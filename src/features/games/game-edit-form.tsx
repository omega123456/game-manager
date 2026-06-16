import { useCallback, useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toCoverImageUrl } from '@/lib/asset-url'
import { logFrontend } from '@/lib/app-log-commands'
import { useUpdateGameMutation } from '@/lib/queries/use-games'
import type { Game, MonitorMode } from '@/types/domain'

interface GameEditFormProps {
  game: Game
  onSaved?: () => void
}

interface GameEditState {
  name: string
  launchTarget: string
  argumentsValue: string
  monitorMode: MonitorMode
  monitorExecutablePath: string
  imagePath: string
}

function createInitialState(game: Game): GameEditState {
  return {
    name: game.name,
    launchTarget: game.launchTarget,
    argumentsValue: game.arguments ?? '',
    monitorMode: game.monitorMode,
    monitorExecutablePath: game.monitorProcessName ?? '',
    imagePath: game.imagePath ?? '',
  }
}

function normalizeDialogPath(value: string | string[] | null): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null
  }
  return typeof value === 'string' ? value : null
}

function getDialogErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.trim() ? message : 'Could not open the file picker.'
}

function deriveProcessName(path: string): string | null {
  const normalized = path.trim()
  if (!normalized) {
    return null
  }
  const fileName = normalized.split(/[\\/]/).pop() ?? normalized
  return fileName.trim() || null
}

