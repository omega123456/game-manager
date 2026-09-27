//! Install-state detection for game launch targets.
//!
//! A game is "not installed" when its launch target is a filesystem path that
//! no longer exists. Only drive-absolute (`C:\...`) and UNC (`\\server\share\...`)
//! paths can be checked; every other target (URIs such as `steam://...`,
//! `shell:AppsFolder\...`, bare executable names, relative or `%VAR%` paths) is
//! always treated as installed.
//!
//! Filesystem access goes through the [`InstallProbe`] seam on `AppState` so the
//! detection rules can be tested with a fake instead of real drives.

use std::io;
use std::path::Path;

use crate::domain::MissingReason;

/// Whether a launch target can be checked on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    /// A drive-absolute or UNC path.
    FilesystemPath,
    /// Anything that cannot be checked on disk (URI, bare name, relative path, ...).
    NonPath,
}

/// Classify a launch target.
pub fn classify_target(target: &str) -> TargetKind {
    let target = target.trim();
    if drive_letter(target).is_some() || unc_share(target).is_some() {
        TargetKind::FilesystemPath
    } else {
        TargetKind::NonPath
    }
}

/// The drive letter of a drive-absolute path such as `E:\Games\x.exe`.
fn drive_letter(target: &str) -> Option<char> {
    let bytes = target.as_bytes();
    let is_drive_path = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/');
    is_drive_path.then(|| char::from(bytes[0]).to_ascii_uppercase())
}

/// The `(server, share)` of a UNC path such as `\\nas\games\x.exe`.
///
/// Device paths (`\\?\...`, `\\.\...`) are not treated as UNC shares.
fn unc_share(target: &str) -> Option<(&str, &str)> {
    let rest = target
        .strip_prefix("\\\\")
        .or_else(|| target.strip_prefix("//"))?;
    let mut parts = rest.split(['\\', '/']);
    let server = parts.next().filter(|server| !server.is_empty())?;
    if server == "?" || server == "." {
        return None;
    }
    let share = parts.next().filter(|share| !share.is_empty())?;
    Some((server, share))
}

/// The root that must exist for a filesystem target to be reachable:
/// `E:\` for drive paths, `\\server\share\` for UNC paths, `None` otherwise.
pub fn install_root(target: &str) -> Option<String> {
    let target = target.trim();
    if let Some(letter) = drive_letter(target) {
        return Some(format!("{letter}:\\"));
    }
    unc_share(target).map(|(server, share)| format!("\\\\{server}\\{share}\\"))
}

/// Outcome of probing one launch target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    /// The target exists, or it cannot be checked on disk (non-path target).
    Present,
    /// The target's drive or share exists but the file does not.
    FileMissing,
    /// The target's drive or share is not available.
    DriveMissing,
    /// The check failed for another reason (e.g. access denied); the stored
    /// state should be left unchanged.
    Unverifiable,
}

impl Probe {
    /// The missing reason this probe maps to, or `None` when it is not a miss.
    pub fn missing_reason(self) -> Option<MissingReason> {
        match self {
            Probe::FileMissing => Some(MissingReason::FileMissing),
            Probe::DriveMissing => Some(MissingReason::DriveMissing),
            Probe::Present | Probe::Unverifiable => None,
        }
    }
}

/// Map a failed stat to a probe outcome.
///
/// A missing root always wins (a disconnected drive or share can surface as
/// several different OS errors); otherwise only `NotFound` counts as missing.
pub fn interpret(error: &io::Error, root_missing: bool) -> Probe {
    if root_missing {
        Probe::DriveMissing
    } else if error.kind() == io::ErrorKind::NotFound {
        Probe::FileMissing
    } else {
        Probe::Unverifiable
    }
}

/// Filesystem access used by install checks.
pub trait InstallProbe: Send + Sync {
    /// Succeeds when `path` exists.
    fn stat(&self, path: &Path) -> io::Result<()>;
    /// Whether the drive or share root `root` is available.
    fn root_exists(&self, root: &Path) -> bool;
}

/// [`InstallProbe`] backed by the real filesystem.
pub struct RealFsProbe;

impl InstallProbe for RealFsProbe {
    fn stat(&self, path: &Path) -> io::Result<()> {
        std::fs::metadata(path).map(|_| ())
    }

    fn root_exists(&self, root: &Path) -> bool {
        root.is_dir()
    }
}

/// Probe one launch target through `probe`.
pub fn probe_target(probe: &dyn InstallProbe, target: &str) -> Probe {
    if classify_target(target) == TargetKind::NonPath {
        return Probe::Present;
    }
    let target = target.trim();
    match probe.stat(Path::new(target)) {
        Ok(()) => Probe::Present,
        Err(error) => {
            let root_missing =
                install_root(target).is_some_and(|root| !probe.root_exists(Path::new(&root)));
            interpret(&error, root_missing)
        }
    }
}
