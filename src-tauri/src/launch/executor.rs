//! Phase executor.
//!
//! For one resolved entry's phase the executor builds a single combined script —
//! the entry's transitive required **utility snippets sourced first** (in
//! dependency order), then the entry's own phase code — and runs it via
//! `tokio::process`. Execution is **best-effort**: every result (success or
//! failure, including utilities skipped for interpreter mismatch) is reported so
//! the orchestrator can log it and continue; the pipeline never halts.
//!
//! Sourcing rules:
//! - **PowerShell** utilities: dot-sourced (`. <path>`) for external snippets,
//!   inlined verbatim for inline snippets.
//! - **Batch** utilities: `call <path>` for external snippets, inlined verbatim
//!   for inline snippets.
//! - A required utility whose snippet interpreter differs from the entry phase's
//!   interpreter is **logged and skipped** (it cannot be sourced safely).
//!
//! Run targets:
//! - External `path` entry `.ps1` → `powershell.exe -File`.
//! - External `path` entry `.bat`/`.cmd` → `cmd /c`.
//! - External `path` entry `.exe` → spawned directly (no combining; any required
//!   utilities are logged and skipped).
//! - Inline / combined code → temp file written with the entry phase interpreter.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use tokio::process::Command;

use crate::domain::{Interpreter, PhaseConfig, PhaseMode, Script, ScriptKind, ScriptPhase};

/// Classification of an entry phase's run target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RunKind {
    /// Combined PowerShell script written to a temp `.ps1`.
    PowerShell,
    /// Combined batch script written to a temp `.bat`.
    Batch,
    /// A native executable spawned directly (no combining).
    Executable,
}

/// The outcome of executing one entry phase.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhaseExecution {
    /// Whether the phase was actually run (vs. skipped because mode is `none`).
    pub ran: bool,
    /// Whether the process reported success (exit status 0).
    pub success: bool,
    /// Captured stdout.
    pub stdout: String,
    /// Captured stderr.
    pub stderr: String,
    /// Names of required utilities skipped for interpreter mismatch / exe target.
    pub skipped_utilities: Vec<String>,
    /// A human-readable detail when the phase did not run successfully.
    pub detail: Option<String>,
}

impl PhaseExecution {
    fn skipped() -> Self {
        PhaseExecution {
            ran: false,
            success: true,
            stdout: String::new(),
            stderr: String::new(),
            skipped_utilities: Vec::new(),
            detail: None,
        }
    }
}

/// Resolve the `PhaseConfig` for `phase` on `script`.
fn phase_config(script: &Script, phase: ScriptPhase) -> &PhaseConfig {
    match phase {
        ScriptPhase::Before => &script.before_launch,
        ScriptPhase::After => &script.after_launch,
        ScriptPhase::OnExit => &script.on_exit,
    }
}

/// Infer the run kind + interpreter implied by an external path's extension.
fn classify_path(path: &str) -> (RunKind, Option<Interpreter>) {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "ps1" => (RunKind::PowerShell, Some(Interpreter::Powershell)),
        "bat" | "cmd" => (RunKind::Batch, Some(Interpreter::Batch)),
        "exe" => (RunKind::Executable, None),
        // Unknown extensions default to PowerShell, the project's primary shell.
        _ => (RunKind::PowerShell, Some(Interpreter::Powershell)),
    }
}

/// The run kind + interpreter for an entry's phase config.
fn classify_phase(config: &PhaseConfig) -> Option<(RunKind, Option<Interpreter>)> {
    match config.mode {
        PhaseMode::None => None,
        PhaseMode::Inline => match config.interpreter {
            Some(Interpreter::Powershell) => Some((RunKind::PowerShell, Some(Interpreter::Powershell))),
            Some(Interpreter::Powershell7) => {
                Some((RunKind::PowerShell, Some(Interpreter::Powershell7)))
            }
            Some(Interpreter::Batch) => Some((RunKind::Batch, Some(Interpreter::Batch))),
            // Inline with no interpreter defaults to PowerShell.
            None => Some((RunKind::PowerShell, Some(Interpreter::Powershell))),
        },
        PhaseMode::Path => config
            .path
            .as_deref()
            .filter(|p| !p.trim().is_empty())
            .map(classify_path),
    }
}

