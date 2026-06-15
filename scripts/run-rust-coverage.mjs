/**
 * Run the Rust coverage gate via the `gm-llvm-cov` cargo alias.
 *
 * Resolves the rustup-managed llvm-cov / llvm-profdata so cargo-llvm-cov works
 * regardless of which `cargo` binary is first on PATH, then runs the alias with
 * the working directory set to `src-tauri` (where `.cargo/config.toml` lives).
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tauriDir = path.join(root, 'src-tauri')

function tryReadCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function ensureRustCoverageTools(env) {
  if (env.LLVM_COV && env.LLVM_PROFDATA) {
    return env
  }

  const rustupHome =
    env.RUSTUP_HOME ??
    tryReadCommand('rustup', ['show', 'home']) ??
    path.join(env.USERPROFILE ?? env.HOME ?? '', '.rustup')
  const toolchain = tryReadCommand('rustup', ['show', 'active-toolchain'])?.split(/\s+/)[0]
  const host = tryReadCommand('rustc', ['-vV'])
    ?.split('\n')
    .find((line) => line.startsWith('host: '))
    ?.replace('host: ', '')
    .trim()

  if (!rustupHome || !toolchain || !host) {
    return env
  }

  const llvmBinDir = path.join(rustupHome, 'toolchains', toolchain, 'lib', 'rustlib', host, 'bin')
  const ext = process.platform === 'win32' ? '.exe' : ''
  const llvmCov = path.join(llvmBinDir, `llvm-cov${ext}`)
  const llvmProfdata = path.join(llvmBinDir, `llvm-profdata${ext}`)

  if (!existsSync(llvmCov) || !existsSync(llvmProfdata)) {
    return env
  }

  return {
    ...env,
    LLVM_COV: env.LLVM_COV ?? llvmCov,
    LLVM_PROFDATA: env.LLVM_PROFDATA ?? llvmProfdata,
  }
}

const env = ensureRustCoverageTools({ ...process.env })

// `--cfg coverage` excludes the Tauri-runtime entrypoint (lib::run / main) from
// instrumentation — it cannot be exercised in a headless coverage run.
env.RUSTFLAGS = `${env.RUSTFLAGS ? `${env.RUSTFLAGS} ` : ''}--cfg coverage`

const hasRustup = Boolean(tryReadCommand('rustup', ['--version']))
const [command, commandArgs] = hasRustup
  ? ['rustup', ['run', 'stable', 'cargo', 'gm-llvm-cov']]
  : ['cargo', ['gm-llvm-cov']]

const child = spawn(command, commandArgs, {
  cwd: tauriDir,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0))
})
