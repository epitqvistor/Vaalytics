//! SQLite persistence for the Update Center (migration 0014). All multi-row writes that
//! change what is installed run in one transaction, so a failure never leaves a dataset
//! half-applied.

use super::diff::Change;
use super::model::{Confidence, Entry, Validation};
use super::validate::Note;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::Value;

// ---------- sources ----------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceState {
    pub provider_id: String,
    pub enabled: bool,
    pub status: String,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub last_error: Option<String>,
    pub last_error_kind: Option<String>,
    pub last_duration_ms: Option<i64>,
    pub last_bytes: Option<i64>,
}

pub fn source_state(db: &Database, id: &str) -> AppResult<SourceState> {
    let row = db
        .conn()?
        .query_row(
            "SELECT enabled, status, last_attempt_at, last_success_at, last_error, last_error_kind, last_duration_ms, last_bytes FROM update_sources WHERE provider_id = ?1",
            params![id],
            |r| {
                Ok(SourceState {
                    provider_id: id.to_string(),
                    enabled: r.get::<_, i64>(0)? != 0,
                    status: r.get(1)?,
                    last_attempt_at: r.get(2)?,
                    last_success_at: r.get(3)?,
                    last_error: r.get(4)?,
                    last_error_kind: r.get(5)?,
                    last_duration_ms: r.get(6)?,
                    last_bytes: r.get(7)?,
                })
            },
        )
        .optional()?;
    Ok(row.unwrap_or(SourceState { provider_id: id.to_string(), enabled: true, status: "unknown".into(), ..Default::default() }))
}

fn ensure_source(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("INSERT OR IGNORE INTO update_sources (provider_id) VALUES (?1)", params![id])?;
    Ok(())
}

pub fn set_source_enabled(db: &Database, id: &str, enabled: bool) -> AppResult<()> {
    let conn = db.conn()?;
    ensure_source(&conn, id)?;
    conn.execute("UPDATE update_sources SET enabled = ?2 WHERE provider_id = ?1", params![id, enabled as i64])?;
    Ok(())
}

pub fn record_source(db: &Database, id: &str, now: i64, duration_ms: i64, bytes: u64, error: Option<(&str, &str)>, warning: bool) -> AppResult<()> {
    let conn = db.conn()?;
    ensure_source(&conn, id)?;
    match error {
        None => conn.execute(
            "UPDATE update_sources SET status = ?2, last_attempt_at = ?3, last_success_at = ?3, last_error = NULL, last_error_kind = NULL,
             last_duration_ms = ?4, last_bytes = ?5 WHERE provider_id = ?1",
            params![id, if warning { "warning" } else { "ok" }, now, duration_ms, bytes as i64],
        )?,
        Some((kind, msg)) => conn.execute(
            "UPDATE update_sources SET status = 'error', last_attempt_at = ?2, last_error = ?3, last_error_kind = ?4, last_duration_ms = ?5 WHERE provider_id = ?1",
            params![id, now, msg, kind, duration_ms],
        )?,
    };
    Ok(())
}

// ---------- dataset source state ----------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetState {
    pub etag: Option<String>,
    pub source_modified: Option<String>,
    pub last_checked_at: Option<i64>,
    pub last_error: Option<String>,
}

pub fn dataset_state(db: &Database, id: &str) -> AppResult<DatasetState> {
    Ok(db
        .conn()?
        .query_row("SELECT etag, source_modified, last_checked_at, last_error FROM update_datasets WHERE dataset_id = ?1", params![id], |r| {
            Ok(DatasetState { etag: r.get(0)?, source_modified: r.get(1)?, last_checked_at: r.get(2)?, last_error: r.get(3)? })
        })
        .optional()?
        .unwrap_or_default())
}

/// Records a check of a dataset. `etag`/`modified` are only overwritten when given.
pub fn record_dataset_check(db: &Database, id: &str, game: GameId, now: i64, etag: Option<&str>, modified: Option<&str>, error: Option<&str>) -> AppResult<()> {
    db.conn()?.execute(
        "INSERT INTO update_datasets (dataset_id, game, etag, source_modified, last_checked_at, last_error) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(dataset_id) DO UPDATE SET etag = COALESCE(excluded.etag, etag), source_modified = COALESCE(excluded.source_modified, source_modified),
         last_checked_at = CASE WHEN excluded.last_error IS NULL THEN excluded.last_checked_at ELSE last_checked_at END, last_error = excluded.last_error",
        params![id, game.as_str(), etag, modified, now, error],
    )?;
    Ok(())
}

