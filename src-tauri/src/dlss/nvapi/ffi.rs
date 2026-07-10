//! Low-level NVAPI FFI (Phase 3).
//!
//! Implements the dynamic load of `nvapi64.dll`, the `nvapi_QueryInterface`
//! function-pointer resolution (using the IDs from the plan's Reference Data
//! Appendix), the versioned `NVDRS_SETTING_V1`/profile/application structs (with
//! `version` computed via `MAKE_NVAPI_VERSION = size_of::<T>() | (ver << 16)`),
//! safe wrappers, and the [`NvapiDrs`] trait so the orchestration in
//! [`super::drs`] / [`super::presets`] is testable with a fake.
//!
//! Two layers live here:
//!
//! * The **driver layer** ([`NvapiDriver`]) — the lowest-level abstraction over
//!   the resolved NVAPI function pointers. It deals only in opaque handles and
//!   raw DWORD settings. The real implementation ([`real_driver`]) is gated to
//!   Windows production/development builds and exercises genuine `unsafe` FFI
//!   against a live driver, so it is the one true runtime boundary that cannot
//!   be unit-tested in CI.
//! * The **orchestration layer** ([`NvapiDrs`]) — pure logic over a
//!   [`NvapiDriver`]: profile matching (Levenshtein + exe match), value reads,
//!   and writes. This is implemented in [`super::drs`] and is fully testable
//!   against a fake [`NvapiDriver`].

use crate::dlss::DlssResult;

/// Compute an NVAPI versioned-struct `version` field: `size_of::<T>() | (ver << 16)`.
pub fn make_nvapi_version<T>(interface_version: u32) -> u32 {
    (std::mem::size_of::<T>() as u32) | (interface_version << 16)
}

/// NVAPI DRS setting id for the DLSS SR render-preset selection.
pub const SETTING_ID_DLSS_SR: u32 = 0x10E4_1DF3;
/// NVAPI DRS setting id for the DLSS RR render-preset selection.
pub const SETTING_ID_DLSS_RR: u32 = 0x10E4_1DF7;
/// NVAPI DRS setting id for enabling DLSS-SR override on a profile.
pub const SETTING_ID_DLSS_SR_OVERRIDE: u32 = 0x10E4_1E01;
/// NVAPI DRS setting id for enabling DLSS-RR override on a profile.
pub const SETTING_ID_DLSS_RR_OVERRIDE: u32 = 0x10E4_1E02;
/// NVAPI DRS setting id for DLSS-SR preset profile mode (Recommended / Custom).
pub const SETTING_ID_DLSS_SR_PRESET_PROFILE: u32 = 0x0063_4291;
/// `0x10E41DF3` value: use NVIDIA's recommended preset bundle.
pub const PRESET_VALUE_RECOMMENDED: u32 = 0x00FF_FFFF;
/// `0x00634291` value: NVIDIA App "Recommended" model preset mode.
pub const PRESET_PROFILE_MODE_RECOMMENDED: u32 = 1;
/// `0x00634291` value: NVIDIA App "Custom" model preset mode.
pub const PRESET_PROFILE_MODE_CUSTOM: u32 = 2;

/// A DWORD driver setting value plus its DRS [`setting_location`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DrsDwordSetting {
    /// The setting's DWORD value.
    pub value: u32,
    /// Where the value comes from (`NVDRS_*_PROFILE_LOCATION`).
    pub location: u32,
}

/// `NVDRS_SETTING_LOCATION` values returned by `DRS_GetSetting`.
pub mod setting_location {
    /// Value is stored on the queried profile.
    pub const CURRENT_PROFILE: u32 = 0;
    /// Value is inherited from the current global profile.
    pub const GLOBAL_PROFILE: u32 = 1;
    /// Value is inherited from the base profile.
    pub const BASE_PROFILE: u32 = 2;
}

