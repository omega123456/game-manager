# Game Manager

A **Windows 11 desktop game library and launch orchestrator** built with Tauri 2 and React 19 (TypeScript). The UI is a native shell—sidebar navigation, cover-art library grid, script and group managers, and a live launch lifecycle banner—with light/dark theming and accent colors. **SQLite** is the single source of truth in the Rust backend; the frontend talks to the database only through Tauri IPC (`invoke`). Game launches run a configurable script pipeline across three lifecycle phases, monitor the game process for playtime, and log every step locally. 

## Contents

- **Develop locally**
  - [Requirements](#requirements)
  - [Setup](#setup)
  - [Quick start](#quick-start)
  - [Scripts](#scripts)
- **Reference**
  - [Features](#features)
  - [Game library](#game-library)
  - [Launch orchestration](#launch-orchestration)
  - [Script system](#script-system)
  - [Groups](#groups)
  - [Settings](#settings)
  - [Stack](#stack)
  - [Project layout](#project-layout)
  - [Contributing](#contributing)
  - [CLAUDE.md](CLAUDE.md)

## Features

- **Game library** — responsive 3:4 cover-art card grid with total playtime, last played, group badges, and a **Currently Playing** indicator
- **Add-game wizard** — three-step flow: pick an executable via native file dialog → search SteamGridDB for cover art (with a local-file fallback) → confirm metadata and save
- **Game detail** — tabbed modal: **Overview** (hero art, stats, Play), **Scripts** (direct assignments, group-inherited scripts, resolved execution-order preview), **Groups** (membership), **Edit** (name, launch target, monitor mode, arguments, cover image)
- **Launch orchestration** — resolve applicable scripts, execute **Before Launch → After Process Detected → On Exit**, surface a live lifecycle banner, and **never halt the pipeline** on individual script failures (best-effort with full logging)
- **Playtime tracking** — one `play_sessions` row per app-launched session; library cards show aggregate totals and last played
- **Script manager** — full CRUD for **normal**, **global**, and **utility** scripts; three lifecycle phases per normal/global script; external file or inline PowerShell/Batch; Monaco editor; utility `require` edges with **cycle detection** enforced in Rust
- **Group manager** — CRUD groups; assign scripts to a group; view member games; games inherit group scripts in the resolver
- **Process monitoring** — per-game **job-object tree** tracking (default) or **named-process** tracking for launcher/store titles
- **Settings** — global script toggles, launch options (raise game priority), API keys (SteamGridDB + Steam Web), and appearance (light / dark / system theme + accent color)
- **Application logging** — structured logs table with retention and incremental vacuum; frontend logging routed through IPC (no raw `console` in feature code)
- **Native desktop app** — smaller footprint than typical Electron stacks; bundles to MSI via Tauri

## Game library

The home screen (`/library`) is a filterable, sortable grid of game cards.

- Cards show cover art, name, formatted playtime, last played, and group membership chips.
- Filter and sort by group, last played, total time, or name.
- **Add Game** opens the three-step wizard (executable → art → confirm).
- Clicking a card opens the **Game Detail** modal.
- When a game is active, its card and the sidebar **Continue Playing** mini-card highlight the session; the **Currently Playing** hero appears on the library when applicable.
- **Play Now** in the top bar launches the most recently played game.

## Launch orchestration

Press **Play** on a game card, from the detail modal, or use **Play Now** / the sidebar continue card to start a session.

1. **Before Launch** — run resolved scripts for the `before` phase (global → group → direct, priority-sorted).
2. **Waiting for process** — launch the game executable and poll until the monitored process is detected (job-object tree or named process, per game config).
3. **After Process Detected** — run `after` phase scripts (e.g. gaming-mode tweaks, sleep prevention).
4. **Playing** — track elapsed time while the process (or job tree) remains alive; optional **High** process priority when enabled in Settings.
5. **On Exit** — run `onExit` phase scripts when the session ends.
6. **Done** — write the play session, show a brief summary in the launch banner, and refresh library aggregates.

The **launch banner** under the top bar shows the current phase, elapsed time, script failure count, and cancel/stop actions. Cancelling before the game starts aborts the pipeline; stopping during play ends monitoring and runs exit-phase scripts where applicable.

Individual script failures are logged and counted but do **not** block subsequent scripts or the overall launch.

## Script system

Scripts live under **Script Manager** (`/scripts`).

| Kind | Behavior |
| ---- | -------- |
| **Normal** | Assigned directly to games or groups; has priority (1–10) and three phases |
| **Global** | Applies to every game when enabled in Settings; same phase model as normal |
| **Utility** | Phase-less snippet (inline or external) that other scripts `require`/include |

Each phase (`before`, `after`, `onExit`) is either an **external file path** (`.ps1`, `.bat`, `.cmd`, `.exe`) or **inline** code with a PowerShell or Batch interpreter. Utility dependencies form a **DAG**; cycles are rejected at save time in the Rust backend.

The **resolved script preview** (game detail → Scripts tab) shows the merged, priority-sorted list per phase with provenance chips (`global`, `group`, `direct`).

## Groups

**Group Manager** (`/groups`) lets you create groups, assign scripts (global and utility scripts are excluded from the group picker), and inspect member games.

Games can belong to multiple groups. Group scripts merge into the resolver output alongside global and direct assignments.

## Settings

Settings (`/settings`) is split into four sections:

- **Global Scripts** — toggle which non-utility scripts run globally for every launch
- **Launch** — **Raise game priority** (Windows `HIGH_PRIORITY_CLASS`); on by default
- **API Integrations** — masked **SteamGridDB** and **Steam Web API** keys for cover-art search and metadata during add-game / edit flows
- **Appearance** — theme (system / light / dark) and accent color (default, violet, emerald, amber, rose, sky); persisted locally

## Stack

| Layer | Technologies |
| ----- | ------------ |
| Desktop shell | Tauri 2, Rust (SQLite via rusqlite, launch executor, process monitor, SteamGridDB art) |
| UI | React 19, TypeScript, Vite 8, Tailwind CSS 4, shadcn/ui, Zustand, TanStack Query, React Router, Monaco, `motion` |
| Icons | Material Symbols |
| Tests | Vitest (90% coverage gates), Rust integration tests (nextest / llvm-cov), Playwright E2E + screenshot baselines |

## Requirements

| Tool | Notes |
| ---- | ----- |
| [Node.js](https://nodejs.org/) | LTS recommended |
| [pnpm](https://pnpm.io/) | Package manager (**pnpm only** — not npm or yarn) |
| [Rust](https://www.rust-lang.org/tools/install) | Required to build the Tauri backend (`cargo`, `rustc`) |
| [cargo-nextest](https://nexte.st/book/installing.html) | For `pnpm test:rust`, `pnpm test:rust:coverage`, and `pnpm test:all`: `cargo install cargo-nextest` |
| Rust coverage (optional) | For `pnpm test:rust:coverage` / `pnpm test:all`: `cargo install cargo-llvm-cov` and `rustup component add llvm-tools-preview` |
| OS | **Windows 11** (WebView2 is bundled with the OS on current Windows 11 builds) |

See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for MSVC / Windows SDK details when building from source.

## Setup

Follow these steps on a new machine before **Quick start** or **Contributing**.

1. **Node.js** — Install Node.js (LTS). Verify with `node -v`.
2. **pnpm** — Enable via Corepack (`corepack enable` then `corepack prepare pnpm@latest --activate`) or install pnpm globally. Verify with `pnpm -v`.
3. **Rust** — Install rustup and the stable toolchain. Verify with `cargo -v` and `rustc -V`.
4. **Tauri OS dependencies** — On Windows, install the MSVC toolchain and Windows SDK per [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
5. **Clone and install JS deps** — From the repo root:

   ```bash
   git clone <repository-url>
   cd game-manager
   pnpm install
   ```

6. **Playwright (for E2E / `pnpm test:all`)** — Install browsers once (this project uses Chromium):

   ```bash
   pnpm exec playwright install chromium
   ```

7. **cargo-nextest (for Rust integration tests)** — Not installed by `pnpm install`. The repo uses Nextest via Cargo aliases in `.cargo/config.toml` (`gm-test-integration`, `gm-llvm-cov`). From any directory:

   ```bash
   cargo install cargo-nextest
   ```

   Verify with `cargo nextest --version`. Ensure `~/.cargo/bin` (or your Cargo bin directory) is on your `PATH`.

8. **Rust coverage tools (for `pnpm test:rust:coverage` and `pnpm test:all`)** — Requires Nextest (step 7). From any directory:

   ```bash
   rustup component add llvm-tools-preview
   cargo install cargo-llvm-cov
   ```

   Ensure `cargo llvm-cov` is on your `PATH` (same Cargo bin directory as above).

For day-to-day development you only need steps 1–5 and **Quick start** below. Add steps 6–8 when you run the full Rust or end-to-end test suite.

## Quick start

From the repository root (after **Setup** if this is a fresh clone):

```bash
pnpm install
pnpm tauri dev
```

The dev server prefers port **1420**. `pnpm tauri dev` uses `http://127.0.0.1:1420` from Tauri config. `pnpm dev` (frontend-only) runs Vite on the same port when free—check Vite's startup banner for the actual URL.

### Web-only UI (no native shell)

Useful for quick frontend iteration without the Rust toolchain (IPC must be mocked or features that call the backend will not work end-to-end):

```bash
pnpm dev
```

### Production build (Windows MSI)

```bash
pnpm tauri build
```

Installable bundles are written under `src-tauri/target/release/bundle/`.

## Scripts

| Command | Purpose |
| ------- | ------- |
| `pnpm dev` | Vite dev server (frontend only) |
| `pnpm build` | Typecheck + production frontend build |
| `pnpm preview` | Preview the built frontend |
| `pnpm tauri dev` | Run the full Tauri app in development |
| `pnpm tauri build` | Build installable Windows bundles (MSI) |
| `pnpm test` | Run Vitest once |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:coverage` | Vitest with coverage thresholds (90% lines/functions/statements) |
| `pnpm test:rust` | Rust integration tests via [cargo-nextest](https://nexte.st/) (`cargo gm-test-integration`; targets in `.cargo/config.toml`) |
| `pnpm test:rust:coverage` | Same tests under [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) (`cargo gm-llvm-cov`) |
| `pnpm test:all` | Vitest coverage + Rust llvm-cov + Playwright E2E |
| `pnpm test:e2e` | Playwright E2E tests (all specs, including visual regression) |
| `pnpm test:screenshots` | Playwright screenshot specs only |
| `pnpm lint` / `pnpm lint:fix` | ESLint on `src/` |
| `pnpm format` | Prettier on `src/` |
| `pnpm typecheck` | `tsc --noEmit` |

After intentional visual changes, regenerate Playwright baselines:

```bash
pnpm test:e2e -- --update-snapshots
```

## Project layout

```
game-manager/
├── src/                 # React app: components, features, lib (IPC wrappers), stores, routes, styles, types
├── src-tauri/           # Rust backend, Tauri config, permissions, SQLite migrations, icons
├── e2e/                 # Playwright specs (including visual regression)
├── src/tests/           # Vitest tests (mirrors src/); ipc-mock.ts, fixtures.ts
├── .cargo/config.toml   # gm-test-integration / gm-llvm-cov aliases
├── package.json         # Frontend scripts and dependencies
└── CLAUDE.md            # Maintainer/agent notes: architecture, commands, testing gates
```

## Contributing

1. Complete **Setup** (including Playwright, cargo-nextest, and Rust coverage tools if you run the full suite), then stay on the latest dependencies with `pnpm install` as needed.
2. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test:all` (Vitest coverage, Rust with llvm-cov, Playwright) before opening a PR.
3. For behavior that depends on the native shell, verify with `pnpm tauri dev` when possible. See **CLAUDE.md** for IPC conventions, the 7-step command checklist, directory map, and screenshot baseline workflow.