// ---------- versions ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: i64,
    pub dataset_id: String,
    pub game: String,
    pub league: Option<String>,
    pub format: u32,
    pub label: String,
    pub content_hash: String,
    pub entry_count: i64,
    pub provider_id: String,
    pub source_url: Option<String>,
    pub source_version: Option<String>,
    pub retrieved_at: i64,
    pub created_at: i64,
    pub installed_at: Option<i64>,
    pub status: String,
    pub origin: String,
    pub validation: String,
    pub validation_notes: Vec<Note>,
    pub parent_id: Option<i64>,
    pub has_content: bool,
}

const VERSION_COLS: &str = "id, dataset_id, game, league, format, label, content_hash, entry_count, provider_id, source_url, source_version,
    retrieved_at, created_at, installed_at, status, origin, validation, validation_notes, parent_id, content IS NOT NULL";

fn version_row(r: &Row) -> rusqlite::Result<VersionInfo> {
    let notes: String = r.get(17)?;
    Ok(VersionInfo {
        id: r.get(0)?,
        dataset_id: r.get(1)?,
        game: r.get(2)?,
        league: r.get(3)?,
        format: r.get::<_, i64>(4)? as u32,
        label: r.get(5)?,
        content_hash: r.get(6)?,
        entry_count: r.get(7)?,
        provider_id: r.get(8)?,
        source_url: r.get(9)?,
        source_version: r.get(10)?,
        retrieved_at: r.get(11)?,
        created_at: r.get(12)?,
        installed_at: r.get(13)?,
        status: r.get(14)?,
        origin: r.get(15)?,
        validation: r.get(16)?,
        validation_notes: parse_notes(&notes),
        parent_id: r.get(18)?,
        has_content: r.get(19)?,
    })
}

fn parse_notes(s: &str) -> Vec<Note> {
    serde_json::from_str::<Vec<Value>>(s)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| Some(Note { level: Validation::parse(v.get("level")?.as_str()?), message: v.get("message")?.as_str()?.to_string() }))
        .collect()
}

pub fn version(db: &Database, id: i64) -> AppResult<Option<VersionInfo>> {
    Ok(db.conn()?.query_row(&format!("SELECT {VERSION_COLS} FROM update_versions WHERE id = ?1"), params![id], version_row).optional()?)
}

pub fn installed(db: &Database, dataset_id: &str) -> AppResult<Option<VersionInfo>> {
    Ok(db
        .conn()?
        .query_row(&format!("SELECT {VERSION_COLS} FROM update_versions WHERE dataset_id = ?1 AND status = 'installed'"), params![dataset_id], version_row)
        .optional()?)
}

pub fn staged(db: &Database, dataset_id: &str) -> AppResult<Option<VersionInfo>> {
    Ok(db
        .conn()?
        .query_row(&format!("SELECT {VERSION_COLS} FROM update_versions WHERE dataset_id = ?1 AND status = 'staged' ORDER BY id DESC LIMIT 1"), params![dataset_id], version_row)
        .optional()?)
}

