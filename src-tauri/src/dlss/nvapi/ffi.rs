//! Low-level NVAPI FFI (Phase 3).
//!
//! Implements the dynamic load of `nvapi64.dll`, the `nvapi_QueryInterface`
//! function-pointer resolution (using the IDs from the plan's Reference Data
//! Appendix), the versioned `NVDRS_SETTING_V1`/profile/application structs (with
//! `version` computed via `MAKE_NVAPI_VERSION = size_of::<T>() | (ver << 16)`),
//! safe wrappers, and the [`super::drs::NvapiDrs`] trait so the orchestration in
//! [`super::drs`] / [`super::presets`] is testable with a fake.
//!
//! Two layers live here:
//!
//! * The **driver layer** ([`NvapiDriver`]) — the lowest-level abstraction over
//!   the resolved NVAPI function pointers. It deals only in opaque handles and
//!   raw DWORD settings. The real implementation ([`real_driver`]) is gated to
//!   `cfg(windows)` and exercises genuine `unsafe` FFI against a live driver, so
//!   it is the one true runtime boundary that cannot be unit-tested in CI.
//! * The **orchestration layer** ([`super::drs::NvapiDrs`]) — pure logic over a
//!   [`NvapiDriver`]: profile matching (Levenshtein + exe match), value reads,
//!   and writes. This is implemented in [`super::drs`] and is fully testable
//!   against a fake [`NvapiDriver`].

use crate::dlss::DlssResult;

/// Compute an NVAPI versioned-struct `version` field: `size_of::<T>() | (ver << 16)`.
pub fn make_nvapi_version<T>(interface_version: u32) -> u32 {
    (std::mem::size_of::<T>() as u32) | (interface_version << 16)
}

/// NVAPI DRS setting id for the DLSS SR render-preset selection
/// (`NGX_DLSS_SR_OVERRIDE_RENDER_PRESET_SELECTION`).
pub const SETTING_ID_DLSS_SR: u32 = 0x10E4_1DF3;
/// NVAPI DRS setting id for the DLSS RR render-preset selection
/// (`NGX_DLSS_RR_OVERRIDE_RENDER_PRESET_SELECTION`).
pub const SETTING_ID_DLSS_RR: u32 = 0x10E4_1DF7;
/// DLSS-SR override enable (`NGX_DLSS_SR_OVERRIDE`): a render-preset selection
/// only takes effect when this is on.
pub const SETTING_ID_DLSS_SR_OVERRIDE: u32 = 0x10E4_1E01;
/// DLSS-RR override enable (`NGX_DLSS_RR_OVERRIDE`).
pub const SETTING_ID_DLSS_RR_OVERRIDE: u32 = 0x10E4_1E02;

/// Sentinel preset value meaning "let NVIDIA pick the recommended preset".
pub const PRESET_RECOMMENDED: u32 = 0x00FF_FFFF;
/// The `Default` preset value (no forced preset).
pub const PRESET_DEFAULT: u32 = 0;

