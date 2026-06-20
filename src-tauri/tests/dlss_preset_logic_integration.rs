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
use game_manager_lib::db::repo::{
    dlss,
    games::{self, NewGame},
};
use game_manager_lib::dlss::detect::{DetectionResult, DetectionSummary};
use game_manager_lib::dlss::nvapi::drs::{find_app_profile, levenshtein, DrsOrchestrator};
use game_manager_lib::dlss::nvapi::ffi::{
    make_nvapi_version, setting_location, DrsDwordSetting, NvapiDriver, NvapiDrs, ProfileInfo,
    PRESET_VALUE_RECOMMENDED, SETTING_ID_DLSS_RR, SETTING_ID_DLSS_SR, SETTING_ID_DLSS_SR_OVERRIDE,
    SETTING_ID_DLSS_SR_PRESET_PROFILE,
};
use game_manager_lib::dlss::nvapi::presets::{
    self, game_identity, override_setting_id, setting_id,
};
use game_manager_lib::dlss::DlssError;
use game_manager_lib::domain::{DetectedDll, GamePresetState, MonitorMode, PresetKind};
use game_manager_lib::state::AppState;

// ---------------------------------------------------------------------------
// Fake driver.
// ---------------------------------------------------------------------------

/// A configurable in-memory [`NvapiDriver`] fake.
struct FakeDriver {
    base_profile: usize,
    current_global_profile: usize,
    profiles: Vec<ProfileInfo>,
    /// Settings keyed by `(profile_handle, setting_id)`.
    settings: Mutex<Vec<((usize, u32), DrsDwordSetting)>>,
    /// Optional forced error for every call.
    error: Option<fn() -> DlssError>,
}

impl FakeDriver {
    fn new(base_profile: usize, profiles: Vec<ProfileInfo>) -> Self {
        Self {
            base_profile,
            current_global_profile: base_profile,
            profiles,
            settings: Mutex::new(Vec::new()),
            error: None,
        }
    }

    fn with_current_global_profile(self, profile: usize) -> Self {
        Self {
            current_global_profile: profile,
            ..self
        }
    }

    fn with_setting(self, profile: usize, setting_id: u32, value: u32) -> Self {
        self.with_setting_detail(
            profile,
            setting_id,
            DrsDwordSetting {
                value,
                location: setting_location::CURRENT_PROFILE,
            },
        )
    }

    fn with_inherited_setting(self, profile: usize, setting_id: u32, value: u32) -> Self {
        self.with_setting_detail(
            profile,
            setting_id,
            DrsDwordSetting {
                value,
                location: setting_location::GLOBAL_PROFILE,
            },
        )
    }

    fn with_base_inherited_setting(self, profile: usize, setting_id: u32, value: u32) -> Self {
        self.with_setting_detail(
            profile,
            setting_id,
            DrsDwordSetting {
                value,
                location: setting_location::BASE_PROFILE,
            },
        )
    }

    fn with_setting_detail(
        self,
        profile: usize,
        setting_id: u32,
        setting: DrsDwordSetting,
    ) -> Self {
        self.settings
            .lock()
            .unwrap()
            .push(((profile, setting_id), setting));
        self
    }

    fn failing(error: fn() -> DlssError) -> Self {
        Self {
            base_profile: 1,
            current_global_profile: 1,
            profiles: Vec::new(),
            settings: Mutex::new(Vec::new()),
            error: Some(error),
        }
    }

    fn lookup(&self, profile: usize, setting_id: u32) -> Option<DrsDwordSetting> {
        self.settings
            .lock()
            .unwrap()
            .iter()
            .find(|((p, s), _)| *p == profile && *s == setting_id)
            .map(|(_, setting)| *setting)
    }
}

impl NvapiDriver for FakeDriver {
    fn base_profile(&self) -> Result<usize, DlssError> {
        if let Some(err) = self.error {
            return Err(err());
        }
        Ok(self.base_profile)
    }

