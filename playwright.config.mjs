import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'
import { DEV_SERVER_HOST } from './scripts/pick-dev-port.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const portFile = path.join(root, '.playwright-dev-port')

// The port file is written by ensure-playwright-port.mjs before `test:e2e`;
// screenshot runs pass PLAYWRIGHT_DEV_PORT directly. Reading from a file (rather
// than probing at config-evaluation time) is critical because Playwright evaluates
// the config module in EVERY worker process — each probe would race and pick a
// different port than the webServer is bound to.
const portText =
  process.env.PLAYWRIGHT_DEV_PORT ?? (existsSync(portFile) ? readFileSync(portFile, 'utf8') : null)

if (portText === null) {
  throw new Error(
    'Missing .playwright-dev-port. Run Playwright via pnpm test:e2e / pnpm test:screenshots, ' +
      'set PLAYWRIGHT_DEV_PORT, or first run: node scripts/ensure-playwright-port.mjs'
  )
}

const port = parseInt(portText.trim(), 10)
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid Playwright dev server port: ${portText.trim()}`)
}

const baseURL = `http://${DEV_SERVER_HOST}:${port}`

const availableCpus = Math.max(1, os.availableParallelism?.() ?? os.cpus().length)
const isCI = !!process.env.CI
const isScreenshotRun = process.env.PLAYWRIGHT_SCREENSHOT_RUN === '1'
// Screenshot-only runs (scripts/playwright-screenshots.mjs) may use more workers; capped at 10.
const workers = isCI ? 1 : Math.min(isScreenshotRun ? 10 : 2, availableCpus)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers,
  reporter: 'line',
  timeout: 15_000,
  expect: {
    // Do not loosen these tolerances to make screenshots pass — fix the UI or
    // intentionally update baselines instead.
    toHaveScreenshot: {
      maxDiffPixels: 50,
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
    },
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // --strictPort: fail fast if the probed port was grabbed by a race.
    command: `pnpm --silent exec vite --host ${DEV_SERVER_HOST} --port ${port} --strictPort --logLevel error`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false, // Always start fresh so VITE_PLAYWRIGHT=true applies.
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      VITE_PLAYWRIGHT: 'true',
    },
  },
})
