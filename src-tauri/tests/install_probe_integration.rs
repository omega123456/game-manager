//! Launch-target classification and probing (`install` module).

use std::io;

use game_manager_lib::domain::MissingReason;
use game_manager_lib::install::{
    classify_target, install_root, interpret, probe_target, InstallProbe, Probe, RealFsProbe,
    TargetKind,
};

mod common;

#[test]
fn classifies_only_drive_and_unc_paths_as_filesystem_targets() {
    let filesystem = [
        r"C:\Games\Hades\Hades.exe",
        "e:/games/x.exe",
        r"  D:\padded.exe  ",
        r"\\nas\games\x.exe",
        "//nas/games/x.exe",
    ];
    for target in filesystem {
        assert_eq!(
            classify_target(target),
            TargetKind::FilesystemPath,
            "{target}"
        );
    }

    let non_path = [
        "steam://rungameid/1145360",
        r"shell:AppsFolder\Microsoft.Game_8wekyb3d8bbwe!App",
        "com.epicgames.launcher:apps/fn",
        "game.exe",
        r"Games\relative.exe",
        r"%ProgramFiles%\Game\game.exe",
        "C:",
        r"\\?\C:\Games\long.exe",
        r"\\.\pipe\x",
        r"\\nas",
        r"\\nas\",
        "",
    ];
    for target in non_path {
        assert_eq!(classify_target(target), TargetKind::NonPath, "{target}");
    }
}

#[test]
fn install_root_names_the_drive_or_share() {
    assert_eq!(install_root(r"e:\Games\x.exe").as_deref(), Some(r"E:\"));
    assert_eq!(install_root("C:/x.exe").as_deref(), Some(r"C:\"));
    assert_eq!(
        install_root(r"\\nas\games\sub\x.exe").as_deref(),
        Some(r"\\nas\games\")
    );
    assert_eq!(
        install_root("//nas/games/x.exe").as_deref(),
        Some(r"\\nas\games\")
    );
    assert_eq!(install_root("steam://rungameid/1"), None);
    assert_eq!(install_root("game.exe"), None);
}

#[test]
fn interpret_prefers_a_missing_root_then_not_found() {
    let not_found = io::Error::from(io::ErrorKind::NotFound);
    let denied = io::Error::from(io::ErrorKind::PermissionDenied);

    assert_eq!(interpret(&not_found, true), Probe::DriveMissing);
    assert_eq!(interpret(&denied, true), Probe::DriveMissing);
    assert_eq!(interpret(&not_found, false), Probe::FileMissing);
    assert_eq!(interpret(&denied, false), Probe::Unverifiable);
}

#[test]
fn probe_maps_to_missing_reasons() {
    assert_eq!(
        Probe::FileMissing.missing_reason(),
        Some(MissingReason::FileMissing)
    );
    assert_eq!(
        Probe::DriveMissing.missing_reason(),
        Some(MissingReason::DriveMissing)
    );
    assert_eq!(Probe::Present.missing_reason(), None);
    assert_eq!(Probe::Unverifiable.missing_reason(), None);
}

#[test]
fn missing_reason_round_trips_through_its_db_string() {
    for reason in [MissingReason::FileMissing, MissingReason::DriveMissing] {
        assert_eq!(MissingReason::from_db_str(reason.as_db_str()), Some(reason));
    }
    assert_eq!(MissingReason::from_db_str("gone"), None);
}

#[test]
fn probe_target_uses_the_probe_for_paths_only() {
    let probe = common::FakeInstallProbe::with_present(&[r"C:\Games\present.exe"]);
    probe.set_root_missing(r"Q:\");

    assert_eq!(
        probe_target(&probe, r"C:\Games\present.exe"),
        Probe::Present
    );
    assert_eq!(
        probe_target(&probe, r"C:\Games\gone.exe"),
        Probe::FileMissing
    );
    assert_eq!(probe_target(&probe, r"Q:\Games\x.exe"), Probe::DriveMissing);
    assert_eq!(probe.stat_calls(), 3);

    assert_eq!(probe_target(&probe, "steam://rungameid/1"), Probe::Present);
    assert_eq!(probe.stat_calls(), 3, "non-path targets are never stat-ed");

    probe.script(
        r"C:\Games\locked.exe",
        vec![Err(io::ErrorKind::PermissionDenied)],
    );
    assert_eq!(
        probe_target(&probe, r"C:\Games\locked.exe"),
        Probe::Unverifiable
    );
}

#[test]
fn real_probe_reads_the_filesystem() {
    let dir = tempfile::tempdir().unwrap();
    let exe = dir.path().join("game.exe");
    std::fs::write(&exe, b"").unwrap();

    let probe = RealFsProbe;
    assert!(probe.stat(&exe).is_ok());
    assert_eq!(
        probe
            .stat(&dir.path().join("missing.exe"))
            .unwrap_err()
            .kind(),
        io::ErrorKind::NotFound
    );
    assert!(probe.root_exists(dir.path()));
    assert!(!probe.root_exists(&dir.path().join("no-such-dir")));

    let exe_str = exe.to_string_lossy().to_string();
    assert_eq!(probe_target(&probe, &exe_str), Probe::Present);
    let missing = dir.path().join("gone.exe").to_string_lossy().to_string();
    assert_eq!(probe_target(&probe, &missing), Probe::FileMissing);
}
