import { useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/lib/app-log-commands'
import type { SaveScriptInput } from '@/lib/ipc/scripts-commands'
import {
  useCreateScriptMutation,
  useDeleteScriptMutation,
  useSetScriptDependenciesMutation,
  useUpdateScriptMutation,
} from '@/lib/queries/use-scripts'
import { cn } from '@/lib/utils'
import type { PhaseConfig, Script, ScriptKind } from '@/types/domain'

import { DependencyPicker } from './dependency-picker'
import { PhaseBlock } from './phase-block'
import {
  KIND_OPTIONS,
  MAX_PRIORITY,
  MIN_PRIORITY,
  PHASES,
  type PhaseKey,
  type PriorityTier,
  type ScriptDraft,
  draftFromScript,
  emptyPhase,
  newScriptDraft,
  priorityTier,
} from './script-form-types'

const PRIORITY_RANGE_CLASS: Record<PriorityTier, string> = {
  low: 'bg-priority-low',
  medium: 'bg-priority-medium',
  high: 'bg-priority-high',
}

const PRIORITY_THUMB_CLASS: Record<PriorityTier, string> = {
  low: 'border-priority-low',
  medium: 'border-priority-medium',
  high: 'border-priority-high',
}

const PRIORITY_BADGE_CLASS: Record<PriorityTier, string> = {
  low: 'border-transparent bg-priority-low text-priority-low-foreground',
  medium: 'border-transparent bg-priority-medium text-priority-medium-foreground',
  high: 'border-transparent bg-priority-high text-priority-high-foreground',
}

export interface ScriptEditorPanelProps {
  /** The script being edited, or null for a new draft. */
  script: Script | null
  /** All scripts (for the dependency picker / cycle preview). */
  allScripts: Script[]
  /** Called with the saved script's id after a successful create/update. */
  onSaved: (scriptId: number) => void
  /** Called after the edited script is deleted. */
  onDeleted: () => void
}

function buildInput(draft: ScriptDraft): SaveScriptInput {
  const isUtility = draft.kind === 'utility'
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    kind: draft.kind,
    priority: draft.priority,
    beforeLaunch: isUtility ? emptyPhase() : draft.beforeLaunch,
    afterLaunch: isUtility ? emptyPhase() : draft.afterLaunch,
    onExit: isUtility ? emptyPhase() : draft.onExit,
    snippet: isUtility ? draft.snippet : emptyPhase(),
  }
}

/**
 * Master-detail editor for a script. The layout switches by `kind`:
 * normal/global show a priority slider + three always-expanded phase blocks;
 * utility shows a single phase-less snippet editor. The Requires picker manages
 * utility include edges; the backend remains the cycle authority.
 */
