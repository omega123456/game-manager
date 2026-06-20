//! DLSS scan-status integration tests.
//!
//! Exercises the `AppState` scan-running flag used by the management page to
//! wait for the startup scan instead of redundantly rescanning the library.

use game_manager_lib::commands::dlss::get_scan_status_impl;
use game_manager_lib::state::AppState;

#[test]
fn scan_status_tracks_running_state() {
    let state = AppState::in_memory().unwrap();

    assert_eq!(get_scan_status_impl(&state).scanning, false);
    assert!(state.dlss_scan_begin(), "first begin should start the scan");
    assert_eq!(get_scan_status_impl(&state).scanning, true);
    assert!(
        !state.dlss_scan_begin(),
        "second begin while running should be rejected"
    );

    state.dlss_scan_finish();
    assert_eq!(get_scan_status_impl(&state).scanning, false);
    assert!(
        state.dlss_scan_begin(),
        "begin should succeed again after finishing"
    );
    state.dlss_scan_finish();
}