/// `nvapi_QueryInterface` ids for the DRS functions. Verified against
/// DLSSTweaks / NVIDIA Profile Inspector — the values here are the ones modern
/// drivers actually export (several earlier "appendix" ids were wrong; see the
/// DLSS preset root-cause handoff).
pub mod query_interface_id {
    /// `NvAPI_Initialize`.
    pub const INITIALIZE: u32 = 0x0150_E828;
    /// `NvAPI_DRS_CreateSession`.
    pub const DRS_CREATE_SESSION: u32 = 0x0694_D52E;
    /// `NvAPI_DRS_LoadSettings`.
    pub const DRS_LOAD_SETTINGS: u32 = 0x375D_BD6B;
    /// `NvAPI_DRS_GetBaseProfile` (lowest-priority defaults).
    pub const DRS_GET_BASE_PROFILE: u32 = 0xDA84_66A0;
    /// `NvAPI_DRS_GetCurrentGlobalProfile` — the profile NVIDIA App/Control Panel
    /// edits as "Global"; what global presets must read/write.
    pub const DRS_GET_CURRENT_GLOBAL_PROFILE: u32 = 0x617B_FF9F;
    /// `NvAPI_DRS_EnumProfiles`.
    pub const DRS_ENUM_PROFILES: u32 = 0xBC37_1EE0;
    /// `NvAPI_DRS_GetProfileInfo`.
    pub const DRS_GET_PROFILE_INFO: u32 = 0x61CD_6FD6;
    /// `NvAPI_DRS_EnumApplications`.
    pub const DRS_ENUM_APPLICATIONS: u32 = 0x7FA2_173A;
    /// `NvAPI_DRS_GetSetting` — the canonical id used by NVIDIA Profile Inspector
    /// / DLSSTweaks, paired with `NVDRS_SETTING_V1`. (The `0xEA99498D` variant some
    /// references list resolves to a function that rejects the V1 struct with
    /// `INVALID_ARGUMENT` on current drivers, so it is intentionally not used.)
    pub const DRS_GET_SETTING: u32 = 0x73BF_8338;
    /// `NvAPI_DRS_SetSetting` — canonical id paired with `NVDRS_SETTING_V1`.
    pub const DRS_SET_SETTING: u32 = 0x577D_D202;
    /// `NvAPI_DRS_SaveSettings`.
    pub const DRS_SAVE_SETTINGS: u32 = 0xFCBC_7E14;
    /// `NvAPI_DRS_DestroySession`.
    pub const DRS_DESTROY_SESSION: u32 = 0xDAD9_CFF8;
}

/// NVAPI `NvAPI_Status` values we care about.
pub mod status {
    /// Success.
    pub const OK: i32 = 0;
    /// The requested setting/feature is not supported.
    pub const NOT_SUPPORTED: i32 = -2;
    /// The caller lacks the elevation required to write/save settings.
    pub const INVALID_USER_PRIVILEGE: i32 = -130;
    /// Enumeration ran off the end of the list. On current drivers this is `-7`
    /// (`NVAPI_END_ENUMERATION`) — the normal end-of-list signal, not an error.
    pub const END_ENUMERATION: i32 = -7;
    /// The profile does not exist.
    pub const PROFILE_NOT_FOUND: i32 = -163;
    /// The requested setting is not present on the profile. Drivers report an
    /// absent setting as either `-165` or `-160` depending on header/driver
    /// version; [`is_setting_absent`] treats both as "unset".
    pub const SETTING_NOT_FOUND: i32 = -165;
    /// Alternate "setting not present" code seen on current drivers.
    pub const SETTING_NOT_FOUND_ALT: i32 = -160;

    /// Whether `code` means the setting is simply not present on the profile (so
    /// the read should yield `None`/Default rather than an error).
    pub fn is_setting_absent(code: i32) -> bool {
        code == SETTING_NOT_FOUND || code == SETTING_NOT_FOUND_ALT
    }
}

/// Where DRS reports a setting value as living, relative to the queried profile
/// (`NVDRS_SETTING_V1.settingLocation`). Only [`SettingLocation::Current`] values
/// are *locally* stored on the profile; everything else is inherited and must not
/// be displayed as a per-profile preset (it does not reflect the NVIDIA App view).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingLocation {
    /// Stored locally on the queried profile (`NVDRS_CURRENT_PROFILE_LOCATION`, 0).
    Current,
    /// Inherited from the current global profile (`NVDRS_GLOBAL_PROFILE_LOCATION`, 1).
    Global,
    /// Inherited from the base profile (`NVDRS_BASE_PROFILE_LOCATION`, 2).
    Base,
    /// Any other / unrecognised location reported by the driver.
    Other(u32),
}

impl SettingLocation {
    /// Decode the raw `settingLocation` DWORD.
    pub fn from_raw(raw: u32) -> Self {
        match raw {
            0 => SettingLocation::Current,
            1 => SettingLocation::Global,
            2 => SettingLocation::Base,
            other => SettingLocation::Other(other),
        }
    }

    /// `true` when the value is stored locally on the queried profile.
    pub fn is_local(self) -> bool {
        matches!(self, SettingLocation::Current)
    }
}

/// A DWORD setting read from a DRS profile, paired with the location the driver
/// reports it from (so inherited values can be distinguished from local ones).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SettingValue {
    /// The DWORD value.
    pub value: u32,
    /// Where the driver reports this value as stored.
    pub location: SettingLocation,
}

