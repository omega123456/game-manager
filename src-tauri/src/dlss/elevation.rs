//! Process-elevation detection and relaunch-as-Administrator.
//!
//! `is_elevated` reads the current process token's elevation state.
//! `relaunch_as_admin` re-runs the current executable with the `runas` verb
//! (triggering UAC) and exits the current process. The relaunch path drives the
//! real Win32 shell and never returns, so it is excluded from coverage and
//! test builds.

use crate::dlss::DlssResult;

/// Whether the current process is running with an elevated (Administrator) token.
///
/// On non-Windows targets (only relevant for cross-compilation) this returns
/// `false`. On Windows it queries `TOKEN_ELEVATION` via `GetTokenInformation`.
#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // SAFETY: standard token-elevation probe. The token handle is closed on every
    // path; `GetTokenInformation` writes into a correctly sized stack struct.
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned: u32 = 0;
        let size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;
        let result = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut std::ffi::c_void),
            size,
            &mut returned,
        );
        let _ = CloseHandle(token);
        result.is_ok() && elevation.TokenIsElevated != 0
    }
}

/// Non-Windows fallback: never elevated.
#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

/// Relaunch the current executable elevated (UAC `runas`) and exit.
///
/// On success this process terminates and does not return. Excluded from
/// coverage/test builds because it drives the real Win32 shell + a process
/// exit. Integration tests run with `test-utils`; they must never relaunch the
/// test binary, or the relaunched binary recursively runs the same tests.
#[cfg(all(windows, not(coverage), not(feature = "test-utils")))]
pub fn relaunch_as_admin() -> DlssResult<()> {
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe = std::env::current_exe()
        .map_err(|err| crate::dlss::DlssError::Io(format!("current exe: {err}")))?;
    let exe_wide: Vec<u16> = exe
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let verb_wide: Vec<u16> = "runas".encode_utf16().chain(std::iter::once(0)).collect();

    // SAFETY: all pointers reference null-terminated buffers that outlive the call.
    unsafe {
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_NOCLOSEPROCESS,
            lpVerb: PCWSTR(verb_wide.as_ptr()),
            lpFile: PCWSTR(exe_wide.as_ptr()),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        ShellExecuteExW(&mut info)
            .map_err(|err| crate::dlss::DlssError::Io(format!("relaunch elevated: {err}")))?;
    }
    std::process::exit(0);
}

/// Non-Windows / coverage / test fallback: relaunch is unsupported.
#[cfg(any(not(windows), coverage, feature = "test-utils"))]
pub fn relaunch_as_admin() -> DlssResult<()> {
    Err(crate::dlss::DlssError::Unsupported)
}
