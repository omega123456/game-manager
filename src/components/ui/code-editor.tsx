import * as React from 'react'
import Editor, { loader } from '@monaco-editor/react'

import { cn } from '@/lib/utils'
import type { Interpreter } from '@/types/domain'

// Bundle Monaco locally instead of fetching it from a CDN (offline-first
// desktop app). The dynamic import keeps the heavy `monaco-editor` module out of
// the synchronous import graph (it cannot load in jsdom), so tests that render
// routes without mounting the editor are unaffected.
let monacoConfigured = false
function configureMonaco(): void {
  if (monacoConfigured) {
    return
  }
  monacoConfigured = true
  void import('monaco-editor').then((monaco) => loader.config({ monaco }))
}

/** Map a script interpreter to the Monaco language id. */
function interpreterLanguage(interpreter: Interpreter): string {
  return interpreter === 'batch' ? 'bat' : 'powershell'
}

export interface CodeEditorProps {
  /** Inline code value. */
  value: string
  /** Called with the updated code on every edit. */
  onChange: (value: string) => void
  /** Interpreter that determines the syntax-highlighting language. */
  interpreter: Interpreter
  /** Accessible label for the editing region. */
  ariaLabel: string
  className?: string
}

/**
 * Monaco-backed inline code editor. Theme follows the document `data-theme`
 * attribute so it matches the active app theme. Bundled locally (no CDN) for
 * offline use. In Vitest this module is mocked so the heavy editor never mounts
 * in jsdom.
 */
export function CodeEditor({
  value,
  onChange,
  interpreter,
  ariaLabel,
  className,
}: CodeEditorProps): React.JSX.Element {
  React.useEffect(() => {
    configureMonaco()
  }, [])

  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'

  return (
    <div
      className={cn('overflow-hidden rounded-md border border-input bg-surface-lowest', className)}
      data-testid="code-editor"
      role="group"
      aria-label={ariaLabel}
    >
      <Editor
        height="180px"
        language={interpreterLanguage(interpreter)}
        theme={isDark ? 'vs-dark' : 'vs'}
        value={value}
        onChange={(next) => onChange(next ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
        }}
      />
    </div>
  )
}
