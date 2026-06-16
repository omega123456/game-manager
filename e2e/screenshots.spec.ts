import { test, expect } from '@playwright/test'

import {
  driveLaunch,
  gotoApp,
  gotoAppState,
  scrollRouteOutletToTop,
  setTheme,
  THEMES,
  waitForLibraryGridImagesSettled,
} from './helpers'

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
    await waitForLibraryGridImagesSettled(page)
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
    await page.getByTestId('library-grid').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Open Alan Wake 2' }).waitFor({ state: 'visible' })
    await waitForLibraryGridImagesSettled(page)
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

  test(`launch card hidden — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/library?libraryFixture=empty')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Your library is empty' }).waitFor({ state: 'visible' })
    await expect(page.getByTestId('launch-game-button')).toHaveCount(0)
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`launch-card-hidden-${theme}.png`)
  })

  test(`library loading — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/library?libraryFixture=loading')
    await setTheme(page, theme)
    await page.getByTestId('library-loading').waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`library-loading-${theme}.png`)
  })

  test(`library group filter — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('combobox', { name: 'Filter library by group' }).click()
    await page.getByRole('option', { name: 'HDR Games' }).click()
    await page.getByRole('button', { name: 'Open Alan Wake 2' }).waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`library-group-filter-${theme}.png`)
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

  test(`game detail groups — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('button', { name: 'Open Alan Wake 2' }).click()
    await page.getByRole('tab', { name: 'Groups' }).click()
    await page.getByTestId('game-detail-groups-tab').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`game-detail-groups-${theme}.png`)
  })

  test(`game detail scripts — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('button', { name: 'Open Alan Wake 2' }).click()
    await page.getByRole('tab', { name: 'Scripts' }).click()
    await page.getByTestId('game-detail-scripts-tab').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`game-detail-scripts-${theme}.png`)
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

  test(`launch banner preparing — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await driveLaunch(page, { gameId: 1, phase: 'before', failedCount: 0, detail: '2/3 scripts' })
    await page.getByText('Preparing', { exact: false }).first().waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`launch-banner-preparing-${theme}.png`)
  })

  test(`launch banner launching — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await driveLaunch(page, {
      gameId: 1,
      phase: 'waitingForProcess',
      failedCount: 0,
      elapsedSeconds: 14,
    })
    await page.getByTestId('launch-banner-cancel').waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`launch-banner-launching-${theme}.png`)
  })

  test(`launch banner playing — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await driveLaunch(page, {
      gameId: 1,
      phase: 'playing',
      failedCount: 1,
      elapsedSeconds: 95,
    })
    await page.getByTestId('game-card-playing').first().waitFor({ state: 'visible' })
    await page.getByTestId('launch-banner-failure').waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`launch-banner-playing-${theme}.png`)
  })

  test(`launch banner done — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await driveLaunch(page, { gameId: 1, phase: 'playing', failedCount: 0, elapsedSeconds: 8040 })
    await driveLaunch(page, { gameId: 1, phase: 'ended', failedCount: 0, elapsedSeconds: 8040 })
    await page.getByTestId('launch-banner-done').waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`launch-banner-done-${theme}.png`)
  })

  test(`group manager detail — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('link', { name: /Group Manager/ }).click()
    await page.getByRole('button', { name: 'Edit HDR Games' }).click()
    await page.getByTestId('group-detail-panel').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`group-manager-detail-${theme}.png`)
  })
}
