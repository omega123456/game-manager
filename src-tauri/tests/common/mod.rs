//! Shared helpers for DLSS integration tests.
//!
//! This module lives under `tests/common/` so Cargo treats it as a submodule of
//! the test crates that `mod`-declare it rather than as a standalone test
//! binary. It intentionally contains NO `#[test]` functions.
//!
//! Not every test binary uses every helper, so `dead_code` is allowed here (the
//! standard pattern for `tests/common` shared modules).
#![allow(dead_code)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::games::NewGame;
use game_manager_lib::dlss::detect::{DllIdentity, FileVersionReader};
use game_manager_lib::domain::MonitorMode;
use game_manager_lib::state::AppState;

/// A fake reader mapping known absolute paths to canned identities.
pub struct FakeReader {
    pub map: HashMap<PathBuf, DllIdentity>,
}

impl FileVersionReader for FakeReader {
    fn read(&self, path: &Path) -> game_manager_lib::dlss::DlssResult<DllIdentity> {
        self.map
            .get(path)
            .cloned()
            .ok_or_else(|| game_manager_lib::dlss::DlssError::Io("no identity".into()))
    }
}

pub fn state_with_app_data(dir: &Path) -> AppState {
    AppState::new_with_app_data_dir(open_in_memory().unwrap(), dir.to_path_buf())
}

pub fn new_game(launch_target: &str) -> NewGame {
    NewGame {
        name: "Test Game".into(),
        launch_target: launch_target.into(),
        monitor_mode: MonitorMode::Tree,
        monitor_process_name: None,
        arguments: None,
        image_path: None,
    }
}
