//! Map records for the Loot Journal and its overlay (table `loot_map_runs`, migration 0011).
//!
//! Not a second map tracker: an `auto` record points at a map instance Session Intelligence detected
//! from Client.txt (session + area id + seed); its time is read from `play_area_visits` (time inside
//! the instance, portals back to the hideout excluded). A `manual` record is the user's own
//! Start / Pause / Finish, used when they prefer it or detection isn't available; while one is open,
//! automatic records are not created.
//!
//! Captures are assigned to a map only when that is reliable: copied inside the open auto map's
//! instance, or while the user's own manual map is running (not paused). A copy in the hideout after
//! a map is NOT assigned automatically; the user can assign it.

use super::SessionContext;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRun {
    pub id: i64,
    pub session_id: Option<i64>,
    pub source: String,
    pub area_id: Option<String>,
    pub area_name: Option<String>,
    pub area_level: Option<i64>,
    pub seed: Option<i64>,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub status: String,
    pub strategy: Option<String>,
    pub notes: Option<String>,
    pub user_confirmed: bool,
    /// Time in the map so far (auto: inside the instance; manual: minus pauses).
    pub duration_secs: i64,
    /// When set, the duration is still counting from this moment (the UI adds `now - runningSince`).
    pub running_since: Option<i64>,
    /// 1-based position among the session's map records (manual records without a session: among all).
    pub ordinal: i64,
    /// Captures assigned to this map.
    pub items: i64,
    pub quantity: i64,
    pub item_types: i64,
    /// Sum of known values (game base unit).
    pub value: f64,
    pub unpriced: i64,
    pub best_item_id: Option<i64>,
    pub best_item_name: Option<String>,
    pub best_item_value: Option<f64>,
    pub best_item_icon: Option<String>,
}

const RUN_COLS: &str = "r.id, r.session_id, r.source, r.area_id, r.area_name, r.area_level, r.seed, r.started_at, r.ended_at, r.status, r.strategy, r.notes, \
    r.user_confirmed, r.paused_at, r.paused_secs,
    (SELECT COUNT(*) FROM loot_items i WHERE i.map_run_id = r.id),
    (SELECT COALESCE(SUM(COALESCE(i.stack_size, 1)), 0) FROM loot_items i WHERE i.map_run_id = r.id),
    (SELECT COUNT(DISTINCT COALESCE(i.item_name, '') || '|' || i.base_type) FROM loot_items i WHERE i.map_run_id = r.id),
    (SELECT COALESCE(SUM(i.value_total), 0) FROM loot_items i WHERE i.map_run_id = r.id AND i.value_status IN ('priced', 'manual')),
    (SELECT COUNT(*) FROM loot_items i WHERE i.map_run_id = r.id AND (i.value_status NOT IN ('priced', 'manual') OR i.value_total IS NULL)),
    (SELECT json_array(i.id, COALESCE(i.item_name, i.base_type), i.value_total, i.icon) FROM loot_items i
       WHERE i.map_run_id = r.id AND i.value_status IN ('priced', 'manual') AND i.value_total IS NOT NULL ORDER BY i.value_total DESC LIMIT 1)";

struct Raw {
    run: MapRun,
    paused_at: Option<i64>,
    paused_secs: i64,
}

fn raw_row(r: &Row<'_>) -> rusqlite::Result<Raw> {
    let best: Option<String> = r.get(20)?;
    let best: Option<serde_json::Value> = best.and_then(|s| serde_json::from_str(&s).ok());
    let b = |k: usize| best.as_ref().and_then(|v| v.get(k)).cloned();
    Ok(Raw {
        run: MapRun {
            id: r.get(0)?,
            session_id: r.get(1)?,
            source: r.get(2)?,
            area_id: r.get(3)?,
            area_name: r.get(4)?,
            area_level: r.get(5)?,
            seed: r.get(6)?,
            started_at: r.get(7)?,
            ended_at: r.get(8)?,
            status: r.get(9)?,
            strategy: r.get(10)?,
            notes: r.get(11)?,
            user_confirmed: r.get::<_, i64>(12)? == 1,
            duration_secs: 0,
            running_since: None,
            ordinal: 0,
            items: r.get(15)?,
            quantity: r.get(16)?,
            item_types: r.get(17)?,
            value: r.get(18)?,
            unpriced: r.get(19)?,
            best_item_id: b(0).and_then(|v| v.as_i64()),
            best_item_name: b(1).and_then(|v| v.as_str().map(str::to_owned)),
            best_item_value: b(2).and_then(|v| v.as_f64()),
            best_item_icon: b(3).and_then(|v| v.as_str().map(str::to_owned)),
        },
        paused_at: r.get(13)?,
        paused_secs: r.get(14)?,
    })
}