/// `nvapi_QueryInterface` ids for the DRS functions (Reference Data Appendix).
pub mod query_interface_id {
    /// `NvAPI_Initialize`.
    pub const INITIALIZE: u32 = 0x0150_E828;
    /// `NvAPI_DRS_CreateSession`.
    pub const DRS_CREATE_SESSION: u32 = 0x0694_D52E;
    /// `NvAPI_DRS_LoadSettings`.
    pub const DRS_LOAD_SETTINGS: u32 = 0x375D_BD6B;
    /// `NvAPI_DRS_GetBaseProfile`.
    pub const DRS_GET_BASE_PROFILE: u32 = 0xDA84_66A0;
    /// `NvAPI_DRS_GetCurrentGlobalProfile`.
    pub const DRS_GET_CURRENT_GLOBAL_PROFILE: u32 = 0x617B_FF9F;
    /// `NvAPI_DRS_EnumProfiles`.
    pub const DRS_ENUM_PROFILES: u32 = 0xBC37_1EE0;
    /// `NvAPI_DRS_GetProfileInfo`.
    pub const DRS_GET_PROFILE_INFO: u32 = 0x61CD_6FD6;
    /// `NvAPI_DRS_EnumApplications`.
    pub const DRS_ENUM_APPLICATIONS: u32 = 0x7FA2_173A;
    /// Primary `NvAPI_DRS_GetSetting` query id (newer drivers).
    pub const DRS_GET_SETTING: u32 = 0xEA99_498D;
    /// Legacy `NvAPI_DRS_GetSetting` query id fallback.
    pub const DRS_GET_SETTING_LEGACY: u32 = 0x73BF_8338;
    /// Primary `NvAPI_DRS_SetSetting` query id (newer drivers).
    pub const DRS_SET_SETTING: u32 = 0x8A2C_F5F5;
    /// Legacy `NvAPI_DRS_SetSetting` query id fallback.
    pub const DRS_SET_SETTING_LEGACY: u32 = 0x577D_D202;
    /// `NvAPI_DRS_SaveSettings`.
    pub const DRS_SAVE_SETTINGS: u32 = 0xFCBC_7E14;
    /// `NvAPI_DRS_DestroySession`.
    pub const DRS_DESTROY_SESSION: u32 = 0xDAD9_CFF8;
}

/// NVAPI `NvAPI_Status` values we care about (Reference Data Appendix).
pub mod status {
    /// Success.
    pub const OK: i32 = 0;
    /// The requested setting/feature is not supported.
    pub const NOT_SUPPORTED: i32 = -2;
    /// The caller lacks the elevation required to write/save settings.
    pub const INVALID_USER_PRIVILEGE: i32 = -130;
    /// Enumeration ran off the end of the list (`NVAPI_END_ENUMERATION`).
    pub const END_ENUMERATION: i32 = -7;
    /// The profile does not exist.
    pub const PROFILE_NOT_FOUND: i32 = -163;
    /// The requested setting is not present on the profile.
    pub const SETTING_NOT_FOUND: i32 = -160;
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
    /// The base profile handle token (lowest-priority global defaults).
    fn base_profile(&self) -> DlssResult<usize>;
    /// The current global profile handle (what NVIDIA Control Panel / App edits).
    fn current_global_profile(&self) -> DlssResult<usize>;
    /// Enumerate every per-application profile (handle + name + exe names).
    fn enumerate_profiles(&self) -> DlssResult<Vec<ProfileInfo>>;
    /// Read a DWORD setting from `profile`. `None` when the setting is absent.
    fn get_setting(&self, profile: usize, setting_id: u32) -> DlssResult<Option<u32>> {
        Ok(self
            .get_setting_detail(profile, setting_id)?
            .map(|setting| setting.value))
    }
    /// Read a DWORD setting and its DRS location from `profile`.
    fn get_setting_detail(
        &self,
        profile: usize,
        setting_id: u32,
    ) -> DlssResult<Option<DrsDwordSetting>>;
    /// Write a DWORD setting to `profile` and persist it (requires elevation).
    fn set_setting(&self, profile: usize, setting_id: u32, value: u32) -> DlssResult<()>;
    /// Reload the in-memory DRS session from the driver store (picks up external edits).
    fn reload_settings(&self) -> DlssResult<()> {
        Ok(())
    }
}

