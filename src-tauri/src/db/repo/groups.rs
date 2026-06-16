//! Groups repository.
//!
//! Read/write helpers returning [`Group`] domain structs, including the assigned
//! script ids and member game ids.

use rusqlite::{params, Connection};

use crate::domain::Group;
use crate::error::{AppError, AppResult};

/// Fields required to create or update a group.
#[derive(Debug, Clone)]
pub struct NewGroup {
    /// Display name.
    pub name: String,
    /// Optional description.
    pub description: Option<String>,
}

fn script_ids(conn: &Connection, group_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt =
        conn.prepare("SELECT script_id FROM group_scripts WHERE group_id = ?1 ORDER BY script_id")?;
    super::collect_ids(&mut stmt, params![group_id])
}

fn game_ids(conn: &Connection, group_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt =
        conn.prepare("SELECT game_id FROM game_groups WHERE group_id = ?1 ORDER BY game_id")?;
    super::collect_ids(&mut stmt, params![group_id])
}

fn hydrate(
    conn: &Connection,
    id: i64,
    name: String,
    description: Option<String>,
) -> AppResult<Group> {
    Ok(Group {
        id,
        name,
        description,
        script_ids: script_ids(conn, id)?,
        game_ids: game_ids(conn, id)?,
    })
}

/// Insert a new group and return its assigned id.
pub fn create(conn: &Connection, group: &NewGroup) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO groups (name, description) VALUES (?1, ?2)",
        params![group.name, group.description],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Update a group's name/description. Returns whether a row changed.
pub fn update(conn: &Connection, id: i64, group: &NewGroup) -> AppResult<bool> {
    let changed = conn.execute(
        "UPDATE groups SET name = ?2, description = ?3 WHERE id = ?1",
        params![id, group.name, group.description],
    )?;
    Ok(changed > 0)
}

/// Delete a group by id (cascades junctions). Returns whether it existed.
pub fn delete(conn: &Connection, id: i64) -> AppResult<bool> {
    let changed = conn.execute("DELETE FROM groups WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

/// Replace the set of scripts assigned to a group.
pub fn set_scripts(conn: &Connection, group_id: i64, script_ids: &[i64]) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM group_scripts WHERE group_id = ?1",
        params![group_id],
    )?;
    for script_id in script_ids {
        tx.execute(
            "INSERT INTO group_scripts (group_id, script_id) VALUES (?1, ?2)",
            params![group_id, script_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Replace the set of games that belong to a group.
pub fn set_games(conn: &Connection, group_id: i64, game_ids: &[i64]) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM game_groups WHERE group_id = ?1",
        params![group_id],
    )?;
    for game_id in game_ids {
        tx.execute(
            "INSERT INTO game_groups (game_id, group_id) VALUES (?1, ?2)",
            params![game_id, group_id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// List all groups (with assigned scripts + member games) ordered by name.
pub fn list(conn: &Connection) -> AppResult<Vec<Group>> {
    let mut stmt =
        conn.prepare("SELECT id, name, description FROM groups ORDER BY name COLLATE NOCASE")?;
    let raw = super::collect_rows(&mut stmt, [], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut groups = Vec::new();
    for (id, name, description) in raw {
        groups.push(hydrate(conn, id, name, description)?);
    }
    Ok(groups)
}

/// Fetch a single group by id.
pub fn get(conn: &Connection, id: i64) -> AppResult<Group> {
    let mut stmt = conn.prepare("SELECT id, name, description FROM groups WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    match rows.next() {
        Some(row) => {
            let (id, name, description) = row?;
            hydrate(conn, id, name, description)
        }
        None => Err(AppError::database(format!("group {id} not found"))),
    }
}
