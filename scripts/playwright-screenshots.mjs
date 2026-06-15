/**
 * Runs screenshot specs with a dynamically allocated dev-server port so screenshot
 * runs do not collide with `pnpm dev` on 1420 or a prior Playwright webServer.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { DEV_SERVER_HOST, pickRandomDevPort } from './pick-dev-port.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = await pickRandomDevPort(DEV_SERVER_HOST)

const extraArgs = process.argv.slice(2)
const result = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', 'e2e/screenshots.spec.ts', ...extraArgs],
  {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      PLAYWRIGHT_DEV_PORT: String(port),
    },
  }
)

process.exit(result.status ?? 1)
