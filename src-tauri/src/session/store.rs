//! SQLite access for Session Intelligence (tables from 0006_sessions.sql).
//! Every query is scoped by `game`. Functions take a `Connection` so callers
//! can group several writes in one transaction.

use crate::error::{AppError, AppResult};
use crate::game::GameId;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: i64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub last_activity_at: i64,
    pub status: String,
    pub end_reason: Option<String>,
    /// False when Client.txt couldn't be read: area/map figures are unknown, not zero.
    pub log_tracked: bool,
    pub duration_secs: i64,
    pub maps_entered: i64,
    pub areas_entered: i64,
    pub map_secs: i64,
    pub hideout_secs: i64,
    pub town_secs: i64,
    pub campaign_secs: i64,
    pub content_secs: i64,
    pub unknown_secs: i64,
    pub loading_secs: i64,
    pub afk_secs: i64,
    pub deaths: i64,
    pub level_ups: i64,
    #[serde(skip)]
    pub process_id: Option<u32>,
    #[serde(skip)]
    pub process_started_at: Option<i64>,
}

const SUMMARY_COLS: &str = "id, started_at, ended_at, last_activity_at, status, end_reason, log_tracked, maps_entered, areas_entered, map_secs, \
    hideout_secs, town_secs, campaign_secs, content_secs, unknown_secs, loading_secs, afk_secs, deaths, level_ups, process_id, process_started_at";

fn summary_row(r: &Row<'_>) -> rusqlite::Result<SessionSummary> {
    let started_at: i64 = r.get(1)?;
    let ended_at: Option<i64> = r.get(2)?;
    let last: i64 = r.get(3)?;
    Ok(SessionSummary {
        id: r.get(0)?,
        started_at,
        ended_at,
        last_activity_at: last,
        status: r.get(4)?,
        end_reason: r.get(5)?,
        log_tracked: r.get::<_, i64>(6)? == 1,
        duration_secs: (ended_at.unwrap_or(last) - started_at).max(0),
        maps_entered: r.get(7)?,
        areas_entered: r.get(8)?,
        map_secs: r.get(9)?,
        hideout_secs: r.get(10)?,
        town_secs: r.get(11)?,
        campaign_secs: r.get(12)?,
        content_secs: r.get(13)?,
        unknown_secs: r.get(14)?,
        loading_secs: r.get(15)?,
        afk_secs: r.get(16)?,
        deaths: r.get(17)?,
        level_ups: r.get(18)?,
        process_id: r.get::<_, Option<i64>>(19)?.map(|v| v as u32),
        process_started_at: r.get(20)?,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisitRow {
    pub id: i64,
    pub area_id: String,
    pub area_name: Option<String>,
    pub area_level: Option<i64>,
    pub seed: Option<i64>,
    pub kind: String,
    pub entered_at: i64,
    pub exited_at: Option<i64>,
    pub loading_secs: Option<f64>,
}

fn visit_row(r: &Row<'_>) -> rusqlite::Result<VisitRow> {
    Ok(VisitRow {
        id: r.get(0)?,
        area_id: r.get(1)?,
        area_name: r.get(2)?,
        area_level: r.get(3)?,
        seed: r.get(4)?,
        kind: r.get(5)?,
        entered_at: r.get(6)?,
        exited_at: r.get(7)?,
        loading_secs: r.get(8)?,
    })
}
const VISIT_COLS: &str = "id, area_id, area_name, area_level, seed, kind, entered_at, exited_at, loading_secs";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub id: i64,
    pub at: i64,
    pub kind: String,
    pub detail: Option<String>,
}

/// One map instance (same area id + seed), possibly entered several times.
/// `completed` is always `None`: Client.txt has no verified "map completed" line.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapRun {
    pub area_id: String,
    pub area_name: Option<String>,
    pub area_level: Option<i64>,
    pub first_entered_at: i64,
    pub last_exited_at: Option<i64>,
    pub entries: i64,
    pub inside_secs: i64,
    pub completed: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub summary: SessionSummary,
    pub visits: Vec<VisitRow>,
    pub events: Vec<EventRow>,
    pub map_runs: Vec<MapRun>,
}

// ---------- tracker state ----------

#[derive(Debug, Clone, Default, PartialEq)]
pub struct TrackerState {
    pub log_path: Option<String>,
    pub log_key: Option<String>,
    pub log_offset: u64,
    pub last_line_at: Option<i64>,
}

pub fn tracker_state(conn: &Connection, game: GameId) -> AppResult<TrackerState> {
    Ok(conn
        .query_row(
            "SELECT log_path, log_key, log_offset, last_line_at FROM play_tracker_state WHERE game = ?1",
            params![game.as_str()],
            |r| Ok(TrackerState { log_path: r.get(0)?, log_key: r.get(1)?, log_offset: r.get::<_, i64>(2)?.max(0) as u64, last_line_at: r.get(3)? }),
        )
        .optional()?
        .unwrap_or_default())
}

pub fn save_position(conn: &Connection, game: GameId, key: Option<&str>, offset: u64, last_line_at: Option<i64>, now: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO play_tracker_state (game, log_key, log_offset, last_line_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(game) DO UPDATE SET log_key = excluded.log_key, log_offset = excluded.log_offset,
           last_line_at = COALESCE(excluded.last_line_at, play_tracker_state.last_line_at), updated_at = excluded.updated_at",
        params![game.as_str(), key, offset as i64, last_line_at, now],
    )?;
    Ok(())
}

/// Sets (or clears) the manual log path; resets the reader position.
pub fn set_log_path(conn: &Connection, game: GameId, path: Option<&str>, now: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO play_tracker_state (game, log_path, log_key, log_offset, updated_at) VALUES (?1, ?2, NULL, 0, ?3)
         ON CONFLICT(game) DO UPDATE SET log_path = excluded.log_path, log_key = NULL, log_offset = 0, last_line_at = NULL, updated_at = excluded.updated_at",
        params![game.as_str(), path, now],
    )?;
    Ok(())
}