impl SettingValue {
    /// The value if it is stored locally on the queried profile, else `None`.
    pub fn local_value(self) -> Option<u32> {
        self.location.is_local().then_some(self.value)
    }
}

/// One enumerated driver profile: an opaque handle, its name, and the lowercase
/// application (exe) names registered on it.
///
/// `exe_names` are normalised to lowercase so the orchestration's case-insensitive
/// exe match is a plain equality test.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileInfo {
    /// Opaque profile handle as an integer token (the real driver exposes a
    /// `*mut c_void`; we carry it as a `usize` so the abstraction is `Send`/copyable).
    pub handle: usize,
    /// The profile's display name.
    pub name: String,
    /// Lowercased application (exe) file names registered on this profile.
    pub exe_names: Vec<String>,
}

/// The lowest-level NVAPI abstraction: a session over the resolved function
/// pointers, dealing only in opaque handles and raw DWORD settings.
///
/// The real implementation ([`real_driver`]) is the genuine runtime/driver
/// boundary; the orchestration in [`super::drs`] is written purely against this
/// trait so it can be unit-tested with a fake.
pub trait NvapiDriver: Send {
    /// The current global profile handle token — the profile NVIDIA App edits as
    /// "Global" (`GetCurrentGlobalProfile`, falling back to the base profile).
    fn global_profile(&self) -> DlssResult<usize>;
    /// Enumerate every per-application profile (handle + name + exe names).
    fn enumerate_profiles(&self) -> DlssResult<Vec<ProfileInfo>>;
    /// Reload DRS settings from the driver so subsequent reads observe edits made
    /// outside the app (NVIDIA App, Profile Inspector).
    fn reload(&self) -> DlssResult<()>;
    /// Read a DWORD setting from `profile`, including its [`SettingLocation`].
    /// `None` when the setting is absent on the profile and all its parents.
    fn get_setting(&self, profile: usize, setting_id: u32) -> DlssResult<Option<SettingValue>>;
    /// Write a DWORD setting *locally* to `profile`. Does not persist on its own —
    /// call [`NvapiDriver::save`] after a batch of writes.
    fn set_setting(&self, profile: usize, setting_id: u32, value: u32) -> DlssResult<()>;
    /// Persist pending writes to the driver (requires elevation).
    fn save(&self) -> DlssResult<()>;
}

// ---------------------------------------------------------------------------
// Real driver — the genuine runtime/NVAPI boundary (Windows only).
// ---------------------------------------------------------------------------

/// Construct the real, `nvapi64.dll`-backed [`NvapiDriver`].
///
/// This loads the DLL, resolves the DRS function pointers via
/// `nvapi_QueryInterface`, initialises NVAPI, and creates+loads a DRS session.
/// On a system without an NVIDIA driver it returns [`crate::dlss::DlssError::Unsupported`].
///
/// The unsafe FFI here only executes against a live driver and therefore is the
/// single legitimate runtime boundary excluded from CI coverage via the existing
/// `cfg(coverage)` entrypoint carve-out — every line of *logic* lives in the
/// `cfg(coverage)`-free orchestration layer ([`super::drs`]).
#[cfg(all(windows, not(coverage), not(feature = "test-utils")))]
pub fn real_driver() -> DlssResult<Box<dyn NvapiDriver>> {
    windows_impl::RealDriver::open().map(|driver| Box::new(driver) as Box<dyn NvapiDriver>)
}

/// Fallback when NVAPI cannot be used (non-Windows / coverage) or must never be
/// reached (`test-utils`). Tests always build with `test-utils`, so this
/// guarantees a test can never touch the live driver and mutate real preset
/// state; it returns [`crate::dlss::DlssError::Unsupported`] just like a host
/// with no NVIDIA driver.
#[cfg(not(all(windows, not(coverage), not(feature = "test-utils"))))]
pub fn real_driver() -> DlssResult<Box<dyn NvapiDriver>> {
    Err(crate::dlss::DlssError::Unsupported)
}

#[cfg(all(windows, not(coverage), not(feature = "test-utils")))]
mod windows_impl {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCSTR;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{FreeLibrary, HMODULE};
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    use super::{
        make_nvapi_version, query_interface_id as qid, status, NvapiDriver, ProfileInfo,
        SettingLocation, SettingValue,
    };
    use crate::dlss::{DlssError, DlssResult};

