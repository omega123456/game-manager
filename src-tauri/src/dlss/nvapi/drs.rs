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

use crate::dlss::nvapi::ffi::{self, NvapiDriver, NvapiDrs};
use crate::dlss::DlssResult;

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
/// 1. order all driver profiles by Levenshtein distance between the profile name
///    and `game_name` (closest first);
/// 2. for each candidate (closest first), confirm by checking whether any exe in
///    `exe_names` equals one of the profile's registered application names
///    (case-insensitive);
/// 3. the first confirmed profile wins; if none confirms, return `None`
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
}

impl DrsOrchestrator {
    /// Wrap a [`NvapiDriver`] (real or fake) in the orchestration.
    pub fn new(driver: Box<dyn NvapiDriver>) -> Self {
        Self { driver }
    }
}

impl NvapiDrs for DrsOrchestrator {
    fn get_base_setting(&self, setting_id: u32) -> DlssResult<Option<u32>> {
        let profile = self.driver.base_profile()?;
        self.driver.get_setting(profile, setting_id)
    }

    fn set_base_setting(&self, setting_id: u32, value: u32) -> DlssResult<()> {
        let profile = self.driver.base_profile()?;
        self.driver.set_setting(profile, setting_id, value)
    }

    fn get_app_setting(
        &self,
        game_name: &str,
        exe_names: &[String],
        setting_id: u32,
    ) -> DlssResult<Option<u32>> {
        let profiles = self.driver.enumerate_profiles()?;
        tracing::info!(
            category = "dlss",
            game_name = %game_name,
            setting_id,
            enumerated_profile_count = profiles.len(),
            "nvapi profile match: enumerated driver profiles"
        );
        match find_app_profile(&profiles, game_name, exe_names) {
            Some(profile) => {
                let value = self.driver.get_setting(profile, setting_id)?.unwrap_or(0);
                tracing::info!(
                    category = "dlss",
                    game_name = %game_name,
                    profile_handle = profile,
                    setting_id,
                    preset_value = value,
                    "nvapi profile match: read preset from matched profile"
                );
                Ok(Some(value))
            }
            None => Ok(None),
        }
    }

    fn set_app_setting(
        &self,
        game_name: &str,
        exe_names: &[String],
        setting_id: u32,
        value: u32,
    ) -> DlssResult<bool> {
        let profiles = self.driver.enumerate_profiles()?;
        match find_app_profile(&profiles, game_name, exe_names) {
            Some(profile) => {
                self.driver.set_setting(profile, setting_id, value)?;
                Ok(true)
            }
            None => Ok(false),
        }
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
