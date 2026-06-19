//! DLSS global indicator integration tests.
//!
//! Covers mode/value mapping, defensive validation, unsupported-platform
//! behavior, privilege classification, and command-level delegation without
//! touching the real NVIDIA registry.

use std::sync::{Arc, Mutex};

use game_manager_lib::commands::dlss::{get_global_indicator_impl, set_global_indicator_impl};
use game_manager_lib::dlss::indicator::{
    get_global_indicator_mode_impl, get_global_indicator_mode_with, map_registry_error,
    set_global_indicator_mode_impl, set_global_indicator_mode_with, IndicatorRegistry,
};
use game_manager_lib::dlss::DlssError;
use game_manager_lib::domain::DlssIndicatorMode;

#[derive(Clone)]
struct FakeRegistry {
    read: Result<u32, FakeRegistryError>,
    writes: Arc<Mutex<Vec<u32>>>,
}

#[derive(Clone)]
struct FakeRegistryError {
    kind: std::io::ErrorKind,
    message: &'static str,
}

impl FakeRegistryError {
    fn into_io_error(self) -> std::io::Error {
        std::io::Error::new(self.kind, self.message)
    }
}

impl FakeRegistry {
    fn with_value(value: u32) -> Self {
        Self {
            read: Ok(value),
            writes: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn with_error(kind: std::io::ErrorKind, message: &'static str) -> Self {
        Self {
            read: Err(FakeRegistryError { kind, message }),
            writes: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn writes(&self) -> Vec<u32> {
        self.writes.lock().unwrap().clone()
    }
}

impl IndicatorRegistry for FakeRegistry {
    fn get_show_dlss_indicator(&self) -> Result<u32, DlssError> {
        self.read
            .clone()
            .map_err(|err| map_registry_error(&err.into_io_error(), "read test registry value"))
    }

    fn set_show_dlss_indicator(&self, value: u32) -> Result<(), DlssError> {
        if let Err(err) = &self.read {
            return Err(map_registry_error(
                &err.clone().into_io_error(),
                "write test registry value",
            ));
        }
        self.writes.lock().unwrap().push(value);
        Ok(())
    }
}

#[test]
fn dto_round_trips_supported_indicator_values() {
    assert_eq!(DlssIndicatorMode::Off.registry_value(), 0);
    assert_eq!(DlssIndicatorMode::DebugDllsOnly.registry_value(), 1);
    assert_eq!(DlssIndicatorMode::AllDlssDlls.registry_value(), 1024);

    assert_eq!(
        DlssIndicatorMode::from_registry_value(0).unwrap(),
        DlssIndicatorMode::Off
    );
    assert_eq!(
        DlssIndicatorMode::from_registry_value(1).unwrap(),
        DlssIndicatorMode::DebugDllsOnly
    );
    assert_eq!(
        DlssIndicatorMode::from_registry_value(1024).unwrap(),
        DlssIndicatorMode::AllDlssDlls
    );
}

#[test]
fn dto_rejects_unknown_registry_values() {
    let err = DlssIndicatorMode::from_registry_value(7).unwrap_err();
    assert!(matches!(err, DlssError::Invalid(_)));
    assert!(err
        .to_string()
        .contains("unsupported DLSS indicator registry value"));
}

#[test]
fn read_path_maps_registry_values_to_modes() {
    assert_eq!(
        get_global_indicator_mode_with(&FakeRegistry::with_value(0)).unwrap(),
        DlssIndicatorMode::Off
    );
    assert_eq!(
        get_global_indicator_mode_with(&FakeRegistry::with_value(1)).unwrap(),
        DlssIndicatorMode::DebugDllsOnly
    );
    assert_eq!(
        get_global_indicator_mode_with(&FakeRegistry::with_value(1024)).unwrap(),
        DlssIndicatorMode::AllDlssDlls
    );
}

#[test]
fn write_path_maps_modes_to_registry_values() {
    let registry = FakeRegistry::with_value(0);
    set_global_indicator_mode_with(&registry, DlssIndicatorMode::Off).unwrap();
    set_global_indicator_mode_with(&registry, DlssIndicatorMode::DebugDllsOnly).unwrap();
    set_global_indicator_mode_with(&registry, DlssIndicatorMode::AllDlssDlls).unwrap();
    assert_eq!(registry.writes(), vec![0, 1, 1024]);
}

#[test]
fn permission_denied_registry_errors_become_privilege_errors() {
    let registry = FakeRegistry::with_error(std::io::ErrorKind::PermissionDenied, "denied");
    let read_err = get_global_indicator_mode_with(&registry).unwrap_err();
    assert!(matches!(read_err, DlssError::Privilege));

    let write_err = set_global_indicator_mode_with(&registry, DlssIndicatorMode::Off).unwrap_err();
    assert!(matches!(write_err, DlssError::Privilege));
}

#[test]
fn non_permission_registry_errors_become_io_errors() {
    let registry = FakeRegistry::with_error(std::io::ErrorKind::NotFound, "missing");
    let err = get_global_indicator_mode_with(&registry).unwrap_err();
    assert!(matches!(err, DlssError::Io(_)));
    assert!(err.to_string().contains("read test registry value"));
}

#[test]
fn command_impls_delegate_to_indicator_logic() {
    match get_global_indicator_impl() {
        Ok(mode) => {
            assert!(matches!(
                mode,
                DlssIndicatorMode::Off
                    | DlssIndicatorMode::DebugDllsOnly
                    | DlssIndicatorMode::AllDlssDlls
            ));
        }
        Err(err) => {
            let message = err.to_string();
            assert!(
                message.contains("NVIDIA NVAPI is unavailable on this system")
                    || message.contains("administrator privileges are required")
                    || message.contains("unsupported DLSS indicator registry value")
                    || message.contains("io error:")
            );
        }
    }

    match set_global_indicator_impl(DlssIndicatorMode::Off) {
        Ok(()) => {}
        Err(err) => {
            let message = err.to_string();
            assert!(
                message.contains("NVIDIA NVAPI is unavailable on this system")
                    || message.contains("administrator privileges are required")
                    || message.contains("io error:")
            );
        }
    }
}

#[test]
fn live_impls_are_unsupported_in_test_builds() {
    let read_err = get_global_indicator_mode_impl().unwrap_err();
    assert!(matches!(read_err, DlssError::Unsupported));

    let write_err = set_global_indicator_mode_impl(DlssIndicatorMode::Off).unwrap_err();
    assert!(matches!(write_err, DlssError::Unsupported));
}
