//! Launch orchestration: resolver, executor, events, and the state machine.
//!
//! The resolver (Phase D3) computes the ordered, per-phase script set for a game.
//! The executor (Phase E1) runs each entry's phase via `tokio::process`, sourcing
//! required utility snippets first. The state machine drives the lifecycle and
//! emits `launch://*` events; the [`cancel`] token aborts an in-flight launch.

pub mod cancel;
pub mod events;
pub mod executor;
pub mod resolver;
pub mod state_machine;