    /// The single exported entry point that resolves every other DRS function.
    type QueryInterfaceFn = unsafe extern "C" fn(u32) -> *mut c_void;
    type InitializeFn = unsafe extern "C" fn() -> i32;
    type CreateSessionFn = unsafe extern "C" fn(*mut *mut c_void) -> i32;
    type LoadSettingsFn = unsafe extern "C" fn(*mut c_void) -> i32;
    type GetGlobalProfileFn = unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> i32;
    type GetBaseProfileFn = unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> i32;
    type EnumProfilesFn = unsafe extern "C" fn(*mut c_void, u32, *mut *mut c_void) -> i32;
    type GetProfileInfoFn =
        unsafe extern "C" fn(*mut c_void, *mut c_void, *mut NvdrsProfileV1) -> i32;
    type EnumApplicationsFn = unsafe extern "C" fn(
        *mut c_void,
        *mut c_void,
        u32,
        *mut u32,
        *mut NvdrsApplicationV1,
    ) -> i32;
    type GetSettingFn =
        unsafe extern "C" fn(*mut c_void, *mut c_void, u32, *mut NvdrsSettingV1) -> i32;
    type SetSettingFn =
        unsafe extern "C" fn(*mut c_void, *mut c_void, *const NvdrsSettingV1) -> i32;
    type SaveSettingsFn = unsafe extern "C" fn(*mut c_void) -> i32;
    type DestroySessionFn = unsafe extern "C" fn(*mut c_void) -> i32;

    const NVAPI_UNICODE_STRING_MAX: usize = 2048;
    const NVAPI_BINARY_DATA_MAX: usize = 4096;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NvdrsBinarySettingValue {
        value_length: u32,
        value_data: [u8; NVAPI_BINARY_DATA_MAX],
    }

    #[repr(C)]
    union NvdrsSettingValue {
        u32_value: u32,
        binary: NvdrsBinarySettingValue,
        wsz_value: [u16; NVAPI_UNICODE_STRING_MAX],
    }

    /// `NVDRS_SETTING_V1` — see the Reference Data Appendix for the field shape.
    #[repr(C)]
    struct NvdrsSettingV1 {
        version: u32,
        setting_name: [u16; NVAPI_UNICODE_STRING_MAX],
        setting_id: u32,
        setting_type: u32,
        setting_location: u32,
        is_current_predefined: u32,
        is_predefined_valid: u32,
        predefined_value: NvdrsSettingValue,
        current_value: NvdrsSettingValue,
    }

    /// `NVDRS_PROFILE_V1` (subset we read).
    #[repr(C)]
    struct NvdrsProfileV1 {
        version: u32,
        profile_name: [u16; NVAPI_UNICODE_STRING_MAX],
        gpu_support: u32,
        is_predefined: u32,
        num_of_apps: u32,
        num_of_settings: u32,
    }

    /// `NVDRS_APPLICATION_V1` (subset we read).
    #[repr(C)]
    struct NvdrsApplicationV1 {
        version: u32,
        is_predefined: u32,
        app_name: [u16; NVAPI_UNICODE_STRING_MAX],
        user_friendly_name: [u16; NVAPI_UNICODE_STRING_MAX],
        launcher: [u16; NVAPI_UNICODE_STRING_MAX],
    }

    /// `NVDRS_SETTING_TYPE::NVDRS_DWORD_TYPE`.
    const NVDRS_DWORD_TYPE: u32 = 0;
    /// `NVDRS_SETTING_LOCATION::NVDRS_CURRENT_PROFILE_LOCATION`.
    const NVDRS_CURRENT_PROFILE_LOCATION: u32 = 0;