/// Fills duration, the running clock and the ordinal.
fn finish_row(conn: &Connection, raw: Raw, now: i64) -> AppResult<MapRun> {
    let mut run = raw.run;
    if run.source == "auto" {
        let (Some(session), Some(area)) = (run.session_id, run.area_id.clone()) else {
            run.duration_secs = (run.ended_at.unwrap_or(now) - run.started_at).max(0);
            return Ok(run);
        };
        // Visits of this instance; an open visit counts only while the session is still active.
        let (closed, open_since): (i64, Option<i64>) = conn.query_row(
            "SELECT COALESCE(SUM(CASE WHEN v.exited_at IS NOT NULL THEN v.exited_at - v.entered_at ELSE 0 END), 0),
                    MAX(CASE WHEN v.exited_at IS NULL AND s.status = 'active' THEN v.entered_at END)
             FROM play_area_visits v JOIN play_sessions s ON s.id = v.session_id
             WHERE v.session_id = ?1 AND v.area_id = ?2 AND v.seed IS ?3 AND v.kind = 'map'",
            params![session, area, run.seed],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        run.duration_secs = closed.max(0) + open_since.map(|t| (now - t).max(0)).unwrap_or(0);
        run.running_since = open_since.filter(|_| run.status == "active").map(|_| now - run.duration_secs);
    } else {
        let end = run.ended_at.or(raw.paused_at).unwrap_or(now);
        run.duration_secs = (end - run.started_at - raw.paused_secs).max(0);
        run.running_since = (run.status == "active").then(|| now - run.duration_secs);
    }
    run.ordinal = conn.query_row(
        "SELECT COUNT(*) FROM loot_map_runs WHERE game = (SELECT game FROM loot_map_runs WHERE id = ?1)
           AND session_id IS (SELECT session_id FROM loot_map_runs WHERE id = ?1)
           AND (started_at < ?2 OR (started_at = ?2 AND id <= ?1))",
        params![run.id, run.started_at],
        |r| r.get(0),
    )?;
    Ok(run)
}

pub fn get(conn: &Connection, game: GameId, id: i64, now: i64) -> AppResult<Option<MapRun>> {
    let raw = conn
        .query_row(&format!("SELECT {RUN_COLS} FROM loot_map_runs r WHERE r.game = ?1 AND r.id = ?2"), params![game.as_str(), id], raw_row)
        .optional()?;
    raw.map(|r| finish_row(conn, r, now)).transpose()
}

/// The open (active or paused) map record, if any.
pub fn open_run(conn: &Connection, game: GameId, now: i64) -> AppResult<Option<MapRun>> {
    let raw = conn
        .query_row(
            &format!("SELECT {RUN_COLS} FROM loot_map_runs r WHERE r.game = ?1 AND r.status IN ('active', 'paused')"),
            params![game.as_str()],
            raw_row,
        )
        .optional()?;
    raw.map(|r| finish_row(conn, r, now)).transpose()
}

/// Newest first; `session_id` narrows to one session.
pub fn list(conn: &Connection, game: GameId, session_id: Option<i64>, limit: i64, now: i64) -> AppResult<Vec<MapRun>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {RUN_COLS} FROM loot_map_runs r WHERE r.game = ?1 AND (?2 IS NULL OR r.session_id = ?2) ORDER BY r.started_at DESC, r.id DESC LIMIT ?3"
    ))?;
    let raws: Vec<Raw> = stmt.query_map(params![game.as_str(), session_id, limit.clamp(1, 5000)], raw_row)?.collect::<Result<_, _>>()?;
    raws.into_iter().map(|r| finish_row(conn, r, now)).collect()
}