pub fn versions(db: &Database, dataset_id: &str, limit: i64) -> AppResult<Vec<VersionInfo>> {
    let conn = db.conn()?;
    let mut st = conn.prepare(&format!("SELECT {VERSION_COLS} FROM update_versions WHERE dataset_id = ?1 ORDER BY id DESC LIMIT ?2"))?;
    let rows = st.query_map(params![dataset_id, limit], version_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn entries(db: &Database, version_id: i64) -> AppResult<Option<Vec<Entry>>> {
    let raw: Option<Option<String>> = db.conn()?.query_row("SELECT content FROM update_versions WHERE id = ?1", params![version_id], |r| r.get(0)).optional()?;
    match raw.flatten() {
        Some(s) => Ok(Some(serde_json::from_str(&s)?)),
        None => Ok(None),
    }
}

pub fn installed_entries(db: &Database, dataset_id: &str) -> AppResult<Option<(VersionInfo, Vec<Entry>)>> {
    let Some(v) = installed(db, dataset_id)? else { return Ok(None) };
    Ok(entries(db, v.id)?.map(|e| (v, e)))
}

pub struct NewVersion<'a> {
    pub dataset_id: &'a str,
    pub game: GameId,
    pub league: Option<&'a str>,
    pub format: u32,
    pub label: String,
    pub content_hash: String,
    pub entries: &'a [Entry],
    pub provider_id: &'a str,
    pub source_url: Option<&'a str>,
    pub source_version: Option<&'a str>,
    pub retrieved_at: i64,
    pub now: i64,
    pub origin: &'a str,
    pub validation: Validation,
    pub notes: &'a [Note],
    pub parent_id: Option<i64>,
    pub check_id: Option<i64>,
}

fn insert_version_tx(tx: &Connection, v: &NewVersion, status: &str) -> AppResult<i64> {
    tx.execute(
        "INSERT INTO update_versions (dataset_id, game, league, format, label, content_hash, entry_count, content, provider_id, source_url, source_version,
           retrieved_at, created_at, installed_at, status, origin, validation, validation_notes, parent_id, check_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        params![
            v.dataset_id,
            v.game.as_str(),
            v.league,
            v.format as i64,
            v.label,
            v.content_hash,
            v.entries.len() as i64,
            serde_json::to_string(v.entries)?,
            v.provider_id,
            v.source_url,
            v.source_version,
            v.retrieved_at,
            v.now,
            if status == "installed" { Some(v.now) } else { None },
            status,
            v.origin,
            v.validation.as_str(),
            serde_json::to_string(v.notes)?,
            v.parent_id,
            v.check_id,
        ],
    )?;
    Ok(tx.last_insert_rowid())
}

/// Stages a version with its detected changes. Older staged versions of the dataset and
/// their pending changes are superseded. Changes identical to ones the user ignored
/// before (same entry, same new value) start ignored.
pub fn stage(db: &Database, v: &NewVersion, changes: &[(Change, Confidence, bool)], now: i64) -> AppResult<i64> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    tx.execute("UPDATE update_changes SET status = 'superseded', resolved_at = ?2 WHERE dataset_id = ?1 AND status = 'pending'", params![v.dataset_id, now])?;
    tx.execute("UPDATE update_versions SET status = 'discarded' WHERE dataset_id = ?1 AND status = 'staged'", params![v.dataset_id])?;
    let id = insert_version_tx(&tx, v, "staged")?;
    {
        let mut ignored_before = tx.prepare("SELECT 1 FROM update_changes WHERE dataset_id = ?1 AND entry_key = ?2 AND after_hash IS ?3 AND status = 'ignored' LIMIT 1")?;
        let mut ins = tx.prepare(
            "INSERT INTO update_changes (check_id, version_id, dataset_id, game, entry_key, entry_name, change_type, fields, before, after, after_hash,
               confidence, requires_review, status, detected_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )?;
        for (c, conf, review) in changes {
            let h = c.after_hash();
            let was_ignored = ignored_before.exists(params![v.dataset_id, c.key, h])?;
            ins.execute(params![
                v.check_id.unwrap_or(0),
                id,
                v.dataset_id,
                v.game.as_str(),
                c.key,
                c.name,
                c.change_type.as_str(),
                serde_json::to_string(&c.fields)?,
                c.before.as_ref().map(|b| b.to_string()),
                c.after.as_ref().map(|a| a.to_string()),
                h,
                conf.as_str(),
                *review as i64,
                if was_ignored { "ignored" } else { "pending" },
                now,
            ])?;
        }
    }
    tx.commit()?;
    Ok(id)
}

