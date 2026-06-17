//! DLSS NVAPI preset-logic integration tests (Phase 3).
//!
//! Exercises the preset orchestration against a fake [`NvapiDriver`] (no GPU
//! needed): profile matching (Levenshtein ordering + exe match), value
//! translation (global / per-game get/set), the unavailable case when no profile
//! matches, and error classification (privilege-required vs unsupported). Also
//! covers the bundled preset-option lists and the game-identity resolution.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use game_manager_lib::db::connection::open_in_memory;
use game_manager_lib::db::repo::games::{self, NewGame};
use game_manager_lib::domain::{MonitorMode, PresetKind};
use game_manager_lib::dlss::nvapi::drs::{find_app_profile, levenshtein, DrsOrchestrator};
use game_manager_lib::dlss::nvapi::ffi::{
    make_nvapi_version, NvapiDriver, ProfileInfo, SettingLocation, SettingValue, PRESET_RECOMMENDED,
    SETTING_ID_DLSS_RR, SETTING_ID_DLSS_RR_OVERRIDE, SETTING_ID_DLSS_SR,
    SETTING_ID_DLSS_SR_OVERRIDE,
};
use game_manager_lib::dlss::nvapi::presets::{self, game_identity, setting_id};
use game_manager_lib::dlss::DlssError;
use game_manager_lib::state::AppState;

// ---------------------------------------------------------------------------
// Fake driver.
// ---------------------------------------------------------------------------

/// A configurable in-memory [`NvapiDriver`] fake.
struct FakeDriver {
    global_profile: usize,
    profiles: Vec<ProfileInfo>,
    /// Settings keyed by `(profile_handle, setting_id)` → value + location.
    settings: Mutex<Vec<((usize, u32), SettingValue)>>,
    /// Number of times [`NvapiDriver::reload`] / [`NvapiDriver::save`] were called
    /// (shared so a test can inspect them after the driver is boxed).
    reloads: Arc<AtomicUsize>,
    saves: Arc<AtomicUsize>,
    /// Optional forced error for every call.
    error: Option<fn() -> DlssError>,
}

impl FakeDriver {
    fn new(global_profile: usize, profiles: Vec<ProfileInfo>) -> Self {
        Self {
            global_profile,
            profiles,
            settings: Mutex::new(Vec::new()),
            reloads: Arc::new(AtomicUsize::new(0)),
            saves: Arc::new(AtomicUsize::new(0)),
            error: None,
        }
    }

    /// Shared handles to the reload / save call counters.
    fn counters(&self) -> (Arc<AtomicUsize>, Arc<AtomicUsize>) {
        (Arc::clone(&self.reloads), Arc::clone(&self.saves))
    }

    /// Store a value as *locally* stored on `profile`.
    fn with_setting(self, profile: usize, setting_id: u32, value: u32) -> Self {
        self.put(profile, setting_id, value, SettingLocation::Current);
        self
    }

    /// Store a value at an explicit [`SettingLocation`] (e.g. inherited).
    fn with_setting_at(
        self,
        profile: usize,
        setting_id: u32,
        value: u32,
        location: SettingLocation,
    ) -> Self {
        self.put(profile, setting_id, value, location);
        self
    }

    fn put(&self, profile: usize, setting_id: u32, value: u32, location: SettingLocation) {
        self.settings
            .lock()
            .unwrap()
            .push(((profile, setting_id), SettingValue { value, location }));
    }

    fn failing(error: fn() -> DlssError) -> Self {
        Self {
            global_profile: 1,
            profiles: Vec::new(),
            settings: Mutex::new(Vec::new()),
            reloads: Arc::new(AtomicUsize::new(0)),
            saves: Arc::new(AtomicUsize::new(0)),
            error: Some(error),
        }
    }

    fn lookup(&self, profile: usize, setting_id: u32) -> Option<SettingValue> {
        self.settings
            .lock()
            .unwrap()
            .iter()
            .find(|((p, s), _)| *p == profile && *s == setting_id)
            .map(|(_, v)| *v)
    }
}

