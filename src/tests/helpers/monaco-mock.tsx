import * as React from 'react'
import { vi } from 'vitest'

/**
 * Lightweight stand-in for `@monaco-editor/react`. The real Monaco editor cannot
 * mount in jsdom (it needs layout + web workers), so tests mock the module with
 * this textarea-backed component. It preserves the value/onChange contract and an
 * accessible label so behavior can be asserted without the heavy editor.
 *
 * Usage (at the top of a test file, before importing the component under test):
 *   vi.mock('@monaco-editor/react', () => monacoEditorMock())
 */
export function monacoEditorMock() {
  function MockEditor({
    value,
    onChange,
    language,
  }: {
    value?: string
    onChange?: (value: string | undefined) => void
    language?: string
  }): React.JSX.Element {
    return (
      <textarea
        data-testid="monaco-mock"
        data-language={language}
        value={value ?? ''}
        onChange={(event) => onChange?.(event.target.value)}
      />
    )
  }

  return {
    __esModule: true,
    default: MockEditor,
    loader: { config: vi.fn() },
  }
}