export function GameEditForm({ game, onSaved }: GameEditFormProps): React.JSX.Element {
  const { mutateAsync: updateGame } = useUpdateGameMutation()
  const [form, setForm] = useState<GameEditState>(() => createInitialState(game))
  const [validationError, setValidationError] = useState<string | null>(null)
  const [browseError, setBrowseError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const isInitialMount = useRef(true)
  const hasPendingSave = useRef(false)
  const saveGameRef = useRef<() => Promise<void>>(async () => {})

  const monitorProcessName = deriveProcessName(form.monitorExecutablePath)
  const coverPreviewUrl = toCoverImageUrl(form.imagePath)

  const saveGame = useCallback(async () => {
    setValidationError(null)
    setBrowseError(null)

    if (!form.name.trim()) {
      setValidationError('Enter a game name before saving.')
      nameInputRef.current?.focus()
      return
    }

    if (!form.launchTarget.trim()) {
      setValidationError('Choose the executable Game Manager should launch.')
      return
    }

    const processName =
      deriveProcessName(form.monitorExecutablePath) ?? deriveProcessName(form.launchTarget)

    try {
      await updateGame({
        id: game.id,
        input: {
          name: form.name.trim(),
          launchTarget: form.launchTarget.trim(),
          monitorMode: form.monitorMode,
          monitorProcessName: form.monitorMode === 'named' ? processName : null,
          arguments: form.argumentsValue.trim() || null,
          imagePath: form.imagePath.trim() || null,
        },
      })
      onSaved?.()
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      setValidationError('Could not save the game right now. Check the fields and try again.')
      logFrontend('error', 'Failed to update a game from the detail modal.', {
        category: 'games.detail',
        details,
      })
    }
  }, [form, game.id, updateGame, onSaved])

  useEffect(() => {
    saveGameRef.current = saveGame
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    hasPendingSave.current = true
    const timer = setTimeout(() => {
      hasPendingSave.current = false
      void saveGame()
    }, 800)
    return () => clearTimeout(timer)
  }, [saveGame])

  useEffect(() => {
    return () => {
      if (hasPendingSave.current) {
        void saveGameRef.current()
      }
    }
  }, [])

  async function browseForExecutable(target: 'launch' | 'monitor' | 'cover'): Promise<void> {
    setBrowseError(null)

    const config =
      target === 'cover'
        ? {
            title: 'Select cover art',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
          }
        : {
            title: target === 'launch' ? 'Select launch executable' : 'Select monitor executable',
            filters: [{ name: 'Applications', extensions: ['exe'] }],
          }

    try {
      const result = await open({
        directory: false,
        multiple: false,
        ...config,
      })
      const path = normalizeDialogPath(result)
      if (!path) {
        return
      }

      setForm((current) => {
        if (target === 'launch') {
          return { ...current, launchTarget: path }
        }
        if (target === 'monitor') {
          return { ...current, monitorExecutablePath: path }
        }
        return { ...current, imagePath: path }
      })
    } catch (error) {
      const message = getDialogErrorMessage(error)
      setBrowseError(message)
      logFrontend('warn', 'Failed to open a picker in the game detail form.', {
        category: 'games.detail',
        details: message,
      })
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[19rem_1fr]" data-testid="game-detail-edit">
      <div className="space-y-4">
        <div className="overflow-hidden rounded-[1.8rem] border border-border bg-card shadow-sm">
          <div className="aspect-3/4 overflow-hidden bg-surface-high">
            {coverPreviewUrl ? (
              <img
                src={coverPreviewUrl}
                alt={`${form.name || game.name} cover art`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-linear-to-br from-primary/20 via-transparent to-secondary/15 text-primary">
                <Icon name="photo" className="text-[52px]" />
              </div>
            )}
          </div>
        </div>
        <div className="rounded-[1.4rem] border border-border bg-surface-low p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Cover art
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Swap in a local file now. Search-based art replacement stays in the add flow.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 w-full"
            onClick={() => void browseForExecutable('cover')}
          >
            <Icon name="image" className="text-[18px]" />
            Change cover
          </Button>
          <p className="mt-3 break-all text-xs text-muted-foreground">
            {form.imagePath || 'No cover selected'}
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <div className="space-y-5 rounded-[1.8rem] border border-border bg-surface-container p-6 shadow-sm">
          <div className="grid gap-5 xl:grid-cols-2">
            <Field label="Game name" htmlFor="detail-game-name">
              <Input
                id="detail-game-name"
                ref={nameInputRef}
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </Field>

            <Field label="Launch arguments" htmlFor="detail-launch-arguments">
              <Input
                id="detail-launch-arguments"
                placeholder="Optional command line arguments"
                value={form.argumentsValue}
                onChange={(event) =>
                  setForm((current) => ({ ...current, argumentsValue: event.target.value }))
                }
              />
            </Field>
          </div>

          <Field label="Launch target" htmlFor="detail-launch-target">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                id="detail-launch-target"
                value={form.launchTarget}
                onChange={(event) =>
                  setForm((current) => ({ ...current, launchTarget: event.target.value }))
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void browseForExecutable('launch')}
              >
                <Icon name="folder_open" className="text-[18px]" />
                Browse
              </Button>
            </div>
          </Field>
        </div>

        <div className="rounded-[1.8rem] border border-border bg-surface-container p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Launcher mode
              </p>
              <h3 className="font-heading text-xl font-semibold text-foreground">
                Watch the real game executable after a launcher starts
              </h3>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Keep direct games on tree monitoring. Switch this on for launcher flows where the
                launched process is only a bootstrapper.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-full border border-border bg-surface-low px-4 py-2">
              <span className="text-sm font-medium text-foreground">Launcher</span>
              <Switch
                checked={form.monitorMode === 'named'}
                onCheckedChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    monitorMode: checked ? 'named' : 'tree',
                  }))
                }
                aria-label="Enable launcher monitoring"
              />
            </div>
          </div>

          {form.monitorMode === 'named' ? (
            <div className="mt-5">
              <div className="rounded-[1.3rem] border border-primary/30 bg-primary/10 p-4">
                <Field label="Monitor executable" htmlFor="detail-monitor-target">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Input
                      id="detail-monitor-target"
                      value={form.monitorExecutablePath}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          monitorExecutablePath: event.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void browseForExecutable('monitor')}
                    >
                      <Icon name="folder_open" className="text-[18px]" />
                      Browse
                    </Button>
                  </div>
                </Field>
                <p className="mt-3 text-sm text-muted-foreground">
                  {monitorProcessName ? (
                    <>
                      Process name:{' '}
                      <span className="font-medium text-foreground">{monitorProcessName}</span>
                    </>
                  ) : (
                    <>
                      Defaults to:{' '}
                      <span className="font-medium text-foreground">
                        {deriveProcessName(form.launchTarget) ?? 'set a launch target first'}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {validationError ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {validationError}
          </p>
        ) : null}

        {browseError ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {browseError}
          </p>
        ) : null}
      </div>
    </section>
  )
}

interface FieldProps {
  label: string
  htmlFor: string
  children: React.ReactNode
}

function Field({ label, htmlFor, children }: FieldProps): React.JSX.Element {
  return (
    <label className="cursor-pointer space-y-2.5" htmlFor={htmlFor}>
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}