// ---------- sessions ----------

pub fn active_session(conn: &Connection, game: GameId) -> AppResult<Option<SessionSummary>> {
    Ok(conn
        .query_row(&format!("SELECT {SUMMARY_COLS} FROM play_sessions WHERE game = ?1 AND status = 'active'"), params![game.as_str()], summary_row)
        .optional()?)
}

pub fn get_session(conn: &Connection, game: GameId, id: i64) -> AppResult<Option<SessionSummary>> {
    Ok(conn
        .query_row(&format!("SELECT {SUMMARY_COLS} FROM play_sessions WHERE game = ?1 AND id = ?2"), params![game.as_str(), id], summary_row)
        .optional()?)
}

pub fn create_session(conn: &Connection, game: GameId, started_at: i64, pid: Option<u32>, process_started_at: Option<i64>, log_tracked: bool, now: i64) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO play_sessions (game, started_at, last_activity_at, status, process_id, process_started_at, log_tracked, created_at)
         VALUES (?1, ?2, ?2, 'active', ?3, ?4, ?5, ?6)",
        params![game.as_str(), started_at, pid.map(|p| p as i64), process_started_at, log_tracked as i64, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn set_log_tracked(conn: &Connection, session_id: i64) -> AppResult<()> {
    conn.execute("UPDATE play_sessions SET log_tracked = 1 WHERE id = ?1", params![session_id])?;
    Ok(())
}

pub fn touch(conn: &Connection, session_id: i64, at: i64) -> AppResult<()> {
    conn.execute("UPDATE play_sessions SET last_activity_at = MAX(last_activity_at, ?2) WHERE id = ?1", params![session_id, at])?;
    Ok(())
}

pub fn finish(conn: &Connection, session_id: i64, ended_at: i64, reason: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE play_area_visits SET exited_at = MAX(entered_at, ?2) WHERE session_id = ?1 AND exited_at IS NULL",
        params![session_id, ended_at],
    )?;
    conn.execute(
        "UPDATE play_sessions SET status = 'completed', end_reason = ?3, ended_at = MAX(started_at, ?2), last_activity_at = MAX(started_at, ?2) WHERE id = ?1",
        params![session_id, ended_at, reason],
    )?;
    recompute(conn, session_id)
}

