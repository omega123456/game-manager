//! DLSS library-scan progress integration tests.
//!
//! Exercises `scan_library_with_progress`: the per-game `ScanProgressSink`
//! callback that lets the frontend render pills gradually and show a
//! `scanned`/`total` indicator. Uses a fake [`FileVersionReader`] over tempdir
//! fixtures (no real signed DLLs) and a fake sink that records each call.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::games::{self, NewGame};
use game_manager_lib::dlss::detect::{
    self, DllIdentity, FileVersionReader, NoopScanProgress, ScanProgressSink,
};
use game_manager_lib::domain::{
    CatalogSource, DllCatalog, DllType, DllVersion, GameDlssState, MonitorMode,
};
use game_manager_lib::state::AppState;
use tempfile::TempDir;

/// A fake reader mapping known absolute paths to canned identities.
struct FakeReader {
    map: HashMap<PathBuf, DllIdentity>,
}

impl FileVersionReader for FakeReader {
    fn read(&self, path: &Path) -> game_manager_lib::dlss::DlssResult<DllIdentity> {
        self.map
            .get(path)
            .cloned()
            .ok_or_else(|| game_manager_lib::dlss::DlssError::Io("no identity".into()))
    }
}

/// A fake [`ScanProgressSink`] that records every `(scanned, total, game_id, has_sr)`.
#[derive(Default)]
struct RecordingSink {
    calls: Mutex<Vec<(u32, u32, i64, bool)>>,
}

impl ScanProgressSink for RecordingSink {
    fn on_game(&self, scanned: u32, total: u32, state: &GameDlssState) {
        self.calls.lock().unwrap().push((
            scanned,
            total,
            state.game_id,
            state.super_resolution.is_some(),
        ));
    }
}

fn state_with_app_data(dir: &Path) -> AppState {
    AppState::new_with_app_data_dir(open_in_memory().unwrap(), dir.to_path_buf())
}

fn sr_catalog(md5: &str) -> DllCatalog {
    DllCatalog {
        super_resolution: vec![DllVersion {
            dll_type: DllType::SuperResolution,
            version: "3.7".into(),
            version_number: 37,
            label: "v3.7 (Latest)".into(),
            md5: md5.to_string(),
            zip_md5: "deadbeef".into(),
            download_url: "https://example/x.zip".into(),
            file_size_bytes: 1,
            zip_size_bytes: 1,
            is_signature_valid: true,
            is_downloaded: false,
        }],
        frame_generation: vec![],
        ray_reconstruction: vec![],
        source: CatalogSource::Static,
        fetched_at: None,
    }
}

fn new_game(launch_target: &str) -> NewGame {
    NewGame {
        name: "Test Game".into(),
        launch_target: launch_target.into(),
        monitor_mode: MonitorMode::Tree,
        monitor_process_name: None,
        arguments: None,
        image_path: None,
    }
}

#[test]
fn scan_library_with_progress_emits_one_call_per_game() {
    let app_data = TempDir::new().unwrap();
    let game_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    // Game 1: a folder containing an SR DLL → detected.
    let exe = game_dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();
    let dll = game_dir.path().join("nvngx_dlss.dll");
    let bytes = b"dlss";
    std::fs::write(&dll, bytes).unwrap();
    let md5 = detect::md5_hex(bytes);
    let game_one = st
        .with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
        .unwrap();

    // Game 2: a URI launch target → no folder, no detection (still scanned).
    let game_two = st
        .with_db(|c| games::create(c, &new_game("steam://run/2")))
        .unwrap();

    let catalog = sr_catalog(&md5);
    let mut map = HashMap::new();
    map.insert(
        dll,
        DllIdentity {
            md5,
            file_version: "3.7.0.0".into(),
        },
    );
    let reader = FakeReader { map };

    let sink = RecordingSink::default();
    let states = detect::scan_library_with_progress(&st, &catalog, &reader, &sink).unwrap();
    assert_eq!(states.len(), 2);

    let calls = sink.calls.lock().unwrap();
    assert_eq!(calls.len(), 2, "one progress call per game");
    // `total` is constant; `scanned` is 1-based and monotonically increasing.
    assert_eq!(calls[0], (1, 2, game_one, true));
    assert_eq!(calls[1], (2, 2, game_two, false));
}

#[test]
fn noop_scan_progress_is_silent() {
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    st.with_db(|c| games::create(c, &new_game("steam://run/1")))
        .unwrap();

    // The default `scan_library_with` delegates to `scan_library_with_progress`
    // with a `NoopScanProgress`; exercise the noop sink directly too.
    NoopScanProgress.on_game(
        1,
        1,
        &GameDlssState {
            game_id: 1,
            stale: false,
            ..GameDlssState::default()
        },
    );

    let catalog = sr_catalog("unused");
    let reader = FakeReader {
        map: HashMap::new(),
    };
    let states = detect::scan_library_with(&st, &catalog, &reader).unwrap();
    assert_eq!(states.len(), 1);
}