impl NvapiDriver for FakeDriver {
    fn global_profile(&self) -> Result<usize, DlssError> {
        if let Some(err) = self.error {
            return Err(err());
        }
        Ok(self.global_profile)
    }

    fn enumerate_profiles(&self) -> Result<Vec<ProfileInfo>, DlssError> {
        if let Some(err) = self.error {
            return Err(err());
        }
        Ok(self.profiles.clone())
    }

    fn reload(&self) -> Result<(), DlssError> {
        if let Some(err) = self.error {
            return Err(err());
        }
        self.reloads.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn get_setting(
        &self,
        profile: usize,
        setting_id: u32,
    ) -> Result<Option<SettingValue>, DlssError> {
        if let Some(err) = self.error {
            return Err(err());
        }
        Ok(self.lookup(profile, setting_id))
    }

    fn set_setting(&self, profile: usize, setting_id: u32, value: u32) -> Result<(), DlssError> {
        if let Some(err) = self.error {
            return Err(err());
        }
        let mut settings = self.settings.lock().unwrap();
        if let Some(entry) = settings
            .iter_mut()
            .find(|((p, s), _)| *p == profile && *s == setting_id)
        {
            // Writes always store locally on the queried profile.
            entry.1 = SettingValue {
                value,
                location: SettingLocation::Current,
            };
        } else {
            settings.push((
                (profile, setting_id),
                SettingValue {
                    value,
                    location: SettingLocation::Current,
                },
            ));
        }
        Ok(())
    }

    fn save(&self) -> Result<(), DlssError> {
        if let Some(err) = self.error {
            return Err(err());
        }
        self.saves.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

fn profile(handle: usize, name: &str, exes: &[&str]) -> ProfileInfo {
    ProfileInfo {
        handle,
        name: name.to_string(),
        exe_names: exes.iter().map(|e| e.to_lowercase()).collect(),
    }
}

fn orchestrator(driver: FakeDriver) -> DrsOrchestrator {
    DrsOrchestrator::new(Box::new(driver))
}

fn state() -> AppState {
    AppState::new(open_in_memory().unwrap())
}

// ---------------------------------------------------------------------------
// Bundled preset options + version macro.
// ---------------------------------------------------------------------------

#[test]
fn preset_options_contain_default_and_recommended() {
    let sr = presets::preset_options(PresetKind::Dlss).unwrap();
    assert!(sr.iter().any(|p| p.value == 0 && p.name == "Default"));
    assert!(sr.iter().any(|p| p.value == 0x00FF_FFFF));

    let rr = presets::preset_options(PresetKind::RayReconstruction).unwrap();
    assert!(rr.iter().any(|p| p.value == 0 && p.name == "Default"));
}

#[test]
fn make_nvapi_version_packs_size_and_interface_version() {
    let packed = make_nvapi_version::<u32>(1);
    assert_eq!(packed, 4 | (1 << 16));
}

#[test]
fn setting_id_maps_each_kind_to_the_appendix_id() {
    assert_eq!(setting_id(PresetKind::Dlss), SETTING_ID_DLSS_SR);
    assert_eq!(setting_id(PresetKind::RayReconstruction), SETTING_ID_DLSS_RR);
}

// ---------------------------------------------------------------------------
// Levenshtein + profile matching.
// ---------------------------------------------------------------------------

#[test]
fn levenshtein_is_case_insensitive_and_correct() {
    assert_eq!(levenshtein("", ""), 0);
    assert_eq!(levenshtein("abc", ""), 3);
    assert_eq!(levenshtein("", "abc"), 3);
    assert_eq!(levenshtein("Kitten", "sitting"), 3);
    assert_eq!(levenshtein("Cyberpunk", "cyberpunk"), 0);
}

#[test]
fn find_app_profile_picks_closest_name_with_matching_exe() {
    let profiles = vec![
        profile(10, "Some Other Game", &["other.exe"]),
        profile(20, "Cyberpunk 2077", &["cyberpunk2077.exe"]),
        profile(30, "Cyberpunk 2077 Demo", &["cyberpunk2077.exe"]),
    ];
    let exes = vec!["Cyberpunk2077.exe".to_string()];
    // Closest by name is the exact "Cyberpunk 2077" (distance 0) and its exe matches.
    assert_eq!(find_app_profile(&profiles, "Cyberpunk 2077", &exes), Some(20));
}

#[test]
fn find_app_profile_skips_closest_name_without_exe_match() {
    let profiles = vec![
        profile(20, "Cyberpunk 2077", &["wrong.exe"]),
        profile(30, "Cyberpunk Two", &["cyberpunk2077.exe"]),
    ];
    let exes = vec!["cyberpunk2077.exe".to_string()];
    // Closest name (20) has no exe match; the next confirmed candidate wins.
    assert_eq!(find_app_profile(&profiles, "Cyberpunk 2077", &exes), Some(30));
}

#[test]
fn find_app_profile_returns_none_when_no_exe_matches() {
    let profiles = vec![profile(20, "Cyberpunk 2077", &["cyberpunk2077.exe"])];
    let exes = vec!["different.exe".to_string()];
    assert_eq!(find_app_profile(&profiles, "Cyberpunk 2077", &exes), None);
}

#[test]
fn find_app_profile_returns_none_with_no_exes() {
    let profiles = vec![profile(20, "Cyberpunk 2077", &["cyberpunk2077.exe"])];
    assert_eq!(find_app_profile(&profiles, "Cyberpunk 2077", &[]), None);
}

#[test]
fn find_app_profile_matches_exe_path_case_insensitively() {
    let profiles = vec![profile(20, "Game", &["game.exe"])];
    let exes = vec!["C:/Games/Game/GAME.EXE".to_string()];
    assert_eq!(find_app_profile(&profiles, "Game", &exes), Some(20));
}

// ---------------------------------------------------------------------------
// Global preset get/set round-trips.
// ---------------------------------------------------------------------------

#[test]
fn global_preset_get_reads_base_profile_value() {
    let driver = FakeDriver::new(1, vec![]).with_setting(1, SETTING_ID_DLSS_SR, 0x5);
    let drs = orchestrator(driver);
    let value = presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap();
    assert_eq!(value, 0x5);
}

#[test]
fn global_preset_get_unset_reads_as_default() {
    let drs = orchestrator(FakeDriver::new(1, vec![]));
    let value = presets::get_global_preset_with(&drs, PresetKind::RayReconstruction).unwrap();
    assert_eq!(value, 0);
}

#[test]
fn global_preset_set_then_get_round_trips() {
    let drs = orchestrator(FakeDriver::new(1, vec![]));
    presets::set_global_preset_with(&drs, PresetKind::Dlss, 0xB).unwrap();
    let value = presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap();
    assert_eq!(value, 0xB);
}

// ---------------------------------------------------------------------------
// Per-game preset get/set targets the matched profile.
// ---------------------------------------------------------------------------

#[test]
fn game_preset_get_targets_matched_profile() {
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let driver = FakeDriver::new(1, profiles).with_setting(20, SETTING_ID_DLSS_SR, 0x4);
    let drs = orchestrator(driver);
    let exes = vec!["mygame.exe".to_string()];
    let preset = presets::get_game_preset_with(&drs, "My Game", &exes, PresetKind::Dlss).unwrap();
    assert!(preset.available);
    assert_eq!(preset.value, 0x4);
}

#[test]
fn game_preset_get_unavailable_when_no_profile_matches() {
    let profiles = vec![profile(20, "Other", &["other.exe"])];
    let drs = orchestrator(FakeDriver::new(1, profiles));
    let exes = vec!["mygame.exe".to_string()];
    let preset = presets::get_game_preset_with(&drs, "My Game", &exes, PresetKind::Dlss).unwrap();
    assert!(!preset.available);
    assert_eq!(preset.value, 0);
}

#[test]
fn game_preset_get_matched_but_unset_reads_default() {
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let drs = orchestrator(FakeDriver::new(1, profiles));
    let exes = vec!["mygame.exe".to_string()];
    let preset = presets::get_game_preset_with(&drs, "My Game", &exes, PresetKind::Dlss).unwrap();
    assert!(preset.available);
    assert_eq!(preset.value, 0);
}

#[test]
fn game_preset_set_round_trips_on_matched_profile() {
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let drs = orchestrator(FakeDriver::new(1, profiles));
    let exes = vec!["mygame.exe".to_string()];
    let applied =
        presets::set_game_preset_with(&drs, "My Game", &exes, PresetKind::RayReconstruction, 0x4)
            .unwrap();
    assert!(applied);
    let preset =
        presets::get_game_preset_with(&drs, "My Game", &exes, PresetKind::RayReconstruction)
            .unwrap();
    assert_eq!(preset.value, 0x4);
}

#[test]
fn game_preset_set_no_op_when_no_profile_matches() {
    let profiles = vec![profile(20, "Other", &["other.exe"])];
    let drs = orchestrator(FakeDriver::new(1, profiles));
    let exes = vec!["mygame.exe".to_string()];
    let applied =
        presets::set_game_preset_with(&drs, "My Game", &exes, PresetKind::Dlss, 0x4).unwrap();
    assert!(!applied);
}

// ---------------------------------------------------------------------------
// Error classification.
// ---------------------------------------------------------------------------

#[test]
fn privilege_error_propagates_from_set() {
    let drs = orchestrator(FakeDriver::failing(|| DlssError::Privilege));
    let err = presets::set_global_preset_with(&drs, PresetKind::Dlss, 0x4).unwrap_err();
    assert!(matches!(err, DlssError::Privilege));
}

#[test]
fn unsupported_error_propagates_from_get() {
    let drs = orchestrator(FakeDriver::failing(|| DlssError::Unsupported));
    let err = presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap_err();
    assert!(matches!(err, DlssError::Unsupported));
}

#[test]
fn app_setting_error_propagates_from_enumeration() {
    let drs = orchestrator(FakeDriver::failing(|| DlssError::Unsupported));
    let exes = vec!["mygame.exe".to_string()];
    let err = presets::get_game_preset_with(&drs, "My Game", &exes, PresetKind::Dlss).unwrap_err();
    assert!(matches!(err, DlssError::Unsupported));
}

// ---------------------------------------------------------------------------
// Game identity resolution from the DB.
// ---------------------------------------------------------------------------

fn insert_game(state: &AppState, name: &str, launch: &str, process: Option<&str>) -> i64 {
    state
        .with_db(|conn| {
            games::create(
                conn,
                &NewGame {
                    name: name.to_string(),
                    launch_target: launch.to_string(),
                    monitor_mode: MonitorMode::Tree,
                    monitor_process_name: process.map(str::to_string),
                    arguments: None,
                    image_path: None,
                },
            )
        })
        .unwrap()
}

#[test]
fn game_identity_extracts_name_and_exe_from_launch_target() {
    let state = state();
    let id = insert_game(&state, "My Game", "C:/Games/MyGame/mygame.exe", None);
    let (name, exes) = game_identity(&state, id).unwrap();
    assert_eq!(name, "My Game");
    assert_eq!(exes, vec!["mygame.exe".to_string()]);
}

#[test]
fn game_identity_includes_named_monitor_process() {
    let state = state();
    let id = insert_game(
        &state,
        "Launcher Game",
        "C:/Games/launcher.exe",
        Some("game.exe"),
    );
    let (_, exes) = game_identity(&state, id).unwrap();
    assert!(exes.iter().any(|e| e == "launcher.exe"));
    assert!(exes.iter().any(|e| e == "game.exe"));
}

#[test]
fn game_identity_skips_non_exe_launch_targets() {
    let state = state();
    let id = insert_game(&state, "URI Game", "steam://run/12345", None);
    let (_, exes) = game_identity(&state, id).unwrap();
    assert!(exes.is_empty());
}

#[test]
fn game_identity_deduplicates_repeated_exe() {
    let state = state();
    let id = insert_game(&state, "Dup", "C:/a/game.exe", Some("D:/b/GAME.EXE"));
    let (_, exes) = game_identity(&state, id).unwrap();
    assert_eq!(exes.len(), 1);
}

#[test]
fn game_identity_skips_blank_monitor_process() {
    let state = state();
    let id = insert_game(&state, "Blank", "C:/a/game.exe", Some("   "));
    let (_, exes) = game_identity(&state, id).unwrap();
    assert_eq!(exes, vec!["game.exe".to_string()]);
}

#[test]
fn game_identity_includes_exes_found_in_resolved_folder() {
    let state = state();
    let folder = tempfile::TempDir::new().unwrap();
    let launcher = folder.path().join("launcher.exe");
    let actual = folder.path().join("actualgame.exe");
    std::fs::write(&launcher, b"x").unwrap();
    std::fs::write(&actual, b"x").unwrap();
    let id = insert_game(&state, "Folder Scan", launcher.to_str().unwrap(), None);
    let (_, exes) = game_identity(&state, id).unwrap();
    assert!(exes.iter().any(|exe| exe == "launcher.exe"));
    assert!(exes.iter().any(|exe| exe == "actualgame.exe"));
}

// ---------------------------------------------------------------------------
// Per-game orchestration that resolves identity from the DB then delegates.
// ---------------------------------------------------------------------------

#[test]
fn get_game_preset_for_resolves_identity_and_matches_profile() {
    let state = state();
    let id = insert_game(&state, "My Game", "C:/Games/MyGame/mygame.exe", None);
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let driver = FakeDriver::new(1, profiles).with_setting(20, SETTING_ID_DLSS_SR, 0x6);
    let drs = orchestrator(driver);
    let preset = presets::get_game_preset_for(&drs, &state, id, PresetKind::Dlss).unwrap();
    assert!(preset.available);
    assert_eq!(preset.value, 0x6);
}

#[test]
fn get_game_preset_for_matches_profile_from_folder_exe() {
    let state = state();
    let folder = tempfile::TempDir::new().unwrap();
    let launcher = folder.path().join("launcher.exe");
    let actual = folder.path().join("mygame.exe");
    std::fs::write(&launcher, b"x").unwrap();
    std::fs::write(&actual, b"x").unwrap();
    let id = insert_game(&state, "My Game", launcher.to_str().unwrap(), None);
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let driver = FakeDriver::new(1, profiles).with_setting(20, SETTING_ID_DLSS_SR, 0x7);
    let drs = orchestrator(driver);
    let preset = presets::get_game_preset_for(&drs, &state, id, PresetKind::Dlss).unwrap();
    assert!(preset.available);
    assert_eq!(preset.value, 0x7);
}

#[test]
fn set_game_preset_for_applies_to_matched_profile() {
    let state = state();
    let id = insert_game(&state, "My Game", "C:/Games/MyGame/mygame.exe", None);
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let drs = orchestrator(FakeDriver::new(1, profiles));
    presets::set_game_preset_for(&drs, &state, id, PresetKind::Dlss, 0x4).unwrap();
    let preset = presets::get_game_preset_for(&drs, &state, id, PresetKind::Dlss).unwrap();
    assert_eq!(preset.value, 0x4);
}

#[test]
fn set_game_preset_for_is_noop_success_when_unmatched() {
    let state = state();
    let id = insert_game(&state, "My Game", "C:/Games/MyGame/mygame.exe", None);
    let profiles = vec![profile(20, "Other", &["other.exe"])];
    let drs = orchestrator(FakeDriver::new(1, profiles));
    // No matching profile → success (the per-game surface is unavailable, not an error).
    presets::set_game_preset_for(&drs, &state, id, PresetKind::RayReconstruction, 0x4).unwrap();
}

// ---------------------------------------------------------------------------
// Command impls. Tests build with `test-utils`, which forces `real_driver()` to
// return `Unsupported`, so these NEVER reach the live driver — running them must
// never mutate real NVIDIA preset state, even on a developer's GPU. The `Ok`
// arms remain only as defensive no-panic guards.
// ---------------------------------------------------------------------------

#[test]
fn global_get_impl_is_unsupported_or_ok_without_gpu() {
    // `test-utils` guarantees `Unsupported`; must not panic or touch the driver.
    match presets::get_global_preset_impl(&state(), PresetKind::Dlss) {
        Ok(_) => {}
        Err(err) => assert!(matches!(err, DlssError::Unsupported)),
    }
}

#[test]
fn global_set_impl_is_unsupported_or_ok_without_gpu() {
    match presets::set_global_preset_impl(&state(), PresetKind::Dlss, 0x4) {
        Ok(_) => {}
        Err(err) => assert!(matches!(err, DlssError::Unsupported | DlssError::Privilege)),
    }
}

#[test]
fn game_get_impl_is_unsupported_or_ok_without_gpu() {
    let state = state();
    let id = insert_game(&state, "G", "C:/g/g.exe", None);
    match presets::get_game_preset_impl(&state, id, PresetKind::RayReconstruction) {
        Ok(_) => {}
        Err(err) => assert!(matches!(err, DlssError::Unsupported)),
    }
}

#[test]
fn game_set_impl_is_unsupported_or_ok_without_gpu() {
    let state = state();
    let id = insert_game(&state, "G", "C:/g/g.exe", None);
    match presets::set_game_preset_impl(&state, id, PresetKind::Dlss, 0x4) {
        Ok(_) => {}
        Err(err) => assert!(matches!(err, DlssError::Unsupported | DlssError::Privilege)),
    }
}

// ---------------------------------------------------------------------------
// DRS local-vs-inherited setting-location semantics (the root-cause fix).
//
// Only values stored *locally* on the queried profile are the effective preset;
// inherited DWORDs (global / base) must read as Default, matching NVIDIA App.
// ---------------------------------------------------------------------------

#[test]
fn inherited_global_selection_reads_as_default_not_the_dword() {
    // The global profile carries an inherited Preset D (4) but nothing local:
    // the effective global preset must be Default, not Preset D.
    let driver = FakeDriver::new(1, vec![]).with_setting_at(
        1,
        SETTING_ID_DLSS_SR,
        4,
        SettingLocation::Base,
    );
    let drs = orchestrator(driver);
    assert_eq!(
        presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap(),
        0
    );
}

#[test]
fn local_recommended_sentinel_reads_back_as_recommended() {
    // "NVIDIA recommended" is just the local selection sentinel `0x00FFFFFF`.
    let driver = FakeDriver::new(1, vec![]).with_setting(1, SETTING_ID_DLSS_SR, PRESET_RECOMMENDED);
    let drs = orchestrator(driver);
    assert_eq!(
        presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap(),
        PRESET_RECOMMENDED
    );
}

#[test]
fn local_selection_with_override_on_uses_the_selection() {
    let driver = FakeDriver::new(1, vec![])
        .with_setting(1, SETTING_ID_DLSS_SR_OVERRIDE, 1)
        .with_setting(1, SETTING_ID_DLSS_SR, 11);
    let drs = orchestrator(driver);
    assert_eq!(
        presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap(),
        11
    );
}

#[test]
fn per_game_inherited_selection_with_override_on_reads_default() {
    // The BG3 case: override on, but the selection DWORD is inherited from global.
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let driver = FakeDriver::new(1, profiles)
        .with_setting(20, SETTING_ID_DLSS_SR_OVERRIDE, 1)
        .with_setting_at(20, SETTING_ID_DLSS_SR, 4, SettingLocation::Global);
    let drs = orchestrator(driver);
    let exes = vec!["mygame.exe".to_string()];
    let preset = presets::get_game_preset_with(&drs, "My Game", &exes, PresetKind::Dlss).unwrap();
    assert!(preset.available);
    assert_eq!(preset.value, 0);
}

#[test]
fn per_game_local_override_off_reads_default() {
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let driver = FakeDriver::new(1, profiles)
        .with_setting(20, SETTING_ID_DLSS_RR_OVERRIDE, 0)
        .with_setting(20, SETTING_ID_DLSS_RR, 4);
    let drs = orchestrator(driver);
    let exes = vec!["mygame.exe".to_string()];
    let preset = presets::get_game_preset_with(
        &drs,
        "My Game",
        &exes,
        PresetKind::RayReconstruction,
    )
    .unwrap();
    assert_eq!(preset.value, 0);
}

#[test]
fn set_default_clears_override_and_round_trips_to_default() {
    let driver = FakeDriver::new(1, vec![])
        .with_setting(1, SETTING_ID_DLSS_SR, 11)
        .with_setting(1, SETTING_ID_DLSS_SR_OVERRIDE, 1);
    let drs = orchestrator(driver);
    presets::set_global_preset_with(&drs, PresetKind::Dlss, 0).unwrap();
    assert_eq!(
        presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap(),
        0
    );
}

#[test]
fn set_recommended_round_trips_to_recommended() {
    let drs = orchestrator(FakeDriver::new(1, vec![]));
    presets::set_global_preset_with(&drs, PresetKind::Dlss, PRESET_RECOMMENDED).unwrap();
    assert_eq!(
        presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap(),
        PRESET_RECOMMENDED
    );
}

#[test]
fn setting_location_decodes_raw_values() {
    use game_manager_lib::dlss::nvapi::ffi::status;

    assert_eq!(SettingLocation::from_raw(0), SettingLocation::Current);
    assert_eq!(SettingLocation::from_raw(1), SettingLocation::Global);
    assert_eq!(SettingLocation::from_raw(2), SettingLocation::Base);
    assert_eq!(SettingLocation::from_raw(9), SettingLocation::Other(9));

    assert!(SettingLocation::Current.is_local());
    assert!(!SettingLocation::Global.is_local());
    assert!(!SettingLocation::Other(9).is_local());

    // A local value yields its value; an inherited one yields `None`.
    assert_eq!(
        SettingValue {
            value: 7,
            location: SettingLocation::Current,
        }
        .local_value(),
        Some(7)
    );
    assert_eq!(
        SettingValue {
            value: 7,
            location: SettingLocation::Base,
        }
        .local_value(),
        None
    );

    // Both driver "not found" codes mean the setting is absent.
    assert!(status::is_setting_absent(-165));
    assert!(status::is_setting_absent(-160));
    assert!(!status::is_setting_absent(0));
    assert!(!status::is_setting_absent(-130));
}

#[test]
fn game_identity_finds_exes_in_nested_subfolders() {
    let state = state();
    let folder = tempfile::TempDir::new().unwrap();
    let launcher = folder.path().join("launcher.exe");
    let nested_dir = folder.path().join("bin");
    std::fs::create_dir_all(&nested_dir).unwrap();
    std::fs::write(&launcher, b"x").unwrap();
    std::fs::write(nested_dir.join("nested.exe"), b"x").unwrap();

    let id = insert_game(&state, "Nested Scan", launcher.to_str().unwrap(), None);
    let (_, exes) = game_identity(&state, id).unwrap();
    assert!(exes.iter().any(|exe| exe == "launcher.exe"));
    assert!(exes.iter().any(|exe| exe == "nested.exe"));
}

#[test]
fn read_reloads_driver_and_write_saves_once() {
    // A read reloads driver settings first (so external NVIDIA App / Inspector
    // edits are observed); a write persists exactly once after its batch.
    let driver = FakeDriver::new(1, vec![]);
    let (reloads, saves) = driver.counters();
    let drs = DrsOrchestrator::new(Box::new(driver));

    presets::get_global_preset_with(&drs, PresetKind::RayReconstruction).unwrap();
    assert_eq!(reloads.load(Ordering::SeqCst), 1);
    assert_eq!(saves.load(Ordering::SeqCst), 0);

    presets::set_global_preset_with(&drs, PresetKind::RayReconstruction, 4).unwrap();
    assert_eq!(saves.load(Ordering::SeqCst), 1);
}
