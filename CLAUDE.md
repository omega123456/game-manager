Agent guidance for the **Game Manager** repo — a Windows 11 desktop app built with **Tauri v2** (Rust backend) + **React 19 / TypeScript** (frontend). The frontend and backend communicate exclusively via Tauri IPC (`invoke`). SQLite (via `rusqlite`, backend-owned) is the single source of truth.

**Stack:** Tauri v2, React 19, TypeScript, Vite, Tailwind + shadcn/ui, Zustand + TanStack Query, React Router v6, Material Symbols, `motion` v12, Monaco. **Package manager: `pnpm` only** — never npm or yarn.

---

## Commands

```bash
# Development
pnpm tauri dev          # Full Tauri app (Rust + frontend) — preferred
pnpm dev                # Frontend only (Vite on port 1420, no Rust)

# Build
pnpm build              # tsc + Vite production build
pnpm tauri build        # Native app bundle (MSI)

# Testing — run targeted tests for the changed functionality before finishing
pnpm test:all           # Vitest coverage + Rust coverage + full Playwright
pnpm test:coverage      # Vitest with v8 coverage (90% threshold lines/functions/statements)
pnpm test:rust          # Rust tests via nextest, no coverage instrumentation (fast)
pnpm test:rust:coverage # Rust tests via cargo llvm-cov nextest (needs cargo-llvm-cov + llvm-tools-preview)
pnpm test:e2e           # All Playwright specs under e2e/ (includes screenshots.spec.ts)

# Single Vitest test file
pnpm exec vitest run src/tests/path/to/file.test.ts

# Single Rust test suite (from repo root)
cargo nextest run --manifest-path src-tauri/Cargo.toml --features test-utils --test <suite_name>
# Example:
cargo nextest run --manifest-path src-tauri/Cargo.toml --features test-utils --test smoke_integration

# Regenerate Playwright screenshot baselines after intentional visual changes
pnpm test:e2e -- --update-snapshots

# Code quality
pnpm lint               # ESLint on src/
pnpm lint:fix           # ESLint auto-fix
pnpm format             # Prettier on src/
pnpm typecheck          # tsc --noEmit
```

**Lint rule (always apply):** `pnpm lint` must be clean after every change. Fix all lint warnings and errors in touched code before finishing.

**Agent rule (always apply):** Before finishing a session where any code was changed, run the targeted tests that cover the changed functionality and ensure they pass.

---

## Critical Rules for Agents

- **Tests live ONLY in dedicated roots.** Never bundle tests with production code: no `*.test.ts` / `*.spec.ts` next to sources under `src/`, no `describe`/`it` blocks inside application modules, and (Rust) no `#[cfg(test)]` or `#[test]` in `src-tauri/src/`. Use `src/tests/` (mirroring `src/`), `src-tauri/tests/`, and `e2e/` only.
- **Never lower coverage thresholds.** 90% lines/functions/statements for both TypeScript (Vitest v8) and Rust (`cargo-llvm-cov` `--fail-under-*`). Improve tests instead. Never add `istanbul`/`c8` ignore comments or widen `exclude` lists to hide coverage gaps without explicit user approval naming what to exclude.
- **No fixed delays > 5 s** in any test. Use condition-based waiting (Playwright auto-wait, `waitFor`, `findBy*`, polling). Each individual test must complete in under 2 seconds.
- **Package manager: `pnpm` only.**
- **Vitest IPC mocking is mandatory and centralized.** All Vitest tests that touch Tauri IPC must use the shared harness in `src/tests/ipc-mock.ts` plus `ipc.override(...)` / `ipc.emit(...)`. Do **not** create ad hoc IPC mocks, per-test `mockIPC(...)` calls, direct `vi.mock()` stubs for `@tauri-apps/api/*` IPC modules, or direct mocks of `src/lib/*-commands.ts` command wrappers. If a command is missing from the default fixtures, add it to `src/tests/fixtures.ts` or override it in the test. **The intentional missing-mock failure (`[vitest] Unmocked Tauri IPC command: <cmd>`) is part of the contract and must not be bypassed.**
- **No raw `console` in frontend feature code.** Route all logging through `src/lib/app-log-commands.ts` (`logFrontend` and the toast helpers added later). `app-log-commands.ts` is the only module allowed to call `console` (as a last-resort sink). The `no-console` ESLint rule enforces this.