fn instance_end(conn: &Connection, session: i64, area: &str, seed: Option<i64>, fallback: i64) -> AppResult<i64> {
    let end: Option<i64> = conn.query_row(
        "SELECT MAX(COALESCE(exited_at, entered_at)) FROM play_area_visits WHERE session_id = ?1 AND area_id = ?2 AND seed IS ?3 AND kind = 'map'",
        params![session, area, seed],
        |r| r.get(0),
    )?;
    Ok(end.unwrap_or(fallback))
}

fn close(conn: &Connection, run: &MapRun, now: i64) -> AppResult<()> {
    let end = match (&run.source[..], run.session_id, &run.area_id) {
        ("auto", Some(s), Some(a)) => instance_end(conn, s, a, run.seed, now)?,
        _ => now,
    }
    .max(run.started_at);
    conn.execute(
        "UPDATE loot_map_runs SET status = 'finished', ended_at = ?2,
            paused_secs = paused_secs + CASE WHEN paused_at IS NOT NULL THEN MAX(0, ?2 - paused_at) ELSE 0 END, paused_at = NULL
         WHERE id = ?1",
        params![run.id, end],
    )?;
    Ok(())
}

fn in_map(ctx: &SessionContext) -> bool {
    ctx.area_kind.as_deref() == Some("map") && ctx.area_id.is_some() && ctx.in_area
}

/// Follows Session Intelligence: opens an auto record when a map instance is entered, closes the
/// previous one when another map is entered or the session ends. A manual record suspends this.
/// Returns true when something changed.
pub fn sync(conn: &Connection, game: GameId, ctx: Option<&SessionContext>, now: i64) -> AppResult<bool> {
    let open = open_run(conn, game, now)?;
    if open.as_ref().is_some_and(|o| o.source == "manual") {
        return Ok(false);
    }
    let Some(c) = ctx else {
        if let Some(o) = open {
            close(conn, &o, now)?;
            return Ok(true);
        }
        return Ok(false);
    };
    if !in_map(c) {
        // Portals to the hideout keep the map open; a different session closes it.
        if let Some(o) = open.filter(|o| o.session_id != Some(c.session_id)) {
            close(conn, &o, now)?;
            return Ok(true);
        }
        return Ok(false);
    }
    let area = c.area_id.as_deref().unwrap_or_default();
    let existing: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, status FROM loot_map_runs WHERE game = ?1 AND source = 'auto' AND session_id = ?2 AND area_id = ?3 AND seed IS ?4",
            params![game.as_str(), c.session_id, area, c.seed],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let (Some(o), Some((id, _))) = (&open, &existing) {
        if o.id == *id {
            return Ok(false);
        }
    }
    if let Some(o) = &open {
        close(conn, o, now)?;
    }
    match existing {
        Some((id, _)) => {
            conn.execute("UPDATE loot_map_runs SET status = 'active', ended_at = NULL WHERE id = ?1", params![id])?;
        }
        None => {
            let started: i64 = conn
                .query_row(
                    "SELECT MIN(entered_at) FROM play_area_visits WHERE session_id = ?1 AND area_id = ?2 AND seed IS ?3 AND kind = 'map'",
                    params![c.session_id, area, c.seed],
                    |r| r.get::<_, Option<i64>>(0),
                )?
                .or(c.area_entered_at)
                .unwrap_or(now);
            conn.execute(
                "INSERT INTO loot_map_runs (game, session_id, source, area_id, area_name, area_level, seed, started_at, status, created_at)
                 VALUES (?1, ?2, 'auto', ?3, ?4, ?5, ?6, ?7, 'active', ?8)",
                params![game.as_str(), c.session_id, area, c.area_name, c.area_level, c.seed, started, now],
            )?;
        }
    }
    Ok(true)
}