// ---------- visits & events ----------

pub fn open_visit(conn: &Connection, session_id: i64) -> AppResult<Option<VisitRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {VISIT_COLS} FROM play_area_visits WHERE session_id = ?1 AND exited_at IS NULL ORDER BY entered_at DESC, id DESC LIMIT 1"),
            params![session_id],
            visit_row,
        )
        .optional()?)
}

pub fn last_visit(conn: &Connection, session_id: i64) -> AppResult<Option<VisitRow>> {
    Ok(conn
        .query_row(&format!("SELECT {VISIT_COLS} FROM play_area_visits WHERE session_id = ?1 ORDER BY entered_at DESC, id DESC LIMIT 1"), params![session_id], visit_row)
        .optional()?)
}

pub struct NewVisit<'a> {
    pub area_id: &'a str,
    pub area_level: u32,
    pub seed: u64,
    pub kind: &'a str,
    pub at: i64,
    pub log_key: &'a str,
    pub log_offset: u64,
}

/// Closes the open visit and opens a new one. Returns `None` when this log line
/// was already recorded (duplicate).
pub fn enter_area(conn: &Connection, game: GameId, session_id: i64, v: &NewVisit<'_>) -> AppResult<Option<i64>> {
    let dup: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM play_area_visits WHERE session_id = ?1 AND log_key = ?2 AND log_offset = ?3)",
        params![session_id, v.log_key, v.log_offset as i64],
        |r| r.get(0),
    )?;
    if dup {
        return Ok(None);
    }
    conn.execute(
        "UPDATE play_area_visits SET exited_at = MAX(entered_at, ?2) WHERE session_id = ?1 AND exited_at IS NULL",
        params![session_id, v.at],
    )?;
    conn.execute(
        "INSERT INTO play_area_visits (session_id, game, area_id, area_level, seed, kind, entered_at, log_key, log_offset)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![session_id, game.as_str(), v.area_id, v.area_level as i64, v.seed as i64, v.kind, v.at, v.log_key, v.log_offset as i64],
    )?;
    Ok(Some(conn.last_insert_rowid()))
}

pub fn name_visit(conn: &Connection, visit_id: i64, name: &str) -> AppResult<()> {
    conn.execute("UPDATE play_area_visits SET area_name = ?2 WHERE id = ?1 AND area_name IS NULL", params![visit_id, name])?;
    Ok(())
}

pub fn set_visit_loading(conn: &Connection, visit_id: i64, secs: f64) -> AppResult<()> {
    conn.execute("UPDATE play_area_visits SET loading_secs = ?2 WHERE id = ?1 AND loading_secs IS NULL", params![visit_id, secs])?;
    Ok(())
}

/// Inserts an event; duplicates of the same log line are ignored. Returns true if inserted.
pub fn insert_event(conn: &Connection, game: GameId, session_id: i64, at: i64, kind: &str, detail: Option<&str>, log_pos: Option<(&str, u64)>) -> AppResult<bool> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO play_session_events (session_id, game, at, kind, detail, log_key, log_offset) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![session_id, game.as_str(), at, kind, detail, log_pos.map(|p| p.0), log_pos.map(|p| p.1 as i64)],
    )?;
    Ok(n > 0)
}

