//! DLSS swap integration tests (Phase 2).
//!
//! Exercises backup-to-`.dlsss`, copy-over, reset-from-backup, single-game
//! apply, and the resilient "Apply to All" batch over tempdir fixtures with
//! locally-seeded storage (no network).

use std::path::Path;

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::games::{self, NewGame};
use game_manager_lib::dlss::detect::{DetectionResult, DetectionSummary};
use game_manager_lib::dlss::storage;
use game_manager_lib::dlss::swap::{
    apply_to_all_impl, apply_to_game_impl, count_applicable_impl, ApplyProgressSink,
    NoopApplyProgressSink, SwapTarget,
};
use game_manager_lib::domain::{DetectedDll, DllType, MonitorMode};
use game_manager_lib::state::AppState;
use tempfile::TempDir;

/// A recording apply-progress sink.
struct Recorder {
    seen: std::sync::Mutex<Vec<i64>>,
}

impl ApplyProgressSink for Recorder {
    fn emit(&self, result: &game_manager_lib::domain::ApplyResult) {
        self.seen.lock().unwrap().push(result.game_id);
    }
}

fn state_with_app_data(dir: &Path) -> AppState {
    AppState::new_with_app_data_dir(open_in_memory().unwrap(), dir.to_path_buf())
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

/// Seed a downloaded DLL into local storage and write the static-manifest-free
/// catalog entry into the cached manifest so `build_catalog` finds it.
fn seed_storage_and_manifest(app_data: &Path, md5: &str, content: &[u8]) {
    // Write the local DLL.
    let dest = storage::local_dll_path(app_data, DllType::SuperResolution, "3.7", md5);
    std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
    std::fs::write(&dest, content).unwrap();

    // Write a cached manifest containing version 3.7 with this md5.
    let manifest_json = format!(
        r#"{{"dlss":[{{"version":"3.7.0.0","version_number":37,"md5_hash":"{md5}","zip_md5_hash":"zz","download_url":"https://x/x.zip","file_size":1,"zip_file_size":1,"is_signature_valid":true}}],"dlss_g":[],"dlss_d":[]}}"#
    );
    let manifest_path = storage::manifest_path(app_data);
    std::fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
    std::fs::write(&manifest_path, manifest_json).unwrap();
}

/// Seed a session SR detection (in-memory; detection is never persisted).
fn seed_sr_detection(st: &AppState, game_id: i64, dll_path: &Path) {
    st.dlss_detection_set(
        game_id,
        DetectionResult {
            summary: DetectionSummary {
                super_resolution: Some(DetectedDll {
                    version: "old".into(),
                    path: dll_path.to_string_lossy().to_string(),
                    md5: Some("oldmd5".into()),
                }),
                ..DetectionSummary::default()
            },
            ..DetectionResult::default()
        },
    );
}

/// Seed a session FG detection (in-memory; detection is never persisted).
fn seed_fg_detection(st: &AppState, game_id: i64, dll_path: &Path) {
    st.dlss_detection_set(
        game_id,
        DetectionResult {
            summary: DetectionSummary {
                frame_generation: Some(DetectedDll {
                    version: "old-fg".into(),
                    path: dll_path.to_string_lossy().to_string(),
                    md5: Some("oldfgmd5".into()),
                }),
                ..DetectionSummary::default()
            },
            ..DetectionResult::default()
        },
    );
}

#[tokio::test]
async fn apply_version_backs_up_and_copies_over() {
    let app_data = TempDir::new().unwrap();
    let game_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let exe = game_dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();
    let game_dll = game_dir.path().join("nvngx_dlss.dll");
    std::fs::write(&game_dll, b"original").unwrap();

    let new_content = b"new-dll-3.7";
    let md5 = game_manager_lib::dlss::detect::md5_hex(new_content);
    seed_storage_and_manifest(app_data.path(), &md5, new_content);

    let game_id = st
        .with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
        .unwrap();
    seed_sr_detection(&st, game_id, &game_dll);

    apply_to_game_impl(
        &st,
        game_id,
        DllType::SuperResolution,
        SwapTarget::Version("3.7".into()),
    )
    .await
    .unwrap();

    // The game DLL now holds the new content.
    assert_eq!(std::fs::read(&game_dll).unwrap(), new_content);
    // The original was backed up once.
    let backup = game_dir.path().join("nvngx_dlss.dll.dlsss");
    assert_eq!(std::fs::read(&backup).unwrap(), b"original");
}

#[tokio::test]
async fn system_default_restores_backup() {
    let app_data = TempDir::new().unwrap();
    let game_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let exe = game_dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();
    let game_dll = game_dir.path().join("nvngx_dlss.dll");
    std::fs::write(&game_dll, b"swapped").unwrap();
    let backup = game_dir.path().join("nvngx_dlss.dll.dlsss");
    std::fs::write(&backup, b"original").unwrap();

    let game_id = st
        .with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
        .unwrap();
    seed_sr_detection(&st, game_id, &game_dll);

    apply_to_game_impl(
        &st,
        game_id,
        DllType::SuperResolution,
        SwapTarget::SystemDefault,
    )
    .await
    .unwrap();

    assert_eq!(std::fs::read(&game_dll).unwrap(), b"original");
    assert!(!backup.exists(), "backup should be consumed on reset");
}

#[tokio::test]
async fn backup_is_created_only_once() {
    let app_data = TempDir::new().unwrap();
    let game_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let exe = game_dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();
    let game_dll = game_dir.path().join("nvngx_dlss.dll");
    std::fs::write(&game_dll, b"original").unwrap();

    let content_a = b"version-a";
    let md5 = game_manager_lib::dlss::detect::md5_hex(content_a);
    seed_storage_and_manifest(app_data.path(), &md5, content_a);

    let game_id = st
        .with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
        .unwrap();
    seed_sr_detection(&st, game_id, &game_dll);

    apply_to_game_impl(
        &st,
        game_id,
        DllType::SuperResolution,
        SwapTarget::Version("3.7".into()),
    )
    .await
    .unwrap();
    // Apply again — backup must still be the very first original.
    apply_to_game_impl(
        &st,
        game_id,
        DllType::SuperResolution,
        SwapTarget::Version("3.7".into()),
    )
    .await
    .unwrap();

    let backup = game_dir.path().join("nvngx_dlss.dll.dlsss");
    assert_eq!(std::fs::read(&backup).unwrap(), b"original");
}

#[tokio::test]
async fn apply_to_all_is_resilient() {
    let app_data = TempDir::new().unwrap();
    let good_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    // Good game: resolvable folder + DLL present.
    let good_exe = good_dir.path().join("game.exe");
    std::fs::write(&good_exe, b"x").unwrap();
    let good_dll = good_dir.path().join("nvngx_dlss.dll");
    std::fs::write(&good_dll, b"original").unwrap();
    let content = b"new-content";
    let md5 = game_manager_lib::dlss::detect::md5_hex(content);
    seed_storage_and_manifest(app_data.path(), &md5, content);

    let good_id = st
        .with_db(|c| games::create(c, &new_game(good_exe.to_str().unwrap())))
        .unwrap();
    seed_sr_detection(&st, good_id, &good_dll);

    // Bad game: cached detection points at a non-existent folder.
    let bad_id = st
        .with_db(|c| games::create(c, &new_game("steam://run/1")))
        .unwrap();
    seed_sr_detection(&st, bad_id, Path::new("Z:/missing/nvngx_dlss.dll"));

    let recorder = Recorder {
        seen: std::sync::Mutex::new(vec![]),
    };
    let batch = apply_to_all_impl(&st, DllType::SuperResolution, "3.7", &recorder)
        .await
        .unwrap();

    assert_eq!(batch.total, 2);
    assert_eq!(batch.succeeded, 1);
    assert_eq!(batch.failed, 1);
    assert_eq!(recorder.seen.lock().unwrap().len(), 2);
    assert_eq!(std::fs::read(&good_dll).unwrap(), content);
}

#[tokio::test]
async fn apply_to_game_unresolvable_folder_errors() {
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    let game_id = st
        .with_db(|c| games::create(c, &new_game("steam://run/1")))
        .unwrap();
    let err = apply_to_game_impl(
        &st,
        game_id,
        DllType::SuperResolution,
        SwapTarget::SystemDefault,
    )
    .await
    .unwrap_err();
    assert!(err.to_string().contains("install folder"));
}

#[test]
fn count_applicable_counts_detected() {
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    let game_id = st
        .with_db(|c| games::create(c, &new_game("x.exe")))
        .unwrap();
    seed_sr_detection(&st, game_id, Path::new("x.dll"));
    assert_eq!(
        count_applicable_impl(&st, DllType::SuperResolution).unwrap(),
        1
    );
    assert_eq!(
        count_applicable_impl(&st, DllType::FrameGeneration).unwrap(),
        0
    );
}

#[tokio::test]
async fn apply_resolves_destination_without_cached_detection() {
    // No cached detection row: destination resolves via the game folder + the
    // canonical filename (find_dll fallback).
    let app_data = TempDir::new().unwrap();
    let game_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let exe = game_dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();
    let game_dll = game_dir.path().join("nvngx_dlss.dll");
    std::fs::write(&game_dll, b"original").unwrap();

    let content = b"new";
    let md5 = game_manager_lib::dlss::detect::md5_hex(content);
    seed_storage_and_manifest(app_data.path(), &md5, content);

    let game_id = st
        .with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
        .unwrap();
    // Intentionally do NOT upsert a detection row.

    apply_to_game_impl(
        &st,
        game_id,
        DllType::SuperResolution,
        SwapTarget::Version("3.7".into()),
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&game_dll).unwrap(), content);
}