/// Compute the transitive required utilities in dependency order (dependencies
/// before dependents), de-duplicated. Missing/cyclic edges are skipped safely.
fn ordered_required_utilities<'a>(
    script: &Script,
    scripts_by_id: &'a HashMap<i64, Script>,
) -> Vec<&'a Script> {
    fn visit<'a>(
        id: i64,
        scripts_by_id: &'a HashMap<i64, Script>,
        visited: &mut HashSet<i64>,
        out: &mut Vec<&'a Script>,
    ) {
        if !visited.insert(id) {
            return;
        }
        let Some(util) = scripts_by_id.get(&id) else {
            return;
        };
        if util.kind != ScriptKind::Utility {
            return;
        }
        for dep in &util.requires {
            visit(*dep, scripts_by_id, visited, out);
        }
        out.push(util);
    }

    let mut visited = HashSet::new();
    let mut out = Vec::new();
    for dep in &script.requires {
        visit(*dep, scripts_by_id, &mut visited, &mut out);
    }
    out
}

/// Whether `a` and `b` can be sourced into the same combined script. PowerShell
/// 5.1 and PowerShell 7 share identical sourcing syntax, so utilities authored
/// for either can be sourced into either host; batch is its own family.
fn source_compatible(a: Interpreter, b: Interpreter) -> bool {
    use Interpreter::{Batch, Powershell, Powershell7};
    matches!(
        (a, b),
        (Powershell | Powershell7, Powershell | Powershell7) | (Batch, Batch)
    )
}

/// Build a sourcing line / inlined block for one utility under `interpreter`.
///
/// Returns `None` when the utility's snippet cannot be sourced under
/// `interpreter` (mode `none`, or interpreter family mismatch).
fn source_utility(util: &Script, interpreter: Interpreter) -> Option<String> {
    let snippet = &util.snippet;
    match snippet.mode {
        PhaseMode::None => None,
        PhaseMode::Inline => {
            let snippet_interpreter = snippet.interpreter.unwrap_or(Interpreter::Powershell);
            if !source_compatible(snippet_interpreter, interpreter) {
                return None;
            }
            snippet.inline.clone()
        }
        PhaseMode::Path => {
            let path = snippet.path.as_deref().filter(|p| !p.trim().is_empty())?;
            let (_, snippet_interpreter) = classify_path(path);
            if !snippet_interpreter.is_some_and(|s| source_compatible(s, interpreter)) {
                return None;
            }
            match interpreter {
                Interpreter::Powershell | Interpreter::Powershell7 => Some(format!(". \"{path}\"")),
                Interpreter::Batch => Some(format!("call \"{path}\"")),
            }
        }
    }
}

/// The body of the entry's own phase code under `interpreter`.
fn entry_body(config: &PhaseConfig, interpreter: Interpreter) -> String {
    match config.mode {
        PhaseMode::Inline => config.inline.clone().unwrap_or_default(),
        PhaseMode::Path => {
            let path = config.path.clone().unwrap_or_default();
            match interpreter {
                Interpreter::Powershell | Interpreter::Powershell7 => format!(". \"{path}\""),
                Interpreter::Batch => format!("call \"{path}\""),
            }
        }
        PhaseMode::None => String::new(),
    }
}

/// Build the combined script body, collecting skipped-utility names.
fn build_combined(
    script: &Script,
    config: &PhaseConfig,
    interpreter: Interpreter,
    scripts_by_id: &HashMap<i64, Script>,
) -> (String, Vec<String>) {
    let mut parts = Vec::new();
    let mut skipped = Vec::new();
    for util in ordered_required_utilities(script, scripts_by_id) {
        match source_utility(util, interpreter) {
            Some(block) => parts.push(block),
            None => skipped.push(util.name.clone()),
        }
    }
    parts.push(entry_body(config, interpreter));
    let separator = match interpreter {
        Interpreter::Powershell | Interpreter::Powershell7 => "\n",
        Interpreter::Batch => "\r\n",
    };
    (parts.join(separator), skipped)
}

