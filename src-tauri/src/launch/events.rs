//! Launch lifecycle events.
//!
//! The orchestrator drives a game through `Before → wait-for-start → After
//! Detected → wait-for-end → On Exit → ended`, emitting a [`LaunchLifecycle`]
//! payload on the three `launch://*` channels. Emission is abstracted behind the
//! [`EventSink`] trait so the state machine is testable without the Tauri
//! runtime: production wraps a Tauri `AppHandle`; tests use an in-memory
//! recorder.

use serde::{Deserialize, Serialize};

use crate::domain::LaunchPhase;

/// Emitted on each lifecycle phase transition.
pub const EVENT_PHASE: &str = "launch://phase";
/// Emitted (in addition to a phase event) when a script result is a failure.
pub const EVENT_ERROR: &str = "launch://error";
/// Emitted once when the session has ended (success, failure, or cancel).
pub const EVENT_ENDED: &str = "launch://ended";

/// Payload for every `launch://*` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchLifecycle {
    /// The game being launched.
    pub game_id: i64,
    /// The current lifecycle phase.
    pub phase: LaunchPhase,
    /// Optional human-readable detail (e.g. progress `2/3`, cancel/failure note).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Number of script results that failed so far (cumulative; best-effort).
    pub failed_count: u32,
    /// Elapsed session seconds (populated for playing/ended phases).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub elapsed_seconds: Option<i64>,
}

/// A sink that receives lifecycle events on named channels.
///
/// Implementations must be cheap to clone/share across the async launch task.
pub trait EventSink: Send + Sync {
    /// Emit `payload` on `event` (one of the `launch://*` constants).
    fn emit(&self, event: &str, payload: &LaunchLifecycle);
}
