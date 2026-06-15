import { test, expect } from '@playwright/test'

import { gotoApp, setTheme, THEMES } from './helpers'

/**
 * Visual-regression coverage. Every visible UI state must have a screenshot
 * baseline in BOTH light and dark themes (the canonical rule for this project).
 * Baselines are generated on first run via `pnpm test:e2e -- --update-snapshots`.
 *
 * Phase A1 ships only the empty shell; feature states are added per phase.
 */
for (const theme of THEMES) {
  test(`app shell — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await expect(page).toHaveScreenshot(`app-shell-${theme}.png`)
  })

  test(`settings page — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('link', { name: /Settings/ }).click()
    await page.getByRole('heading', { name: 'API Integrations' }).waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`settings-page-${theme}.png`)
  })
}
