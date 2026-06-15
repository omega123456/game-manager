//! Process monitoring.
//!
//! A [`Monitor`] times a game session: it waits for the game process to appear
//! (between the Before and After phases), then waits for it to exit (between the
//! After and On-Exit phases), writing the `play_sessions` row as it goes.
//!
//! Phase E1 ships only the [`stub`] monitor — a configurable immediate/fake
//! start+end used by the state machine and tests. The real two-mode `windows-rs`
//! implementations (`job_object` Mode A, `named_process` Mode B) land in Phase
//! E5 and implement this same trait, so the orchestrator and the lifecycle UI
//! are unaffected by the swap.

pub mod job_object;
pub mod named_process;
pub mod stub;

use std::sync::Arc;

use async_trait::async_trait;

use crate::domain::MonitorMode;
use crate::error::AppResult;
use crate::launch::cancel::CancelToken;
use crate::state::AppState;

/// Outcome of waiting for the game process to start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartOutcome {
    /// The game process was detected; a session row was opened with this id.
    Started(i64),
    /// The wait was cancelled before the process appeared; no session opened.
    Cancelled,
}

/// Times a game session by detecting process start and end.
///
/// Implementations own the `play_sessions` row: [`wait_for_start`] opens it on
/// detection; [`wait_for_end`] closes it on exit. Both honour the shared
/// [`CancelToken`] so `cancel_launch` aborts the wait promptly.
#[async_trait]
pub trait Monitor: Send + Sync {
    /// Wait until the game process is detected, opening a session row.
    ///
    /// Returns [`StartOutcome::Cancelled`] (without opening a session) if the
    /// token is cancelled first.
    async fn wait_for_start(
        &self,
        state: &AppState,
        game_id: i64,
        cancel: &CancelToken,
    ) -> crate::error::AppResult<StartOutcome>;

    /// Wait until the previously-detected process exits, closing the session.
    ///
    /// Returns the elapsed session seconds. Cancellation ends the session
    /// immediately (best-effort) rather than leaving it open.
    async fn wait_for_end(
        &self,
        state: &AppState,
        session_id: i64,
        cancel: &CancelToken,
    ) -> crate::error::AppResult<i64>;
}

/// Read a game's configured monitoring mode (mode-selection logic, decoupled
/// from FFI construction so it is unit-testable without real processes).
pub fn monitor_mode_for_game(state: &AppState, game_id: i64) -> AppResult<MonitorMode> {
    let game = state.with_db(|conn| crate::db::repo::games::get(conn, game_id))?;
    Ok(game.monitor_mode)
}

/// Construct the real `windows-rs` monitor matching the game's configured mode.
///
/// `MonitorMode::Tree` → Mode A (job-object tree); `MonitorMode::Named` → Mode B
/// (named-process). Only available on Windows; the loop/session logic is covered
/// cross-platform via the injectable seams in each mode's module.
#[cfg(windows)]
pub fn select_monitor(state: &AppState, game_id: i64) -> AppResult<Arc<dyn Monitor>> {
    let mode = monitor_mode_for_game(state, game_id)?;
    let monitor: Arc<dyn Monitor> = match mode {
        MonitorMode::Tree => Arc::new(job_object::windows_monitor()),
        MonitorMode::Named => Arc::new(named_process::windows_monitor()),
    };
    Ok(monitor)
}
