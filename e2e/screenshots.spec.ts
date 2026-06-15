import { test, expect } from '@playwright/test'

import { gotoApp, gotoAppState, scrollRouteOutletToTop, setTheme, THEMES } from './helpers'

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
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`app-shell-${theme}.png`)
  })

  test(`settings page — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('link', { name: /Settings/ }).click()
    await page.getByRole('heading', { name: 'API Integrations' }).waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`settings-page-${theme}.png`)
  })

  test(`library grid — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Your collection' }).waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`library-grid-${theme}.png`)
  })

  test(`library empty — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/library?libraryFixture=empty')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Your library is empty' }).waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`library-empty-${theme}.png`)
  })

  test(`library loading — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/library?libraryFixture=loading')
    await setTheme(page, theme)
    await page.getByTestId('library-loading').waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`library-loading-${theme}.png`)
  })

  test(`add game wizard step 1 — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('button', { name: 'Add Game' }).click()
    await page.getByTestId('add-game-step-1').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`add-game-step-1-${theme}.png`)
  })

  test(`add game wizard step 2 — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('button', { name: 'Add Game' }).click()
    await page.getByRole('button', { name: 'Browse for executable' }).click()
    await page.getByRole('button', { name: 'Continue to cover art' }).click()
    await page.getByTestId('art-candidate-grid').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`add-game-step-2-${theme}.png`)
  })

  test(`add game wizard step 3 — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('button', { name: 'Add Game' }).click()
    await page.getByRole('button', { name: 'Browse for executable' }).click()
    await page.getByRole('button', { name: 'Continue to cover art' }).click()
    await page.getByTestId('art-candidate-grid').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Continue to details' }).click()
    await page.getByTestId('add-game-step-3').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`add-game-step-3-${theme}.png`)
  })

  test(`game detail overview — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('button', { name: 'Open Alan Wake 2' }).click()
    await page.getByTestId('game-detail-overview').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`game-detail-overview-${theme}.png`)
  })

  test(`game detail edit — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('button', { name: 'Open Alan Wake 2' }).click()
    await page.getByRole('tab', { name: 'Edit' }).click()
    await page.getByTestId('game-detail-edit').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`game-detail-edit-${theme}.png`)
  })

  test(`script manager normal editor — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('link', { name: /Script Manager/ }).click()
    await page.getByRole('button', { name: 'Edit Auto-Save Manager' }).click()
    await page.getByTestId('script-phases-layout').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`script-manager-normal-${theme}.png`)
  })

  test(`script manager utility editor — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('link', { name: /Script Manager/ }).click()
    await page.getByRole('button', { name: 'Edit SaveLib' }).click()
    await page.getByTestId('script-utility-layout').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`script-manager-utility-${theme}.png`)
  })
}
