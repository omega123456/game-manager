//! Stub process monitor.
//!
//! A configurable, immediate/fake start+end monitor used by the state machine
//! during early development and in tests. It opens a real `play_sessions` row on
//! "start" and closes it on "end" — exercising the full session-writing path —
//! without touching the OS process table. The real `windows-rs` monitors arrive
//! in Phase E5 and implement the same [`Monitor`] trait.

use std::time::Duration;

use async_trait::async_trait;

use super::{Monitor, StartOutcome};
use crate::db::repo::sessions;
use crate::error::AppResult;
use crate::launch::cancel::CancelToken;
use crate::state::AppState;

/// A fake monitor with configurable fake start/end delays.
#[derive(Debug, Clone)]
pub struct StubMonitor {
    /// Simulated delay before the process is "detected".
    start_delay: Duration,
    /// Simulated session duration before the process "exits".
    end_delay: Duration,
}

impl Default for StubMonitor {
    fn default() -> Self {
        // Immediate by default so tests and dev launches resolve fast.
        StubMonitor {
            start_delay: Duration::ZERO,
            end_delay: Duration::ZERO,
        }
    }
}

impl StubMonitor {
    /// An immediate stub (no simulated waits).
    pub fn immediate() -> Self {
        StubMonitor::default()
    }

    /// A stub with explicit simulated start/end delays.
    pub fn with_delays(start_delay: Duration, end_delay: Duration) -> Self {
        StubMonitor {
            start_delay,
            end_delay,
        }
    }

    /// Sleep for `delay`, returning early (`true`) if cancelled first.
    async fn wait_or_cancel(delay: Duration, cancel: &CancelToken) -> bool {
        if delay.is_zero() {
            return cancel.is_cancelled();
        }
        tokio::select! {
            _ = tokio::time::sleep(delay) => cancel.is_cancelled(),
            _ = cancel.cancelled() => true,
        }
    }
}

#[async_trait]
impl Monitor for StubMonitor {
    async fn wait_for_start(
        &self,
        state: &AppState,
        game_id: i64,
        cancel: &CancelToken,
    ) -> AppResult<StartOutcome> {
        if Self::wait_or_cancel(self.start_delay, cancel).await {
            return Ok(StartOutcome::Cancelled);
        }
        let session_id = state.with_db(|conn| sessions::start(conn, game_id))?;
        Ok(StartOutcome::Started(session_id))
    }

    async fn wait_for_end(
        &self,
        state: &AppState,
        session_id: i64,
        cancel: &CancelToken,
    ) -> AppResult<i64> {
        // Cancellation does not skip closing the session — we still record an
        // end time so the row is never left dangling.
        let _ = Self::wait_or_cancel(self.end_delay, cancel).await;
        state.with_db(|conn| {
            sessions::end(conn, session_id)?;
            let session = sessions::get(conn, session_id)?;
            Ok(elapsed_seconds(
                &session.started_at,
                session.ended_at.as_deref(),
            ))
        })
    }
}

/// Compute whole elapsed seconds between two RFC-3339 timestamps.
///
/// Returns 0 when either timestamp is missing or unparseable (best-effort).
pub fn elapsed_seconds(started_at: &str, ended_at: Option<&str>) -> i64 {
    let Some(ended_at) = ended_at else {
        return 0;
    };
    match (
        chrono::DateTime::parse_from_rfc3339(started_at),
        chrono::DateTime::parse_from_rfc3339(ended_at),
    ) {
        (Ok(start), Ok(end)) => (end - start).num_seconds().max(0),
        _ => 0,
    }
}