    fn current_global_profile(&self) -> Result<usize, DlssError> {
        if let Some(err) = self.error {
            return Err(err());
        }
        Ok(self.current_global_profile)
    }

    fn enumerate_profiles(&self) -> Result<Vec<ProfileInfo>, DlssError> {
        if let Some(err) = self.error {
            return Err(err());
        }
        Ok(self.profiles.clone())
    }

    fn get_setting_detail(
        &self,
        profile: usize,
        setting_id: u32,
    ) -> Result<Option<DrsDwordSetting>, DlssError> {
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
        let entry = DrsDwordSetting {
            value,
            location: setting_location::CURRENT_PROFILE,
        };
        if let Some(existing) = settings
            .iter_mut()
            .find(|((p, s), _)| *p == profile && *s == setting_id)
        {
            existing.1 = entry;
        } else {
            settings.push(((profile, setting_id), entry));
        }
        Ok(())
    }
}

struct CountingDriver {
    profiles: Vec<ProfileInfo>,
    enumerate_calls: Arc<AtomicUsize>,
    reload_calls: Arc<AtomicUsize>,
}

impl NvapiDriver for CountingDriver {
    fn base_profile(&self) -> Result<usize, DlssError> {
        Ok(1)
    }

    fn current_global_profile(&self) -> Result<usize, DlssError> {
        Ok(1)
    }

