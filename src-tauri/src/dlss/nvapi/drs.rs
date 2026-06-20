//! NVAPI DRS session/profile orchestration (Phase 3).
//!
//! Pure logic over an [`NvapiDriver`]: profile matching (Levenshtein title
//! similarity + exe match, per the Reference Data Appendix), base-profile and
//! matched-app-profile setting reads/writes, and error classification. None of
//! this touches the live driver directly — it goes through the [`NvapiDriver`]
//! trait — so the whole module is exercised in CI against a fake driver.
//!
//! The real, `nvapi64.dll`-backed driver is constructed by [`real_nvapi_drs`],
//! which wraps [`super::ffi::real_driver`] in a [`DrsOrchestrator`].

use std::sync::{Mutex, OnceLock};

use crate::dlss::nvapi::ffi::{
    self, setting_location, NvapiDriver, NvapiDrs, PRESET_PROFILE_MODE_CUSTOM,
    PRESET_PROFILE_MODE_RECOMMENDED, PRESET_VALUE_RECOMMENDED,
};
use crate::dlss::{DlssError, DlssResult};

/// Compute the Levenshtein edit distance between two strings (case-insensitive),
/// using a single rolling row. Small standalone helper — no external crate.
pub fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.to_lowercase().chars().collect();
    let b: Vec<char> = b.to_lowercase().chars().collect();
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut curr = vec![0usize; b.len() + 1];
    for (i, &ca) in a.iter().enumerate() {
        curr[0] = i + 1;
        for (j, &cb) in b.iter().enumerate() {
            let cost = if ca == cb { 0 } else { 1 };
            curr[j + 1] = (prev[j + 1] + 1).min(curr[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[b.len()]
}

/// Normalise an exe file name to its lowercased base file name, so matching is
/// case-insensitive and path-agnostic (`C:\Games\Foo\game.EXE` → `game.exe`).
fn normalize_exe(name: &str) -> String {
    std::path::Path::new(name)
        .file_name()
        .map(|f| f.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| name.to_lowercase())
}

/// Find the per-game profile (port of DLSS Swapper `FindGameProfile`):
///
/// 1. exact case-insensitive profile name match on `game_name` (no exe check);
/// 2. otherwise order all driver profiles by Levenshtein distance between the profile name
///    and `game_name` (closest first);
/// 3. for each candidate (closest first), confirm by checking whether any exe in
///    `exe_names` equals one of the profile's registered application names
///    (case-insensitive);
/// 4. the first confirmed profile wins; if none confirms, return `None`
///    (per-game presets are *unavailable* for this game — not an error).
pub fn find_app_profile(
    profiles: &[ffi::ProfileInfo],
    game_name: &str,
    exe_names: &[String],
) -> Option<usize> {
    let wanted: Vec<String> = exe_names.iter().map(|e| normalize_exe(e)).collect();
    tracing::info!(
        category = "dlss",
        game_name = %game_name,
        candidate_exe_count = wanted.len(),
        candidate_exes = ?wanted,
        driver_profile_count = profiles.len(),
        "nvapi profile match: starting"
    );
    if let Some(profile) = profiles
        .iter()
        .find(|profile| profile.name.eq_ignore_ascii_case(game_name))
    {
        tracing::info!(
            category = "dlss",
            game_name = %game_name,
            profile_name = %profile.name,
            profile_handle = profile.handle,
            "nvapi profile match: found (exact title)"
        );
        return Some(profile.handle);
    }
    if wanted.is_empty() {
        tracing::info!(
            category = "dlss",
            game_name = %game_name,
            "nvapi profile match: no exe candidates — per-game presets unavailable"
        );
        return None;
    }
    let mut ordered: Vec<&ffi::ProfileInfo> = profiles.iter().collect();
    ordered.sort_by_key(|p| levenshtein(&p.name, game_name));
    for profile in &ordered {
        let matched_exe = profile
            .exe_names
            .iter()
            .find(|registered| wanted.iter().any(|w| w == *registered));
        if let Some(exe) = matched_exe {
            tracing::info!(
                category = "dlss",
                game_name = %game_name,
                profile_name = %profile.name,
                profile_handle = profile.handle,
                matched_exe = %exe,
                "nvapi profile match: found"
            );
            return Some(profile.handle);
        }
    }
    let top_candidates: Vec<String> = ordered
        .iter()
        .take(5)
        .map(|profile| {
            format!(
                "{} (levenshtein={}, exes=[{}])",
                profile.name,
                levenshtein(&profile.name, game_name),
                profile.exe_names.join(", ")
            )
        })
        .collect();
    tracing::info!(
        category = "dlss",
        game_name = %game_name,
        candidate_exes = ?wanted,
        top_candidates = %top_candidates.join(" | "),
        "nvapi profile match: no profile confirmed — per-game presets unavailable"
    );
    None
}

/// The pure orchestration: profile matching + setting reads/writes over a driver.
pub struct DrsOrchestrator {
    driver: Box<dyn NvapiDriver>,
    /// Cached result of the expensive `enumerate_profiles` driver call. Reused
    /// across SR + RR preset reads on the same shared session.
    profiles: Mutex<Option<Vec<ffi::ProfileInfo>>>,
}

impl DrsOrchestrator {
    /// Wrap a [`NvapiDriver`] (real or fake) in the orchestration.
    pub fn new(driver: Box<dyn NvapiDriver>) -> Self {
        Self {
            driver,
            profiles: Mutex::new(None),
        }
    }

    fn profiles(&self) -> DlssResult<Vec<ffi::ProfileInfo>> {
        let mut cache = self
            .profiles
            .lock()
            .map_err(|_| DlssError::Invalid("nvapi profile cache mutex poisoned".to_string()))?;
        if cache.is_none() {
            *cache = Some(self.driver.enumerate_profiles()?);
        }
        Ok(cache
            .as_ref()
            .expect("profile cache populated above")
            .clone())
    }
}

impl DrsOrchestrator {
    fn current_global_selection(&self, selection_id: u32) -> DlssResult<u32> {
        let global = self.driver.current_global_profile()?;
        Ok(self.driver.get_setting(global, selection_id)?.unwrap_or(0))
    }

    /// Effective per-game preset for the NVIDIA App per-title view: only a
    /// **local** selection on the matched app profile counts; inherited/global
    /// DWORDs are ignored and read as Default (`0`).
    fn effective_app_preset(
        override_enabled: u32,
        app_selection: Option<ffi::DrsDwordSetting>,
    ) -> (u32, &'static str) {
        if override_enabled == 0 {
            return (0, "app profile (override off → Default)");
        }
        if let Some(setting) = app_selection {
            if setting.location == setting_location::CURRENT_PROFILE {
                return (setting.value, "app profile (local selection)");
            }
        }
        (0, "app profile (no local selection → Default)")
    }

    /// Effective global preset for the NVIDIA App global-settings view.
    ///
    /// Per [NVIDIA Profile Inspector](https://github.com/Orbmu2k/nvidiaProfileInspector):
    /// SR uses `0x00634291` (Recommended / Custom) plus `0x10E41DF3` (preset
    /// letter). Only **local** values on the current global profile count;
    /// inherited base-profile DWORDs (e.g. stale Preset D) must not be shown.
    fn effective_global_preset(
        profile_mode: Option<ffi::DrsDwordSetting>,
        selection: Option<ffi::DrsDwordSetting>,
    ) -> (u32, &'static str) {
        if let Some(mode) = profile_mode {
            if mode.location == setting_location::CURRENT_PROFILE
                && mode.value == PRESET_PROFILE_MODE_RECOMMENDED
            {
                return (
                    PRESET_VALUE_RECOMMENDED,
                    "global profile (Recommended mode)",
                );
            }
        }
        if let Some(setting) = selection {
            if setting.location == setting_location::CURRENT_PROFILE {
                if setting.value == PRESET_VALUE_RECOMMENDED {
                    return (
                        PRESET_VALUE_RECOMMENDED,
                        "global profile (local recommended preset)",
                    );
                }
                return (setting.value, "global profile (local selection)");
            }
        }
        if let Some(mode) = profile_mode {
            if mode.location == setting_location::CURRENT_PROFILE
                && mode.value == PRESET_PROFILE_MODE_CUSTOM
            {
                return (
                    0,
                    "global profile (Custom mode, no local selection → Default)",
                );
            }
        }
        (0, "global profile (no local preset → Default)")
    }

    fn global_setting_detail(
        &self,
        profile: usize,
        setting_id: u32,
    ) -> DlssResult<Option<ffi::DrsDwordSetting>> {
        self.driver.get_setting_detail(profile, setting_id)
    }
}

impl NvapiDrs for DrsOrchestrator {
    fn get_base_setting(&self, setting_id: u32) -> DlssResult<Option<u32>> {
        let profile = self.driver.current_global_profile()?;
        self.driver.get_setting(profile, setting_id)
    }

    fn get_global_preset_selection(
        &self,
        selection_id: u32,
        profile_mode_id: Option<u32>,
    ) -> DlssResult<u32> {
        let global = self.driver.current_global_profile()?;
        let base = self.driver.base_profile()?;
        let profile_mode = match profile_mode_id {
            Some(mode_id) => self.global_setting_detail(global, mode_id)?,
            None => None,
        };
        let selection = self.global_setting_detail(global, selection_id)?;
        let base_profile_mode = match profile_mode_id {
            Some(mode_id) => self.global_setting_detail(base, mode_id)?,
            None => None,
        };
        let base_selection = self.global_setting_detail(base, selection_id)?;
        let (value, source) = Self::effective_global_preset(profile_mode, selection);
        tracing::info!(
            category = "dlss",
            global_profile_handle = global,
            base_profile_handle = base,
            same_profile = global == base,
            selection_id,
            profile_mode_id,
            profile_mode = ?profile_mode,
            selection = ?selection,
            base_profile_mode = ?base_profile_mode,
            base_selection = ?base_selection,
            preset_value = value,
            preset_source = source,
            "nvapi preset read: current global profile"
        );
        Ok(value)
    }

    fn set_base_setting(&self, setting_id: u32, value: u32) -> DlssResult<()> {
        let profile = self.driver.current_global_profile()?;
        self.driver.set_setting(profile, setting_id, value)
    }

    fn get_app_preset_selection(
        &self,
        game_name: &str,
        exe_names: &[String],
        selection_id: u32,
        override_id: u32,
    ) -> DlssResult<Option<u32>> {
        let profiles = self.profiles()?;
        tracing::info!(
            category = "dlss",
            game_name = %game_name,
            selection_id,
            override_id,
            enumerated_profile_count = profiles.len(),
            "nvapi profile match: enumerated driver profiles"
        );
        let Some(profile) = find_app_profile(&profiles, game_name, exe_names) else {
            return Ok(None);
        };
        let override_enabled = self.driver.get_setting(profile, override_id)?.unwrap_or(0);
        let app_selection = self.driver.get_setting_detail(profile, selection_id)?;
        let global_selection = self.current_global_selection(selection_id)?;
        let (value, source) = Self::effective_app_preset(override_enabled, app_selection);
        tracing::info!(
            category = "dlss",
            game_name = %game_name,
            profile_handle = profile,
            selection_id,
            override_id,
            override_enabled,
            app_selection = ?app_selection,
            global_selection,
            preset_value = value,
            preset_source = source,
            "nvapi profile match: read preset from matched profile"
        );
        Ok(Some(value))
    }

    fn set_app_setting(
        &self,
        game_name: &str,
        exe_names: &[String],
        setting_id: u32,
        value: u32,
    ) -> DlssResult<bool> {
        let profiles = self.profiles()?;
        match find_app_profile(&profiles, game_name, exe_names) {
            Some(profile) => {
                self.driver.set_setting(profile, setting_id, value)?;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    fn reload_from_driver(&self) -> DlssResult<()> {
        self.driver.reload_settings()?;
        let mut cache = self
            .profiles
            .lock()
            .map_err(|_| DlssError::Invalid("nvapi profile cache mutex poisoned".to_string()))?;
        *cache = None;
        tracing::info!(category = "dlss", "nvapi session: reloaded driver settings");
        Ok(())
    }
}

/// Construct the real NVAPI-backed [`NvapiDrs`] implementation.
///
/// Returns [`crate::dlss::DlssError::Unsupported`] when no NVIDIA driver is
/// present (e.g. CI); callers treat that as the preset surface being unavailable.
pub fn real_nvapi_drs() -> DlssResult<Box<dyn NvapiDrs>> {
    let driver = ffi::real_driver()?;
    Ok(Box::new(DrsOrchestrator::new(driver)))
}

/// The process-wide NVAPI DRS session, created on first use and reused forever.
///
/// `None` until a session is successfully opened; a failed open leaves it `None`
/// so the next call retries (rather than caching a "broken" state). A `Mutex`
/// makes this `Sync` and — crucially — *serializes* every NVAPI access.
type SharedSession = Mutex<Option<Box<dyn NvapiDrs>>>;

fn shared_session() -> &'static SharedSession {
    static SESSION: OnceLock<SharedSession> = OnceLock::new();
    SESSION.get_or_init(|| Mutex::new(None))
}

/// Run `f` against a process-wide shared NVAPI DRS session, opening it on first
/// use and reusing it thereafter (mirrors DLSS Swapper's singleton `NVAPIHelper`).
pub fn with_nvapi_drs<R>(f: impl FnOnce(&dyn NvapiDrs) -> DlssResult<R>) -> DlssResult<R> {
    with_nvapi_drs_inner(false, f)
}

/// Like [`with_nvapi_drs`], but reloads the DRS database from the driver before
/// `f` so reads reflect edits made outside this process (e.g. NVIDIA App).
pub fn with_nvapi_drs_reloaded<R>(f: impl FnOnce(&dyn NvapiDrs) -> DlssResult<R>) -> DlssResult<R> {
    with_nvapi_drs_inner(true, f)
}

fn with_nvapi_drs_inner<R>(
    reload: bool,
    f: impl FnOnce(&dyn NvapiDrs) -> DlssResult<R>,
) -> DlssResult<R> {
    let mut guard = shared_session()
        .lock()
        .map_err(|_| DlssError::Invalid("nvapi session mutex poisoned".to_string()))?;
    if guard.is_none() {
        tracing::info!(
            category = "dlss",
            "nvapi session: opening shared DRS session"
        );
        match real_nvapi_drs() {
            Ok(session) => {
                *guard = Some(session);
                tracing::info!(category = "dlss", "nvapi session: shared DRS session ready");
            }
            Err(err) => {
                tracing::warn!(
                    category = "dlss",
                    error = %err,
                    "nvapi session: failed to open shared DRS session"
                );
                return Err(err);
            }
        }
    }
    let drs = guard
        .as_ref()
        .expect("nvapi session initialized immediately above");
    if reload {
        drs.reload_from_driver()?;
    }
    f(drs.as_ref())
}
