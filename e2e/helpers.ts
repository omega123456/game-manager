import type { Page } from '@playwright/test'

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

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