/// The map a capture made now belongs to, when that is reliable (see module docs).
pub fn map_for_capture(conn: &Connection, game: GameId, ctx: Option<&SessionContext>, now: i64) -> AppResult<Option<i64>> {
    let Some(o) = open_run(conn, game, now)? else { return Ok(None) };
    if o.source == "manual" {
        return Ok((o.status == "active").then_some(o.id));
    }
    Ok(ctx
        .filter(|c| in_map(c) && Some(c.session_id) == o.session_id && c.area_id == o.area_id && c.seed == o.seed)
        .map(|_| o.id))
}

/// Starts a manual map. An open automatic record is closed first; an open manual one is an error.
pub fn start_manual(conn: &Connection, game: GameId, ctx: Option<&SessionContext>, name: Option<&str>, now: i64) -> AppResult<i64> {
    if let Some(o) = open_run(conn, game, now)? {
        if o.source == "manual" {
            return Err(AppError::InvalidInput("A manual map is already running. Finish it first.".into()));
        }
        close(conn, &o, now)?;
    }
    let name = name.map(str::trim).filter(|s| !s.is_empty()).map(|s| s.chars().take(80).collect::<String>());
    let area_name = name.or_else(|| ctx.filter(|c| in_map(c)).and_then(|c| c.area_name.clone()));
    conn.execute(
        "INSERT INTO loot_map_runs (game, session_id, source, area_name, area_level, started_at, status, created_at)
         VALUES (?1, ?2, 'manual', ?3, ?4, ?5, 'active', ?5)",
        params![game.as_str(), ctx.map(|c| c.session_id), area_name, ctx.filter(|c| in_map(c)).and_then(|c| c.area_level), now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Pause / resume a manual map.
pub fn set_paused(conn: &Connection, game: GameId, id: i64, paused: bool, now: i64) -> AppResult<()> {
    let n = if paused {
        conn.execute(
            "UPDATE loot_map_runs SET status = 'paused', paused_at = ?3 WHERE game = ?1 AND id = ?2 AND source = 'manual' AND status = 'active'",
            params![game.as_str(), id, now],
        )?
    } else {
        conn.execute(
            "UPDATE loot_map_runs SET status = 'active', paused_secs = paused_secs + MAX(0, ?3 - paused_at), paused_at = NULL
             WHERE game = ?1 AND id = ?2 AND source = 'manual' AND status = 'paused'",
            params![game.as_str(), id, now],
        )?
    };
    if n == 0 {
        return Err(AppError::InvalidInput("Only a running manual map can be paused, and only a paused one resumed.".into()));
    }
    Ok(())
}

/// Finishes an open map (manual, or an automatic one the user ends early).
pub fn finish(conn: &Connection, game: GameId, id: i64, now: i64) -> AppResult<()> {
    let Some(run) = get(conn, game, id, now)? else { return Err(AppError::InvalidInput("Map not found.".into())) };
    if run.status == "finished" {
        return Ok(());
    }
    close(conn, &run, now)
}

#[allow(dead_code)] // offered by the UI; kept here as the reference list
pub const STRATEGIES: &[&str] = &["General Mapping", "Breach", "Expedition", "Delirium", "Ritual", "Abyss", "Boss Rush", "Custom"];

/// User fields of a map record (strategy label, notes, "I checked this").
pub fn edit(conn: &Connection, game: GameId, id: i64, strategy: Option<&str>, notes: Option<&str>, confirmed: Option<bool>) -> AppResult<()> {
    if let Some(s) = strategy.filter(|s| !s.is_empty()) {
        if s.chars().count() > 40 {
            return Err(AppError::InvalidInput("Strategy labels are at most 40 characters.".into()));
        }
    }
    let n = conn.execute(
        "UPDATE loot_map_runs SET strategy = CASE WHEN ?3 IS NULL THEN strategy WHEN ?3 = '' THEN NULL ELSE ?3 END,
            notes = CASE WHEN ?4 IS NULL THEN notes WHEN ?4 = '' THEN NULL ELSE ?4 END, user_confirmed = COALESCE(?5, user_confirmed)
         WHERE game = ?1 AND id = ?2",
        params![game.as_str(), id, strategy, notes.map(|n| n.chars().take(2000).collect::<String>()), confirmed.map(|b| b as i64)],
    )?;
    if n == 0 {
        return Err(AppError::InvalidInput("Map not found.".into()));
    }
    Ok(())
}

/// Deletes a map record; its captures stay (unassigned).
pub fn delete(conn: &Connection, game: GameId, id: i64) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM loot_map_runs WHERE game = ?1 AND id = ?2", params![game.as_str(), id])?)
}

/// Assigns captures to a map (`None` = unassign). Marked as the user's choice.
pub fn assign(conn: &Connection, game: GameId, item_ids: &[i64], map_id: Option<i64>) -> AppResult<usize> {
    if let Some(m) = map_id {
        let ok: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM loot_map_runs WHERE game = ?1 AND id = ?2)", params![game.as_str(), m], |r| r.get(0))?;
        if !ok {
            return Err(AppError::InvalidInput("Map not found.".into()));
        }
    }
    let mut n = 0;
    for id in item_ids {
        n += conn.execute(
            "UPDATE loot_items SET map_run_id = ?3, map_assignment = CASE WHEN ?3 IS NULL THEN NULL ELSE 'user' END WHERE game = ?1 AND id = ?2",
            params![game.as_str(), id, map_id],
        )?;
    }
    Ok(n)
}

/// One-time (idempotent) import of map instances Session Intelligence recorded before map records
/// existed, as finished auto records; captures copied inside such an instance are linked to it.
pub fn backfill(conn: &Connection, game: GameId, now: i64) -> AppResult<usize> {
    let created = conn.execute(
        "INSERT INTO loot_map_runs (game, session_id, source, area_id, area_name, area_level, seed, started_at, ended_at, status, created_at)
         SELECT v.game, v.session_id, 'auto', v.area_id, MAX(v.area_name), MAX(v.area_level), v.seed, MIN(v.entered_at),
                MAX(COALESCE(v.exited_at, v.entered_at)), 'finished', ?2
         FROM play_area_visits v JOIN play_sessions s ON s.id = v.session_id
         WHERE v.game = ?1 AND v.kind = 'map' AND v.seed IS NOT NULL AND s.status = 'completed'
           AND NOT EXISTS (SELECT 1 FROM loot_map_runs r WHERE r.game = v.game AND r.source = 'auto' AND r.session_id = v.session_id
                           AND r.area_id = v.area_id AND r.seed IS v.seed)
         GROUP BY v.session_id, v.area_id, v.seed",
        params![game.as_str(), now],
    )?;
    conn.execute(
        "UPDATE loot_items SET map_assignment = 'auto', map_run_id = (
            SELECT r.id FROM play_area_visits v JOIN loot_map_runs r
              ON r.game = v.game AND r.source = 'auto' AND r.session_id = v.session_id AND r.area_id = v.area_id AND r.seed IS v.seed
            WHERE v.session_id = loot_items.session_id AND v.kind = 'map'
              AND loot_items.captured_at >= v.entered_at AND loot_items.captured_at < COALESCE(v.exited_at, loot_items.captured_at + 1)
            ORDER BY v.entered_at DESC LIMIT 1)
         WHERE game = ?1 AND map_run_id IS NULL AND map_assignment IS NULL AND session_id IS NOT NULL AND capture_area_kind = 'map'",
        params![game.as_str()],
    )?;
    conn.execute("UPDATE loot_items SET map_assignment = NULL WHERE game = ?1 AND map_run_id IS NULL AND map_assignment = 'auto'", params![game.as_str()])?;
    Ok(created)
}

