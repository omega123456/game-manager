//! Install-state commands (`recheck_installs`) and the install checks used by
//! game create/update and by `launch_game`.
//!
//! A game only flips to "not installed" when its launch target is missing on two
//! probes separated by a grace delay, so a drive that is still waking up or a
//! target that is briefly locked does not hide the game. The grace delay is a
//! parameter of every `*_impl` so tests can pass `Duration::ZERO`.

use std::time::Duration;

use crate::db::repo::games::{self, InstallTarget, InstallUpdate};
use crate::domain::{InstallRecheckSummary, MissingReason};
use crate::error::{AppError, AppResult};
use crate::install::{classify_target, install_root, probe_target, Probe, TargetKind};
use crate::state::AppState;

/// Delay between the first missed probe and the confirming re-probe.
pub const INSTALL_GRACE: Duration = Duration::from_millis(1500);

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Probe every target, then re-probe the misses once after `grace`.
fn probe_with_grace(state: &AppState, targets: &[InstallTarget], grace: Duration) -> Vec<Probe> {
    let probe = state.install_probe();
    let mut results: Vec<Probe> = targets
        .iter()
        .map(|target| probe_target(probe, &target.launch_target))
        .collect();
    if results
        .iter()
        .any(|result| result.missing_reason().is_some())
    {
        if !grace.is_zero() {
            std::thread::sleep(grace);
        }
        for (target, result) in targets.iter().zip(results.iter_mut()) {
            if result.missing_reason().is_some() {
                *result = probe_target(probe, &target.launch_target);
            }
        }
    }
    results
}

/// The write a probe result calls for, or `None` when the state must be kept.
fn install_update(target: &InstallTarget, probe: Probe, seen_at: &str) -> Option<InstallUpdate> {
    let seen_at = match probe {
        Probe::Unverifiable => return None,
        Probe::Present if classify_target(&target.launch_target) == TargetKind::FilesystemPath => {
            Some(seen_at.to_string())
        }
        _ => None,
    };
    Some(InstallUpdate {
        id: target.id,
        launch_target: target.launch_target.clone(),
        missing_reason: probe.missing_reason(),
        seen_at,
    })
}

/// Apply `updates`, dropping DLSS detection for games that are now missing.
/// Returns the ids that were actually written (a relinked game is skipped).
fn apply_updates(state: &AppState, updates: &[InstallUpdate]) -> AppResult<Vec<i64>> {
    let written = state.with_db(|conn| games::apply_install_statuses(conn, updates))?;
    for update in updates {
        if update.missing_reason.is_some() && written.contains(&update.id) {
            state.dlss_detection_remove(update.id);
        }
    }
    Ok(written)
}

/// Re-check every game's launch target and store the results.
pub fn recheck_installs_impl(
    state: &AppState,
    grace: Duration,
) -> AppResult<InstallRecheckSummary> {
    let targets = state.with_db(games::install_targets)?;
    let probes = probe_with_grace(state, &targets, grace);
    let seen_at = now_rfc3339();

    let mut summary = InstallRecheckSummary {
        checked: targets.len(),
        ..InstallRecheckSummary::default()
    };
    let mut pending = Vec::new();
    for (target, probe) in targets.iter().zip(probes) {
        match install_update(target, probe, &seen_at) {
            Some(update) => pending.push((target, update)),
            None if target.missing_reason.is_some() => summary.missing_game_ids.push(target.id),
            None => {}
        }
    }

    let updates: Vec<InstallUpdate> = pending.iter().map(|(_, update)| update.clone()).collect();
    let written = apply_updates(state, &updates)?;

    for (target, update) in &pending {
        if !written.contains(&update.id) {
            continue;
        }
        if update.missing_reason.is_some() {
            summary.missing_game_ids.push(update.id);
        }
        if update.missing_reason != target.missing_reason {
            summary.changed_game_ids.push(update.id);
            if update.missing_reason.is_none() {
                summary.restored_game_ids.push(update.id);
            }
        }
    }
    summary.missing_game_ids.sort_unstable();
    Ok(summary)
}

fn find_target(state: &AppState, game_id: i64) -> AppResult<InstallTarget> {
    state
        .with_db(|conn| games::install_target(conn, game_id))?
        .ok_or_else(|| AppError::other(format!("game {game_id} not found")))
}

/// The user-facing error for launching a game whose target is missing.
fn not_installed_message(target: &InstallTarget, reason: MissingReason) -> String {
    match (reason, install_root(&target.launch_target)) {
        (MissingReason::DriveMissing, Some(root)) => format!(
            "{} isn't installed: drive {} isn't connected.",
            target.name,
            root.trim_end_matches('\\')
        ),
        _ => format!(
            "{} isn't installed: launch target not found ({}).",
            target.name, target.launch_target
        ),
    }
}

/// Check a game's launch target right before launching it.
///
/// Stores the result either way. Returns an error naming the problem when the
/// target is still missing after the grace re-probe.
pub fn ensure_launchable_impl(state: &AppState, game_id: i64, grace: Duration) -> AppResult<()> {
    let target = find_target(state, game_id)?;
    let probe = probe_with_grace(state, std::slice::from_ref(&target), grace)[0];
    if let Some(update) = install_update(&target, probe, &now_rfc3339()) {
        apply_updates(state, &[update])?;
    }
    match probe.missing_reason() {
        Some(reason) => Err(AppError::other(not_installed_message(&target, reason))),
        None => Ok(()),
    }
}

/// Probe a game's launch target once, without a grace delay, and store the
/// result. Used after the user sets a new launch target.
///
/// UNC targets are not probed here because a stat on an unreachable share can
/// block for seconds; they are optimistically marked installed and verified by
/// the next [`recheck_installs_impl`].
pub fn check_install_now_impl(state: &AppState, game_id: i64) -> AppResult<()> {
    let target = find_target(state, game_id)?;
    let update = if install_root(&target.launch_target).is_some_and(|root| root.starts_with("\\\\"))
    {
        Some(InstallUpdate {
            id: target.id,
            launch_target: target.launch_target.clone(),
            missing_reason: None,
            seen_at: None,
        })
    } else {
        let probe = probe_target(state.install_probe(), &target.launch_target);
        install_update(&target, probe, &now_rfc3339())
    };
    if let Some(update) = update {
        apply_updates(state, &[update])?;
    }
    Ok(())
}

/// Re-check every game's launch target off the main thread, then rescan DLSS
/// for games that came back so their pills reappear immediately.
#[cfg(not(coverage))]
#[tauri::command]
pub async fn recheck_installs(app: tauri::AppHandle) -> AppResult<InstallRecheckSummary> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;

        let state = app.state::<AppState>();
        let summary = recheck_installs_impl(&state, INSTALL_GRACE)?;
        for game_id in &summary.restored_game_ids {
            if let Err(err) = crate::dlss::detect::scan_game_impl(&state, *game_id) {
                tracing::warn!(
                    category = "dlss",
                    game_id = *game_id,
                    "DLSS scan of reinstalled game failed: {err}"
                );
            }
        }
        Ok(summary)
    })
    .await
    .map_err(|err| AppError::other(format!("install recheck task failed: {err}")))?
}
