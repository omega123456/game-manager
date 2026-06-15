//! Executor integration tests: combined-script building, inline temp-file
//! execution, utility-snippet sourcing, interpreter-mismatch skipping, and
//! external-path classification. These run real `powershell.exe` / `cmd.exe`
//! processes (the target platform is Windows 11).

use std::collections::HashMap;

use game_manager_lib::domain::{Interpreter, PhaseConfig, PhaseMode, Script, ScriptKind, ScriptPhase};
use game_manager_lib::launch::executor::{classify_external_path, execute_phase};

fn none() -> PhaseConfig {
    PhaseConfig::default()
}

fn inline(code: &str, interpreter: Interpreter) -> PhaseConfig {
    PhaseConfig {
        mode: PhaseMode::Inline,
        path: None,
        inline: Some(code.to_string()),
        interpreter: Some(interpreter),
    }
}

fn script(id: i64, name: &str, kind: ScriptKind) -> Script {
    Script {
        id,
        name: name.to_string(),
        description: None,
        kind,
        priority: 5,
        before_launch: none(),
        after_launch: none(),
        on_exit: none(),
        snippet: none(),
        created_at: "2026-01-01T00:00:00Z".to_string(),
        requires: Vec::new(),
    }
}

fn index(scripts: &[Script]) -> HashMap<i64, Script> {
    scripts.iter().cloned().map(|s| (s.id, s)).collect()
}

#[test]
fn classifies_external_paths_by_extension() {
    assert_eq!(classify_external_path("C:/cmds/restart.ps1"), "powershell");
    assert_eq!(classify_external_path("C:/cmds/job.BAT"), "batch");
    assert_eq!(classify_external_path("C:/cmds/job.cmd"), "batch");
    assert_eq!(classify_external_path("C:/games/game.exe"), "executable");
    // Unknown extensions default to PowerShell.
    assert_eq!(classify_external_path("C:/cmds/thing.txt"), "powershell");
}

#[tokio::test]
async fn skips_phase_when_mode_is_none() {
    let mut entry = script(1, "Noop", ScriptKind::Normal);
    entry.before_launch = none();
    let by_id = index(&[entry.clone()]);
    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(!result.ran);
    assert!(result.success);
}

#[tokio::test]
async fn runs_inline_powershell_via_temp_file() {
    let mut entry = script(1, "Echo", ScriptKind::Normal);
    entry.before_launch = inline("Write-Output 'hello-from-inline'", Interpreter::Powershell);
    let by_id = index(&[entry.clone()]);

    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(result.ran, "phase should run");
    assert!(result.success, "stderr: {}", result.stderr);
    assert!(result.stdout.contains("hello-from-inline"));
}

#[tokio::test]
async fn sources_required_utility_function_into_phase() {
    // A normal script calls a function defined only in a required utility.
    let mut util = script(2, "GreetLib", ScriptKind::Utility);
    util.snippet = inline(
        "function Get-Greeting { 'greeting-from-utility' }",
        Interpreter::Powershell,
    );

    let mut entry = script(1, "Greeter", ScriptKind::Normal);
    entry.requires = vec![2];
    entry.before_launch = inline("Write-Output (Get-Greeting)", Interpreter::Powershell);

    let by_id = index(&[entry.clone(), util]);
    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(result.success, "stderr: {}", result.stderr);
    assert!(
        result.stdout.contains("greeting-from-utility"),
        "stdout: {}",
        result.stdout
    );
    assert!(result.skipped_utilities.is_empty());
}

#[tokio::test]
async fn sources_utilities_in_dependency_order() {
    // util A depends on util B; B must be sourced before A.
    let mut util_b = script(3, "BaseLib", ScriptKind::Utility);
    util_b.snippet = inline("function Base { 'B' }", Interpreter::Powershell);
    let mut util_a = script(2, "MidLib", ScriptKind::Utility);
    util_a.requires = vec![3];
    util_a.snippet = inline("function Mid { (Base) + 'A' }", Interpreter::Powershell);

    let mut entry = script(1, "User", ScriptKind::Normal);
    entry.requires = vec![2];
    entry.before_launch = inline("Write-Output (Mid)", Interpreter::Powershell);

    let by_id = index(&[entry.clone(), util_a, util_b]);
    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(result.success, "stderr: {}", result.stderr);
    assert!(result.stdout.contains("BA"), "stdout: {}", result.stdout);
}

