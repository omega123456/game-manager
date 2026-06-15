//! Cancellation primitive for an in-flight launch.
//!
//! A [`CancelToken`] is shared between the orchestrator's wait loop and the
//! launch registry in `AppState`. `cancel_launch` flips the flag and wakes any
//! waiter so the stub (or, later, the real) monitor aborts its wait promptly
//! rather than on a fixed poll boundary.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::Notify;

/// A cloneable cancellation handle shared across a launch.
#[derive(Clone, Default)]
pub struct CancelToken {
    inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
    cancelled: AtomicBool,
    notify: Notify,
}

impl CancelToken {
    /// Create a fresh, un-cancelled token.
    pub fn new() -> Self {
        CancelToken::default()
    }

    /// Request cancellation and wake any current waiter.
    pub fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::SeqCst);
        self.inner.notify.notify_waiters();
    }

    /// Whether cancellation has been requested.
    pub fn is_cancelled(&self) -> bool {
        self.inner.cancelled.load(Ordering::SeqCst)
    }

    /// Resolve as soon as cancellation is requested.
    ///
    /// Returns immediately if already cancelled; otherwise waits for the next
    /// `cancel()` notification.
    pub async fn cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        // Register interest before re-checking to avoid a missed notification.
        let notified = self.inner.notify.notified();
        if self.is_cancelled() {
            return;
        }
        notified.await;
    }
}
