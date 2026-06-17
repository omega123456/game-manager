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
//!   `cfg(windows)` and exercises genuine `unsafe` FFI against a live driver, so
//!   it is the one true runtime boundary that cannot be unit-tested in CI.
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
    /// `NvAPI_DRS_EnumProfiles`.
    pub const DRS_ENUM_PROFILES: u32 = 0xBC37_5238;
    /// `NvAPI_DRS_GetProfileInfo`.
    pub const DRS_GET_PROFILE_INFO: u32 = 0x6155_92AB;
    /// `NvAPI_DRS_EnumApplications`.
    pub const DRS_ENUM_APPLICATIONS: u32 = 0x7FA2_173A;
    /// `NvAPI_DRS_GetSetting`.
    pub const DRS_GET_SETTING: u32 = 0x73BF_8338;
    /// `NvAPI_DRS_SetSetting`.
    pub const DRS_SET_SETTING: u32 = 0x577D_D202;
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
    /// Enumeration ran off the end of the list.
    pub const END_ENUMERATION: i32 = -11;
    /// The profile does not exist.
    pub const PROFILE_NOT_FOUND: i32 = -163;
    /// The requested setting is not present on the profile.
    pub const SETTING_NOT_FOUND: i32 = -165;
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
    /// The base (global) profile handle token.
    fn base_profile(&self) -> DlssResult<usize>;
    /// Enumerate every per-application profile (handle + name + exe names).
    fn enumerate_profiles(&self) -> DlssResult<Vec<ProfileInfo>>;
    /// Read a DWORD setting from `profile`. `None` when the setting is absent.
    fn get_setting(&self, profile: usize, setting_id: u32) -> DlssResult<Option<u32>>;
    /// Write a DWORD setting to `profile` and persist it (requires elevation).
    fn set_setting(&self, profile: usize, setting_id: u32, value: u32) -> DlssResult<()>;
}