#[tokio::test]
async fn apply_creates_dll_when_folder_has_none() {
    // Folder resolvable but no existing DLL: destination is folder + filename.
    let app_data = TempDir::new().unwrap();
    let game_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let exe = game_dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();

    let content = b"fresh";
    let md5 = game_manager_lib::dlss::detect::md5_hex(content);
    seed_storage_and_manifest(app_data.path(), &md5, content);

    let game_id = st
        .with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
        .unwrap();

    apply_to_game_impl(
        &st,
        game_id,
        DllType::SuperResolution,
        SwapTarget::Version("3.7".into()),
    )
    .await
    .unwrap();
    let dll = game_dir.path().join("nvngx_dlss.dll");
    assert_eq!(std::fs::read(&dll).unwrap(), content);
}

#[tokio::test]
async fn system_default_without_backup_is_noop_ok() {
    let app_data = TempDir::new().unwrap();
    let game_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let exe = game_dir.path().join("game.exe");
    std::fs::write(&exe, b"x").unwrap();
    let game_dll = game_dir.path().join("nvngx_dlss.dll");
    std::fs::write(&game_dll, b"current").unwrap();

    let game_id = st
        .with_db(|c| games::create(c, &new_game(exe.to_str().unwrap())))
        .unwrap();
    seed_sr_detection(&st, game_id, &game_dll);

    // No .dlsss backup exists → reset is a no-op success.
    apply_to_game_impl(
        &st,
        game_id,
        DllType::SuperResolution,
        SwapTarget::SystemDefault,
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&game_dll).unwrap(), b"current");
}

