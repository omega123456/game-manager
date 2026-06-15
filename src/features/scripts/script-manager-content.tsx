import { useMemo, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { useScriptsQuery } from '@/lib/queries/use-scripts'
import type { Script } from '@/types/domain'

import { ScriptEditorPanel } from './script-editor-panel'
import { ScriptList } from './script-list'

type Selection = { mode: 'none' } | { mode: 'new' } | { mode: 'edit'; id: number }

/**
 * Script Manager master-detail page. The left list selects (or creates) a
 * script; the right panel edits it. Selection is local panel state, not a route.
 */
export function ScriptManagerContent(): React.JSX.Element {
  const scriptsQuery = useScriptsQuery()
  const scripts = useMemo(
    () => [...(scriptsQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [scriptsQuery.data]
  )

  const [selection, setSelection] = useState<Selection>({ mode: 'none' })

  const selectedScript: Script | null =
    selection.mode === 'edit'
      ? (scripts.find((script) => script.id === selection.id) ?? null)
      : null

  const selectedId = selection.mode === 'edit' ? selection.id : null

  // Re-mount the editor whenever the selection target changes so its draft seeds
  // from the freshly-selected script.
  const editorKey =
    selection.mode === 'edit' ? `edit-${selection.id}` : selection.mode === 'new' ? 'new' : 'none'

  return (
    <div className="grid h-full grid-cols-[20rem_1fr] overflow-hidden" data-testid="script-manager">
      <h1 className="sr-only">Script Manager</h1>
      <ScriptList
        scripts={scripts}
        selectedId={selectedId}
        onSelect={(id) => setSelection({ mode: 'edit', id })}
        onNew={() => setSelection({ mode: 'new' })}
      />

      <div className="h-full overflow-hidden">
        {selection.mode === 'none' || (selection.mode === 'edit' && !selectedScript) ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
            data-testid="script-editor-empty"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon name="code" className="text-[28px]" />
            </span>
            <h2 className="font-heading text-lg font-semibold text-foreground">
              Select or create a script
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Pick a script from the list to edit it, or create a new one to define its phases or
              utility snippet.
            </p>
          </div>
        ) : (
          <ScriptEditorPanel
            key={editorKey}
            script={selectedScript}
            allScripts={scripts}
            onSaved={(id) => setSelection({ mode: 'edit', id })}
            onDeleted={() => setSelection({ mode: 'none' })}
          />
        )}
      </div>
    </div>
  )
}