/// An abstraction over the high-level NVAPI preset reads/writes so the preset
/// surface in [`super::presets`] is testable with a fake.
///
/// Implemented by [`super::drs::DrsOrchestrator`] over any [`NvapiDriver`].
pub trait NvapiDrs: Send {
    /// Read a DWORD setting from the base (global) profile. `None` when unset.
    fn get_base_setting(&self, setting_id: u32) -> DlssResult<Option<u32>>;
    /// Write a DWORD setting to the base (global) profile and save.
    fn set_base_setting(&self, setting_id: u32, value: u32) -> DlssResult<()>;
    /// Read a DWORD setting from the app profile matching `game_name`/`exe_names`.
    /// Returns `None` when no profile matches.
    fn get_app_setting(
        &self,
        game_name: &str,
        exe_names: &[String],
        setting_id: u32,
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
#[cfg(all(windows, not(coverage)))]
pub fn real_driver() -> DlssResult<Box<dyn NvapiDriver>> {
    windows_impl::RealDriver::open().map(|driver| Box::new(driver) as Box<dyn NvapiDriver>)
}

/// Fallback when NVAPI cannot be used at compile time (non-Windows / coverage).
#[cfg(not(all(windows, not(coverage))))]
pub fn real_driver() -> DlssResult<Box<dyn NvapiDriver>> {
    Err(crate::dlss::DlssError::Unsupported)
}

#[cfg(all(windows, not(coverage)))]
mod windows_impl {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCSTR;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{FreeLibrary, HMODULE};
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    use super::{make_nvapi_version, query_interface_id as qid, status, NvapiDriver, ProfileInfo};
    use crate::dlss::{DlssError, DlssResult};

    /// The single exported entry point that resolves every other DRS function.
    type QueryInterfaceFn = unsafe extern "C" fn(u32) -> *mut c_void;
    type InitializeFn = unsafe extern "C" fn() -> i32;
    type CreateSessionFn = unsafe extern "C" fn(*mut *mut c_void) -> i32;
    type LoadSettingsFn = unsafe extern "C" fn(*mut c_void) -> i32;
    type GetBaseProfileFn = unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> i32;
    type EnumProfilesFn = unsafe extern "C" fn(*mut c_void, u32, *mut *mut c_void) -> i32;
    type GetProfileInfoFn = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut NvdrsProfileV1) -> i32;
    type EnumApplicationsFn =
        unsafe extern "C" fn(*mut c_void, *mut c_void, u32, *mut u32, *mut NvdrsApplicationV1) -> i32;
    type GetSettingFn =
        unsafe extern "C" fn(*mut c_void, *mut c_void, u32, *mut NvdrsSettingV1) -> i32;
    type SetSettingFn = unsafe extern "C" fn(*mut c_void, *mut c_void, *const NvdrsSettingV1) -> i32;
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
        enum_profiles: EnumProfilesFn,
        get_profile_info: GetProfileInfoFn,
        enum_applications: EnumApplicationsFn,
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
            let query = unsafe {
                GetProcAddress(module, PCSTR(b"nvapi_QueryInterface\0".as_ptr()))
            };
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
            macro_rules! resolve_fn {
                ($id:expr, $ty:ty) => {{
                    let ptr = resolve($id);
                    if ptr.is_null() {
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

            let initialize: InitializeFn = resolve_fn!(qid::INITIALIZE, InitializeFn);
            let create_session: CreateSessionFn =
                resolve_fn!(qid::DRS_CREATE_SESSION, CreateSessionFn);
            let load_settings: LoadSettingsFn = resolve_fn!(qid::DRS_LOAD_SETTINGS, LoadSettingsFn);
            let get_base_profile: GetBaseProfileFn =
                resolve_fn!(qid::DRS_GET_BASE_PROFILE, GetBaseProfileFn);
            let enum_profiles: EnumProfilesFn =
                resolve_fn!(qid::DRS_ENUM_PROFILES, EnumProfilesFn);
            let get_profile_info: GetProfileInfoFn =
                resolve_fn!(qid::DRS_GET_PROFILE_INFO, GetProfileInfoFn);
            let enum_applications: EnumApplicationsFn =
                resolve_fn!(qid::DRS_ENUM_APPLICATIONS, EnumApplicationsFn);
            let get_setting: GetSettingFn = resolve_fn!(qid::DRS_GET_SETTING, GetSettingFn);
            let set_setting: SetSettingFn = resolve_fn!(qid::DRS_SET_SETTING, SetSettingFn);
            let save_settings: SaveSettingsFn =
                resolve_fn!(qid::DRS_SAVE_SETTINGS, SaveSettingsFn);
            let destroy_session: DestroySessionFn =
                resolve_fn!(qid::DRS_DESTROY_SESSION, DestroySessionFn);

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

            Ok(Self {
                module,
                session,
                enum_profiles,
                get_profile_info,
                enum_applications,
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

        fn get_setting(&self, profile: usize, setting_id: u32) -> DlssResult<Option<u32>> {
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
            if code == status::SETTING_NOT_FOUND {
                return Ok(None);
            }
            if code != status::OK {
                return Err(classify(code, "get_setting"));
            }
            // SAFETY: preset settings are DWORD type; read the u32 arm.
            Ok(Some(unsafe { setting.current_value.u32_value }))
        }

        fn set_setting(&self, profile: usize, setting_id: u32, value: u32) -> DlssResult<()> {
            let mut setting: NvdrsSettingV1 = unsafe { std::mem::zeroed() };
            setting.version = make_nvapi_version::<NvdrsSettingV1>(1);
            setting.setting_id = setting_id;
            setting.setting_type = NVDRS_DWORD_TYPE;
            setting.setting_location = NVDRS_CURRENT_PROFILE_LOCATION;
            setting.current_value.u32_value = value;
            // SAFETY: valid session + profile handle + populated setting struct.
            let code = unsafe {
                (self.set_setting)(self.session, profile as *mut c_void, &setting)
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
    }
}
