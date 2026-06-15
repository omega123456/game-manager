use std::collections::{BTreeSet, HashMap, HashSet};

use rusqlite::Connection;

use crate::db::repo::{games, groups, scripts};
use crate::domain::{Provenance, ResolvedScript, Script, ScriptKind, ScriptPhase};
use crate::error::{AppError, AppResult};

#[derive(Clone)]
struct CandidateEntry {
    script: Script,
    provenance: Provenance,
    group_name: Option<String>,
}

fn precedence(provenance: Provenance) -> i32 {
    match provenance {
        Provenance::Direct => 3,
        Provenance::Group => 2,
        Provenance::Global => 1,
    }
}

fn phase_enabled(script: &Script, phase: ScriptPhase) -> bool {
    match phase {
        ScriptPhase::Before => script.before_launch.mode != crate::domain::PhaseMode::None,
        ScriptPhase::After => script.after_launch.mode != crate::domain::PhaseMode::None,
        ScriptPhase::OnExit => script.on_exit.mode != crate::domain::PhaseMode::None,
    }
}

fn collect_required_utility_names(
    script: &Script,
    scripts_by_id: &HashMap<i64, Script>,
) -> AppResult<Vec<String>> {
    fn visit(
        script_id: i64,
        scripts_by_id: &HashMap<i64, Script>,
        names: &mut BTreeSet<String>,
        visited: &mut HashSet<i64>,
    ) -> AppResult<()> {
        if !visited.insert(script_id) {
            return Ok(());
        }

        let script = scripts_by_id
            .get(&script_id)
            .ok_or_else(|| AppError::database(format!("script {script_id} not found during resolve")))?;

        if script.kind != ScriptKind::Utility {
            return Err(AppError::database(format!(
                "script {script_id} is not a utility dependency during resolve"
            )));
        }

        names.insert(script.name.clone());
        for dependency_id in &script.requires {
            visit(*dependency_id, scripts_by_id, names, visited)?;
        }
        Ok(())
    }

    let mut names = BTreeSet::new();
    let mut visited = HashSet::new();
    for dependency_id in &script.requires {
        visit(*dependency_id, scripts_by_id, &mut names, &mut visited)?;
    }
    Ok(names.into_iter().collect())
}

fn sorted_phase_entries(
    entries: Vec<CandidateEntry>,
    phase: ScriptPhase,
    scripts_by_id: &HashMap<i64, Script>,
) -> AppResult<Vec<ResolvedScript>> {
    let mut filtered = entries
        .into_iter()
        .filter(|entry| phase_enabled(&entry.script, phase))
        .collect::<Vec<_>>();

    filtered.sort_by(|left, right| {
        right
            .script
            .priority
            .cmp(&left.script.priority)
            .then_with(|| left.script.name.to_lowercase().cmp(&right.script.name.to_lowercase()))
            .then_with(|| left.script.name.cmp(&right.script.name))
    });

    filtered
        .into_iter()
        .enumerate()
        .map(|(index, entry)| {
            Ok(ResolvedScript {
                script_id: entry.script.id,
                name: entry.script.name.clone(),
                priority: entry.script.priority,
                phase,
                provenance: entry.provenance,
                group_name: entry.group_name,
                order: (index + 1) as i64,
                required_utility_names: collect_required_utility_names(&entry.script, scripts_by_id)?,
            })
        })
        .collect()
}

pub fn resolve_for_game(conn: &Connection, game_id: i64) -> AppResult<Vec<ResolvedScript>> {
    let _game = games::get(conn, game_id)?;
    let all_scripts = scripts::list(conn)?;
    let groups_for_game = games::group_ids(conn, game_id)?
        .into_iter()
        .map(|group_id| groups::get(conn, group_id))
        .collect::<AppResult<Vec<_>>>()?;

    let scripts_by_id = all_scripts
        .iter()
        .cloned()
        .map(|script| (script.id, script))
        .collect::<HashMap<_, _>>();

    let mut by_script_id: HashMap<i64, CandidateEntry> = HashMap::new();

    for script_id in games::script_ids(conn, game_id)? {
        let script = scripts_by_id
            .get(&script_id)
            .ok_or_else(|| AppError::database(format!("script {script_id} not found during resolve")))?;
        if script.kind == ScriptKind::Normal {
            by_script_id.insert(
                script_id,
                CandidateEntry {
                    script: script.clone(),
                    provenance: Provenance::Direct,
                    group_name: None,
                },
            );
        }
    }

    for group in &groups_for_game {
        for script_id in &group.script_ids {
            let script = scripts_by_id
                .get(script_id)
                .ok_or_else(|| AppError::database(format!("script {script_id} not found during resolve")))?;
            if script.kind != ScriptKind::Normal {
                continue;
            }
            let next = CandidateEntry {
                script: script.clone(),
                provenance: Provenance::Group,
                group_name: Some(group.name.clone()),
            };
            match by_script_id.get(script_id) {
                Some(existing) if precedence(existing.provenance) >= precedence(next.provenance) => {}
                _ => {
                    by_script_id.insert(*script_id, next);
                }
            }
        }
    }

    for script in all_scripts.iter().filter(|script| script.kind == ScriptKind::Global) {
        let next = CandidateEntry {
            script: script.clone(),
            provenance: Provenance::Global,
            group_name: None,
        };
        match by_script_id.get(&script.id) {
            Some(existing) if precedence(existing.provenance) >= precedence(next.provenance) => {}
            _ => {
                by_script_id.insert(script.id, next);
            }
        }
    }

    let entries = by_script_id.into_values().collect::<Vec<_>>();
    let mut resolved = Vec::new();
    resolved.extend(sorted_phase_entries(entries.clone(), ScriptPhase::Before, &scripts_by_id)?);
    resolved.extend(sorted_phase_entries(entries.clone(), ScriptPhase::After, &scripts_by_id)?);
    resolved.extend(sorted_phase_entries(entries, ScriptPhase::OnExit, &scripts_by_id)?);
    Ok(resolved)
}