#[tokio::test]
async fn skips_utility_with_mismatched_interpreter() {
    // Entry is PowerShell; the required utility is Batch -> logged + skipped.
    let mut util = script(2, "BatchLib", ScriptKind::Utility);
    util.snippet = inline("echo from-batch", Interpreter::Batch);

    let mut entry = script(1, "PsEntry", ScriptKind::Normal);
    entry.requires = vec![2];
    entry.before_launch = inline("Write-Output 'ps-ran'", Interpreter::Powershell);

    let by_id = index(&[entry.clone(), util]);
    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(result.success, "stderr: {}", result.stderr);
    assert!(result.stdout.contains("ps-ran"));
    assert_eq!(result.skipped_utilities, vec!["BatchLib".to_string()]);
}

#[tokio::test]
async fn runs_inline_powershell7_via_pwsh() {
    // PowerShell 7 inline code runs through pwsh.exe.
    let mut entry = script(1, "Echo7", ScriptKind::Normal);
    entry.before_launch = inline("Write-Output 'hello-from-pwsh7'", Interpreter::Powershell7);
    let by_id = index(&[entry.clone()]);

    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(result.ran, "phase should run");
    assert!(result.success, "stderr: {}", result.stderr);
    assert!(result.stdout.contains("hello-from-pwsh7"), "stdout: {}", result.stdout);
}

#[tokio::test]
async fn sources_powershell_utility_into_powershell7_entry() {
    // A PowerShell 5.1 utility is sourced into a PowerShell 7 entry: the two are
    // the same shell family, so it must NOT be skipped.
    let mut util = script(2, "SharedLib", ScriptKind::Utility);
    util.snippet = inline("function Get-Shared { 'shared-across-ps' }", Interpreter::Powershell);

    let mut entry = script(1, "Pwsh7User", ScriptKind::Normal);
    entry.requires = vec![2];
    entry.before_launch = inline("Write-Output (Get-Shared)", Interpreter::Powershell7);

    let by_id = index(&[entry.clone(), util]);
    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(result.success, "stderr: {}", result.stderr);
    assert!(result.stdout.contains("shared-across-ps"), "stdout: {}", result.stdout);
    assert!(result.skipped_utilities.is_empty());
}

#[tokio::test]
async fn runs_inline_batch_via_temp_file() {
    let mut entry = script(1, "BatchEcho", ScriptKind::Normal);
    entry.after_launch = inline("@echo off\r\necho batch-output", Interpreter::Batch);
    let by_id = index(&[entry.clone()]);

    let result = execute_phase(&entry, ScriptPhase::After, &by_id).await;
    assert!(result.ran);
    assert!(result.success, "stderr: {}", result.stderr);
    assert!(result.stdout.contains("batch-output"), "stdout: {}", result.stdout);
}

fn path_phase(path: &str) -> PhaseConfig {
    PhaseConfig {
        mode: PhaseMode::Path,
        path: Some(path.to_string()),
        inline: None,
        interpreter: None,
    }
}

#[tokio::test]
async fn runs_external_executable_directly() {
    // whoami.exe exits immediately; spawn it directly via path/exe mode.
    let mut entry = script(1, "ExeEntry", ScriptKind::Normal);
    entry.before_launch = path_phase("C:/Windows/System32/whoami.exe");
    let by_id = index(&[entry.clone()]);

    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(result.ran);
    assert!(result.success, "stderr: {}", result.stderr);
}

#[tokio::test]
async fn external_executable_logs_skipped_utilities() {
    // exe entries cannot source utilities; required ones are reported as skipped.
    let util = {
        let mut u = script(2, "UnusedLib", ScriptKind::Utility);
        u.snippet = inline("function X {}", Interpreter::Powershell);
        u
    };
    let mut entry = script(1, "ExeWithUtil", ScriptKind::Normal);
    entry.requires = vec![2];
    entry.before_launch = path_phase("C:/Windows/System32/whoami.exe");

    let by_id = index(&[entry.clone(), util]);
    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(result.success, "stderr: {}", result.stderr);
    assert_eq!(result.skipped_utilities, vec!["UnusedLib".to_string()]);
}