export function ScriptEditorPanel({
  script,
  allScripts,
  onSaved,
  onDeleted,
}: ScriptEditorPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState<ScriptDraft>(() =>
    script ? draftFromScript(script) : newScriptDraft()
  )
  const [requires, setRequires] = useState<number[]>(script?.requires ?? [])
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const createMutation = useCreateScriptMutation()
  const updateMutation = useUpdateScriptMutation()
  const deleteMutation = useDeleteScriptMutation()
  const dependenciesMutation = useSetScriptDependenciesMutation()

  const isUtility = draft.kind === 'utility'
  const saving = createMutation.isPending || updateMutation.isPending

  function setPhase(key: PhaseKey, next: PhaseConfig): void {
    setDraft((current) => ({ ...current, [key]: next }))
  }

  async function applyDependencies(targetId: number, nextRequires: number[]): Promise<boolean> {
    try {
      const persisted = await dependenciesMutation.mutateAsync({
        scriptId: targetId,
        dependsOn: nextRequires,
      })
      setRequires(persisted)
      return true
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err)
      toastError('Could not update requirements', {
        description: 'The change was rejected — it may create a circular reference.',
        category: 'scripts.dependencies',
        details,
      })
      return false
    }
  }

  function addRequirement(utilityId: number): void {
    if (requires.includes(utilityId)) {
      return
    }
    const next = [...requires, utilityId]
    if (script) {
      void applyDependencies(script.id, next)
    } else {
      setRequires(next)
    }
  }

  function removeRequirement(utilityId: number): void {
    const next = requires.filter((id) => id !== utilityId)
    if (script) {
      void applyDependencies(script.id, next)
    } else {
      setRequires(next)
    }
  }

  async function handleSave(): Promise<void> {
    setError(null)
    if (!draft.name.trim()) {
      setError('Enter a script name before saving.')
      return
    }
    const input = buildInput(draft)
    try {
      const saved = script
        ? await updateMutation.mutateAsync({ id: script.id, input })
        : await createMutation.mutateAsync(input)
      // New scripts persist their require edges after creation.
      if (!script && requires.length > 0) {
        const ok = await applyDependencies(saved.id, requires)
        if (!ok) {
          onSaved(saved.id)
          return
        }
      }
      toastSuccess(script ? 'Script updated' : 'Script created', {
        description: saved.name,
        category: 'scripts.editor',
      })
      onSaved(saved.id)
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err)
      setError('Could not save the script right now. Check the fields and try again.')
      toastError('Could not save script', { category: 'scripts.editor', details })
    }
  }

  async function handleDelete(): Promise<void> {
    if (!script) {
      return
    }
    try {
      await deleteMutation.mutateAsync(script.id)
      setConfirmDelete(false)
      onDeleted()
    } catch (err) {
      const details = err instanceof Error ? err.message : String(err)
      toastError('Could not delete script', { category: 'scripts.editor', details })
    }
  }

  return (
    <section
      className="mx-auto h-full w-[min(1100px,70%)] overflow-y-auto p-8"
      data-testid="script-editor-panel"
      aria-label={script ? `Editing ${script.name}` : 'New script'}
    >
      <div className="flex flex-col gap-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold text-foreground">
              {draft.name.trim() || (script ? script.name : 'New script')}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {script
                ? 'Update the script definition, execution phases, and utility requirements.'
                : 'Define how this script runs across launch phases or as a reusable utility snippet.'}
            </p>
          </div>
          {script ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Delete script"
              onClick={() => setConfirmDelete(true)}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Icon name="delete" className="text-[18px]" />
            </Button>
          ) : null}
        </header>

        <section className="space-y-4 rounded-2xl border border-border bg-surface-low p-5">
          <div className="space-y-4">
            <label className="block cursor-pointer space-y-2" htmlFor="script-name">
              <span className="text-sm font-medium text-foreground">Name</span>
              <Input
                id="script-name"
                value={draft.name}
                onChange={(event) => setDraft((c) => ({ ...c, name: event.target.value }))}
              />
            </label>
            <label className="block cursor-pointer space-y-2" htmlFor="script-description">
              <span className="text-sm font-medium text-foreground">Description</span>
              <Textarea
                id="script-description"
                placeholder="Optional"
                value={draft.description}
                onChange={(event) => setDraft((c) => ({ ...c, description: event.target.value }))}
              />
            </label>
          </div>
        </section>

        <section className="space-y-2 rounded-2xl border border-border bg-surface-low p-5">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Kind</legend>
            <div
              role="radiogroup"
              aria-label="Script kind"
              className="grid gap-2 sm:grid-cols-3"
              data-testid="script-kind-group"
            >
              {KIND_OPTIONS.map((option) => {
                const active = draft.kind === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${option.label} kind`}
                    onClick={() => setDraft((c) => ({ ...c, kind: option.value as ScriptKind }))}
                    className={cn(
                      'cursor-pointer rounded-lg border p-3 text-left transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/10'
                        : 'border-border bg-surface hover:border-primary/20'
                    )}
                  >
                    <span className="text-sm font-semibold text-foreground">{option.label}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </fieldset>
        </section>

        {isUtility ? (
          <section
            className="space-y-3 rounded-2xl border border-border bg-surface-low p-5"
            data-testid="script-utility-layout"
          >
            <div>
              <h3 className="font-heading text-base font-semibold text-foreground">Snippet</h3>
              <p className="text-sm text-muted-foreground">
                Reusable code other scripts can require before they run.
              </p>
            </div>
            <PhaseBlock
              label="Snippet"
              icon="extension"
              idPrefix="snippet"
              value={draft.snippet}
              onChange={(next) => setDraft((c) => ({ ...c, snippet: next }))}
            />
          </section>
        ) : (
          <section
            className="space-y-4 rounded-2xl border border-border bg-surface-low p-5"
            data-testid="script-phases-layout"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Priority</span>
                <Badge
                  variant="outline"
                  className={cn('font-mono', PRIORITY_BADGE_CLASS[priorityTier(draft.priority)])}
                >
                  {draft.priority}
                </Badge>
              </div>
              <Slider
                min={MIN_PRIORITY}
                max={MAX_PRIORITY}
                step={1}
                value={[draft.priority]}
                aria-label="Priority"
                onValueChange={([next]) => setDraft((c) => ({ ...c, priority: next }))}
                rangeClassName={PRIORITY_RANGE_CLASS[priorityTier(draft.priority)]}
                thumbClassName={PRIORITY_THUMB_CLASS[priorityTier(draft.priority)]}
              />
              <p className="text-xs text-muted-foreground">
                Higher numbers are executed earlier.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <h3 className="font-heading text-base font-semibold text-foreground">
                  Execution phases
                </h3>
                <p className="text-sm text-muted-foreground">
                  Configure what runs before launch, after launch, and on exit.
                </p>
              </div>
              {PHASES.map((phase) => (
                <PhaseBlock
                  key={phase.key}
                  label={phase.label}
                  icon={phase.icon}
                  idPrefix={phase.key}
                  value={draft[phase.key]}
                  onChange={(next) => setPhase(phase.key, next)}
                />
              ))}
            </div>

            <div className="space-y-2">
              <div>
                <h3 className="font-heading text-base font-semibold text-foreground">
                  Requires (utility scripts)
                </h3>
                <p className="text-sm text-muted-foreground">
                  Utility snippets this script depends on at runtime.
                </p>
              </div>
              <DependencyPicker
                scriptId={script?.id ?? -1}
                allScripts={allScripts}
                requires={requires}
                onAdd={addRequirement}
                onRemove={removeRequirement}
              />
            </div>
          </section>
        )}

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            <Icon name="save" className="text-[18px]" />
            {saving ? 'Saving…' : script ? 'Save changes' : 'Create script'}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {script?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the script and its require edges. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete script'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
