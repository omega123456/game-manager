//! Launch commands (`launch_game`, `cancel_launch`).
//!
//! `launch_game` resolves a game's script pipeline and runs it asynchronously
//! through the [`state_machine`](crate::launch::state_machine), against the stub
//! monitor in Phase E1. Lifecycle progress is emitted on the `launch://*`
//! channels. `cancel_launch` flips the registered launch's cancellation token so
//! the wait aborts promptly.
//!
//! The testable core lives in `run_launch_impl`, which takes an [`EventSink`] and
//! [`Monitor`] so it can be exercised without the Tauri runtime. The thin
//! `#[tauri::command]` wrappers wire a Tauri `AppHandle` sink + the default stub
//! monitor and spawn the run on the async runtime so the UI is never blocked.

use std::sync::Arc;

use crate::error::AppResult;
use crate::launch::cancel::CancelToken;
use crate::launch::events::EventSink;
#[cfg(not(coverage))]
use crate::domain::LaunchPhase;
#[cfg(not(coverage))]
use crate::launch::events::{LaunchLifecycle, EVENT_ENDED, EVENT_ERROR};
use crate::launch::state_machine;
use crate::monitor::Monitor;
use crate::state::AppState;

/// Run the full launch lifecycle for `game_id` to completion.
///
/// Registers a cancellation token in `state` for the duration of the run and
/// removes it afterwards. Returns the number of failed script results.
pub async fn run_launch_impl(
    state: &AppState,
    game_id: i64,
    monitor: Arc<dyn Monitor>,
    sink: &dyn EventSink,
    cancel: CancelToken,
) -> AppResult<u32> {
    let result = state_machine::run_launch(state, game_id, monitor, sink, cancel).await;
    state.unregister_launch(game_id);
    result
}

/// Cancel an in-flight launch for `game_id`. Returns whether one was active.
pub fn cancel_launch_impl(state: &AppState, game_id: i64) -> AppResult<bool> {
    Ok(state.cancel_launch(game_id))
}

/// Register a launch and resolve its monitor as a single operation so any
/// failure before the async run starts cannot strand the active-launch registry.
pub fn prepare_launch_impl(state: &AppState, game_id: i64) -> AppResult<(CancelToken, Arc<dyn Monitor>)> {
    let cancel = state.register_launch(game_id)?;
    match crate::monitor::select_monitor(state, game_id) {
        Ok(monitor) => Ok((cancel, monitor)),
        Err(err) => {
            state.unregister_launch(game_id);
            Err(err)
        }
    }
}

/// A [`EventSink`] backed by a Tauri `AppHandle`.
#[cfg(not(coverage))]
struct TauriEventSink {
    app: tauri::AppHandle,
}

#[cfg(not(coverage))]
impl EventSink for TauriEventSink {
    fn emit(&self, event: &str, payload: &LaunchLifecycle) {
        use tauri::Emitter;
        if let Err(err) = self.app.emit(event, payload) {
            tracing::warn!(category = "launch", "failed to emit {event}: {err}");
        }
    }
}

#[cfg(not(coverage))]
fn emit_terminal_launch_failure(
    sink: &dyn EventSink,
    game_id: i64,
    failed_count: u32,
    detail: String,
) {
    sink.emit(
        EVENT_ERROR,
        &LaunchLifecycle {
            game_id,
            phase: LaunchPhase::Ended,
            detail: Some(detail.clone()),
            failed_count,
            elapsed_seconds: None,
        },
    );
    sink.emit(
        EVENT_ENDED,
        &LaunchLifecycle {
            game_id,
            phase: LaunchPhase::Ended,
            detail: Some(detail),
            failed_count,
            elapsed_seconds: None,
        },
    );
}

/// Thin `#[tauri::command]` wrapper: spawn the launch on the async runtime.
///
/// Returns immediately so the WebView is never blocked; progress arrives via
/// `launch://*` events. The stub monitor is used until Phase E5 swaps in the
/// real `windows-rs` monitors.
#[cfg(not(coverage))]
#[tauri::command]
pub fn launch_game(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    game_id: i64,
) -> AppResult<()> {
    let (cancel, monitor) = prepare_launch_impl(&state, game_id)?;
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Manager;
        let state = app_handle.state::<AppState>();
        let sink = TauriEventSink {
            app: app_handle.clone(),
        };
        if let Err(err) = run_launch_impl(&state, game_id, monitor, &sink, cancel).await {
            tracing::error!(category = "launch", "launch {game_id} failed: {err}");
            emit_terminal_launch_failure(&sink, game_id, 0, err.to_string());
        }
    });
    Ok(())
}

/// Thin `#[tauri::command]` wrapper delegating to [`cancel_launch_impl`].
#[cfg(not(coverage))]
#[tauri::command]
pub fn cancel_launch(state: tauri::State<'_, AppState>, game_id: i64) -> AppResult<bool> {
    cancel_launch_impl(&state, game_id)
}