#[tokio::test]
async fn external_powershell_path_entry_is_dot_sourced() {
    // Write a real .ps1 to a temp dir and run it as a path-mode entry.
    let dir = std::env::temp_dir();
    let script_path = dir.join(format!("gm-test-path-{}.ps1", std::process::id()));
    std::fs::write(&script_path, "Write-Output 'from-external-ps1'").unwrap();

    let mut entry = script(1, "PathEntry", ScriptKind::Normal);
    entry.before_launch = path_phase(script_path.to_str().unwrap());
    let by_id = index(&[entry.clone()]);

    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    let _ = std::fs::remove_file(&script_path);
    assert!(result.success, "stderr: {}", result.stderr);
    assert!(result.stdout.contains("from-external-ps1"), "stdout: {}", result.stdout);
}

#[tokio::test]
async fn external_batch_path_entry_is_called() {
    let dir = std::env::temp_dir();
    let script_path = dir.join(format!("gm-test-path-{}.bat", std::process::id()));
    std::fs::write(&script_path, "@echo off\r\necho from-external-bat").unwrap();

    let mut entry = script(1, "BatPathEntry", ScriptKind::Normal);
    entry.on_exit = path_phase(script_path.to_str().unwrap());
    let by_id = index(&[entry.clone()]);

    let result = execute_phase(&entry, ScriptPhase::OnExit, &by_id).await;
    let _ = std::fs::remove_file(&script_path);
    assert!(result.success, "stderr: {}", result.stderr);
    assert!(result.stdout.contains("from-external-bat"), "stdout: {}", result.stdout);
}

#[tokio::test]
async fn sources_external_path_utility_snippet() {
    // A utility whose snippet is an external .ps1 file is dot-sourced.
    let dir = std::env::temp_dir();
    let util_path = dir.join(format!("gm-test-util-{}.ps1", std::process::id()));
    std::fs::write(&util_path, "function Helper { 'helper-output' }").unwrap();

    let mut util = script(2, "FileLib", ScriptKind::Utility);
    util.snippet = path_phase(util_path.to_str().unwrap());

    let mut entry = script(1, "UsesFileLib", ScriptKind::Normal);
    entry.requires = vec![2];
    entry.before_launch = inline("Write-Output (Helper)", Interpreter::Powershell);

    let by_id = index(&[entry.clone(), util]);
    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    let _ = std::fs::remove_file(&util_path);
    assert!(result.success, "stderr: {}", result.stderr);
    assert!(result.stdout.contains("helper-output"), "stdout: {}", result.stdout);
    assert!(result.skipped_utilities.is_empty());
}

#[tokio::test]
async fn skips_path_utility_with_mismatched_extension() {
    // Entry PowerShell; utility snippet is an external .bat -> skipped.
    let mut util = script(2, "BatFileLib", ScriptKind::Utility);
    util.snippet = path_phase("C:/cmds/thing.bat");

    let mut entry = script(1, "PsUser", ScriptKind::Normal);
    entry.requires = vec![2];
    entry.before_launch = inline("Write-Output 'ok'", Interpreter::Powershell);

    let by_id = index(&[entry.clone(), util]);
    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(result.success, "stderr: {}", result.stderr);
    assert_eq!(result.skipped_utilities, vec!["BatFileLib".to_string()]);
}

#[tokio::test]
async fn failing_inline_script_reports_failure() {
    let mut entry = script(1, "Fail", ScriptKind::Normal);
    entry.before_launch = inline("exit 3", Interpreter::Powershell);
    let by_id = index(&[entry.clone()]);

    let result = execute_phase(&entry, ScriptPhase::Before, &by_id).await;
    assert!(result.ran);
    assert!(!result.success);
    assert!(result.detail.is_some());
}
