import type { Page } from '@playwright/test'

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

declare global {
  interface Window {
    __gmLaunch__?: (payload: LaunchLifecyclePayload) => void
    __gmDlssScan__?: (payload: DlssScanProgressPayload) => void
  }
}

/** A library-scan-progress payload shape for deterministic E2E driving. */
export interface DlssScanProgressPayload {
  scanned: number
  total: number
  state: {
    gameId: number
    stale: boolean
    superResolution?: { version: string; path: string }
  }
}

/**
 * Push a DLSS library-scan-progress payload straight into the scan-sync hook via
 * the `__gmDlssScan__` test hook installed under `VITE_PLAYWRIGHT`, then wait for
 * the resulting progress toast to appear. Deterministic — no Tauri event runtime.
 */
export async function driveDlssScan(page: Page, payload: DlssScanProgressPayload): Promise<void> {
  await page.waitForFunction(() => typeof window.__gmDlssScan__ === 'function')
  await page.evaluate((p) => {
    window.__gmDlssScan__?.(p)
  }, payload)
  await page.getByText('Scanning DLSS…').waitFor({ state: 'visible' })
}

/** Navigate to the app and wait for the root shell to mount. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' })
  await page.getByTestId('app-root').waitFor({ state: 'visible' })
}

export async function gotoAppState(page: Page, hash: string): Promise<void> {
  await page.goto(`/${hash}`, { waitUntil: 'load' })
  await page.getByTestId('app-root').waitFor({ state: 'visible' })
}

/** Reset the routed scroll container so screenshots start from the top of the page content. */
export async function scrollRouteOutletToTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  })
  await page.getByTestId('route-outlet').evaluate((node) => {
    node.scrollTop = 0
  })
}

/** Set the app theme by toggling `data-theme` on the document element. */
export async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
}

/** Wait until library cover images finish loading or error so screenshots stay stable. */
export async function waitForLibraryGridImagesSettled(page: Page): Promise<void> {
  await page.getByTestId('library-grid').waitFor({ state: 'visible' })
  await page.evaluate(async () => {
    const images = Array.from(
      document.querySelectorAll<HTMLImageElement>('[data-testid="library-grid"] img')
    )
    await Promise.all(
      images.map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete) {
              resolve()
              return
            }
            image.addEventListener('load', () => resolve(), { once: true })
            image.addEventListener('error', () => resolve(), { once: true })
          })
      )
    )
  })
}

/** A launch lifecycle payload shape for deterministic E2E driving. */
export interface LaunchLifecyclePayload {
  gameId: number
  phase: 'before' | 'waitingForProcess' | 'playing' | 'onExit' | 'ended'
  detail?: string
  failedCount: number
  elapsedSeconds?: number
}

/**
 * Push a launch lifecycle payload straight into the launch-store via the
 * `__gmLaunch__` test hook installed under `VITE_PLAYWRIGHT`. Deterministic — no
 * Tauri event runtime or wall-clock timing involved.
 */
export async function driveLaunch(page: Page, payload: LaunchLifecyclePayload): Promise<void> {
  await page.waitForFunction(() => typeof window.__gmLaunch__ === 'function')
  await page.evaluate((p) => {
    window.__gmLaunch__?.(p)
  }, payload)
  await page.getByTestId('launch-banner').waitFor({ state: 'visible' })
}