---

## Architecture

### IPC Boundary

The frontend **never** touches SQLite directly. All backend work goes through typed `invoke()` wrappers in `src/lib/ipc/`.

**Adding a new Tauri command — full 7-step checklist:**

1. Implement `*_impl(state: &AppState, ...)` in `src-tauri/src/commands/` — testable without the Tauri runtime.
2. Write a thin `#[tauri::command]` wrapper that calls `*_impl`.
3. Register it in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
4. Add a typed `invoke<T>('command_name', ...)` wrapper in the appropriate `src/lib/ipc/*-commands.ts`.
5. Add a `[[permission]]` block in `src-tauri/permissions/*.toml` with `commands.allow = ["your_command"]` (snake_case Rust name, not camelCase).
6. Append `"allow-your-command"` to the `permissions` array in `src-tauri/capabilities/default.json`.
7. Update `src/lib/playwright-ipc-mock.ts` (via a fixture in `src/tests/playwright-fixtures/`) if the new command is called during any UI flow covered by E2E.

**Permission debugging:** A runtime `forbidden`/permission error almost always means a missing or mistyped entry in `capabilities/default.json` or a mismatch between the TOML `commands.allow` name and the registered Rust name.

### Directory Map

```
src/
  lib/
    ipc/               # Typed invoke() wrappers (*-commands.ts) — the only path to the backend
    queries/           # TanStack Query hooks keyed per domain
    app-log-commands.ts# Frontend logging entrypoint (no raw console anywhere else)
    playwright-ipc-mock.ts # VITE_PLAYWRIGHT IPC mock router
  stores/              # Zustand: ui-store, launch-store
  routes/              # One component per sidebar destination
  features/            # games/ scripts/ groups/ launch/ settings/
  components/
    ui/                # shadcn components
    layout/            # Sidebar, TopBar, AppLayout
  types/               # Shared TS DTOs (mirror Rust camelCase)
  styles/              # Tailwind globals + theme token CSS vars under [data-theme]
  tests/               # Mirrors src/; setup.ts, ipc-mock.ts, fixtures.ts, playwright-fixtures/

.cargo/
  config.toml          # Test aliases: gm-test-integration, gm-llvm-cov (run from repo root)

src-tauri/
  Cargo.toml, tauri.conf.json, build.rs, nextest.toml
  migrations/          # NNN_*.sql compiled via include_str! + MIGRATIONS array
  permissions/         # *.toml — one [[permission]] block per command
  capabilities/        # default.json — grants permissions to the "main" window
  tests/               # ALL Rust tests (<area>_<focus>_integration.rs)
  src/
    main.rs, lib.rs    # Builder + generate_handler! registration
    state.rs           # AppState (DB handle, launch registry) injected into every *_impl
    error.rs           # AppError / AppResult
    logging.rs         # tracing init (+ logs-table facade in A2)
    domain/            # serde structs/enums (#[serde(rename_all = "camelCase")] over IPC)
    db/                # connection, migrations, repos
    commands/          # Thin #[tauri::command] wrappers + *_impl(&AppState, …)
    launch/ monitor/ art/
```

---

## Code Style

### TypeScript / React

