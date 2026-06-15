import '@testing-library/jest-dom'
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { mockConvertFileSrc } from '@tauri-apps/api/mocks'

import { setupIpc } from './ipc-mock'

// Register the centralized IPC mock hooks (beforeEach + afterEach) for all tests.
setupIpc()

// Make convertFileSrc deterministic so asset-url normalization is testable.
beforeEach(() => {
  mockConvertFileSrc('windows')
})

// ---------------------------------------------------------------------------
// Polyfills for jsdom
// ---------------------------------------------------------------------------

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver
}

if (typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

// Radix UI primitives (Select, etc.) call Pointer Capture APIs that jsdom lacks.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}

afterEach(() => {
  act(() => {
    cleanup()
  })
})
