import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'

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
import { Button } from '@/components/ui/button'
import { CodeEditor } from '@/components/ui/code-editor'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { logFrontend } from '@/lib/app-log-commands'
import { cn } from '@/lib/utils'
import type { Interpreter, PhaseConfig } from '@/types/domain'

import { defaultInterpreter, phaseHasContent } from './script-form-types'

const INTERPRETERS: readonly { value: Interpreter; label: string }[] = [
  { value: 'powershell', label: 'PowerShell' },
  { value: 'powershell7', label: 'PowerShell 7' },
  { value: 'batch', label: 'Batch' },
]

export interface PhaseBlockProps {
  /** Block heading (phase name or "Snippet"). */
  label: string
  /** Material Symbols glyph for the header. */
  icon: string
  /** Stable id prefix for inputs/labels. */
  idPrefix: string
  value: PhaseConfig
  onChange: (next: PhaseConfig) => void
}

/**
 * One always-expanded phase (or utility snippet) editor. The header carries the
 * phase name + a Path/Code segmented toggle; the body shows either a path
 * Input+Browse, or a Monaco inline editor with a PowerShell/Batch interpreter
 * selector. Switching Code→Path while inline content exists prompts a warning.
 */
export function PhaseBlock({
  label,
  icon,
  idPrefix,
  value,
  onChange,
}: PhaseBlockProps): React.JSX.Element {
  const [pendingPathSwitch, setPendingPathSwitch] = useState(false)
  const [browseError, setBrowseError] = useState<string | null>(null)

  const hasContent = phaseHasContent(value)
  // The toggle treats `none` as "Path" (the default empty surface).
  const activeTab: 'path' | 'inline' = value.mode === 'inline' ? 'inline' : 'path'

  function selectPath(): void {
    if (value.mode === 'inline' && Boolean(value.inline?.trim())) {
      setPendingPathSwitch(true)
      return
    }
    onChange({ mode: 'path', path: value.path ?? '' })
  }

  function confirmPathSwitch(): void {
    setPendingPathSwitch(false)
    onChange({ mode: 'path', path: value.path ?? '' })
  }

  function selectInline(): void {
    onChange({
      mode: 'inline',
      inline: value.inline ?? '',
      interpreter: defaultInterpreter(value),
    })
  }

  async function browseForPath(): Promise<void> {
    setBrowseError(null)
    try {
      const result = await open({
        directory: false,
        multiple: false,
        title: `Select a script for ${label}`,
        filters: [{ name: 'Scripts', extensions: ['ps1', 'bat', 'cmd', 'exe'] }],
      })
      const path = Array.isArray(result) ? result[0] : result
      if (typeof path === 'string' && path) {
        onChange({ mode: 'path', path })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open the file picker.'
      setBrowseError(message)
      logFrontend('warn', 'Failed to open the script file picker.', {
        category: 'scripts.editor',
        details: message,
      })
    }
  }

  return (
    <section
      className={cn(
        'rounded-xl border transition-colors',
        hasContent ? 'border-primary/30 bg-primary/10' : 'border-border bg-surface-low'
      )}
      data-testid={`phase-block-${idPrefix}`}
      data-has-content={hasContent}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon
            name={icon}
            className={cn('text-[20px]', hasContent ? 'text-primary' : 'text-muted-foreground')}
          />
          <span className="text-sm font-semibold text-foreground">{label}</span>
        </div>
        <div
          role="radiogroup"
          aria-label={`${label} source`}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-lowest p-1"
        >
          <button
            type="button"
            role="radio"
            aria-checked={activeTab === 'path'}
            onClick={selectPath}
            className={cn(
              'cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors',
              activeTab === 'path'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Path
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={activeTab === 'inline'}
            onClick={selectInline}
            className={cn(
              'cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors',
              activeTab === 'inline'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Code
          </button>
        </div>
      </header>

      <div className="space-y-3 px-4 pb-4">
        {activeTab === 'path' ? (
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={`${idPrefix}-path`}
                aria-label={`${label} script path`}
                placeholder="C:\Commands\example.ps1"
                value={value.path ?? ''}
                onChange={(event) => onChange({ mode: 'path', path: event.target.value })}
              />
              <Button type="button" variant="outline" onClick={() => void browseForPath()}>
                <Icon name="folder_open" className="text-[18px]" />
                Browse
              </Button>
            </div>
            {browseError ? <p className="text-xs text-destructive">{browseError}</p> : null}
          </div>
        ) : (
          <div className="space-y-2">
            <CodeEditor
              ariaLabel={`${label} inline code`}
              value={value.inline ?? ''}
              interpreter={defaultInterpreter(value)}
              onChange={(inline) =>
                onChange({ mode: 'inline', inline, interpreter: defaultInterpreter(value) })
              }
            />
            <div
              role="radiogroup"
              aria-label={`${label} interpreter`}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-lowest p-1"
            >
              {INTERPRETERS.map((option) => {
                const active = defaultInterpreter(value) === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() =>
                      onChange({
                        mode: 'inline',
                        inline: value.inline ?? '',
                        interpreter: option.value,
                      })
                    }
                    className={cn(
                      'cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={pendingPathSwitch} onOpenChange={setPendingPathSwitch}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard inline code?</AlertDialogTitle>
            <AlertDialogDescription>
              Switching {label} to an external path keeps your inline code stored but stops using
              it. The path will run instead until you switch back to Code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing code</AlertDialogCancel>
            <AlertDialogAction onClick={confirmPathSwitch}>Use a path</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
