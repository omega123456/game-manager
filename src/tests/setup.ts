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

// A ResizeObserver that synchronously invokes its callback on `observe`, so
// consumers that rely on the initial measurement (e.g. `@tanstack/react-virtual`)
// receive the polyfilled element dimensions in jsdom instead of a stale 0×0 rect.
globalThis.ResizeObserver = class ResizeObserver {
  private readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    )
  }
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof globalThis.ResizeObserver

// jsdom reports zero layout dimensions, which leaves `@tanstack/react-virtual`
// with an empty viewport (no rows rendered). Give every element a deterministic
// non-zero size so the grid virtualizer measures a usable window: a wide content
// width (so the column count derives) and a tall viewport (so modest datasets
// render fully while large datasets still windowed).
const VIRTUAL_TEST_WIDTH = 1200
const VIRTUAL_TEST_HEIGHT = 2400
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get() {
    return VIRTUAL_TEST_WIDTH
  },
})
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get() {
    return VIRTUAL_TEST_HEIGHT
  },
})
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
  configurable: true,
  get() {
    return VIRTUAL_TEST_WIDTH
  },
})
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return VIRTUAL_TEST_HEIGHT
  },
})
Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  const width = VIRTUAL_TEST_WIDTH
  const height = VIRTUAL_TEST_HEIGHT
  return {
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
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