#[tokio::test]
async fn apply_to_all_empty_library_returns_zero_batch() {
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    let batch = apply_to_all_impl(&st, DllType::SuperResolution, "3.7", &NoopApplyProgressSink)
        .await
        .unwrap();
    assert_eq!(batch.total, 0);
    assert!(batch.results.is_empty());
}

#[tokio::test]
async fn apply_to_all_only_targets_games_with_that_dll_detected() {
    let app_data = TempDir::new().unwrap();
    let sr_dir = TempDir::new().unwrap();
    let fg_dir = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());

    let sr_exe = sr_dir.path().join("sr-game.exe");
    let fg_exe = fg_dir.path().join("fg-game.exe");
    std::fs::write(&sr_exe, b"x").unwrap();
    std::fs::write(&fg_exe, b"x").unwrap();

    let sr_dll = sr_dir.path().join("nvngx_dlss.dll");
    let fg_dll = fg_dir.path().join("nvngx_dlssg.dll");
    std::fs::write(&sr_dll, b"original-sr").unwrap();
    std::fs::write(&fg_dll, b"original-fg").unwrap();

    let content = b"new-content";
    let md5 = game_manager_lib::dlss::detect::md5_hex(content);
    seed_storage_and_manifest(app_data.path(), &md5, content);

    let sr_id = st
        .with_db(|c| games::create(c, &new_game(sr_exe.to_str().unwrap())))
        .unwrap();
    let fg_id = st
        .with_db(|c| games::create(c, &new_game(fg_exe.to_str().unwrap())))
        .unwrap();

    seed_sr_detection(&st, sr_id, &sr_dll);
    seed_fg_detection(&st, fg_id, &fg_dll);

    let batch = apply_to_all_impl(&st, DllType::SuperResolution, "3.7", &NoopApplyProgressSink)
        .await
        .unwrap();

    assert_eq!(batch.total, 1);
    assert_eq!(batch.succeeded, 1);
    assert_eq!(std::fs::read(&sr_dll).unwrap(), content);
    assert_eq!(std::fs::read(&fg_dll).unwrap(), b"original-fg");
}

#[test]
fn noop_apply_sink_emit_does_not_panic() {
    let sink = NoopApplyProgressSink;
    sink.emit(&game_manager_lib::domain::ApplyResult {
        game_id: 1,
        name: "X".into(),
        ok: true,
        message: None,
    });
}

#[test]
fn system_default_target_is_distinct_from_version() {
    assert_ne!(SwapTarget::SystemDefault, SwapTarget::Version("3.7".into()));
}

#[tokio::test]
async fn apply_to_all_records_per_game_failures() {
    let app_data = TempDir::new().unwrap();
    let st = state_with_app_data(app_data.path());
    let game_id = st
        .with_db(|c| games::create(c, &new_game("steam://run/42")))
        .unwrap();
    st.dlss_detection_set(
        game_id,
        DetectionResult {
            summary: DetectionSummary {
                super_resolution: Some(DetectedDll {
                    version: "old".into(),
                    path: "C:/missing/nvngx_dlss.dll".into(),
                    md5: Some("oldmd5".into()),
                }),
                ..DetectionSummary::default()
            },
            ..DetectionResult::default()
        },
    );

    let batch = apply_to_all_impl(&st, DllType::SuperResolution, "3.7", &NoopApplyProgressSink)
        .await
        .unwrap();

    assert_eq!(batch.total, 1);
    assert_eq!(batch.failed, 1);
    assert_eq!(batch.succeeded, 0);
    assert!(!batch.results[0].ok);
}