/// Captures of one session (all of them, in maps or not).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub items: i64,
    pub quantity: i64,
    pub item_types: i64,
    pub value: f64,
    pub unpriced: i64,
}

pub fn session_totals(conn: &Connection, game: GameId, session_id: i64) -> AppResult<Totals> {
    Ok(conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(COALESCE(stack_size, 1)), 0), COUNT(DISTINCT COALESCE(item_name, '') || '|' || base_type),
                COALESCE(SUM(CASE WHEN value_status IN ('priced', 'manual') THEN value_total END), 0),
                COALESCE(SUM(CASE WHEN value_status NOT IN ('priced', 'manual') OR value_total IS NULL THEN 1 ELSE 0 END), 0)
         FROM loot_items WHERE game = ?1 AND session_id = ?2",
        params![game.as_str(), session_id],
        |r| Ok(Totals { items: r.get(0)?, quantity: r.get(1)?, item_types: r.get(2)?, value: r.get(3)?, unpriced: r.get(4)? }),
    )?)
}

/// Captures since a moment (the user's "Reset session"), across game sessions.
pub fn totals_since(conn: &Connection, game: GameId, since: i64) -> AppResult<Totals> {
    Ok(conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(COALESCE(stack_size, 1)), 0), COUNT(DISTINCT COALESCE(item_name, '') || '|' || base_type),
                COALESCE(SUM(CASE WHEN value_status IN ('priced', 'manual') THEN value_total END), 0),
                COALESCE(SUM(CASE WHEN value_status NOT IN ('priced', 'manual') OR value_total IS NULL THEN 1 ELSE 0 END), 0)
         FROM loot_items WHERE game = ?1 AND captured_at >= ?2",
        params![game.as_str(), since],
        |r| Ok(Totals { items: r.get(0)?, quantity: r.get(1)?, item_types: r.get(2)?, value: r.get(3)?, unpriced: r.get(4)? }),
    )?)
}