/// Makes a version the installed one (atomically): the current installed version becomes
/// `previous`, the given one `installed`. `applied_changes` are marked applied.
pub fn install(db: &Database, version_id: i64, applied_changes: &[i64], now: i64) -> AppResult<Option<i64>> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let (dataset_id, status): (String, String) = tx.query_row("SELECT dataset_id, status FROM update_versions WHERE id = ?1", params![version_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    if status == "installed" {
        return Err(AppError::InvalidInput("This version is already installed.".into()));
    }
    let has_content: bool = tx.query_row("SELECT content IS NOT NULL FROM update_versions WHERE id = ?1", params![version_id], |r| r.get(0))?;
    if !has_content {
        return Err(AppError::InvalidInput("This version's data was removed by the retention policy and can't be restored.".into()));
    }
    let previous: Option<i64> = tx.query_row("SELECT id FROM update_versions WHERE dataset_id = ?1 AND status = 'installed'", params![dataset_id], |r| r.get(0)).optional()?;
    tx.execute("UPDATE update_versions SET status = 'previous' WHERE dataset_id = ?1 AND status = 'installed'", params![dataset_id])?;
    tx.execute("UPDATE update_versions SET status = 'installed', installed_at = ?2 WHERE id = ?1", params![version_id, now])?;
    for id in applied_changes {
        tx.execute("UPDATE update_changes SET status = 'applied', resolved_at = ?2 WHERE id = ?1", params![id, now])?;
    }
    tx.commit()?;
    Ok(previous)
}

/// Inserts a new version (partial application or import) and installs it in one transaction.
pub fn insert_and_install(db: &Database, v: &NewVersion, applied_changes: &[i64], now: i64) -> AppResult<(i64, Option<i64>)> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let previous: Option<i64> = tx.query_row("SELECT id FROM update_versions WHERE dataset_id = ?1 AND status = 'installed'", params![v.dataset_id], |r| r.get(0)).optional()?;
    tx.execute("UPDATE update_versions SET status = 'previous' WHERE dataset_id = ?1 AND status = 'installed'", params![v.dataset_id])?;
    let id = insert_version_tx(&tx, v, "installed")?;
    for c in applied_changes {
        tx.execute("UPDATE update_changes SET status = 'applied', resolved_at = ?2 WHERE id = ?1", params![c, now])?;
    }
    tx.commit()?;
    Ok((id, previous))
}

/// Retention: keeps the content of the installed version, any staged version and the
/// `keep` most recent others; older ones keep their metadata (history) but lose content.
pub fn prune(db: &Database, dataset_id: &str, keep: i64) -> AppResult<usize> {
    Ok(db.conn()?.execute(
        "UPDATE update_versions SET content = NULL WHERE dataset_id = ?1 AND content IS NOT NULL AND status IN ('previous', 'discarded')
         AND id NOT IN (SELECT id FROM update_versions WHERE dataset_id = ?1 AND status IN ('previous', 'discarded') ORDER BY id DESC LIMIT ?2)",
        params![dataset_id, keep.max(1)],
    )?)
}

// ---------- changes ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRow {
    pub id: i64,
    pub check_id: i64,
    pub version_id: Option<i64>,
    pub dataset_id: String,
    pub game: String,
    pub entry_key: String,
    pub entry_name: String,
    pub change_type: String,
    pub fields: Vec<String>,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub confidence: String,
    pub requires_review: bool,
    pub status: String,
    pub reviewed: bool,
    pub detected_at: i64,
    pub resolved_at: Option<i64>,
}

const CHANGE_COLS: &str = "id, check_id, version_id, dataset_id, game, entry_key, entry_name, change_type, fields, before, after, confidence,
    requires_review, status, reviewed, detected_at, resolved_at";

fn change_row(r: &Row) -> rusqlite::Result<ChangeRow> {
    let json = |s: Option<String>| s.and_then(|s| serde_json::from_str(&s).ok());
    Ok(ChangeRow {
        id: r.get(0)?,
        check_id: r.get(1)?,
        version_id: r.get(2)?,
        dataset_id: r.get(3)?,
        game: r.get(4)?,
        entry_key: r.get(5)?,
        entry_name: r.get(6)?,
        change_type: r.get(7)?,
        fields: serde_json::from_str(&r.get::<_, String>(8)?).unwrap_or_default(),
        before: json(r.get(9)?),
        after: json(r.get(10)?),
        confidence: r.get(11)?,
        requires_review: r.get::<_, i64>(12)? != 0,
        status: r.get(13)?,
        reviewed: r.get::<_, i64>(14)? != 0,
        detected_at: r.get(15)?,
        resolved_at: r.get(16)?,
    })
}

/// Changes filtered by status (None = all), newest first.
pub fn changes(db: &Database, status: Option<&str>, dataset_id: Option<&str>, limit: i64) -> AppResult<Vec<ChangeRow>> {
    let conn = db.conn()?;
    let mut st = conn.prepare(&format!(
        "SELECT {CHANGE_COLS} FROM update_changes WHERE (?1 IS NULL OR status = ?1) AND (?2 IS NULL OR dataset_id = ?2) ORDER BY id DESC LIMIT ?3"
    ))?;
    let rows = st.query_map(params![status, dataset_id, limit], change_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn set_change_status(db: &Database, ids: &[i64], status: Option<&str>, reviewed: Option<bool>, now: i64) -> AppResult<usize> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let mut n = 0;
    for id in ids {
        if let Some(s) = status {
            n += tx.execute(
                "UPDATE update_changes SET status = ?2, resolved_at = CASE WHEN ?2 = 'pending' THEN NULL ELSE ?3 END WHERE id = ?1 AND status IN ('pending', 'ignored')",
                params![id, s, now],
            )?;
        }
        if let Some(r) = reviewed {
            n += tx.execute("UPDATE update_changes SET reviewed = ?2 WHERE id = ?1", params![id, r as i64])?;
        }
    }
    tx.commit()?;
    Ok(n)
}

pub fn pending_counts(db: &Database) -> AppResult<Vec<(String, i64, i64)>> {
    let conn = db.conn()?;
    let mut st = conn.prepare("SELECT dataset_id, COUNT(*), SUM(requires_review) FROM update_changes WHERE status = 'pending' GROUP BY dataset_id")?;
    let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, Option<i64>>(2)?.unwrap_or(0))))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ---------- checks & events ----------

