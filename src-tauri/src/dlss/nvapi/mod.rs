//! NVAPI integration root.
//!
//! Owns the dynamic `nvapi64.dll` load probe (implemented in Phase 1 for
//! `dlss_get_support`) and re-exports the FFI ([`ffi`]), DRS session/profile
//! orchestration ([`drs`]), and preset feature surface ([`presets`]) sub-modules
//! filled in Phase 3.

pub mod drs;
pub mod ffi;
pub mod presets;

/// Whether `nvapi64.dll` can be loaded on this system (NVIDIA driver present).
///
/// This is the support probe behind `DlssSupport.nvapiAvailable`. It does not
/// resolve any functions or create a session — it only verifies the DLL exists
/// and loads, so it is safe (and cheap) to call on any machine. On a system with
/// no NVIDIA driver (e.g. CI) it returns `false` rather than erroring.
#[cfg(windows)]
pub fn is_nvapi_available() -> bool {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::FreeLibrary;
    use windows::Win32::System::LibraryLoader::LoadLibraryW;

    let name: Vec<u16> = std::ffi::OsStr::new("nvapi64.dll")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: `LoadLibraryW` takes a null-terminated wide string; the handle is
    // freed immediately if the load succeeded.
    unsafe {
        match LoadLibraryW(PCWSTR(name.as_ptr())) {
            Ok(handle) if !handle.is_invalid() => {
                let _ = FreeLibrary(handle);
                true
            }
            _ => false,
        }
    }
}

/// Non-Windows fallback: NVAPI is never available.
#[cfg(not(windows))]
pub fn is_nvapi_available() -> bool {
    false
}