- **Formatter:** Prettier — `semi: false`, `singleQuote: true`, `tabWidth: 2`, `trailingComma: "es5"`, `printWidth: 100`. Run `pnpm format` before committing.
- **TypeScript:** strict mode (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`). Prefer explicit return types on public functions; infer where obvious. Avoid `any`.
- **Imports:** Named imports preferred. Use `import type` for type-only imports. The `@/` alias maps to `src/`.
- **Components:** Functional only. Props type named `<ComponentName>Props`. Components/types `PascalCase`; hooks `useCamelCase`; files/utilities `kebab-case`; constants `UPPER_SNAKE_CASE`.
- **Styling:** Tailwind + shadcn/ui. Design tokens are CSS custom properties scoped under `[data-theme="light|dark"]` in `src/styles/`. **Never hard-code colors or spacing values** — use tokens / Tailwind theme tokens (`bg-background`, `text-foreground`, `border-border`, `bg-primary`, …).
- **State:** Zustand stores in `src/stores/` (`ui-store`, `launch-store`). Server data via TanStack Query; invalidate on mutations. Overlays (modals/wizard/dialogs) are Zustand state, **not** routes.
- **Theme:** set `data-theme="light|dark"` on `document.documentElement`. Persist via `set_setting('theme', …)` — fire-and-forget; IPC errors must not block the UI change.

### Error Handling (TypeScript)

Silent error swallowing is **forbidden** without a log line. Frontend logging must go through `src/lib/app-log-commands.ts`. Do **not** call raw `console.*` in feature code. For user-visible failures, use the toast helpers (which log via `logFrontend`); for caught non-user-visible failures, call `logFrontend` at the appropriate level.

### Rust

- Use `tracing` macros (`warn!`, `error!`, `info!`) with context for all non-trivial error paths. Do not swallow errors without a log line.
- `#[serde(rename_all = "camelCase")]` on all structs serialized over IPC.
- Command handlers are thin wrappers; business logic lives in `*_impl` functions taking `&AppState` (testable without the Tauri runtime).
- Never embed `#[cfg(test)]` or `#[test]` in `src-tauri/src/` — all tests go in `src-tauri/tests/` only.

---

## Testing Conventions

Keep every test in a dedicated file under the appropriate test root (`src/tests/`, `src-tauri/tests/`, `e2e/`). Production files must contain only shipping code.

### Vitest (TypeScript)

- Test files mirror source: `src/components/Foo.tsx` → `src/tests/components/Foo.test.tsx`.
- Setup file `src/tests/setup.ts` provides jsdom polyfills (`ResizeObserver`, `matchMedia`, `scrollIntoView`) and wires Vitest IPC through the shared `src/tests/ipc-mock.ts` harness. A missing IPC fixture throws `[vitest] Unmocked Tauri IPC command: <cmd>`.
- Always test real behavior through the public API with the shared harness. Use `ipc.override(...)` for per-test behavior and `ipc.emit(...)` for events. If a test needs a new IPC response, extend `src/tests/fixtures.ts` or override only that command in the test.
- After `render`, use `waitFor` / `findBy*` for async-mounted state. Use `const user = userEvent.setup()` and await interactions to avoid React `act(...)` warnings; treat new `act(...)` warnings as unfinished work.

### Rust

- Tests only in `src-tauri/tests/<area>_<focus>_integration.rs`. Name files after what they test, not meta-goals like `coverage_boost`.
- Use in-memory SQLite (`Connection::open_in_memory()`) — never mock the DB layer.
- After adding a new test file, register it in **both** aliases in the repo-root `.cargo/config.toml`: `gm-test-integration` and `gm-llvm-cov`.
- Run with `pnpm test:rust` for fast iteration; `pnpm test:rust:coverage` for the coverage gate (`cargo llvm-cov nextest`). `cargo-llvm-cov` sets `--cfg coverage` to exclude the Tauri runtime entrypoint (`lib::run` / `main`); do not add other code behind `cfg(coverage)` to dodge coverage.

### Playwright (E2E + Visual Regression)

- Specs live in `e2e/`. `pnpm test:e2e` (and therefore `pnpm test:all`) always includes `screenshots.spec.ts`.
- **Every new component / visible UI state needs screenshot coverage for both light and dark themes** in `e2e/screenshots.spec.ts`.
- **Do not increase Playwright screenshot pixel tolerance** (or any visual diff threshold in `playwright.config.mjs`) to make tests pass — fix the UI/regression or intentionally update baselines instead.
- Update the `VITE_PLAYWRIGHT` mock for any new IPC command called from the UI. **Never embed fixture data or domain logic inline in `playwright-ipc-mock.ts`** — all fixture data belongs in `src/tests/playwright-fixtures/` (one file per domain) and must be wired through the registry in `src/tests/playwright-fixtures/index.ts` so it can be looked up and overridden per-test without touching the mock router.
- After intentional visual changes, regenerate baselines: `pnpm test:e2e -- --update-snapshots` and commit the updated snapshot files.

---

## Key Gotchas

- **`csp: null`** in `tauri.conf.json` is intentional for now.
- **Migrations** are compiled into the binary via `include_str!`. To add one: create `src-tauri/migrations/NNN_description.sql` and register it in the `MIGRATIONS` array (Phase A2 introduces the runner).
- **`pnpm tauri dev`** runs `pnpm dev` first (Vite on 1420) then compiles the Rust side; the first Rust build is slow.