pub fn start_check(db: &Database, kind: &str, trigger: &str, now: i64) -> AppResult<i64> {
    let conn = db.conn()?;
    conn.execute("INSERT INTO update_checks (kind, trigger, started_at, status) VALUES (?1, ?2, ?3, 'running')", params![kind, trigger, now])?;
    Ok(conn.last_insert_rowid())
}

pub fn finish_check(db: &Database, id: i64, status: &str, summary: &Value, now: i64) -> AppResult<()> {
    db.conn()?.execute("UPDATE update_checks SET status = ?2, summary = ?3, finished_at = ?4 WHERE id = ?1", params![id, status, summary.to_string(), now])?;
    Ok(())
}

/// Crash recovery: runs left `running` by a previous process are marked interrupted.
pub fn mark_interrupted(db: &Database, now: i64) -> AppResult<usize> {
    Ok(db.conn()?.execute("UPDATE update_checks SET status = 'interrupted', finished_at = ?1 WHERE status = 'running'", params![now])?)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRow {
    pub id: i64,
    pub kind: String,
    pub trigger: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub status: String,
    pub summary: Option<Value>,
}

pub fn checks(db: &Database, limit: i64) -> AppResult<Vec<CheckRow>> {
    let conn = db.conn()?;
    let mut st = conn.prepare("SELECT id, kind, trigger, started_at, finished_at, status, summary FROM update_checks ORDER BY id DESC LIMIT ?1")?;
    let rows = st
        .query_map(params![limit], |r| {
            Ok(CheckRow {
                id: r.get(0)?,
                kind: r.get(1)?,
                trigger: r.get(2)?,
                started_at: r.get(3)?,
                finished_at: r.get(4)?,
                status: r.get(5)?,
                summary: r.get::<_, Option<String>>(6)?.and_then(|s| serde_json::from_str(&s).ok()),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, Default)]
pub struct NewEvent<'a> {
    pub check_id: Option<i64>,
    pub kind: &'a str,
    pub game: Option<GameId>,
    pub league: Option<&'a str>,
    pub dataset_id: Option<&'a str>,
    pub provider_id: Option<&'a str>,
    pub modules: Vec<&'a str>,
    pub from_version: Option<i64>,
    pub to_version: Option<i64>,
    pub status: &'a str,
    pub message: String,
    pub duration_ms: Option<i64>,
}

pub fn event(db: &Database, e: NewEvent, now: i64) -> AppResult<()> {
    db.conn()?.execute(
        "INSERT INTO update_events (ts, check_id, kind, game, league, dataset_id, provider_id, modules, from_version, to_version, status, message, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            now,
            e.check_id,
            e.kind,
            e.game.map(|g| g.as_str()),
            e.league,
            e.dataset_id,
            e.provider_id,
            serde_json::to_string(&e.modules)?,
            e.from_version,
            e.to_version,
            e.status,
            e.message,
            e.duration_ms
        ],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub id: i64,
    pub ts: i64,
    pub check_id: Option<i64>,
    pub kind: String,
    pub game: Option<String>,
    pub league: Option<String>,
    pub dataset_id: Option<String>,
    pub provider_id: Option<String>,
    pub modules: Vec<String>,
    pub from_version: Option<i64>,
    pub to_version: Option<i64>,
    pub status: String,
    pub message: String,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EventFilter {
    pub since: Option<i64>,
    pub until: Option<i64>,
    pub game: Option<String>,
    pub league: Option<String>,
    pub module: Option<String>,
    pub provider: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
}

pub fn events(db: &Database, f: &EventFilter) -> AppResult<Vec<EventRow>> {
    let conn = db.conn()?;
    let module_like = f.module.as_ref().map(|m| format!("%\"{}\"%", m.replace(['%', '_', '"'], "")));
    let mut st = conn.prepare(
        "SELECT id, ts, check_id, kind, game, league, dataset_id, provider_id, modules, from_version, to_version, status, message, duration_ms
         FROM update_events WHERE (?1 IS NULL OR ts >= ?1) AND (?2 IS NULL OR ts <= ?2) AND (?3 IS NULL OR game = ?3) AND (?4 IS NULL OR league = ?4)
         AND (?5 IS NULL OR modules LIKE ?5) AND (?6 IS NULL OR provider_id = ?6) AND (?7 IS NULL OR status = ?7)
         ORDER BY id DESC LIMIT ?8",
    )?;
    let rows = st
        .query_map(params![f.since, f.until, f.game, f.league, module_like, f.provider, f.status, f.limit.unwrap_or(300).clamp(1, 2000)], |r| {
            Ok(EventRow {
                id: r.get(0)?,
                ts: r.get(1)?,
                check_id: r.get(2)?,
                kind: r.get(3)?,
                game: r.get(4)?,
                league: r.get(5)?,
                dataset_id: r.get(6)?,
                provider_id: r.get(7)?,
                modules: serde_json::from_str(&r.get::<_, String>(8)?).unwrap_or_default(),
                from_version: r.get(9)?,
                to_version: r.get(10)?,
                status: r.get(11)?,
                message: r.get(12)?,
                duration_ms: r.get(13)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ---------- league profiles ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeagueProfile {
    pub game: String,
    pub league: String,
    pub display_name: String,
    pub hardcore: bool,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub ended_detected_at: Option<i64>,
    pub status: String,
    pub provider_id: String,
}

/// Syncs league profiles with an installed league list: new leagues are added, listed ones
/// refreshed, leagues no longer listed are marked ended (never deleted).
pub fn sync_league_profiles(db: &Database, game: GameId, leagues: &[Entry], provider_id: &str, now: i64) -> AppResult<()> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    for l in leagues {
        tx.execute(
            "INSERT INTO league_profiles (game, league, display_name, hardcore, first_seen_at, last_seen_at, status, provider_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'active', ?6)
             ON CONFLICT(game, league) DO UPDATE SET display_name = excluded.display_name, hardcore = excluded.hardcore,
             last_seen_at = excluded.last_seen_at, status = 'active', ended_detected_at = NULL",
            params![game.as_str(), l.key, l.name, l.data.get("hardcore").and_then(Value::as_bool).unwrap_or(false) as i64, now, provider_id],
        )?;
    }
    let listed: Vec<&str> = leagues.iter().map(|l| l.key.as_str()).collect();
    let active: Vec<String> = {
        let mut st = tx.prepare("SELECT league FROM league_profiles WHERE game = ?1 AND status = 'active'")?;
        let v = st.query_map(params![game.as_str()], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
        v
    };
    for l in active.iter().filter(|l| !listed.contains(&l.as_str())) {
        tx.execute("UPDATE league_profiles SET status = 'ended', ended_detected_at = ?3 WHERE game = ?1 AND league = ?2", params![game.as_str(), l, now])?;
    }
    tx.commit()?;
    Ok(())
}

pub fn league_profiles(db: &Database) -> AppResult<Vec<LeagueProfile>> {
    let conn = db.conn()?;
    let mut st = conn.prepare(
        "SELECT game, league, display_name, hardcore, first_seen_at, last_seen_at, ended_detected_at, status, provider_id FROM league_profiles
         ORDER BY game, status, first_seen_at DESC, league",
    )?;
    let rows = st
        .query_map([], |r| {
            Ok(LeagueProfile {
                game: r.get(0)?,
                league: r.get(1)?,
                display_name: r.get(2)?,
                hardcore: r.get::<_, i64>(3)? != 0,
                first_seen_at: r.get(4)?,
                last_seen_at: r.get(5)?,
                ended_detected_at: r.get(6)?,
                status: r.get(7)?,
                provider_id: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Leagues with stored market data or history (kept even after a league ends).
pub fn leagues_with_data(db: &Database) -> AppResult<Vec<(String, String, i64, i64)>> {
    let conn = db.conn()?;
    let mut st = conn.prepare(
        "SELECT game, league, COUNT(*), MAX(ts) FROM (SELECT game, league, ts FROM price_history) GROUP BY game, league",
    )?;
    let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ---------- market (read-only view of the Market engine's own tables) ----------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketState {
    pub league: String,
    pub categories: i64,
    pub oldest_fetch: Option<i64>,
    pub newest_fetch: Option<i64>,
    pub errors: i64,
    pub last_error: Option<String>,
    pub items: i64,
}

pub fn market_state(db: &Database, game: GameId, league: &str) -> AppResult<MarketState> {
    let conn = db.conn()?;
    let (categories, oldest, newest, errors): (i64, Option<i64>, Option<i64>, i64) = conn.query_row(
        "SELECT COUNT(*), MIN(fetched_at), MAX(fetched_at), COALESCE(SUM(last_error IS NOT NULL), 0) FROM market_fetches WHERE game = ?1 AND league = ?2 AND category != '__leagues'",
        params![game.as_str(), league],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let last_error: Option<String> = conn
        .query_row(
            "SELECT last_error FROM market_fetches WHERE game = ?1 AND league = ?2 AND last_error IS NOT NULL ORDER BY last_error_at DESC LIMIT 1",
            params![game.as_str(), league],
            |r| r.get(0),
        )
        .optional()?;
    let items: i64 = conn.query_row("SELECT COUNT(*) FROM market_items WHERE game = ?1 AND league = ?2", params![game.as_str(), league], |r| r.get(0))?;
    Ok(MarketState { league: league.to_string(), categories, oldest_fetch: oldest, newest_fetch: newest, errors, last_error, items })
}

// ---------- analytics ----------

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analytics {
    pub runs: i64,
    pub runs_ok: i64,
    pub runs_partial: i64,
    pub runs_failed: i64,
    pub avg_duration_secs: Option<f64>,
    pub changes_detected: i64,
    pub changes_applied: i64,
    pub changes_ignored: i64,
    pub versions_installed: i64,
    pub rollbacks: i64,
    pub by_dataset: Vec<(String, i64)>,
    /// Runs per day for the last 30 days: (day start unix s, runs, failed).
    pub activity: Vec<(i64, i64, i64)>,
}

pub fn analytics(db: &Database, now: i64) -> AppResult<Analytics> {
    let conn = db.conn()?;
    let mut a = Analytics::default();
    (a.runs, a.runs_ok, a.runs_partial, a.runs_failed, a.avg_duration_secs) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(status = 'ok'), 0), COALESCE(SUM(status = 'partial'), 0), COALESCE(SUM(status IN ('failed', 'interrupted')), 0),
         AVG(CASE WHEN finished_at IS NOT NULL THEN finished_at - started_at END) FROM update_checks WHERE kind IN ('check', 'sync')",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )?;
    (a.changes_detected, a.changes_applied, a.changes_ignored) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(status = 'applied'), 0), COALESCE(SUM(status = 'ignored'), 0) FROM update_changes",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    a.versions_installed = conn.query_row("SELECT COUNT(*) FROM update_versions WHERE installed_at IS NOT NULL", [], |r| r.get(0))?;
    a.rollbacks = conn.query_row("SELECT COUNT(*) FROM update_events WHERE kind = 'rollback'", [], |r| r.get(0))?;
    {
        let mut st = conn.prepare("SELECT dataset_id, COUNT(*) FROM update_changes GROUP BY dataset_id ORDER BY COUNT(*) DESC LIMIT 8")?;
        a.by_dataset = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
    }
    {
        let since = now - 30 * 86_400;
        let mut st = conn.prepare(
            "SELECT (started_at / 86400) * 86400 AS day, COUNT(*), COALESCE(SUM(status IN ('failed', 'interrupted')), 0) FROM update_checks
             WHERE started_at >= ?1 AND kind IN ('check', 'sync') GROUP BY day ORDER BY day",
        )?;
        a.activity = st.query_map(params![since], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<Vec<_>, _>>()?;
    }
    Ok(a)
}

// ---------- articles ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleRow {
    pub provider_id: String,
    pub article_id: String,
    pub game: Option<String>,
    pub kind: String,
    pub title: String,
    pub url: String,
    pub published_at: Option<i64>,
    pub discovered_at: i64,
    pub processed_at: Option<i64>,
    pub process_error: Option<String>,
    pub analysis: Option<Value>,
    pub reviewed: bool,
}

/// Inserts articles not seen before; returns how many were new.
pub fn insert_articles(db: &Database, provider_id: &str, items: &[super::patchnotes::Discovered], now: i64) -> AppResult<usize> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let mut n = 0;
    for a in items {
        n += tx.execute(
            "INSERT OR IGNORE INTO patch_articles (provider_id, article_id, game, kind, title, url, published_at, discovered_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![provider_id, a.id, a.game.map(|g| g.as_str()), a.kind, a.title, a.url, a.published_at, now],
        )?;
    }
    tx.commit()?;
    Ok(n)
}

const ARTICLE_COLS: &str = "provider_id, article_id, game, kind, title, url, published_at, discovered_at, processed_at, process_error, analysis, reviewed";

fn article_row(r: &Row) -> rusqlite::Result<ArticleRow> {
    Ok(ArticleRow {
        provider_id: r.get(0)?,
        article_id: r.get(1)?,
        game: r.get(2)?,
        kind: r.get(3)?,
        title: r.get(4)?,
        url: r.get(5)?,
        published_at: r.get(6)?,
        discovered_at: r.get(7)?,
        processed_at: r.get(8)?,
        process_error: r.get(9)?,
        analysis: r.get::<_, Option<String>>(10)?.and_then(|s| serde_json::from_str(&s).ok()),
        reviewed: r.get::<_, i64>(11)? != 0,
    })
}

pub fn articles(db: &Database, limit: i64) -> AppResult<Vec<ArticleRow>> {
    let conn = db.conn()?;
    let mut st = conn.prepare(&format!("SELECT {ARTICLE_COLS} FROM patch_articles ORDER BY COALESCE(published_at, discovered_at) DESC LIMIT ?1"))?;
    let rows = st.query_map(params![limit], article_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn article(db: &Database, provider_id: &str, article_id: &str) -> AppResult<Option<ArticleRow>> {
    Ok(db
        .conn()?
        .query_row(&format!("SELECT {ARTICLE_COLS} FROM patch_articles WHERE provider_id = ?1 AND article_id = ?2"), params![provider_id, article_id], article_row)
        .optional()?)
}

/// Unprocessed patch-note threads of one game, newest first.
pub fn unprocessed_articles(db: &Database, provider_id: &str, game: GameId, limit: i64) -> AppResult<Vec<ArticleRow>> {
    let conn = db.conn()?;
    let mut st = conn.prepare(&format!(
        "SELECT {ARTICLE_COLS} FROM patch_articles WHERE provider_id = ?1 AND game = ?2 AND processed_at IS NULL AND process_error IS NULL
         ORDER BY COALESCE(published_at, discovered_at) DESC LIMIT ?3"
    ))?;
    let rows = st.query_map(params![provider_id, game.as_str(), limit], article_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn set_article_analysis(db: &Database, provider_id: &str, article_id: &str, analysis: Result<&Value, &str>, now: i64) -> AppResult<()> {
    let conn = db.conn()?;
    match analysis {
        Ok(v) => conn.execute(
            "UPDATE patch_articles SET analysis = ?3, processed_at = ?4, process_error = NULL WHERE provider_id = ?1 AND article_id = ?2",
            params![provider_id, article_id, v.to_string(), now],
        )?,
        Err(e) => conn.execute("UPDATE patch_articles SET process_error = ?3 WHERE provider_id = ?1 AND article_id = ?2", params![provider_id, article_id, e])?,
    };
    Ok(())
}

pub fn set_article_reviewed(db: &Database, provider_id: &str, article_id: &str, reviewed: bool) -> AppResult<()> {
    db.conn()?.execute("UPDATE patch_articles SET reviewed = ?3 WHERE provider_id = ?1 AND article_id = ?2", params![provider_id, article_id, reviewed as i64])?;
    Ok(())
}

pub fn last_check_of(db: &Database, kinds: &[&str]) -> AppResult<(Option<i64>, Option<i64>)> {
    let conn = db.conn()?;
    let list = kinds.iter().map(|k| format!("'{}'", k.replace('\'', ""))).collect::<Vec<_>>().join(",");
    let attempt: Option<i64> = conn.query_row(&format!("SELECT MAX(started_at) FROM update_checks WHERE kind IN ({list})"), [], |r| r.get(0))?;
    let ok: Option<i64> = conn.query_row(&format!("SELECT MAX(finished_at) FROM update_checks WHERE kind IN ({list}) AND status = 'ok'"), [], |r| r.get(0))?;
    Ok((attempt, ok))
}
