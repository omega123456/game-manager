//! DLSS library-scan progress integration tests.
//!
//! Exercises `scan_library_with_progress`: the per-game `ScanProgressSink`
//! callback that lets the frontend render pills gradually and show a
//! `scanned`/`total` indicator. Uses a fake [`FileVersionReader`] over tempdir
//! fixtures (no real signed DLLs) and a fake sink that records each call.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use game_manager_lib::db::repo::games;
use game_manager_lib::dlss::detect::{self, DllIdentity, NoopScanProgress, ScanProgressSink};
use game_manager_lib::domain::{CatalogSource, DllCatalog, DllType, DllVersion, GameDlssState};
use tempfile::TempDir;

mod common;
use common::{new_game, state_with_app_data, FakeReader};

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
    // Returned states are deterministically ordered by source index regardless of
    // producer completion order (8b KD-9): game_one (with SR) first, then game_two.
    assert_eq!(states[0].game_id, game_one);
    assert!(states[0].super_resolution.is_some());
    assert_eq!(states[1].game_id, game_two);
    assert!(states[1].super_resolution.is_none());

    let calls = sink.calls.lock().unwrap();
    assert_eq!(calls.len(), 2, "one progress call per game");
    // `total` is constant; `scanned` is a monotonic count assigned by the single
    // serialized consumer. Progress events arrive in producer-completion order
    // (KD-9), so assert order-independently by game id.
    assert_eq!(calls[0].1, 2, "total is the full library size");
    assert_eq!(calls[1].1, 2, "total is the full library size");
    let scanned_counts: Vec<u32> = calls.iter().map(|c| c.0).collect();
    assert_eq!(scanned_counts, vec![1, 2], "scanned advances monotonically");
    let by_game: HashMap<i64, bool> = calls.iter().map(|c| (c.2, c.3)).collect();
    assert_eq!(by_game.get(&game_one), Some(&true), "game_one detected SR");
    assert_eq!(by_game.get(&game_two), Some(&false), "game_two has no SR");
}

#[test]
fn scan_library_parallel_preserves_set_and_order_over_many_games() {
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    // Seed enough games to engage multiple producer threads. Even-indexed games
    // get an SR DLL on disk; odd-indexed games are URI targets (no folder). All
    // are returned in deterministic source order regardless of completion order.
    let mut dirs: Vec<TempDir> = Vec::new();
    let mut expected_ids: Vec<i64> = Vec::new();
    let mut expected_has_sr: Vec<bool> = Vec::new();
    let mut map: HashMap<PathBuf, DllIdentity> = HashMap::new();
    let bytes = b"dlss";
    let md5 = detect::md5_hex(bytes);

    for i in 0..16 {
        if i % 2 == 0 {
            let dir = TempDir::new().unwrap();
            let exe = dir.path().join("game.exe");
            std::fs::write(&exe, b"x").unwrap();
            let dll = dir.path().join("nvngx_dlss.dll");
            std::fs::write(&dll, bytes).unwrap();
            map.insert(
                dll,
                DllIdentity {
                    md5: md5.clone(),
                    file_version: "3.7.0.0".into(),
                },
            );
            let id = st
                .with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
                .unwrap();
            expected_ids.push(id);
            expected_has_sr.push(true);
            dirs.push(dir);
        } else {
            let id = st
                .with_db(|c| games::create(c, &new_game(&format!("steam://run/{i}"))))
                .unwrap();
            expected_ids.push(id);
            expected_has_sr.push(false);
        }
    }

    let catalog = sr_catalog(&md5);
    let reader = FakeReader { map };
    let sink = RecordingSink::default();
    let states = detect::scan_library_with_progress(&st, &catalog, &reader, &sink).unwrap();

    // Deterministic ordering by source index (games::list order).
    let got_ids: Vec<i64> = states.iter().map(|s| s.game_id).collect();
    assert_eq!(got_ids, expected_ids, "returned vector is source-ordered");
    let got_has_sr: Vec<bool> = states
        .iter()
        .map(|s| s.super_resolution.is_some())
        .collect();
    assert_eq!(got_has_sr, expected_has_sr, "detections preserved per game");

    // Progress: one call per game, count reaches total monotonically, full set.
    let calls = sink.calls.lock().unwrap();
    assert_eq!(calls.len(), 16);
    let scanned_counts: Vec<u32> = calls.iter().map(|c| c.0).collect();
    assert_eq!(scanned_counts, (1..=16).collect::<Vec<_>>());
    assert!(calls.iter().all(|c| c.1 == 16));
    let progressed_ids: std::collections::HashSet<i64> = calls.iter().map(|c| c.2).collect();
    let expected_set: std::collections::HashSet<i64> = expected_ids.iter().copied().collect();
    assert_eq!(progressed_ids, expected_set, "every game emitted progress");

    // Under test-utils the NVAPI tail collapses to the safe fallback: no preset.
    assert!(
        states.iter().all(|s| s.sr_preset.is_none()),
        "NVAPI returns the safe fallback under test-utils"
    );
}

#[test]
fn scan_library_empty_returns_no_states() {
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let catalog = sr_catalog("unused");
    let reader = FakeReader {
        map: HashMap::new(),
    };
    let sink = RecordingSink::default();
    let states = detect::scan_library_with_progress(&st, &catalog, &reader, &sink).unwrap();
    assert!(states.is_empty(), "no games → no states");
    assert!(
        sink.calls.lock().unwrap().is_empty(),
        "no games → no progress calls"
    );
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