/// Spawn `command`, capture stdout/stderr, and fold into a [`PhaseExecution`].
async fn run_command(mut command: Command, skipped: Vec<String>) -> PhaseExecution {
    match command.output().await {
        Ok(output) => {
            let success = output.status.success();
            PhaseExecution {
                ran: true,
                success,
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                skipped_utilities: skipped,
                detail: if success {
                    None
                } else {
                    Some(format!("exited with {}", output.status))
                },
            }
        }
        Err(err) => PhaseExecution {
            ran: true,
            success: false,
            stdout: String::new(),
            stderr: err.to_string(),
            skipped_utilities: skipped,
            detail: Some(format!("spawn failed: {err}")),
        },
    }
}

/// Write `body` to a uniquely-named temp file with `extension`; return its path.
fn write_temp_script(body: &str, extension: &str) -> std::io::Result<std::path::PathBuf> {
    use std::io::Write;
    let unique = format!(
        "gm-launch-{}-{}.{extension}",
        std::process::id(),
        // A monotonic-ish suffix avoids collisions across rapid invocations.
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let path = std::env::temp_dir().join(unique);
    let mut file = std::fs::File::create(&path)?;
    file.write_all(body.as_bytes())?;
    Ok(path)
}

/// Execute one entry phase, sourcing required utilities first. Best-effort: a
/// `none` phase is a no-op; spawn/exit failures are reported, never panicked.
pub async fn execute_phase(
    script: &Script,
    phase: ScriptPhase,
    scripts_by_id: &HashMap<i64, Script>,
) -> PhaseExecution {
    let config = phase_config(script, phase).clone();
    let Some((run_kind, interpreter)) = classify_phase(&config) else {
        return PhaseExecution::skipped();
    };

    // Native executable: spawn directly; combining/utility sourcing N/A.
    if run_kind == RunKind::Executable {
        let path = config.path.clone().unwrap_or_default();
        let skipped: Vec<String> = ordered_required_utilities(script, scripts_by_id)
            .into_iter()
            .map(|u| u.name.clone())
            .collect();
        let mut command = Command::new(path);
        apply_no_window(&mut command);
        return run_command(command, skipped).await;
    }

    let interpreter = interpreter.unwrap_or(Interpreter::Powershell);
    let (body, skipped) = build_combined(script, &config, interpreter, scripts_by_id);

    let mut command = match interpreter {
        Interpreter::Powershell | Interpreter::Powershell7 => {
            let path = match write_temp_script(&body, "ps1") {
                Ok(path) => path,
                Err(err) => return temp_write_failure(err, skipped),
            };
            let exe = match interpreter {
                Interpreter::Powershell7 => "pwsh.exe",
                _ => "powershell.exe",
            };
            let mut command = Command::new(exe);
            command
                .arg("-NoProfile")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-File")
                .arg(&path);
            command
        }
        Interpreter::Batch => {
            let path = match write_temp_script(&body, "bat") {
                Ok(path) => path,
                Err(err) => return temp_write_failure(err, skipped),
            };
            let mut command = Command::new("cmd.exe");
            command.arg("/c").arg(&path);
            command
        }
    };
    apply_no_window(&mut command);
    run_command(command, skipped).await
}

/// Build a [`PhaseExecution`] for a temp-file write failure.
fn temp_write_failure(err: std::io::Error, skipped: Vec<String>) -> PhaseExecution {
    PhaseExecution {
        ran: true,
        success: false,
        stdout: String::new(),
        stderr: err.to_string(),
        skipped_utilities: skipped,
        detail: Some(format!("temp script write failed: {err}")),
    }
}

/// Apply platform process-creation flags (hide the console window on Windows).
#[cfg(windows)]
fn apply_no_window(command: &mut Command) {
    // CREATE_NO_WINDOW so launched shells do not flash a console. `creation_flags`
    // is an inherent method on tokio's Windows `Command`.
    command.creation_flags(0x0800_0000);
}

/// No-op on non-Windows hosts (tests run cross-platform).
#[cfg(not(windows))]
fn apply_no_window(_command: &mut Command) {}

// Re-export the run-kind classifier for tests that assert on path inference.
#[doc(hidden)]
pub fn classify_external_path(path: &str) -> &'static str {
    match classify_path(path).0 {
        RunKind::PowerShell => "powershell",
        RunKind::Batch => "batch",
        RunKind::Executable => "executable",
    }
}
