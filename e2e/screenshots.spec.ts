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
    await page.getByRole('heading', { name: 'Updates' }).waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`settings-page-${theme}.png`)
  })

  test(`update available toast — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/library?updateFixture=available')
    await setTheme(page, theme)
    await page.getByText('Update available').waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Update now' }).waitFor({ state: 'visible' })
    await waitForLibraryGridImagesSettled(page)
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`update-available-toast-${theme}.png`)
  })

  test(`logs page — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('link', { name: /Logs/ }).click()
    await page.getByRole('heading', { name: 'Logs', level: 1 }).waitFor({ state: 'visible' })
    await page.getByText('Showing', { exact: false }).first().waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`logs-page-${theme}.png`)
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

  test(`launch banner scripts popover — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/library?launchRunFixture=active')
    await setTheme(page, theme)
    await driveLaunch(page, {
      gameId: 1,
      phase: 'playing',
      failedCount: 1,
      elapsedSeconds: 95,
    })
    await page.getByTestId('launch-banner-scripts').click()
    await page.getByText('Execution pipeline').waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`launch-banner-scripts-popover-${theme}.png`)
  })

  test(`currently playing hero scripts popover — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/library?launchRunFixture=failed')
    await setTheme(page, theme)
    await page.getByTestId('currently-playing-hero').waitFor({ state: 'visible' })
    await page.getByTestId('hero-scripts').waitFor({ state: 'visible' })
    await page.getByTestId('hero-scripts').click()
    await page.getByText('Execution pipeline').waitFor({ state: 'visible' })
    await waitForLibraryGridImagesSettled(page)
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`currently-playing-hero-scripts-popover-${theme}.png`)
  })

  test(`group manager detail — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('link', { name: /Group Manager/ }).click()
    await page.getByRole('button', { name: 'Edit HDR Games' }).click()
    await page.getByTestId('group-detail-panel').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`group-manager-detail-${theme}.png`)
  })

  // ── DLSS Management ──────────────────────────────────────────────────────

  test(`dlss page populated — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'DLSS Management' }).waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Global Overrides' }).waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Global Presets' }).waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Global Indicator' }).waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`dlss-page-populated-${theme}.png`)
  })

  test(`dlss global indicator card — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss')
    await setTheme(page, theme)
    const indicatorHeading = page.getByRole('heading', { name: 'Global Indicator' })
    await indicatorHeading.waitFor({ state: 'visible' })
    const indicatorCard = indicatorHeading.locator('xpath=ancestor::section[1]')
    await indicatorHeading.scrollIntoViewIfNeeded()
    await page.getByRole('combobox', { name: 'Show on-screen indicator' }).waitFor({
      state: 'visible',
    })
    await expect(indicatorCard).toHaveScreenshot(`dlss-global-indicator-card-${theme}.png`)
  })

  test(`dlss version combobox open — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Global Overrides' }).waitFor({ state: 'visible' })
    await page.getByRole('combobox', { name: 'DLSS Super Resolution' }).click()
    // Downloaded + Available group headings confirm the grouped list is open.
    await page.getByRole('option', { name: /v3\.7\.10/ }).waitFor({ state: 'visible' })
    await page.getByRole('option', { name: /v3\.8\.0/ }).waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`dlss-version-combobox-open-${theme}.png`)
  })

  test(`dlss download in progress — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss?dlssFixture=mid-download')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Global Overrides' }).waitFor({ state: 'visible' })
    await page.getByRole('combobox', { name: 'DLSS Super Resolution' }).click()
    // v3.8.0 is the not-downloaded version → selecting it starts a download.
    await page.getByRole('option', { name: /v3\.8\.0/ }).click()
    await page.getByText(/Downloading 3\.8\.0/).waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`dlss-download-in-progress-${theme}.png`)
  })

  test(`dlss apply to all confirm — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Global Overrides' }).waitFor({ state: 'visible' })
    await page.getByRole('combobox', { name: 'DLSS Super Resolution' }).click()
    await page.getByRole('option', { name: /v3\.7\.10/ }).click()
    await page
      .getByRole('button', { name: /Apply to All/ })
      .first()
      .click()
    await page
      .getByRole('alertdialog')
      .getByText(/Apply DLSS Super Resolution/)
      .waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`dlss-apply-to-all-confirm-${theme}.png`)
  })

  test(`dlss apply to all result — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss?dlssFixture=batch-failures')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Global Overrides' }).waitFor({ state: 'visible' })
    await page.getByRole('combobox', { name: 'DLSS Super Resolution' }).click()
    await page.getByRole('option', { name: /v3\.7\.10/ }).click()
    await page
      .getByRole('button', { name: /Apply to All/ })
      .first()
      .click()
    await page.getByRole('button', { name: /Apply to/ }).click()
    // Persistent toast with "View details" → open the result dialog.
    await page.getByRole('button', { name: 'View details' }).click()
    await page.getByTestId('apply-result-list').waitFor({ state: 'visible' })
    await page.getByText('City Skyline X').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`dlss-apply-to-all-result-${theme}.png`)
  })

  test(`dlss apply to all in progress — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss?dlssFixture=mid-apply')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Global Overrides' }).waitFor({ state: 'visible' })
    await page.getByRole('combobox', { name: 'DLSS Super Resolution' }).click()
    await page.getByRole('option', { name: /v3\.7\.10/ }).click()
    await page
      .getByRole('button', { name: /Apply to All/ })
      .first()
      .click()
    await page.getByRole('button', { name: /Apply to/ }).click()
    await page.getByTestId('apply-progress-panel').waitFor({ state: 'visible' })
    await page.getByText('0 of 2 complete').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`dlss-apply-to-all-in-progress-${theme}.png`)
  })

  test(`dlss global presets unsupported — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss?dlssFixture=no-nvidia')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Global Presets' }).waitFor({ state: 'visible' })
    await page
      .getByText(/NVIDIA/)
      .first()
      .waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`dlss-global-presets-unsupported-${theme}.png`)
  })

  test(`dlss empty state — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss?dlssFixture=empty')
    await setTheme(page, theme)
    await page.getByText('No DLSS-compatible games detected').waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`dlss-empty-state-${theme}.png`)
  })

  test(`dlss elevation banner — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss?dlssFixture=not-elevated')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'DLSS Management' }).waitFor({ state: 'visible' })
    await page.getByRole('heading', { name: 'Global Overrides' }).waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`dlss-elevation-banner-${theme}.png`)
  })

  test(`dlss elevation toast — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss?dlssFixture=elevation-toast')
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Global Overrides' }).waitFor({ state: 'visible' })
    await page.getByRole('combobox', { name: 'DLSS Super Resolution' }).click()
    await page.getByRole('option', { name: /v3\.7\.10/ }).click()
    await page
      .getByRole('button', { name: /Apply to All/ })
      .first()
      .click()
    await page.getByRole('button', { name: /Apply to/ }).click()
    await page.getByText('Administrator access required').waitFor({ state: 'visible' })
    await page
      .getByRole('button', { name: 'Relaunch as Administrator' })
      .waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`dlss-elevation-toast-${theme}.png`)
  })

  test(`dlss loading skeleton — ${theme}`, async ({ page }) => {
    await gotoAppState(page, '#/dlss?dlssFixture=loading')
    await setTheme(page, theme)
    await page.getByTestId('dlss-loading').waitFor({ state: 'visible' })
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`dlss-loading-skeleton-${theme}.png`)
  })

  // ── Per-game DLSS tab + library card pills ───────────────────────────────

  test(`game detail dlss tab with presets — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('button', { name: 'Open Alan Wake 2' }).click()
    await page.getByRole('tab', { name: 'DLSS' }).click()
    await page.getByTestId('game-detail-dlss').waitFor({ state: 'visible' })
    await page.getByText('Detected versions').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`game-detail-dlss-with-presets-${theme}.png`)
  })

  test(`game detail dlss tab without presets — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('button', { name: 'Open Balatro' }).click()
    await page.getByRole('tab', { name: 'DLSS' }).click()
    await page.getByTestId('game-detail-dlss').waitFor({ state: 'visible' })
    await page.getByText('Presets unavailable').waitFor({ state: 'visible' })
    await expect(page).toHaveScreenshot(`game-detail-dlss-without-presets-${theme}.png`)
  })

  test(`library cards with dlss pills — ${theme}`, async ({ page }) => {
    await gotoApp(page)
    await setTheme(page, theme)
    await page.getByRole('heading', { name: 'Your collection' }).waitFor({ state: 'visible' })
    await page.getByTestId('library-grid').waitFor({ state: 'visible' })
    await page.getByTestId('dlss-pills').first().waitFor({ state: 'visible' })
    await waitForLibraryGridImagesSettled(page)
    await scrollRouteOutletToTop(page)
    await expect(page).toHaveScreenshot(`library-cards-dlss-pills-${theme}.png`)
  })
}
