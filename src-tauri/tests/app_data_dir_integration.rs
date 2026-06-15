use std::path::Path;

#[test]
fn resolved_app_data_dir_maps_dev_suffix_before_extension_in_debug() {
    let base = Path::new("parent").join("app.gamemanager.desktop");
    let resolved = game_manager_lib::resolved_app_data_dir(&base);
    #[cfg(debug_assertions)]
    {
        assert_eq!(
            resolved,
            Path::new("parent").join("app.gamemanager-dev.desktop")
        );
    }
    #[cfg(not(debug_assertions))]
    {
        assert_eq!(resolved, base);
    }
}

#[test]
fn resolved_app_data_dir_unchanged_when_no_file_name() {
    let base = Path::new("");
    let resolved = game_manager_lib::resolved_app_data_dir(base);
    assert_eq!(resolved, base);
}