/// Map records finished since a moment.
pub fn finished_since(conn: &Connection, game: GameId, since: i64) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM loot_map_runs WHERE game = ?1 AND status = 'finished' AND ended_at >= ?2",
        params![game.as_str(), since],
        |r| r.get(0),
    )?)
}

/// The most recent map record that started at or after a moment.
pub fn latest_since(conn: &Connection, game: GameId, since: i64, now: i64) -> AppResult<Option<MapRun>> {
    let raw = conn
        .query_row(
            &format!("SELECT {RUN_COLS} FROM loot_map_runs r WHERE r.game = ?1 AND r.started_at >= ?2 ORDER BY r.started_at DESC, r.id DESC LIMIT 1"),
            params![game.as_str(), since],
            raw_row,
        )
        .optional()?;
    raw.map(|r| finish_row(conn, r, now)).transpose()
}

/// Finished map records of a session.
pub fn finished_in_session(conn: &Connection, game: GameId, session_id: i64) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM loot_map_runs WHERE game = ?1 AND session_id = ?2 AND status = 'finished'",
        params![game.as_str(), session_id],
        |r| r.get(0),
    )?)
}

/// Overall counts for the Overview.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub maps: i64,
    pub sessions: i64,
}

pub fn counts(conn: &Connection, game: GameId) -> AppResult<Counts> {
    Ok(conn.query_row(
        "SELECT (SELECT COUNT(*) FROM loot_map_runs WHERE game = ?1), (SELECT COUNT(*) FROM play_sessions WHERE game = ?1)",
        params![game.as_str()],
        |r| Ok(Counts { maps: r.get(0)?, sessions: r.get(1)? }),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    const G: GameId = GameId::Poe2;

    fn db() -> Database {
        Database::open_in_memory().unwrap()
    }

    fn session(c: &Connection, id: i64, status: &str) {
        c.execute(
            "INSERT INTO play_sessions (id, game, started_at, last_activity_at, status, created_at) VALUES (?1, 'poe2', 1000, 1000, ?2, 0)",
            params![id, status],
        )
        .unwrap();
    }

    fn visit(c: &Connection, sid: i64, area: &str, seed: i64, kind: &str, entered: i64, exited: Option<i64>) {
        c.execute(
            "INSERT INTO play_area_visits (session_id, game, area_id, area_name, area_level, seed, kind, entered_at, exited_at, log_key, log_offset)
             VALUES (?1, 'poe2', ?2, ?2, 79, ?3, ?4, ?5, ?6, 'k', ?5)",
            params![sid, area, seed, kind, entered, exited],
        )
        .unwrap();
    }

    fn ctx(sid: i64, area: &str, seed: i64, kind: &str, entered: i64) -> SessionContext {
        SessionContext {
            session_id: sid,
            started_at: 1000,
            area_name: Some(area.into()),
            area_kind: Some(kind.into()),
            area_id: Some(area.into()),
            area_level: Some(79),
            seed: Some(seed),
            area_entered_at: Some(entered),
            in_area: true,
        }
    }

    fn item(c: &Connection, at: i64, sid: Option<i64>, kind: Option<&str>, map: Option<i64>, value: Option<f64>, stack: i64) -> i64 {
        c.execute(
            "INSERT INTO loot_items (game, fingerprint, raw_text, item_class, rarity, base_type, category, stack_size, parser_confidence, captured_at,
                last_captured_at, source, session_id, capture_area_kind, map_run_id, map_assignment, value_status, value_total)
             VALUES ('poe2', ?1, 'x', 'Stackable Currency', 'Currency', 'Exalted Orb', 'currency', ?2, 'high', ?3, ?3, 'clipboard', ?4, ?5, ?6,
                CASE WHEN ?6 IS NULL THEN NULL ELSE 'auto' END, CASE WHEN ?7 IS NULL THEN 'no_market_data' ELSE 'priced' END, ?7)",
            params![format!("fp{at}"), stack, at, sid, kind, map, value],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    #[test]
    fn follows_session_intelligence_without_a_second_timer() {
        let db = db();
        let c = db.conn().unwrap();
        session(&c, 1, "active");
        visit(&c, 1, "MapA", 11, "map", 2000, Some(2300)); // 300 s
        visit(&c, 1, "Hideout", 1, "hideout", 2300, Some(2400));
        visit(&c, 1, "MapA", 11, "map", 2400, None); // back through the portal
        assert!(sync(&c, G, Some(&ctx(1, "MapA", 11, "map", 2400)), 2500).unwrap());
        assert!(!sync(&c, G, Some(&ctx(1, "MapA", 11, "map", 2400)), 2510).unwrap(), "no change, no write");
        let open = open_run(&c, G, 2500).unwrap().unwrap();
        assert_eq!((open.source.as_str(), open.started_at, open.duration_secs, open.ordinal), ("auto", 2000, 400, 1));
        assert_eq!(open.running_since, Some(2100), "clock = time inside the instance, hideout excluded");

        // In the hideout the map stays open (but captures there aren't assigned to it).
        let mut hideout = ctx(1, "Hideout", 1, "hideout", 2600);
        hideout.area_kind = Some("hideout".into());
        assert!(!sync(&c, G, Some(&hideout), 2600).unwrap());
        assert_eq!(map_for_capture(&c, G, Some(&hideout), 2600).unwrap(), None);
        assert_eq!(map_for_capture(&c, G, Some(&ctx(1, "MapA", 11, "map", 2400)), 2600).unwrap(), Some(open.id));

        // A different map closes the first one at its last exit.
        c.execute("UPDATE play_area_visits SET exited_at = 2550 WHERE area_id = 'MapA' AND exited_at IS NULL", []).unwrap();
        visit(&c, 1, "MapB", 22, "map", 2700, None);
        assert!(sync(&c, G, Some(&ctx(1, "MapB", 22, "map", 2700)), 2710).unwrap());
        let a = get(&c, G, open.id, 2710).unwrap().unwrap();
        assert_eq!((a.status.as_str(), a.ended_at, a.duration_secs, a.running_since), ("finished", Some(2550), 450, None));
        let b = open_run(&c, G, 2710).unwrap().unwrap();
        assert_eq!((b.area_id.as_deref(), b.ordinal), (Some("MapB"), 2));

        // The session ends → the open map closes.
        assert!(sync(&c, G, None, 2800).unwrap());
        assert!(open_run(&c, G, 2800).unwrap().is_none());
        assert_eq!(counts(&c, G).unwrap().maps, 2);
    }

    #[test]
    fn manual_maps_pause_resume_finish_and_suspend_automatic_records() {
        let db = db();
        let c = db.conn().unwrap();
        session(&c, 1, "active");
        visit(&c, 1, "MapA", 11, "map", 2000, None);
        sync(&c, G, Some(&ctx(1, "MapA", 11, "map", 2000)), 2010).unwrap();
        let id = start_manual(&c, G, Some(&ctx(1, "MapA", 11, "map", 2000)), Some("  Breach run "), 2100).unwrap();
        assert!(start_manual(&c, G, None, None, 2101).is_err(), "one manual map at a time");
        let m = open_run(&c, G, 2100).unwrap().unwrap();
        assert_eq!((m.id, m.source.as_str(), m.area_name.as_deref()), (id, "manual", Some("Breach run")));
        assert_eq!(get(&c, G, 1, 2100).unwrap().unwrap().status, "finished", "the automatic record was closed");
        // While a manual map is open, sync doesn't create automatic records.
        visit(&c, 1, "MapB", 22, "map", 2150, None);
        assert!(!sync(&c, G, Some(&ctx(1, "MapB", 22, "map", 2150)), 2160).unwrap());
        assert_eq!(map_for_capture(&c, G, None, 2160).unwrap(), Some(id), "a running manual map takes captures anywhere");

        set_paused(&c, G, id, true, 2200).unwrap();
        assert_eq!(map_for_capture(&c, G, None, 2250).unwrap(), None, "not while paused");
        assert_eq!(get(&c, G, id, 2400).unwrap().unwrap().duration_secs, 100, "paused time doesn't count");
        assert!(set_paused(&c, G, id, true, 2300).is_err());
        set_paused(&c, G, id, false, 2400).unwrap();
        finish(&c, G, id, 2500).unwrap();
        let m = get(&c, G, id, 9999).unwrap().unwrap();
        assert_eq!((m.status.as_str(), m.duration_secs, m.running_since), ("finished", 200, None));
        finish(&c, G, id, 2600).unwrap();
        assert_eq!(get(&c, G, id, 9999).unwrap().unwrap().ended_at, Some(2500), "finishing twice changes nothing");
    }

    #[test]
    fn totals_assignment_backfill_and_game_isolation() {
        let db = db();
        let c = db.conn().unwrap();
        session(&c, 1, "completed");
        visit(&c, 1, "MapA", 11, "map", 2000, Some(2300));
        visit(&c, 1, "Hideout", 1, "hideout", 2300, Some(2400));
        let inside = item(&c, 2100, Some(1), Some("map"), None, Some(3.0), 3);
        let in_hideout = item(&c, 2350, Some(1), Some("hideout"), None, None, 1);
        assert_eq!(backfill(&c, G, 5000).unwrap(), 1);
        assert_eq!(backfill(&c, G, 5001).unwrap(), 0, "idempotent");
        let runs = list(&c, G, None, 10, 5000).unwrap();
        assert_eq!(runs.len(), 1);
        let r = runs[0].clone();
        assert_eq!((r.items, r.quantity, r.value, r.unpriced, r.duration_secs), (1, 3, 3.0, 0, 300));
        assert_eq!(r.best_item_id, Some(inside));
        // The user assigns the hideout copy, then unassigns it.
        assign(&c, G, &[in_hideout], Some(r.id)).unwrap();
        let r2 = get(&c, G, r.id, 5000).unwrap().unwrap();
        assert_eq!((r2.items, r2.unpriced, r2.item_types), (2, 1, 1));
        let how: String = c.query_row("SELECT map_assignment FROM loot_items WHERE id = ?1", [in_hideout], |x| x.get(0)).unwrap();
        assert_eq!(how, "user");
        assign(&c, G, &[in_hideout], None).unwrap();
        assert!(assign(&c, G, &[in_hideout], Some(999)).is_err());
        assert!(list(&c, GameId::Poe1, None, 10, 5000).unwrap().is_empty(), "game isolation");
        edit(&c, G, r.id, Some("Breach"), Some("good map"), Some(true)).unwrap();
        let r3 = get(&c, G, r.id, 5000).unwrap().unwrap();
        assert_eq!((r3.strategy.as_deref(), r3.notes.as_deref(), r3.user_confirmed), (Some("Breach"), Some("good map"), true));
        edit(&c, G, r.id, Some(""), None, None).unwrap();
        assert_eq!(get(&c, G, r.id, 5000).unwrap().unwrap().strategy, None);
        // Deleting a map keeps its captures.
        delete(&c, G, r.id).unwrap();
        let left: i64 = c.query_row("SELECT COUNT(*) FROM loot_items WHERE map_run_id IS NULL", [], |x| x.get(0)).unwrap();
        assert_eq!(left, 2);
    }
}