    fn utf16_to_string(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    /// Map a non-OK NVAPI status to a [`DlssError`].
    fn classify(code: i32, context: &str) -> DlssError {
        match code {
            status::INVALID_USER_PRIVILEGE => DlssError::Privilege,
            status::NOT_SUPPORTED => DlssError::Unsupported,
            other => {
                tracing::warn!(category = "dlss", "nvapi {context} failed: status {other}");
                DlssError::Invalid(format!("nvapi {context} failed (status {other})"))
            }
        }
    }

    /// The resolved, live NVAPI driver session.
    pub(super) struct RealDriver {
        module: HMODULE,
        session: *mut c_void,
        load_settings: LoadSettingsFn,
        enum_profiles: EnumProfilesFn,
        get_profile_info: GetProfileInfoFn,
        enum_applications: EnumApplicationsFn,
        get_global_profile: Option<GetGlobalProfileFn>,
        get_base_profile: GetBaseProfileFn,
        get_setting: GetSettingFn,
        set_setting: SetSettingFn,
        save_settings: SaveSettingsFn,
        destroy_session: DestroySessionFn,
    }

    // SAFETY: the function pointers + session handle are only used behind `&self`
    // and the driver session is single-threaded per the NVAPI contract; we never
    // share it concurrently (a fresh driver is opened per orchestration call).
    unsafe impl Send for RealDriver {}

    impl RealDriver {
        pub(super) fn open() -> DlssResult<Self> {
            let name: Vec<u16> = OsStr::new("nvapi64.dll")
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            // SAFETY: null-terminated wide string passed to LoadLibraryW.
            let module = unsafe { LoadLibraryW(PCWSTR(name.as_ptr())) }
                .map_err(|_| DlssError::Unsupported)?;
            if module.is_invalid() {
                return Err(DlssError::Unsupported);
            }

            // SAFETY: the single ANSI export resolving all other functions.
            let query =
                unsafe { GetProcAddress(module, PCSTR(b"nvapi_QueryInterface\0".as_ptr())) };
            let Some(query) = query else {
                // SAFETY: module was successfully loaded above.
                unsafe {
                    let _ = FreeLibrary(module);
                }
                return Err(DlssError::Unsupported);
            };
            // SAFETY: the resolved symbol has the QueryInterface signature.
            let query: QueryInterfaceFn = unsafe { std::mem::transmute(query) };

            // SAFETY: resolve each function by id; null means unsupported.
            let resolve = |id: u32| -> *mut c_void { unsafe { query(id) } };
            // Resolve a required function pointer, logging *which* one is missing
            // (pointer-resolution failures happen before Initialize and were
            // historically invisible).
            macro_rules! resolve_fn {
                ($name:expr, $ty:ty, $id:expr) => {{
                    let ptr = resolve($id);
                    if ptr.is_null() {
                        tracing::warn!(
                            category = "dlss",
                            function = $name,
                            "nvapi open: required function pointer did not resolve"
                        );
                        // SAFETY: module loaded above.
                        unsafe {
                            let _ = FreeLibrary(module);
                        }
                        return Err(DlssError::Unsupported);
                    }
                    // SAFETY: resolved pointer matches the declared signature.
                    unsafe { std::mem::transmute::<*mut c_void, $ty>(ptr) }
                }};
            }

            let initialize: InitializeFn =
                resolve_fn!("NvAPI_Initialize", InitializeFn, qid::INITIALIZE);
            let create_session: CreateSessionFn = resolve_fn!(
                "DRS_CreateSession",
                CreateSessionFn,
                qid::DRS_CREATE_SESSION
            );
            let load_settings: LoadSettingsFn =
                resolve_fn!("DRS_LoadSettings", LoadSettingsFn, qid::DRS_LOAD_SETTINGS);
            let get_base_profile: GetBaseProfileFn = resolve_fn!(
                "DRS_GetBaseProfile",
                GetBaseProfileFn,
                qid::DRS_GET_BASE_PROFILE
            );
            // Current-global profile is optional: fall back to the base profile if
            // the driver does not export it (logged at use site).
            let get_global_profile: Option<GetGlobalProfileFn> = {
                let ptr = resolve(qid::DRS_GET_CURRENT_GLOBAL_PROFILE);
                if ptr.is_null() {
                    None
                } else {
                    // SAFETY: resolved pointer matches the declared signature.
                    Some(unsafe { std::mem::transmute::<*mut c_void, GetGlobalProfileFn>(ptr) })
                }
            };
            let enum_profiles: EnumProfilesFn =
                resolve_fn!("DRS_EnumProfiles", EnumProfilesFn, qid::DRS_ENUM_PROFILES);
            let get_profile_info: GetProfileInfoFn = resolve_fn!(
                "DRS_GetProfileInfo",
                GetProfileInfoFn,
                qid::DRS_GET_PROFILE_INFO
            );
            let enum_applications: EnumApplicationsFn = resolve_fn!(
                "DRS_EnumApplications",
                EnumApplicationsFn,
                qid::DRS_ENUM_APPLICATIONS
            );
            let get_setting: GetSettingFn =
                resolve_fn!("DRS_GetSetting", GetSettingFn, qid::DRS_GET_SETTING);
            let set_setting: SetSettingFn =
                resolve_fn!("DRS_SetSetting", SetSettingFn, qid::DRS_SET_SETTING);
            let save_settings: SaveSettingsFn =
                resolve_fn!("DRS_SaveSettings", SaveSettingsFn, qid::DRS_SAVE_SETTINGS);
            let destroy_session: DestroySessionFn = resolve_fn!(
                "DRS_DestroySession",
                DestroySessionFn,
                qid::DRS_DESTROY_SESSION
            );

            // SAFETY: initialise NVAPI before any DRS call.
            let code = unsafe { initialize() };
            if code != status::OK {
                // SAFETY: module loaded above.
                unsafe {
                    let _ = FreeLibrary(module);
                }
                return Err(classify(code, "initialize"));
            }

            let mut session: *mut c_void = std::ptr::null_mut();
            // SAFETY: out-pointer is a valid local.
            let code = unsafe { create_session(&mut session) };
            if code != status::OK {
                unsafe {
                    let _ = FreeLibrary(module);
                }
                return Err(classify(code, "create_session"));
            }
            // SAFETY: session was created above.
            let code = unsafe { load_settings(session) };
            if code != status::OK {
                unsafe {
                    destroy_session(session);
                    let _ = FreeLibrary(module);
                }
                return Err(classify(code, "load_settings"));
            }

            tracing::info!(category = "dlss", "nvapi session: shared DRS session ready");
            Ok(Self {
                module,
                session,
                load_settings,
                enum_profiles,
                get_profile_info,
                enum_applications,
                get_global_profile,
                get_base_profile,
                get_setting,
                set_setting,
                save_settings,
                destroy_session,
            })
        }

        fn profile_info(&self, profile: *mut c_void) -> DlssResult<(String, u32)> {
            let mut info: NvdrsProfileV1 = unsafe { std::mem::zeroed() };
            info.version = make_nvapi_version::<NvdrsProfileV1>(1);
            // SAFETY: valid session + profile handle + out struct.
            let code = unsafe { (self.get_profile_info)(self.session, profile, &mut info) };
            if code != status::OK {
                return Err(classify(code, "get_profile_info"));
            }
            Ok((utf16_to_string(&info.profile_name), info.num_of_apps))
        }

        fn application_names(&self, profile: *mut c_void, count: u32) -> DlssResult<Vec<String>> {
            if count == 0 {
                return Ok(Vec::new());
            }
            let mut apps: Vec<NvdrsApplicationV1> =
                (0..count).map(|_| unsafe { std::mem::zeroed() }).collect();
            for app in &mut apps {
                app.version = make_nvapi_version::<NvdrsApplicationV1>(1);
            }
            let mut got = count;
            // SAFETY: apps buffer sized `count`, out-count valid.
            let code = unsafe {
                (self.enum_applications)(self.session, profile, 0, &mut got, apps.as_mut_ptr())
            };
            if code != status::OK && code != status::END_ENUMERATION {
                return Err(classify(code, "enum_applications"));
            }
            Ok(apps
                .iter()
                .take(got as usize)
                .map(|app| {
                    let name = utf16_to_string(&app.app_name);
                    std::path::Path::new(&name)
                        .file_name()
                        .map(|f| f.to_string_lossy().to_lowercase())
                        .unwrap_or_else(|| name.to_lowercase())
                })
                .collect())
        }
    }

    impl Drop for RealDriver {
        fn drop(&mut self) {
            // SAFETY: session + module are valid for the lifetime of `self`.
            unsafe {
                (self.destroy_session)(self.session);
                let _ = FreeLibrary(self.module);
            }
        }
    }

    impl NvapiDriver for RealDriver {
        fn global_profile(&self) -> DlssResult<usize> {
            // Prefer the current global profile (what NVIDIA App edits as "Global").
            if let Some(get_global) = self.get_global_profile {
                let mut profile: *mut c_void = std::ptr::null_mut();
                // SAFETY: valid session + out-pointer.
                let code = unsafe { get_global(self.session, &mut profile) };
                if code == status::OK && !profile.is_null() {
                    return Ok(profile as usize);
                }
                tracing::warn!(
                    category = "dlss",
                    status = code,
                    "nvapi: GetCurrentGlobalProfile failed; falling back to base profile"
                );
            }
            let mut profile: *mut c_void = std::ptr::null_mut();
            // SAFETY: valid session + out-pointer.
            let code = unsafe { (self.get_base_profile)(self.session, &mut profile) };
            if code != status::OK {
                return Err(classify(code, "get_base_profile"));
            }
            Ok(profile as usize)
        }

        fn reload(&self) -> DlssResult<()> {
            // SAFETY: valid session; re-reads settings edited outside the app.
            let code = unsafe { (self.load_settings)(self.session) };
            if code != status::OK {
                return Err(classify(code, "load_settings"));
            }
            tracing::debug!(category = "dlss", "nvapi session: reloaded driver settings");
            Ok(())
        }

        fn enumerate_profiles(&self) -> DlssResult<Vec<ProfileInfo>> {
            let mut out = Vec::new();
            let mut index = 0u32;
            loop {
                let mut handle: *mut c_void = std::ptr::null_mut();
                // SAFETY: valid session + out-pointer; iterates until END_ENUMERATION.
                let code = unsafe { (self.enum_profiles)(self.session, index, &mut handle) };
                if code == status::END_ENUMERATION {
                    break;
                }
                if code != status::OK {
                    return Err(classify(code, "enum_profiles"));
                }
                let (name, num_apps) = self.profile_info(handle)?;
                let exe_names = self.application_names(handle, num_apps)?;
                out.push(ProfileInfo {
                    handle: handle as usize,
                    name,
                    exe_names,
                });
                index += 1;
            }
            Ok(out)
        }

        fn get_setting(&self, profile: usize, setting_id: u32) -> DlssResult<Option<SettingValue>> {
            let mut setting: NvdrsSettingV1 = unsafe { std::mem::zeroed() };
            setting.version = make_nvapi_version::<NvdrsSettingV1>(1);
            // SAFETY: valid session + profile handle + out struct.
            let code = unsafe {
                (self.get_setting)(
                    self.session,
                    profile as *mut c_void,
                    setting_id,
                    &mut setting,
                )
            };
            if status::is_setting_absent(code) {
                return Ok(None);
            }
            if code != status::OK {
                return Err(classify(code, "get_setting"));
            }
            Ok(Some(SettingValue {
                // SAFETY: preset settings are DWORD type; read the u32 arm.
                value: unsafe { setting.current_value.u32_value },
                location: SettingLocation::from_raw(setting.setting_location),
            }))
        }

        fn set_setting(&self, profile: usize, setting_id: u32, value: u32) -> DlssResult<()> {
            let mut setting: NvdrsSettingV1 = unsafe { std::mem::zeroed() };
            setting.version = make_nvapi_version::<NvdrsSettingV1>(1);
            setting.setting_id = setting_id;
            setting.setting_type = NVDRS_DWORD_TYPE;
            setting.setting_location = NVDRS_CURRENT_PROFILE_LOCATION;
            setting.current_value.u32_value = value;
            // SAFETY: valid session + profile handle + populated setting struct.
            let code =
                unsafe { (self.set_setting)(self.session, profile as *mut c_void, &setting) };
            if code != status::OK {
                return Err(classify(code, "set_setting"));
            }
            Ok(())
        }

        fn save(&self) -> DlssResult<()> {
            // SAFETY: valid session; save persists to the driver (needs elevation).
            let code = unsafe { (self.save_settings)(self.session) };
            if code != status::OK {
                return Err(classify(code, "save_settings"));
            }
            Ok(())
        }
    }
}