    fn enumerate_profiles(&self) -> Result<Vec<ProfileInfo>, DlssError> {
        self.enumerate_calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.profiles.clone())
    }

    fn get_setting_detail(
        &self,
        _profile: usize,
        _setting_id: u32,
    ) -> Result<Option<DrsDwordSetting>, DlssError> {
        Ok(None)
    }

    fn set_setting(&self, _profile: usize, _setting_id: u32, _value: u32) -> Result<(), DlssError> {
        Ok(())
    }

    fn reload_settings(&self) -> Result<(), DlssError> {
        self.reload_calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

struct MinimalDriver;

impl NvapiDriver for MinimalDriver {
    fn base_profile(&self) -> Result<usize, DlssError> {
        Ok(7)
    }

    fn current_global_profile(&self) -> Result<usize, DlssError> {
        Ok(7)
    }

    fn enumerate_profiles(&self) -> Result<Vec<ProfileInfo>, DlssError> {
        Ok(Vec::new())
    }

    fn get_setting_detail(
        &self,
        _profile: usize,
        setting_id: u32,
    ) -> Result<Option<DrsDwordSetting>, DlssError> {
        Ok(Some(DrsDwordSetting {
            value: setting_id,
            location: setting_location::CURRENT_PROFILE,
        }))
    }

    fn set_setting(&self, _profile: usize, _setting_id: u32, _value: u32) -> Result<(), DlssError> {
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
    assert_eq!(
        setting_id(PresetKind::RayReconstruction),
        SETTING_ID_DLSS_RR
    );
}

#[test]
fn preset_profile_setting_id_exists_only_for_dlss() {
    assert_eq!(
        presets::preset_profile_setting_id(PresetKind::Dlss),
        Some(SETTING_ID_DLSS_SR_PRESET_PROFILE)
    );
    assert_eq!(
        presets::preset_profile_setting_id(PresetKind::RayReconstruction),
        None
    );
}

#[test]
fn ffi_real_driver_is_unsupported_or_available_without_panicking() {
    match game_manager_lib::dlss::nvapi::ffi::real_driver() {
        Ok(_) => panic!("test-utils builds must not open the live NVAPI driver"),
        Err(err) => assert!(matches!(err, DlssError::Unsupported)),
    }
}

#[test]
fn real_nvapi_drs_is_unsupported_or_available_without_panicking() {
    match game_manager_lib::dlss::nvapi::drs::real_nvapi_drs() {
        Ok(_) => panic!("test-utils builds must not open a live NVAPI DRS session"),
        Err(err) => assert!(matches!(err, DlssError::Unsupported)),
    }
}

#[test]
fn ffi_default_helpers_delegate_without_custom_overrides() {
    let driver = MinimalDriver;
    assert_eq!(driver.get_setting(7, 0x1234).unwrap(), Some(0x1234));
    driver.reload_settings().unwrap();
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
fn find_app_profile_matches_exact_title_without_exe_check() {
    let profiles = vec![profile(20, "Cyberpunk 2077", &["cyberpunk2077.exe"])];
    assert_eq!(find_app_profile(&profiles, "Cyberpunk 2077", &[]), Some(20));
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
    assert_eq!(
        find_app_profile(&profiles, "Cyberpunk 2077", &exes),
        Some(20)
    );
}

#[test]
fn find_app_profile_skips_closest_name_without_exe_match() {
    let profiles = vec![
        profile(20, "Example Game Pro", &["wrong.exe"]),
        profile(30, "Totally Different", &["game.exe"]),
    ];
    let exes = vec!["game.exe".to_string()];
    // Closest name (20) has no exe match; the next confirmed candidate wins.
    assert_eq!(find_app_profile(&profiles, "Example Game", &exes), Some(30));
}

#[test]
fn find_app_profile_returns_none_when_no_exe_matches_and_no_title_match() {
    let profiles = vec![profile(20, "Some Other Game", &["other.exe"])];
    let exes = vec!["different.exe".to_string()];
    assert_eq!(find_app_profile(&profiles, "Cyberpunk 2077", &exes), None);
}

#[test]
fn find_app_profile_returns_none_with_no_exes_and_no_title_match() {
    let profiles = vec![profile(20, "Some Other Game", &["other.exe"])];
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
fn global_preset_get_reads_current_global_profile_not_base() {
    let driver = FakeDriver::new(1, vec![])
        .with_current_global_profile(99)
        .with_setting(1, SETTING_ID_DLSS_SR, 0x4)
        .with_setting(99, SETTING_ID_DLSS_SR, 0xB);
    let drs = orchestrator(driver);
    let value = presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap();
    assert_eq!(value, 0xB);
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

#[test]
fn global_preset_get_ignores_inherited_base_selection() {
    let driver = FakeDriver::new(1, vec![])
        .with_current_global_profile(99)
        .with_setting(1, SETTING_ID_DLSS_SR, 0x4)
        .with_base_inherited_setting(99, SETTING_ID_DLSS_SR, 0x4);
    let drs = orchestrator(driver);
    let value = presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap();
    assert_eq!(value, 0);
}

#[test]
fn global_preset_get_recommended_mode_overrides_inherited_selection() {
    let driver = FakeDriver::new(1, vec![])
        .with_current_global_profile(99)
        .with_setting(99, SETTING_ID_DLSS_SR_PRESET_PROFILE, 1)
        .with_base_inherited_setting(99, SETTING_ID_DLSS_SR, 0x4);
    let drs = orchestrator(driver);
    let value = presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap();
    assert_eq!(value, PRESET_VALUE_RECOMMENDED);
}

#[test]
fn global_preset_get_local_custom_preset_k() {
    let driver = FakeDriver::new(1, vec![])
        .with_current_global_profile(99)
        .with_setting(99, SETTING_ID_DLSS_SR_PRESET_PROFILE, 2)
        .with_setting(99, SETTING_ID_DLSS_SR, 0xB)
        .with_base_inherited_setting(99, SETTING_ID_DLSS_SR, 0x4);
    let drs = orchestrator(driver);
    let value = presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap();
    assert_eq!(value, 0xB);
}

#[test]
fn global_preset_set_recommended_writes_profile_mode_and_selection() {
    let driver = FakeDriver::new(1, vec![]);
    let drs = orchestrator(driver);
    presets::set_global_preset_with(&drs, PresetKind::Dlss, PRESET_VALUE_RECOMMENDED).unwrap();
    let value = presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap();
    assert_eq!(value, PRESET_VALUE_RECOMMENDED);
}

#[test]
fn global_preset_rr_ignores_inherited_base_selection() {
    let driver = FakeDriver::new(1, vec![])
        .with_current_global_profile(99)
        .with_setting(1, SETTING_ID_DLSS_RR, 0x4)
        .with_base_inherited_setting(99, SETTING_ID_DLSS_RR, 0x4);
    let drs = orchestrator(driver);
    let value = presets::get_global_preset_with(&drs, PresetKind::RayReconstruction).unwrap();
    assert_eq!(value, 0);
}

#[test]
fn global_preset_set_default_clears_dlss_profile_mode_and_selection() {
    let driver = FakeDriver::new(1, vec![])
        .with_setting(1, SETTING_ID_DLSS_SR_PRESET_PROFILE, 2)
        .with_setting(1, SETTING_ID_DLSS_SR, 0xB);
    let drs = orchestrator(driver);
    presets::set_global_preset_with(&drs, PresetKind::Dlss, 0).unwrap();
    let value = presets::get_global_preset_with(&drs, PresetKind::Dlss).unwrap();
    assert_eq!(value, 0);
}

#[test]
fn global_preset_set_rr_writes_direct_selection_without_profile_mode() {
    let drs = orchestrator(FakeDriver::new(1, vec![]));
    presets::set_global_preset_with(&drs, PresetKind::RayReconstruction, 0x7).unwrap();
    let value = presets::get_global_preset_with(&drs, PresetKind::RayReconstruction).unwrap();
    assert_eq!(value, 0x7);
}

// ---------------------------------------------------------------------------
// Per-game preset get/set targets the matched profile.
// ---------------------------------------------------------------------------

#[test]
fn game_preset_get_targets_matched_profile() {
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let driver = FakeDriver::new(1, profiles)
        .with_setting(20, SETTING_ID_DLSS_SR_OVERRIDE, 1)
        .with_setting(20, SETTING_ID_DLSS_SR, 0x4);
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
fn game_preset_get_default_when_app_has_no_local_selection() {
    let profiles = vec![profile(20, "Baldur's Gate 3", &["bg3.exe"])];
    let driver = FakeDriver::new(1, profiles)
        .with_current_global_profile(99)
        .with_setting(20, SETTING_ID_DLSS_SR_OVERRIDE, 1)
        .with_setting(99, SETTING_ID_DLSS_SR, 0xB);
    let drs = orchestrator(driver);
    let exes = vec!["bg3.exe".to_string()];
    let preset =
        presets::get_game_preset_with(&drs, "Baldur's Gate 3", &exes, PresetKind::Dlss).unwrap();
    assert!(preset.available);
    assert_eq!(preset.value, 0);
}

#[test]
fn game_preset_get_default_when_app_has_inherited_selection() {
    let profiles = vec![profile(20, "Baldur's Gate 3", &["bg3.exe"])];
    let driver = FakeDriver::new(1, profiles)
        .with_current_global_profile(99)
        .with_inherited_setting(20, SETTING_ID_DLSS_SR, 0x4)
        .with_setting(20, SETTING_ID_DLSS_SR_OVERRIDE, 1)
        .with_setting(99, SETTING_ID_DLSS_SR, 0x4);
    let drs = orchestrator(driver);
    let exes = vec!["bg3.exe".to_string()];
    let preset =
        presets::get_game_preset_with(&drs, "Baldur's Gate 3", &exes, PresetKind::Dlss).unwrap();
    assert!(preset.available);
    assert_eq!(preset.value, 0);
}

#[test]
fn game_preset_get_default_when_app_override_off_despite_inherited_selection() {
    let profiles = vec![profile(20, "Baldur's Gate 3", &["bg3.exe"])];
    let driver = FakeDriver::new(1, profiles)
        .with_current_global_profile(99)
        .with_inherited_setting(20, SETTING_ID_DLSS_SR, 0x4)
        .with_setting(20, SETTING_ID_DLSS_SR_OVERRIDE, 0)
        .with_setting(99, SETTING_ID_DLSS_SR, 0xB);
    let drs = orchestrator(driver);
    let exes = vec!["bg3.exe".to_string()];
    let preset =
        presets::get_game_preset_with(&drs, "Baldur's Gate 3", &exes, PresetKind::Dlss).unwrap();
    assert!(preset.available);
    assert_eq!(preset.value, 0);
    assert_eq!(
        override_setting_id(PresetKind::Dlss),
        SETTING_ID_DLSS_SR_OVERRIDE
    );
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

#[test]
fn game_preset_set_default_turns_override_off_for_matched_profile() {
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let driver = FakeDriver::new(1, profiles)
        .with_setting(20, SETTING_ID_DLSS_SR_OVERRIDE, 1)
        .with_setting(20, SETTING_ID_DLSS_SR, 0x5);
    let drs = orchestrator(driver);
    let exes = vec!["mygame.exe".to_string()];

    let applied =
        presets::set_game_preset_with(&drs, "My Game", &exes, PresetKind::Dlss, 0).unwrap();

    assert!(applied);
    let preset = presets::get_game_preset_with(&drs, "My Game", &exes, PresetKind::Dlss).unwrap();
    assert!(preset.available);
    assert_eq!(preset.value, 0);
}

#[test]
fn drs_get_base_setting_reads_from_current_global_profile() {
    let driver = FakeDriver::new(1, vec![])
        .with_current_global_profile(9)
        .with_setting(9, SETTING_ID_DLSS_SR, 0xA)
        .with_setting(1, SETTING_ID_DLSS_SR, 0x3);
    let drs = orchestrator(driver);

    let value = drs.get_base_setting(SETTING_ID_DLSS_SR).unwrap();

    assert_eq!(value, Some(0xA));
}

#[test]
fn drs_profile_cache_reuses_enumeration_until_reload() {
    let enumerate_calls = Arc::new(AtomicUsize::new(0));
    let reload_calls = Arc::new(AtomicUsize::new(0));
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let driver = CountingDriver {
        profiles,
        enumerate_calls: enumerate_calls.clone(),
        reload_calls: reload_calls.clone(),
    };
    let drs = DrsOrchestrator::new(Box::new(driver));
    let exes = vec!["mygame.exe".to_string()];

    assert_eq!(
        drs.get_app_preset_selection(
            "My Game",
            &exes,
            SETTING_ID_DLSS_SR,
            SETTING_ID_DLSS_SR_OVERRIDE
        )
        .unwrap(),
        Some(0)
    );
    assert_eq!(
        drs.get_app_preset_selection(
            "My Game",
            &exes,
            SETTING_ID_DLSS_SR,
            SETTING_ID_DLSS_SR_OVERRIDE
        )
        .unwrap(),
        Some(0)
    );
    assert_eq!(enumerate_calls.load(Ordering::SeqCst), 1);

    drs.reload_from_driver().unwrap();
    assert_eq!(reload_calls.load(Ordering::SeqCst), 1);

    assert_eq!(
        drs.get_app_preset_selection(
            "My Game",
            &exes,
            SETTING_ID_DLSS_SR,
            SETTING_ID_DLSS_SR_OVERRIDE
        )
        .unwrap(),
        Some(0)
    );
    assert_eq!(enumerate_calls.load(Ordering::SeqCst), 2);
}

#[test]
fn shared_nvapi_session_helpers_are_unsupported_in_test_builds() {
    let err = game_manager_lib::dlss::nvapi::drs::with_nvapi_drs(|drs| {
        drs.get_base_setting(SETTING_ID_DLSS_SR)
    })
    .unwrap_err();
    assert!(matches!(err, DlssError::Unsupported));

    let err = game_manager_lib::dlss::nvapi::drs::with_nvapi_drs_reloaded(|drs| {
        drs.get_global_preset_selection(SETTING_ID_DLSS_SR, Some(SETTING_ID_DLSS_SR_PRESET_PROFILE))
    })
    .unwrap_err();
    assert!(matches!(err, DlssError::Unsupported));
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

#[test]
fn game_identity_uses_folder_override_and_detected_dll_parent_folders() {
    let state = state();
    let install = tempfile::TempDir::new().unwrap();
    let override_folder = tempfile::TempDir::new().unwrap();
    let detected_folder = tempfile::TempDir::new().unwrap();
    let nested = detected_folder.path().join("Bin");
    std::fs::create_dir_all(&nested).unwrap();

    let launcher = install.path().join("launcher.exe");
    let override_exe = override_folder.path().join("overridegame.exe");
    let nested_exe = nested.join("detectedgame.exe");
    let detected_dll = nested.join("nvngx_dlss.dll");
    let rr_dll = detected_folder.path().join("nvngx_dlssd.dll");

    std::fs::write(&launcher, b"x").unwrap();
    std::fs::write(&override_exe, b"x").unwrap();
    std::fs::write(&nested_exe, b"x").unwrap();
    std::fs::write(&detected_dll, b"x").unwrap();
    std::fs::write(&rr_dll, b"x").unwrap();

    let id = insert_game(&state, "Override Game", launcher.to_str().unwrap(), None);
    state
        .with_db(|conn| {
            dlss::set_folder_override(conn, id, Some(override_folder.path().to_str().unwrap()))
        })
        .unwrap();
    state.dlss_detection_set(
        id,
        DetectionResult {
            folder_resolved: Some(override_folder.path().to_string_lossy().to_string()),
            summary: DetectionSummary {
                super_resolution: Some(DetectedDll {
                    version: "3.7.0".to_string(),
                    path: detected_dll.to_string_lossy().to_string(),
                    md5: None,
                }),
                frame_generation: None,
                ray_reconstruction: Some(DetectedDll {
                    version: "1.0.0".to_string(),
                    path: rr_dll.to_string_lossy().to_string(),
                    md5: None,
                }),
            },
            last_scanned_at: Some("2026-06-20T09:00:00Z".to_string()),
            sr_preset: None,
        },
    );

    let (_, exes) = game_identity(&state, id).unwrap();
    assert!(exes.iter().any(|exe| exe == "overridegame.exe"));
    assert!(exes.iter().any(|exe| exe == "detectedgame.exe"));
    assert!(exes.iter().any(|exe| exe == "launcher.exe"));
}

#[test]
fn game_identity_ignores_missing_folder_override_and_missing_detected_parents() {
    let state = state();
    let install = tempfile::TempDir::new().unwrap();
    let launcher = install.path().join("launcher.exe");
    std::fs::write(&launcher, b"x").unwrap();

    let id = insert_game(
        &state,
        "Missing Paths",
        launcher.to_str().unwrap(),
        Some("missing.exe"),
    );
    state
        .with_db(|conn| dlss::set_folder_override(conn, id, Some("Z:/does/not/exist")))
        .unwrap();
    state.dlss_detection_set(
        id,
        DetectionResult {
            folder_resolved: None,
            summary: DetectionSummary {
                super_resolution: Some(DetectedDll {
                    version: "3.7.0".to_string(),
                    path: "Z:/missing/folder/nvngx_dlss.dll".to_string(),
                    md5: None,
                }),
                frame_generation: None,
                ray_reconstruction: None,
            },
            last_scanned_at: None,
            sr_preset: None,
        },
    );

    let (_, exes) = game_identity(&state, id).unwrap();
    assert!(exes.iter().any(|exe| exe == "launcher.exe"));
    assert!(exes.iter().any(|exe| exe == "missing.exe"));
}

// ---------------------------------------------------------------------------
// Per-game orchestration that resolves identity from the DB then delegates.
// ---------------------------------------------------------------------------

#[test]
fn get_game_preset_for_resolves_identity_and_matches_profile() {
    let state = state();
    let id = insert_game(&state, "My Game", "C:/Games/MyGame/mygame.exe", None);
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let driver = FakeDriver::new(1, profiles)
        .with_setting(20, SETTING_ID_DLSS_SR_OVERRIDE, 1)
        .with_setting(20, SETTING_ID_DLSS_SR, 0x6);
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
    let driver = FakeDriver::new(1, profiles)
        .with_setting(20, SETTING_ID_DLSS_SR_OVERRIDE, 1)
        .with_setting(20, SETTING_ID_DLSS_SR, 0x7);
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
// never mutate real NVIDIA preset state, even on a developer's GPU.
// ---------------------------------------------------------------------------

#[test]
fn global_get_impl_is_unsupported_in_test_builds() {
    let err = presets::get_global_preset_impl(&state(), PresetKind::Dlss).unwrap_err();
    assert!(matches!(err, DlssError::Unsupported));
}

#[test]
fn global_set_impl_is_unsupported_in_test_builds() {
    let err = presets::set_global_preset_impl(&state(), PresetKind::Dlss, 0x4).unwrap_err();
    assert!(matches!(err, DlssError::Unsupported));
}

#[test]
fn game_get_impl_is_unsupported_in_test_builds() {
    let state = state();
    let id = insert_game(&state, "G", "C:/g/g.exe", None);
    let err = presets::get_game_preset_impl(&state, id, PresetKind::RayReconstruction).unwrap_err();
    assert!(matches!(err, DlssError::Unsupported));
}

#[test]
fn game_set_impl_is_unsupported_in_test_builds() {
    let state = state();
    let id = insert_game(&state, "G", "C:/g/g.exe", None);
    let err = presets::set_game_preset_impl(&state, id, PresetKind::Dlss, 0x4).unwrap_err();
    assert!(matches!(err, DlssError::Unsupported));
}

#[test]
fn sr_preset_for_pill_maps_each_outcome() {
    // A matched profile yields its value (even Default = 0).
    assert_eq!(
        presets::sr_preset_for_pill(Ok(GamePresetState {
            available: true,
            value: 5,
        })),
        Some(5)
    );
    // No matched profile → no letter.
    assert_eq!(
        presets::sr_preset_for_pill(Ok(GamePresetState {
            available: false,
            value: 0,
        })),
        None
    );
    // Any NVAPI error (e.g. no driver) collapses to None.
    assert_eq!(
        presets::sr_preset_for_pill(Err(DlssError::Unsupported)),
        None
    );
}

#[test]
fn read_game_sr_preset_is_none_in_test_builds() {
    // NVAPI is unavailable under `test-utils`, so the real-session entry never
    // reaches a driver and safely yields None (the production scan path).
    let state = state();
    let id = insert_game(&state, "G", "C:/g/g.exe", None);
    assert_eq!(presets::read_game_sr_preset(&state, id), None);
}

#[test]
fn sr_preset_pill_value_reflects_matched_profile_over_mock_driver() {
    // The surrounding functionality of the pill read, exercised against a MOCKED
    // driver: a matched SR profile with a custom preset surfaces that value.
    let state = state();
    let id = insert_game(&state, "My Game", "C:/Games/MyGame/mygame.exe", None);
    let profiles = vec![profile(20, "My Game", &["mygame.exe"])];
    let driver = FakeDriver::new(1, profiles)
        .with_setting(20, SETTING_ID_DLSS_SR_OVERRIDE, 1)
        .with_setting(20, SETTING_ID_DLSS_SR, 0x5);
    let drs = orchestrator(driver);

    let value = presets::sr_preset_for_pill(presets::get_game_preset_for(
        &drs,
        &state,
        id,
        PresetKind::Dlss,
    ));
    assert_eq!(value, Some(0x5));
}

#[test]
fn sr_preset_pill_value_is_none_without_matched_profile() {
    // No driver profile matches the game → the pill shows no preset letter.
    let state = state();
    let id = insert_game(&state, "My Game", "C:/Games/MyGame/mygame.exe", None);
    let drs = orchestrator(FakeDriver::new(
        1,
        vec![profile(20, "Other", &["other.exe"])],
    ));

    let value = presets::sr_preset_for_pill(presets::get_game_preset_for(
        &drs,
        &state,
        id,
        PresetKind::Dlss,
    ));
    assert_eq!(value, None);
}