/// Recomputes the summary columns of a session from its visits and events.
pub fn recompute(conn: &Connection, session_id: i64) -> AppResult<()> {
    let (end_ref, status): (i64, String) = conn.query_row(
        "SELECT COALESCE(ended_at, last_activity_at), status FROM play_sessions WHERE id = ?1",
        params![session_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let _ = status;
    let mut by_kind = std::collections::HashMap::<String, i64>::new();
    let mut stmt = conn.prepare(
        "SELECT kind, SUM(MAX(0, COALESCE(exited_at, MAX(entered_at, ?2)) - entered_at)) FROM play_area_visits WHERE session_id = ?1 GROUP BY kind",
    )?;
    for row in stmt.query_map(params![session_id, end_ref], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))? {
        let (k, v) = row?;
        by_kind.insert(k, v);
    }
    let (areas, maps, loading): (i64, i64, f64) = conn.query_row(
        "SELECT COUNT(*),
                COUNT(DISTINCT CASE WHEN kind = 'map' THEN area_id || ':' || COALESCE(seed, id) END),
                COALESCE(SUM(loading_secs), 0)
         FROM play_area_visits WHERE session_id = ?1",
        params![session_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let (deaths, levels): (i64, i64) = conn.query_row(
        "SELECT COUNT(CASE WHEN kind = 'death' THEN 1 END), COUNT(CASE WHEN kind = 'level_up' THEN 1 END) FROM play_session_events WHERE session_id = ?1",
        params![session_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    // AFK: pair ON/OFF in time order; an open ON lasts until the session's end reference.
    let mut afk = 0i64;
    let mut since: Option<i64> = None;
    let mut ev = conn.prepare("SELECT at, kind FROM play_session_events WHERE session_id = ?1 AND kind IN ('afk_on', 'afk_off') ORDER BY at, id")?;
    for row in ev.query_map(params![session_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
        let (at, kind) = row?;
        match (kind.as_str(), since) {
            ("afk_on", None) => since = Some(at),
            ("afk_off", Some(s)) => {
                afk += (at - s).max(0);
                since = None;
            }
            _ => {}
        }
    }
    if let Some(s) = since {
        afk += (end_ref - s).max(0);
    }
    let k = |name: &str| *by_kind.get(name).unwrap_or(&0);
    conn.execute(
        "UPDATE play_sessions SET maps_entered = ?2, areas_entered = ?3, map_secs = ?4, hideout_secs = ?5, town_secs = ?6, campaign_secs = ?7,
           content_secs = ?8, unknown_secs = ?9, loading_secs = ?10, afk_secs = ?11, deaths = ?12, level_ups = ?13 WHERE id = ?1",
        params![session_id, maps, areas, k("map"), k("hideout"), k("town"), k("campaign"), k("content"), k("unknown"), loading.round() as i64, afk, deaths, levels],
    )?;
    Ok(())
}

// ---------- history queries ----------

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    /// Unix s, inclusive.
    pub from: Option<i64>,
    /// Unix s, exclusive.
    pub to: Option<i64>,
    /// Matches area names/ids visited in the session.
    pub search: Option<String>,
    /// "newest" (default) | "oldest" | "longest" | "shortest" | "most_maps" | "fewest_maps"
    pub sort: Option<String>,
    pub limit: Option<i64>,
}

pub fn list(conn: &Connection, game: GameId, q: &HistoryQuery) -> AppResult<Vec<SessionSummary>> {
    let order = match q.sort.as_deref().unwrap_or("newest") {
        "newest" => "started_at DESC",
        "oldest" => "started_at ASC",
        "longest" => "(COALESCE(ended_at, last_activity_at) - started_at) DESC",
        "shortest" => "(COALESCE(ended_at, last_activity_at) - started_at) ASC",
        "most_maps" => "maps_entered DESC, started_at DESC",
        "fewest_maps" => "maps_entered ASC, started_at DESC",
        _ => return Err(AppError::InvalidInput("Unknown sort order.".into())),
    };
    let search = q.search.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| {
        let esc: String = s.chars().take(80).flat_map(|c| if matches!(c, '%' | '_' | '\\') { vec!['\\', c] } else { vec![c] }).collect();
        format!("%{esc}%")
    });
    let limit = q.limit.unwrap_or(500).clamp(1, 5000);
    let sql = format!(
        "SELECT {SUMMARY_COLS} FROM play_sessions s WHERE game = ?1
           AND (?2 IS NULL OR started_at >= ?2) AND (?3 IS NULL OR started_at < ?3)
           AND (?4 IS NULL OR EXISTS (SELECT 1 FROM play_area_visits v WHERE v.session_id = s.id
                 AND (v.area_name LIKE ?4 ESCAPE '\\' OR v.area_id LIKE ?4 ESCAPE '\\')))
         ORDER BY {order} LIMIT ?5"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![game.as_str(), q.from, q.to, search, limit], summary_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn detail(conn: &Connection, game: GameId, id: i64) -> AppResult<Option<SessionDetail>> {
    let Some(summary) = get_session(conn, game, id)? else { return Ok(None) };
    let mut vs = conn.prepare(&format!("SELECT {VISIT_COLS} FROM play_area_visits WHERE session_id = ?1 AND game = ?2 ORDER BY entered_at, id"))?;
    let visits: Vec<VisitRow> = vs.query_map(params![id, game.as_str()], visit_row)?.collect::<Result<_, _>>()?;
    let mut es = conn.prepare("SELECT id, at, kind, detail FROM play_session_events WHERE session_id = ?1 AND game = ?2 ORDER BY at, id")?;
    let events: Vec<EventRow> = es
        .query_map(params![id, game.as_str()], |r| Ok(EventRow { id: r.get(0)?, at: r.get(1)?, kind: r.get(2)?, detail: r.get(3)? }))?
        .collect::<Result<_, _>>()?;
    let end_ref = summary.ended_at.unwrap_or(summary.last_activity_at);
    let map_runs = map_runs(&visits, end_ref);
    Ok(Some(SessionDetail { summary, visits, events, map_runs }))
}

/// Groups map visits by instance (area id + seed), in order of first entry.
pub fn map_runs(visits: &[VisitRow], end_ref: i64) -> Vec<MapRun> {
    let mut runs: Vec<(String, Option<i64>, MapRun)> = Vec::new();
    for v in visits.iter().filter(|v| v.kind == "map") {
        let exit = v.exited_at.unwrap_or(end_ref.max(v.entered_at));
        let secs = (exit - v.entered_at).max(0);
        if let Some((_, _, run)) = runs.iter_mut().find(|(a, s, _)| *a == v.area_id && *s == v.seed && v.seed.is_some()) {
            run.entries += 1;
            run.inside_secs += secs;
            run.last_exited_at = v.exited_at.or(run.last_exited_at);
            if run.area_name.is_none() {
                run.area_name = v.area_name.clone();
            }
        } else {
            runs.push((
                v.area_id.clone(),
                v.seed,
                MapRun {
                    area_id: v.area_id.clone(),
                    area_name: v.area_name.clone(),
                    area_level: v.area_level,
                    first_entered_at: v.entered_at,
                    last_exited_at: v.exited_at,
                    entries: 1,
                    inside_secs: secs,
                    completed: None,
                },
            ));
        }
    }
    runs.into_iter().map(|r| r.2).collect()
}

pub fn delete(conn: &Connection, game: GameId, ids: &[i64]) -> AppResult<usize> {
    let mut n = 0;
    for id in ids {
        n += conn.execute("DELETE FROM play_sessions WHERE game = ?1 AND id = ?2 AND status = 'completed'", params![game.as_str(), id])?;
    }
    Ok(n)
}

/// Deletes all completed sessions of a game (the active one keeps running).
pub fn delete_all(conn: &Connection, game: GameId) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM play_sessions WHERE game = ?1 AND status = 'completed'", params![game.as_str()])?)
}

pub fn apply_retention(conn: &Connection, game: GameId, days: u32, now: i64) -> AppResult<usize> {
    if days == 0 {
        return Ok(0);
    }
    let cutoff = now - days as i64 * 86_400;
    Ok(conn.execute(
        "DELETE FROM play_sessions WHERE game = ?1 AND status = 'completed' AND COALESCE(ended_at, last_activity_at) < ?2",
        params![game.as_str(), cutoff],
    )?)
}

/// The completed session before `id` (for "compared with the previous session").
pub fn previous_completed(conn: &Connection, game: GameId, started_before: i64) -> AppResult<Option<SessionSummary>> {
    Ok(conn
        .query_row(
            &format!("SELECT {SUMMARY_COLS} FROM play_sessions WHERE game = ?1 AND status = 'completed' AND started_at < ?2 ORDER BY started_at DESC LIMIT 1"),
            params![game.as_str(), started_before],
            summary_row,
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn visit(conn: &Connection, sid: i64, area: &str, kind: &str, seed: u64, at: i64, off: u64) -> Option<i64> {
        enter_area(conn, GameId::Poe2, sid, &NewVisit { area_id: area, area_level: 70, seed, kind, at, log_key: "k", log_offset: off }).unwrap()
    }

    #[test]
    fn summary_counts_map_instances_and_time_by_kind() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        let sid = create_session(&c, GameId::Poe2, 1000, Some(4), Some(1000), true, 1000).unwrap();
        visit(&c, sid, "HideoutShrine", "hideout", 1, 1000, 1);
        visit(&c, sid, "MapAugury", "map", 77, 1100, 2);
        visit(&c, sid, "HideoutShrine", "hideout", 1, 1400, 3);
        visit(&c, sid, "MapAugury", "map", 77, 1500, 4); // same instance re-entered
        visit(&c, sid, "G1_town", "town", 1, 1600, 5);
        visit(&c, sid, "MapBastille", "map", 9, 1700, 6);
        assert_eq!(visit(&c, sid, "MapBastille", "map", 9, 1700, 6), None, "same log line is a duplicate");
        insert_event(&c, GameId::Poe2, sid, 1710, "death", None, Some(("k", 7))).unwrap();
        assert!(!insert_event(&c, GameId::Poe2, sid, 1710, "death", None, Some(("k", 7))).unwrap());
        insert_event(&c, GameId::Poe2, sid, 1720, "afk_on", None, Some(("k", 8))).unwrap();
        insert_event(&c, GameId::Poe2, sid, 1780, "afk_off", None, Some(("k", 9))).unwrap();
        finish(&c, sid, 2000, "game_closed").unwrap();
        let s = get_session(&c, GameId::Poe2, sid).unwrap().unwrap();
        assert_eq!(s.maps_entered, 2, "two instances, one re-entered");
        assert_eq!(s.areas_entered, 6);
        assert_eq!(s.map_secs, 300 + 100 + 300);
        assert_eq!(s.hideout_secs, 100 + 100);
        assert_eq!(s.town_secs, 100);
        assert_eq!(s.deaths, 1);
        assert_eq!(s.afk_secs, 60);
        assert_eq!(s.duration_secs, 1000);
        assert_eq!(s.status, "completed");
        assert!(open_visit(&c, sid).unwrap().is_none());

        let d = detail(&c, GameId::Poe2, sid).unwrap().unwrap();
        assert_eq!(d.map_runs.len(), 2);
        assert_eq!(d.map_runs[0].entries, 2);
        assert_eq!(d.map_runs[0].inside_secs, 400);
        assert_eq!(d.map_runs[0].completed, None, "completion is unavailable from Client.txt");
        assert!(detail(&c, GameId::Poe1, sid).unwrap().is_none(), "game isolation");
    }

    #[test]
    fn only_one_active_session_per_game() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        create_session(&c, GameId::Poe2, 1, None, None, false, 1).unwrap();
        assert!(create_session(&c, GameId::Poe2, 2, None, None, false, 2).is_err());
        create_session(&c, GameId::Poe1, 2, None, None, false, 2).unwrap();
    }

    #[test]
    fn history_filters_sorts_searches_and_deletes() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        for (i, (start, len, map)) in [(1000, 600, "MapAugury"), (5000, 3600, "MapBastille"), (9000, 60, "G1_4")].iter().enumerate() {
            let sid = create_session(&c, GameId::Poe2, *start, None, None, true, 0).unwrap();
            let kind = if map.starts_with("Map") { "map" } else { "campaign" };
            visit(&c, sid, map, kind, i as u64 + 2, *start, i as u64);
            finish(&c, sid, start + len, "game_closed").unwrap();
        }
        let all = list(&c, GameId::Poe2, &HistoryQuery::default()).unwrap();
        assert_eq!(all.iter().map(|s| s.started_at).collect::<Vec<_>>(), vec![9000, 5000, 1000]);
        let longest = list(&c, GameId::Poe2, &HistoryQuery { sort: Some("longest".into()), ..Default::default() }).unwrap();
        assert_eq!(longest[0].started_at, 5000);
        let ranged = list(&c, GameId::Poe2, &HistoryQuery { from: Some(2000), to: Some(9000), ..Default::default() }).unwrap();
        assert_eq!(ranged.len(), 1);
        let searched = list(&c, GameId::Poe2, &HistoryQuery { search: Some("bastille".into()), ..Default::default() }).unwrap();
        assert_eq!(searched.len(), 1);
        let wildcard = list(&c, GameId::Poe2, &HistoryQuery { search: Some("%".into()), ..Default::default() }).unwrap();
        assert!(wildcard.is_empty(), "LIKE wildcards are escaped");
        assert!(list(&c, GameId::Poe2, &HistoryQuery { sort: Some("x; DROP".into()), ..Default::default() }).is_err());
        assert!(list(&c, GameId::Poe1, &HistoryQuery::default()).unwrap().is_empty());
        let prev = previous_completed(&c, GameId::Poe2, 9000).unwrap().unwrap();
        assert_eq!(prev.started_at, 5000);

        let ids: Vec<i64> = all.iter().take(2).map(|s| s.id).collect();
        assert_eq!(delete(&c, GameId::Poe1, &ids).unwrap(), 0, "other game can't delete");
        assert_eq!(delete(&c, GameId::Poe2, &ids).unwrap(), 2);
        let n: i64 = c.query_row("SELECT COUNT(*) FROM play_area_visits", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "visits cascade");
        assert_eq!(apply_retention(&c, GameId::Poe2, 1, 1000 + 600 + 86_401).unwrap(), 1);
    }

    #[test]
    fn tracker_state_round_trip() {
        let db = Database::open_in_memory().unwrap();
        let c = db.conn().unwrap();
        assert_eq!(tracker_state(&c, GameId::Poe2).unwrap(), TrackerState::default());
        save_position(&c, GameId::Poe2, Some("key"), 42, Some(7), 1).unwrap();
        save_position(&c, GameId::Poe2, Some("key"), 50, None, 2).unwrap();
        let s = tracker_state(&c, GameId::Poe2).unwrap();
        assert_eq!((s.log_key.as_deref(), s.log_offset, s.last_line_at), (Some("key"), 50, Some(7)));
        set_log_path(&c, GameId::Poe2, Some("C:/x/Client.txt"), 3).unwrap();
        let s = tracker_state(&c, GameId::Poe2).unwrap();
        assert_eq!((s.log_path.as_deref(), s.log_offset, s.log_key), (Some("C:/x/Client.txt"), 0, None));
        assert!(c.execute("INSERT INTO play_tracker_state (game, updated_at) VALUES ('poe3', 0)", []).is_err());
    }
}
