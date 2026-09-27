//! Shared helpers for integration tests (DLSS readers, install probes, fixtures).
//!
//! This module lives under `tests/common/` so Cargo treats it as a submodule of
//! the test crates that `mod`-declare it rather than as a standalone test
//! binary. It intentionally contains NO `#[test]` functions.
//!
//! Not every test binary uses every helper, so `dead_code` is allowed here (the
//! standard pattern for `tests/common` shared modules).
#![allow(dead_code)]

use std::collections::{HashMap, HashSet, VecDeque};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::games::NewGame;
use game_manager_lib::dlss::detect::{DllIdentity, FileVersionReader};
use game_manager_lib::domain::MonitorMode;
use game_manager_lib::install::InstallProbe;
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

#[derive(Default)]
struct FakeInstallProbeState {
    all_present: bool,
    present: HashSet<String>,
    missing_roots: HashSet<String>,
    scripted: HashMap<String, VecDeque<Result<(), io::ErrorKind>>>,
    stat_calls: usize,
}

/// A controllable [`InstallProbe`]. Clones share state, so a test can keep a
/// handle after boxing one into `AppState` and change which paths exist.
#[derive(Clone, Default)]
pub struct FakeInstallProbe {
    inner: Arc<Mutex<FakeInstallProbeState>>,
}

impl FakeInstallProbe {
    /// Every path exists.
    pub fn all_present() -> Self {
        let probe = Self::default();
        probe.inner.lock().unwrap().all_present = true;
        probe
    }

    /// Only the given paths exist.
    pub fn with_present(paths: &[&str]) -> Self {
        let probe = Self::default();
        for path in paths {
            probe.set_present(path, true);
        }
        probe
    }

    /// Mark `path` as existing or missing.
    pub fn set_present(&self, path: &str, present: bool) {
        let mut state = self.inner.lock().unwrap();
        state.all_present = false;
        if present {
            state.present.insert(path.to_string());
        } else {
            state.present.remove(path);
        }
    }

    /// Mark a drive/share root (e.g. `Q:\`) as unavailable.
    pub fn set_root_missing(&self, root: &str) {
        self.inner
            .lock()
            .unwrap()
            .missing_roots
            .insert(root.to_string());
    }

    /// Queue stat results for `path`, consumed before the present set applies.
    pub fn script(&self, path: &str, results: Vec<Result<(), io::ErrorKind>>) {
        self.inner
            .lock()
            .unwrap()
            .scripted
            .insert(path.to_string(), results.into());
    }

    /// Number of stat calls made so far.
    pub fn stat_calls(&self) -> usize {
        self.inner.lock().unwrap().stat_calls
    }
}

impl InstallProbe for FakeInstallProbe {
    fn stat(&self, path: &Path) -> io::Result<()> {
        let mut state = self.inner.lock().unwrap();
        state.stat_calls += 1;
        let key = path.to_string_lossy().to_string();
        if let Some(result) = state.scripted.get_mut(&key).and_then(VecDeque::pop_front) {
            return result.map_err(io::Error::from);
        }
        if state.all_present || state.present.contains(&key) {
            Ok(())
        } else {
            Err(io::Error::from(io::ErrorKind::NotFound))
        }
    }

    fn root_exists(&self, root: &Path) -> bool {
        !self
            .inner
            .lock()
            .unwrap()
            .missing_roots
            .contains(root.to_string_lossy().as_ref())
    }
}

/// An in-memory `AppState` over `probe`.
pub fn state_with_probe(probe: &FakeInstallProbe) -> AppState {
    AppState::in_memory_with_install_probe(Box::new(probe.clone())).unwrap()
}
