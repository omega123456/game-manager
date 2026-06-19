//! Global DLSS on-screen indicator support.
//!
//! Owns the supported indicator modes, DWORD mapping for NVIDIA's
//! `ShowDlssIndicator` registry value, and a small registry access boundary so
//! tests can exercise behavior without touching the real HKLM key.

use crate::dlss::{DlssError, DlssResult};
use crate::domain::DlssIndicatorMode;

#[cfg(all(windows, not(feature = "test-utils"), not(coverage)))]
const NGX_CORE_PATH: &str = r"SOFTWARE\NVIDIA Corporation\Global\NGXCore";
#[cfg(all(windows, not(feature = "test-utils"), not(coverage)))]
const SHOW_DLSS_INDICATOR_VALUE: &str = "ShowDlssIndicator";

/// Read the current global DLSS indicator mode from the live registry.
pub fn get_global_indicator_mode_impl() -> DlssResult<DlssIndicatorMode> {
    get_global_indicator_mode_with(&default_registry())
}

/// Write the current global DLSS indicator mode to the live registry.
pub fn set_global_indicator_mode_impl(mode: DlssIndicatorMode) -> DlssResult<()> {
    set_global_indicator_mode_with(&default_registry(), mode)
}

/// Testable read path using an injected registry backend.
pub fn get_global_indicator_mode_with(
    registry: &dyn IndicatorRegistry,
) -> DlssResult<DlssIndicatorMode> {
    let value = registry.get_show_dlss_indicator()?;
    DlssIndicatorMode::from_registry_value(value)
}

/// Testable write path using an injected registry backend.
pub fn set_global_indicator_mode_with(
    registry: &dyn IndicatorRegistry,
    mode: DlssIndicatorMode,
) -> DlssResult<()> {
    registry.set_show_dlss_indicator(mode.registry_value())
}

/// Registry access boundary for the global indicator value.
pub trait IndicatorRegistry {
    fn get_show_dlss_indicator(&self) -> DlssResult<u32>;
    fn set_show_dlss_indicator(&self, value: u32) -> DlssResult<()>;
}

/// Convert a registry-layer failure into the DLSS error model.
pub fn map_registry_error(err: &std::io::Error, context: &str) -> DlssError {
    if err.kind() == std::io::ErrorKind::PermissionDenied {
        tracing::warn!(
            category = "dlss",
            "privilege denied during {context}: {err}"
        );
        DlssError::Privilege
    } else {
        DlssError::Io(format!("{context}: {err}"))
    }
}

#[cfg(all(windows, not(feature = "test-utils"), not(coverage)))]
fn map_win32_error(
    status: windows::Win32::Foundation::WIN32_ERROR,
    context: &str,
) -> DlssResult<()> {
    if status.0 == 0 {
        Ok(())
    } else {
        Err(map_registry_error(
            &std::io::Error::from_raw_os_error(status.0 as i32),
            context,
        ))
    }
}

#[cfg(all(windows, not(feature = "test-utils"), not(coverage)))]
fn default_registry() -> RealIndicatorRegistry {
    RealIndicatorRegistry
}

#[cfg(any(not(windows), feature = "test-utils", coverage))]
fn default_registry() -> UnsupportedIndicatorRegistry {
    UnsupportedIndicatorRegistry
}

#[cfg(any(not(windows), feature = "test-utils", coverage))]
struct UnsupportedIndicatorRegistry;

#[cfg(any(not(windows), feature = "test-utils", coverage))]
impl IndicatorRegistry for UnsupportedIndicatorRegistry {
    fn get_show_dlss_indicator(&self) -> DlssResult<u32> {
        Err(DlssError::Unsupported)
    }

    fn set_show_dlss_indicator(&self, _value: u32) -> DlssResult<()> {
        Err(DlssError::Unsupported)
    }
}

#[cfg(all(windows, not(feature = "test-utils"), not(coverage)))]
struct RealIndicatorRegistry;

#[cfg(all(windows, not(feature = "test-utils"), not(coverage)))]
impl IndicatorRegistry for RealIndicatorRegistry {
    fn get_show_dlss_indicator(&self) -> DlssResult<u32> {
        use std::os::windows::ffi::OsStrExt;

        use windows::Win32::System::Registry::{
            RegCloseKey, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
            RRF_RT_REG_DWORD,
        };

        unsafe {
            let key_path: Vec<u16> = std::ffi::OsStr::new(NGX_CORE_PATH)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let value_name: Vec<u16> = std::ffi::OsStr::new(SHOW_DLSS_INDICATOR_VALUE)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let mut key = HKEY::default();
            let key_status = RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                windows::core::PCWSTR(key_path.as_ptr()),
                0,
                KEY_READ,
                &mut key,
            );
            map_win32_error(key_status, "open NVIDIA NGXCore registry key")?;

            let mut value = 0u32;
            let mut size = std::mem::size_of::<u32>() as u32;
            let result = RegGetValueW(
                key,
                None,
                windows::core::PCWSTR(value_name.as_ptr()),
                RRF_RT_REG_DWORD,
                None,
                Some((&mut value as *mut u32).cast()),
                Some(&mut size),
            );
            let _ = RegCloseKey(key);
            map_win32_error(result, "read NVIDIA ShowDlssIndicator registry value")?;
            Ok(value)
        }
    }

    fn set_show_dlss_indicator(&self, value: u32) -> DlssResult<()> {
        use std::os::windows::ffi::OsStrExt;

        use windows::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_SET_VALUE,
            REG_DWORD,
        };

        unsafe {
            let key_path: Vec<u16> = std::ffi::OsStr::new(NGX_CORE_PATH)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let value_name: Vec<u16> = std::ffi::OsStr::new(SHOW_DLSS_INDICATOR_VALUE)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let mut key = HKEY::default();
            let key_status = RegOpenKeyExW(
                HKEY_LOCAL_MACHINE,
                windows::core::PCWSTR(key_path.as_ptr()),
                0,
                KEY_SET_VALUE,
                &mut key,
            );
            map_win32_error(key_status, "open NVIDIA NGXCore registry key for write")?;

            let bytes = value.to_le_bytes();
            let result = RegSetValueExW(
                key,
                windows::core::PCWSTR(value_name.as_ptr()),
                0,
                REG_DWORD,
                Some(&bytes),
            );
            let _ = RegCloseKey(key);
            map_win32_error(result, "write NVIDIA ShowDlssIndicator registry value")?;
            Ok(())
        }
    }
}