/// An abstraction over the high-level NVAPI preset reads/writes so the preset
/// surface in [`super::presets`] is testable with a fake.
///
/// Implemented by [`super::drs::DrsOrchestrator`] over any [`NvapiDriver`].
pub trait NvapiDrs: Send {
    /// Read a DWORD setting from the current global profile. `None` when unset.
    fn get_base_setting(&self, setting_id: u32) -> DlssResult<Option<u32>>;
    /// Read the effective global preset for NVIDIA App parity.
    ///
    /// `profile_mode_id` is the SR-only `SETTING_ID_DLSS_SR_PRESET_PROFILE`
    /// (`0x00634291`); pass `None` for RR.
    fn get_global_preset_selection(
        &self,
        selection_id: u32,
        profile_mode_id: Option<u32>,
    ) -> DlssResult<u32>;
    /// Write a DWORD setting to the current global profile and save.
    fn set_base_setting(&self, setting_id: u32, value: u32) -> DlssResult<()>;
    /// Read the effective preset selection for a matched app profile.
    /// `override_id` is the profile's DLSS override-enable setting; when it is off
    /// the effective preset is Default regardless of stale selection DWORDs.
    fn get_app_preset_selection(
        &self,
        game_name: &str,
        exe_names: &[String],
        selection_id: u32,
        override_id: u32,
    ) -> DlssResult<Option<u32>>;
    /// Write a DWORD setting to the matched app profile and save. Returns `false`
    /// when no profile matches.
    fn set_app_setting(
        &self,
        game_name: &str,
        exe_names: &[String],
        setting_id: u32,
        value: u32,
    ) -> DlssResult<bool>;
    /// Reload driver settings into the shared session and drop cached profile lists.
    fn reload_from_driver(&self) -> DlssResult<()>;
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
/// single legitimate runtime boundary excluded from CI coverage and `test-utils`
/// builds — every line of *logic* lives in the fake-driver-tested orchestration
/// layer ([`super::drs`]).
#[cfg(all(windows, not(coverage), not(feature = "test-utils")))]
pub fn real_driver() -> DlssResult<Box<dyn NvapiDriver>> {
    windows_impl::RealDriver::open().map(|driver| Box::new(driver) as Box<dyn NvapiDriver>)
}

/// Fallback when NVAPI cannot be used at compile time (non-Windows / coverage / tests).
#[cfg(any(not(windows), coverage, feature = "test-utils"))]
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
        make_nvapi_version, query_interface_id as qid, setting_location, status, DrsDwordSetting,
        NvapiDriver, ProfileInfo,
    };
    use crate::dlss::{DlssError, DlssResult};

    /// The single exported entry point that resolves every other DRS function.
    type QueryInterfaceFn = unsafe extern "C" fn(u32) -> *mut c_void;
    type InitializeFn = unsafe extern "C" fn() -> i32;
    type CreateSessionFn = unsafe extern "C" fn(*mut *mut c_void) -> i32;
    type LoadSettingsFn = unsafe extern "C" fn(*mut c_void) -> i32;
    type GetBaseProfileFn = unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> i32;
    type GetCurrentGlobalProfileFn = unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> i32;
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
    type GetSettingFnV2 =
        unsafe extern "C" fn(*mut c_void, *mut c_void, u32, *mut NvdrsSettingV1, *mut u32) -> i32;
    type SetSettingFn =
        unsafe extern "C" fn(*mut c_void, *mut c_void, *const NvdrsSettingV1) -> i32;
    type SetSettingFnV2 =
        unsafe extern "C" fn(*mut c_void, *mut c_void, *mut NvdrsSettingV1, u32, u32) -> i32;
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
    const NVDRS_CURRENT_PROFILE_LOCATION: u32 = setting_location::CURRENT_PROFILE;

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

    fn free_module(module: HMODULE) {
        // SAFETY: module was successfully loaded above.
        unsafe {
            let _ = FreeLibrary(module);
        }
    }

    /// Resolve a required NVAPI export via `nvapi_QueryInterface`.
    fn resolve_required(
        query: QueryInterfaceFn,
        id: u32,
        name: &str,
        module: HMODULE,
    ) -> DlssResult<*mut c_void> {
        // SAFETY: caller transmutes to the correct function signature when non-null.
        let ptr = unsafe { query(id) };
        if ptr.is_null() {
            tracing::warn!(
                category = "dlss",
                query_id = format!("0x{id:08X}"),
                function = name,
                "nvapi open: required function pointer not found"
            );
            free_module(module);
            return Err(DlssError::Unsupported);
        }
        Ok(ptr)
    }

    enum ResolvedGetSetting {
        V1(GetSettingFn),
        V2(GetSettingFnV2),
    }

    enum ResolvedSetSetting {
        V1(SetSettingFn),
        V2(SetSettingFnV2),
    }

    fn resolve_get_setting(
        query: QueryInterfaceFn,
        module: HMODULE,
    ) -> DlssResult<ResolvedGetSetting> {
        // SAFETY: resolved pointer matches the declared signature when non-null.
        let primary = unsafe { query(qid::DRS_GET_SETTING) };
        if !primary.is_null() {
            return Ok(ResolvedGetSetting::V2(unsafe {
                std::mem::transmute(primary)
            }));
        }
        // SAFETY: resolved pointer matches the declared signature when non-null.
        let legacy = unsafe { query(qid::DRS_GET_SETTING_LEGACY) };
        if legacy.is_null() {
            tracing::warn!(
                category = "dlss",
                "nvapi open: DRS_GetSetting not found (primary or legacy query id)"
            );
            free_module(module);
            return Err(DlssError::Unsupported);
        }
        tracing::info!(
            category = "dlss",
            "nvapi open: DRS_GetSetting resolved via legacy query id"
        );
        // SAFETY: resolved pointer matches the declared signature.
        Ok(ResolvedGetSetting::V1(unsafe {
            std::mem::transmute(legacy)
        }))
    }

    fn resolve_set_setting(
        query: QueryInterfaceFn,
        module: HMODULE,
    ) -> DlssResult<ResolvedSetSetting> {
        // SAFETY: resolved pointer matches the declared signature when non-null.
        let primary = unsafe { query(qid::DRS_SET_SETTING) };
        if !primary.is_null() {
            return Ok(ResolvedSetSetting::V2(unsafe {
                std::mem::transmute(primary)
            }));
        }
        // SAFETY: resolved pointer matches the declared signature when non-null.
        let legacy = unsafe { query(qid::DRS_SET_SETTING_LEGACY) };
        if legacy.is_null() {
            tracing::warn!(
                category = "dlss",
                "nvapi open: DRS_SetSetting not found (primary or legacy query id)"
            );
            free_module(module);
            return Err(DlssError::Unsupported);
        }
        tracing::info!(
            category = "dlss",
            "nvapi open: DRS_SetSetting resolved via legacy query id"
        );
        // SAFETY: resolved pointer matches the declared signature.
        Ok(ResolvedSetSetting::V1(unsafe {
            std::mem::transmute(legacy)
        }))
    }

    /// The resolved, live NVAPI driver session.
    pub(super) struct RealDriver {
        module: HMODULE,
        session: *mut c_void,
        enum_profiles: EnumProfilesFn,
        get_profile_info: GetProfileInfoFn,
        enum_applications: EnumApplicationsFn,
        get_base_profile: GetBaseProfileFn,
        get_current_global_profile: GetCurrentGlobalProfileFn,
        get_setting: ResolvedGetSetting,
        set_setting: ResolvedSetSetting,
        load_settings: LoadSettingsFn,
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

            tracing::info!(category = "dlss", "nvapi open: resolving function pointers");
            // SAFETY: each resolved pointer matches the declared signature.
            let initialize: InitializeFn = unsafe {
                std::mem::transmute(resolve_required(
                    query,
                    qid::INITIALIZE,
                    "NvAPI_Initialize",
                    module,
                )?)
            };
            let create_session: CreateSessionFn = unsafe {
                std::mem::transmute(resolve_required(
                    query,
                    qid::DRS_CREATE_SESSION,
                    "NvAPI_DRS_CreateSession",
                    module,
                )?)
            };
            let load_settings: LoadSettingsFn = unsafe {
                std::mem::transmute(resolve_required(
                    query,
                    qid::DRS_LOAD_SETTINGS,
                    "NvAPI_DRS_LoadSettings",
                    module,
                )?)
            };
            let get_base_profile: GetBaseProfileFn = unsafe {
                std::mem::transmute(resolve_required(
                    query,
                    qid::DRS_GET_BASE_PROFILE,
                    "NvAPI_DRS_GetBaseProfile",
                    module,
                )?)
            };
            let get_current_global_profile: GetCurrentGlobalProfileFn = unsafe {
                std::mem::transmute(resolve_required(
                    query,
                    qid::DRS_GET_CURRENT_GLOBAL_PROFILE,
                    "NvAPI_DRS_GetCurrentGlobalProfile",
                    module,
                )?)
            };
            let enum_profiles: EnumProfilesFn = unsafe {
                std::mem::transmute(resolve_required(
                    query,
                    qid::DRS_ENUM_PROFILES,
                    "NvAPI_DRS_EnumProfiles",
                    module,
                )?)
            };
            let get_profile_info: GetProfileInfoFn = unsafe {
                std::mem::transmute(resolve_required(
                    query,
                    qid::DRS_GET_PROFILE_INFO,
                    "NvAPI_DRS_GetProfileInfo",
                    module,
                )?)
            };
            let enum_applications: EnumApplicationsFn = unsafe {
                std::mem::transmute(resolve_required(
                    query,
                    qid::DRS_ENUM_APPLICATIONS,
                    "NvAPI_DRS_EnumApplications",
                    module,
                )?)
            };
            let get_setting = resolve_get_setting(query, module)?;
            let set_setting = resolve_set_setting(query, module)?;
            let save_settings: SaveSettingsFn = unsafe {
                std::mem::transmute(resolve_required(
                    query,
                    qid::DRS_SAVE_SETTINGS,
                    "NvAPI_DRS_SaveSettings",
                    module,
                )?)
            };
            let destroy_session: DestroySessionFn = unsafe {
                std::mem::transmute(resolve_required(
                    query,
                    qid::DRS_DESTROY_SESSION,
                    "NvAPI_DRS_DestroySession",
                    module,
                )?)
            };
            tracing::info!(category = "dlss", "nvapi open: function pointers resolved");

            // Step logging: these three NVAPI calls are the runtime boundary that
            // cannot be unit-tested in CI, and `DRS_LoadSettings` (reads the whole
            // driver settings DB) is the most likely place to block on real
            // hardware. Logging each step pinpoints exactly which call stalls/fails.
            tracing::info!(category = "dlss", "nvapi open: NvAPI_Initialize");
            // SAFETY: initialise NVAPI before any DRS call.
            let code = unsafe { initialize() };
            if code != status::OK {
                // SAFETY: module loaded above.
                unsafe {
                    let _ = FreeLibrary(module);
                }
                return Err(classify(code, "initialize"));
            }

            tracing::info!(category = "dlss", "nvapi open: DRS_CreateSession");
            let mut session: *mut c_void = std::ptr::null_mut();
            // SAFETY: out-pointer is a valid local.
            let code = unsafe { create_session(&mut session) };
            if code != status::OK {
                unsafe {
                    let _ = FreeLibrary(module);
                }
                return Err(classify(code, "create_session"));
            }
            tracing::info!(category = "dlss", "nvapi open: DRS_LoadSettings");
            // SAFETY: session was created above.
            let code = unsafe { load_settings(session) };
            if code != status::OK {
                unsafe {
                    destroy_session(session);
                    let _ = FreeLibrary(module);
                }
                return Err(classify(code, "load_settings"));
            }
            tracing::info!(category = "dlss", "nvapi open: session ready");

            Ok(Self {
                module,
                session,
                enum_profiles,
                get_profile_info,
                enum_applications,
                get_base_profile,
                get_current_global_profile,
                get_setting,
                set_setting,
                load_settings,
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
        fn base_profile(&self) -> DlssResult<usize> {
            let mut profile: *mut c_void = std::ptr::null_mut();
            // SAFETY: valid session + out-pointer.
            let code = unsafe { (self.get_base_profile)(self.session, &mut profile) };
            if code != status::OK {
                return Err(classify(code, "get_base_profile"));
            }
            Ok(profile as usize)
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

        fn current_global_profile(&self) -> DlssResult<usize> {
            let mut profile: *mut c_void = std::ptr::null_mut();
            // SAFETY: valid session + out-pointer.
            let code = unsafe { (self.get_current_global_profile)(self.session, &mut profile) };
            if code != status::OK {
                tracing::warn!(
                    category = "dlss",
                    status = code,
                    "nvapi get_current_global_profile failed; falling back to base profile"
                );
                return self.base_profile();
            }
            Ok(profile as usize)
        }

        fn get_setting_detail(
            &self,
            profile: usize,
            setting_id: u32,
        ) -> DlssResult<Option<DrsDwordSetting>> {
            let mut setting: NvdrsSettingV1 = unsafe { std::mem::zeroed() };
            setting.version = make_nvapi_version::<NvdrsSettingV1>(1);
            let profile_ptr = profile as *mut c_void;
            // SAFETY: valid session + profile handle + out struct.
            let code = match self.get_setting {
                ResolvedGetSetting::V1(get_setting) => unsafe {
                    get_setting(self.session, profile_ptr, setting_id, &mut setting)
                },
                ResolvedGetSetting::V2(get_setting) => {
                    let mut flags = 0u32;
                    unsafe {
                        get_setting(
                            self.session,
                            profile_ptr,
                            setting_id,
                            &mut setting,
                            &mut flags,
                        )
                    }
                }
            };
            if code == status::SETTING_NOT_FOUND {
                return Ok(None);
            }
            if code != status::OK {
                return Err(classify(code, "get_setting"));
            }
            // SAFETY: preset settings are DWORD type; read the u32 arm.
            Ok(Some(DrsDwordSetting {
                value: unsafe { setting.current_value.u32_value },
                location: setting.setting_location,
            }))
        }

        fn set_setting(&self, profile: usize, setting_id: u32, value: u32) -> DlssResult<()> {
            let mut setting: NvdrsSettingV1 = unsafe { std::mem::zeroed() };
            setting.version = make_nvapi_version::<NvdrsSettingV1>(1);
            setting.setting_id = setting_id;
            setting.setting_type = NVDRS_DWORD_TYPE;
            setting.setting_location = NVDRS_CURRENT_PROFILE_LOCATION;
            setting.current_value.u32_value = value;
            let profile_ptr = profile as *mut c_void;
            // SAFETY: valid session + profile handle + populated setting struct.
            let code = match self.set_setting {
                ResolvedSetSetting::V1(set_setting) => unsafe {
                    set_setting(self.session, profile_ptr, &setting)
                },
                ResolvedSetSetting::V2(set_setting) => unsafe {
                    set_setting(self.session, profile_ptr, &mut setting, 0, 0)
                },
            };
            if code != status::OK {
                return Err(classify(code, "set_setting"));
            }
            // SAFETY: valid session; save persists to the driver (needs elevation).
            let code = unsafe { (self.save_settings)(self.session) };
            if code != status::OK {
                return Err(classify(code, "save_settings"));
            }
            Ok(())
        }

        fn reload_settings(&self) -> DlssResult<()> {
            // SAFETY: session was created and loaded during `open`.
            let code = unsafe { (self.load_settings)(self.session) };
            if code != status::OK {
                return Err(classify(code, "reload_settings"));
            }
            Ok(())
        }
    }
}
