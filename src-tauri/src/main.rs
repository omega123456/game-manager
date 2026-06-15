// Prevents an additional console window on Windows in release. DO NOT REMOVE.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(coverage))]
fn main() {
    game_manager_lib::run()
}

// Under coverage instrumentation the Tauri runtime entrypoint is excluded, so the
// binary needs a trivial main to compile.
#[cfg(coverage)]
fn main() {}
