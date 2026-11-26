//! Deck Intelligence backups: every session is also written as a JSON file in a folder OUTSIDE the
//! app data folder (default `Documents\Vaalytics\Deck Intelligence`), so uninstalling with "delete app
//! data" or losing the database doesn't lose the opening history (it happened, 2026-11-26).
//!
//! - One file per session (`deck-session-<date>-<created_at>-<id>.json`), rewritten after every change;
//!   written to a temporary file first and then renamed, so a crash never leaves half a file.
//! - Deleting a session in Vaalytics moves its file to `deleted/` (never removed by Vaalytics).
//! - "Restore" reads the files back: a session already in the database (same creation and start time —
//!   both never change, unlike the name) is skipped, card entries keep their ids (`source_uid`), so
//!   restoring twice adds nothing.
//! - Screenshots are not part of a backup (they stay in the app data folder).

use crate::db::Database;
use crate::error::{AppError, AppResult};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

pub const FORMAT: u64 = 1;

/// All rows of a query as `{column: value}` objects (the backup keeps every column as stored).
fn rows(c: &Connection, sql: &str, id: i64) -> AppResult<Vec<Value>> {
    let mut st = c.prepare(sql)?;
    let cols: Vec<String> = st.column_names().map(|s| s.to_string()).collect();
    let out = st
        .query_map([id], |r| {
            let mut m = Map::new();
            for (i, name) in cols.iter().enumerate() {
                let v = match r.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => Value::from(n),
                    ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
                    ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
                    ValueRef::Blob(_) => Value::Null,
                };
                m.insert(name.clone(), v);
            }
            Ok(Value::Object(m))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(out)
}

/// The backup document of one session (None when it doesn't exist).
pub fn session_document(c: &Connection, id: i64, now: i64) -> AppResult<Option<Value>> {
    let session = rows(c, "SELECT * FROM deck_sessions WHERE id = ?1 AND game = 'poe1'", id)?;
    let Some(session) = session.into_iter().next() else { return Ok(None) };
    let events = rows(c, "SELECT * FROM deck_events WHERE session_id = ?1 ORDER BY at, id", id)?;
    let valuation = rows(c, "SELECT * FROM deck_valuations WHERE session_id = ?1 AND kind = 'final'", id)?.into_iter().next();
    Ok(Some(serde_json::json!({
        "format": FORMAT,
        "kind": "vaalytics.deck-session",
        "app": env!("CARGO_PKG_VERSION"),
        "exportedAt": now,
        "session": session,
        "events": events,
        "valuation": valuation,
    })))
}

/// Includes the session id: two sessions can be created within the same second (imports).
pub fn file_name(created_at: i64, id: i64) -> String {
    format!("deck-session-{}-{created_at}-{id}.json", super::date_label(created_at))
}

/// Writes (replaces) the session's file. Returns the path, or None when the session doesn't exist.
pub fn write_session(dir: &Path, c: &Connection, id: i64, now: i64) -> AppResult<Option<PathBuf>> {
    let Some(doc) = session_document(c, id, now)? else { return Ok(None) };
    let created_at = doc["session"]["created_at"].as_i64().unwrap_or(0);
    std::fs::create_dir_all(dir)?;
    let path = dir.join(file_name(created_at, id));
    let tmp = dir.join(format!(".{}.tmp", file_name(created_at, id)));
    std::fs::write(&tmp, serde_json::to_vec_pretty(&doc)?)?;
    std::fs::rename(&tmp, &path)?;
    Ok(Some(path))
}

/// Moves a deleted session's file to `deleted/` (kept, never removed by Vaalytics).
pub fn archive(dir: &Path, created_at: i64, id: i64) -> AppResult<()> {
    let name = file_name(created_at, id);
    let from = dir.join(&name);
    if from.exists() {
        let to_dir = dir.join("deleted");
        std::fs::create_dir_all(&to_dir)?;
        std::fs::rename(&from, to_dir.join(&name))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub files: usize,
    pub sessions_added: usize,
    pub sessions_skipped: usize,
    pub cards_added: usize,
    pub errors: Vec<String>,
}

fn sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => n.as_i64().map(SqlValue::Integer).unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

const SESSION_COLS: [&str; 14] =
    ["name", "league", "created_at", "opened_on", "status", "origin", "started_at", "ended_at", "active_secs", "planned_decks", "opened_decks", "acquisition", "cost_total", "notes"];
const EVENT_COLS: [&str; 12] = ["at", "source", "source_uid", "recognized_text", "recognized_card", "confidence", "bbox", "card", "status", "review_reason", "corrected", "corrected_at"];
const VALUATION_COLS: [&str; 7] = ["valued_at", "league", "prices_at", "total_value", "priced_cards", "unpriced_cards", "lines"];

/// Restores one backup document. Ok(None) = already in the database.
fn restore_document(db: &Database, doc: &Value) -> AppResult<Option<usize>> {
    if doc["kind"] != "vaalytics.deck-session" || doc["format"].as_u64().unwrap_or(0) > FORMAT {
        return Err(AppError::InvalidInput("not a Deck Intelligence backup (or from a newer Vaalytics)".into()));
    }
    let s = &doc["session"];
    let name = s["name"].as_str().ok_or_else(|| AppError::InvalidInput("session without a name".into()))?;
    let created_at = s["created_at"].as_i64().ok_or_else(|| AppError::InvalidInput("session without a creation time".into()))?;
    let started_at = s["started_at"].as_i64().ok_or_else(|| AppError::InvalidInput("session without a start time".into()))?;
    let mut c = db.conn()?;
    let tx = c.transaction()?;
    // Same session = same creation and start time AND (a card entry in common, or — without cards — the same
    // name). Two sessions created within one second are still told apart; a renamed session is still found.
    let uids: Vec<String> = doc["events"].as_array().into_iter().flatten().filter_map(|e| e["source_uid"].as_str().map(str::to_owned)).collect();
    let candidates: Vec<(i64, String)> = {
        let mut st = tx.prepare("SELECT id, name FROM deck_sessions WHERE game = 'poe1' AND created_at = ?1 AND started_at = ?2")?;
        let rows = st.query_map(params![created_at, started_at], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
        rows
    };
    for (cid, cname) in candidates {
        let same = if uids.is_empty() {
            cname == name
        } else {
            uids.iter().any(|u| {
                tx.query_row("SELECT 1 FROM deck_events WHERE session_id = ?1 AND source_uid = ?2", params![cid, u], |_| Ok(())).optional().ok().flatten().is_some()
            })
        };
        if same {
            return Ok(None);
        }
    }
    // At most one unfinished session: a restored unfinished one is paused, or finished if another is open.
    let active: bool = tx.query_row("SELECT EXISTS (SELECT 1 FROM deck_sessions WHERE game = 'poe1' AND status IN ('running','paused'))", [], |r| r.get(0))?;
    let mut values: Vec<SqlValue> = SESSION_COLS.iter().map(|k| sql(&s[*k])).collect();
    let status = s["status"].as_str().unwrap_or("finished");
    values[4] = SqlValue::Text(if status == "finished" { "finished" } else if active { "finished" } else { "paused" }.into());
    if !matches!(s["acquisition"].as_str(), Some("individual" | "bulk" | "farmed" | "free" | "unknown")) {
        values[11] = SqlValue::Text("unknown".into());
    }
    if !matches!(s["origin"].as_str(), Some("live" | "import")) {
        values[5] = SqlValue::Text("live".into());
    }
    let cols = SESSION_COLS.join(", ");
    let marks = (2..=SESSION_COLS.len() + 1).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
    let mut p: Vec<SqlValue> = vec![SqlValue::Text("poe1".into())];
    p.extend(values);
    tx.execute(&format!("INSERT INTO deck_sessions (game, {cols}) VALUES (?1, {marks})"), rusqlite::params_from_iter(p))?;
    let id = tx.last_insert_rowid();
    let mut cards = 0;
    for e in doc["events"].as_array().into_iter().flatten() {
        let mut p: Vec<SqlValue> = vec![SqlValue::Integer(id), SqlValue::Text("poe1".into())];
        p.extend(EVENT_COLS.iter().map(|k| sql(&e[*k])));
        let cols = EVENT_COLS.join(", ");
        let marks = (3..=EVENT_COLS.len() + 2).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
        cards += tx.execute(&format!("INSERT OR IGNORE INTO deck_events (session_id, game, {cols}) VALUES (?1, ?2, {marks})"), rusqlite::params_from_iter(p))?;
    }
    if let Some(v) = doc["valuation"].as_object() {
        let v = Value::Object(v.clone());
        let mut p: Vec<SqlValue> = vec![SqlValue::Integer(id)];
        p.extend(VALUATION_COLS.iter().map(|k| sql(&v[*k])));
        let cols = VALUATION_COLS.join(", ");
        let marks = (2..=VALUATION_COLS.len() + 1).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
        tx.execute(&format!("INSERT OR IGNORE INTO deck_valuations (session_id, game, kind, {cols}) VALUES (?1, 'poe1', 'final', {marks})"), rusqlite::params_from_iter(p))?;
    }
    tx.commit()?;
    Ok(Some(cards))
}

/// Restores every backup file in `dir` (not `deleted/`) that isn't in the database yet.
pub fn restore_dir(db: &Database, dir: &Path) -> AppResult<RestoreSummary> {
    let mut out = RestoreSummary::default();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Err(AppError::InvalidInput(format!("The backup folder doesn't exist: {}", dir.display()))),
    };
    let mut files: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "json") && p.file_name().is_some_and(|n| !n.to_string_lossy().starts_with('.'))).collect();
    files.sort();
    for f in files {
        out.files += 1;
        let r = std::fs::read(&f).map_err(AppError::from).and_then(|b| serde_json::from_slice::<Value>(&b).map_err(AppError::from)).and_then(|doc| restore_document(db, &doc));
        match r {
            Ok(Some(n)) => {
                out.sessions_added += 1;
                out.cards_added += n;
            }
            Ok(None) => out.sessions_skipped += 1,
            Err(e) => out.errors.push(format!("{}: {}", f.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(), super::public(&e))),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::super::store;
    use super::*;

    fn seed(db: &Database) -> i64 {
        let input = store::SessionInput { name: "Night".into(), league: Some("Covens".into()), opened_on: None, planned_decks: Some(10), opened_decks: Some(8), acquisition: store::Acquisition::Bulk, cost_total: Some(30.0), notes: Some("ok".into()) };
        let id = store::create(db, input, 1_000, None).unwrap();
        {
            let c = db.conn().unwrap();
            for (i, card) in ["The Lover", "Rain of Chaos", "The Doctor"].iter().enumerate() {
                let e = store::NewEvent {
                    session_id: id,
                    at: 1_000 + i as i64,
                    source: "log",
                    source_uid: format!("log:k:{i}"),
                    capture_id: None,
                    recognized_text: None,
                    recognized_card: None,
                    confidence: 1.0,
                    bbox: None,
                    card: Some(card.to_string()),
                    status: "confirmed",
                    review_reason: None,
                };
                store::insert_event(&c, &e).unwrap();
            }
        }
        let counts = store::session_card_counts(&db.conn().unwrap(), id).unwrap();
        let v = store::build_valuation(&counts, &std::collections::HashMap::from([("The Doctor".into(), 900.0)]), &Default::default(), Some("Covens".into()), Some(1), 2_000);
        store::finish(db, id, 2_000, &v).unwrap();
        id
    }

    #[test]
    fn backup_round_trip_survives_a_lost_database() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let id = seed(&db);
        let path = write_session(dir.path(), &db.conn().unwrap(), id, 3_000).unwrap().unwrap();
        assert_eq!(path.file_name().unwrap().to_string_lossy(), file_name(1_000, id));
        assert!(file_name(1_000, id).starts_with("deck-session-1970-01-01-1000-"));
        assert!(write_session(dir.path(), &db.conn().unwrap(), 999, 3_000).unwrap().is_none());

        // A brand-new database (the old one was deleted).
        let fresh = Database::open_in_memory().unwrap();
        let r = restore_dir(&fresh, dir.path()).unwrap();
        assert_eq!((r.files, r.sessions_added, r.cards_added, r.errors.len()), (1, 1, 3, 0));
        let s = store::summaries(&fresh.conn().unwrap(), 4_000).unwrap();
        assert_eq!(s.len(), 1);
        let s = &s[0];
        assert_eq!((s.session.name.as_str(), s.session.status.as_str(), s.session.opened_decks, s.session.cost_total, s.confirmed), ("Night", "finished", Some(8), Some(30.0), 3));
        assert_eq!(s.valuation.as_ref().unwrap().total_value, 900.0, "original valuation restored");

        // Restoring again adds nothing.
        let again = restore_dir(&fresh, dir.path()).unwrap();
        assert_eq!((again.sessions_added, again.sessions_skipped), (0, 1));
    }

    #[test]
    fn deleted_sessions_are_archived_and_not_restored() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let id = seed(&db);
        write_session(dir.path(), &db.conn().unwrap(), id, 3_000).unwrap();
        archive(dir.path(), 1_000, id).unwrap();
        assert!(dir.path().join("deleted").join(file_name(1_000, id)).exists());
        let fresh = Database::open_in_memory().unwrap();
        assert_eq!(restore_dir(&fresh, dir.path()).unwrap().files, 0);
    }

    #[test]
    fn sessions_created_in_the_same_second_get_their_own_files_and_rename_is_not_a_new_session() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open_in_memory().unwrap();
        let mk = |name: &str| store::SessionInput { name: name.into(), league: None, opened_on: None, planned_decks: None, opened_decks: None, acquisition: store::Acquisition::Unknown, cost_total: None, notes: None };
        let a = store::create(&db, mk("A"), 5_000, None).unwrap();
        store::finish(&db, a, 5_001, &store::build_valuation(&[], &Default::default(), &Default::default(), None, None, 5_001)).unwrap();
        // Same creation second, but a different start (imports set started_at to the first card).
        let (b, _) = store::insert_imported(&db, "B", None, &[(4_000, "log:x:1".into(), "The Lover".into())], 5_000, |c| store::build_valuation(c, &Default::default(), &Default::default(), None, None, 5_000)).unwrap().unwrap();
        for id in [a, b] {
            write_session(dir.path(), &db.conn().unwrap(), id, 6_000).unwrap();
        }
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2, "own file each");
        // Two live sessions created in the same second (same start too) are still two sessions.
        let c1 = store::create(&db, mk("C1"), 7_000, None).unwrap();
        store::finish(&db, c1, 7_001, &store::build_valuation(&[], &Default::default(), &Default::default(), None, None, 7_001)).unwrap();
        let c2 = store::create(&db, mk("C2"), 7_000, None).unwrap();
        for id in [c1, c2] {
            write_session(dir.path(), &db.conn().unwrap(), id, 7_002).unwrap();
        }
        // Renamed after the backup: still the same session when restoring (it has cards).
        store::update(&db, b, mk("B renamed")).unwrap();
        assert_eq!(restore_dir(&db, dir.path()).unwrap().sessions_skipped, 4);
        let fresh = Database::open_in_memory().unwrap();
        assert_eq!(restore_dir(&fresh, dir.path()).unwrap().sessions_added, 4);
    }

    #[test]
    fn bad_files_are_reported_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("x.json"), b"{not json").unwrap();
        std::fs::write(dir.path().join("y.json"), br#"{"kind":"something-else"}"#).unwrap();
        let db = Database::open_in_memory().unwrap();
        let r = restore_dir(&db, dir.path()).unwrap();
        assert_eq!((r.files, r.sessions_added, r.errors.len()), (2, 0, 2));
        assert!(restore_dir(&db, &dir.path().join("missing")).is_err());
    }
}
