import type { Page } from '@playwright/test'

export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/** Navigate to the app and wait for the root shell to mount. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' })
  await page.getByTestId('app-root').waitFor({ state: 'visible' })
}

/** Set the app theme by toggling `data-theme` on the document element. */
export async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
}
