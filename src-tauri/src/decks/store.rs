//! Storage for Deck Intelligence (migration 0013). Every row is `game = 'poe1'`.
//! Writes that touch several rows run in one transaction.

use crate::db::Database;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const GAME: &str = "poe1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Acquisition {
    Individual,
    Bulk,
    Farmed,
    Free,
    Unknown,
}

impl Acquisition {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Individual => "individual",
            Self::Bulk => "bulk",
            Self::Farmed => "farmed",
            Self::Free => "free",
            Self::Unknown => "unknown",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "individual" => Self::Individual,
            "bulk" => Self::Bulk,
            "farmed" => Self::Farmed,
            "free" => Self::Free,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInput {
    pub name: String,
    pub league: Option<String>,
    pub opened_on: Option<String>,
    pub planned_decks: Option<i64>,
    pub acquisition: Acquisition,
    pub cost_total: Option<f64>,
    pub notes: Option<String>,
}

impl SessionInput {
    pub fn validate(mut self) -> AppResult<Self> {
        self.name = self.name.trim().chars().take(120).collect();
        if self.name.is_empty() {
            return Err(AppError::InvalidInput("Give the session a name.".into()));
        }
        self.league = self.league.map(|l| l.trim().chars().take(80).collect::<String>()).filter(|l| !l.is_empty());
        self.opened_on = self.opened_on.filter(|d| d.len() == 10 && d.as_bytes()[4] == b'-' && d.as_bytes()[7] == b'-');
        if self.planned_decks.is_some_and(|n| !(0..=1_000_000).contains(&n)) {
            return Err(AppError::InvalidInput("The number of decks must be between 0 and 1,000,000.".into()));
        }
        if self.cost_total.is_some_and(|c| !c.is_finite() || c < 0.0) {
            return Err(AppError::InvalidInput("The cost must be zero or more.".into()));
        }
        self.notes = self.notes.map(|n| n.chars().take(4000).collect::<String>()).filter(|n| !n.trim().is_empty());
        Ok(self)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: i64,
    pub name: String,
    pub league: Option<String>,
    pub created_at: i64,
    pub opened_on: Option<String>,
    pub status: String,
    pub origin: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    /// Running time so far (pauses excluded); for a running session up to `now`.
    pub active_secs: i64,
    pub resumed_at: Option<i64>,
    pub planned_decks: Option<i64>,
    pub acquisition: Acquisition,
    pub cost_total: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    #[serde(flatten)]
    pub session: Session,
    pub confirmed: i64,
    pub review: i64,
    pub unrecognized: i64,
    pub first_card_at: Option<i64>,
    pub last_card_at: Option<i64>,
    pub valuation: Option<Valuation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValuationLine {
    pub card: String,
    pub qty: i64,
    /// Chaos per card; None = no price known.
    pub unit: Option<f64>,
    /// "market" | "manual" | null
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Valuation {
    pub valued_at: i64,
    pub league: Option<String>,
    pub prices_at: Option<i64>,
    pub total_value: f64,
    pub priced_cards: i64,
    pub unpriced_cards: i64,
    pub lines: Vec<ValuationLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: i64,
    pub session_id: i64,
    pub at: i64,
    pub source: String,
    pub capture_id: Option<i64>,
    pub recognized_text: Option<String>,
    pub recognized_card: Option<String>,
    pub confidence: f64,
    pub bbox: Option<serde_json::Value>,
    pub card: Option<String>,
    pub status: String,
    pub review_reason: Option<String>,
    pub corrected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    pub id: i64,
    pub session_id: i64,
    pub taken_at: i64,
    pub source: String,
    pub has_image: bool,
    pub width: i64,
    pub height: i64,
    pub ocr_lines: i64,
    pub ignored_lines: i64,
    pub error: Option<String>,
}

pub struct NewEvent<'a> {
    pub session_id: i64,
    pub at: i64,
    pub source: &'a str,
    pub source_uid: String,
    pub capture_id: Option<i64>,
    pub recognized_text: Option<String>,
    pub recognized_card: Option<String>,
    pub confidence: f64,
    pub bbox: Option<String>,
    pub card: Option<String>,
    pub status: &'a str,
    pub review_reason: Option<String>,
}

const SESSION_COLS: &str = "id, name, league, created_at, opened_on, status, origin, started_at, ended_at, active_secs, resumed_at, planned_decks, acquisition, cost_total, notes";

fn session_row(r: &Row, now: i64) -> rusqlite::Result<Session> {
    let status: String = r.get(5)?;
    let active: i64 = r.get(9)?;
    let resumed: Option<i64> = r.get(10)?;
    let running_extra = if status == "running" { resumed.map_or(0, |t| (now - t).max(0)) } else { 0 };
    Ok(Session {
        id: r.get(0)?,
        name: r.get(1)?,
        league: r.get(2)?,
        created_at: r.get(3)?,
        opened_on: r.get(4)?,
        status,
        origin: r.get(6)?,
        started_at: r.get(7)?,
        ended_at: r.get(8)?,
        active_secs: active + running_extra,
        resumed_at: resumed,
        planned_decks: r.get(11)?,
        acquisition: Acquisition::parse(&r.get::<_, String>(12)?),
        cost_total: r.get(13)?,
        notes: r.get(14)?,
    })
}

pub fn session(c: &Connection, id: i64, now: i64) -> AppResult<Session> {
    c.query_row(&format!("SELECT {SESSION_COLS} FROM deck_sessions WHERE id = ?1 AND game = '{GAME}'"), [id], |r| session_row(r, now))
        .optional()?
        .ok_or_else(|| AppError::InvalidInput("That session doesn't exist any more.".into()))
}

/// The unfinished (running or paused) session, if any. There is at most one.
pub fn active(c: &Connection, now: i64) -> AppResult<Option<Session>> {
    Ok(c
        .query_row(
            &format!("SELECT {SESSION_COLS} FROM deck_sessions WHERE game = '{GAME}' AND status IN ('running','paused') ORDER BY id DESC LIMIT 1"),
            [],
            |r| session_row(r, now),
        )
        .optional()?)
}

pub fn create(db: &Database, input: SessionInput, now: i64, log_pos: Option<(Option<String>, u64)>) -> AppResult<i64> {
    let input = input.validate()?;
    let mut c = db.conn()?;
    let tx = c.transaction()?;
    if active(&tx, now)?.is_some() {
        return Err(AppError::InvalidInput("Finish the current session before starting a new one.".into()));
    }
    let (key, offset) = log_pos.map_or((None, None), |(k, o)| (k, Some(o as i64)));
    tx.execute(
        "INSERT INTO deck_sessions (game, name, league, created_at, opened_on, status, origin, started_at, active_secs, resumed_at,
                                    planned_decks, acquisition, cost_total, notes, log_key, log_offset)
         VALUES (?1, ?2, ?3, ?4, ?5, 'running', 'live', ?4, 0, ?4, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![GAME, input.name, input.league, now, input.opened_on, input.planned_decks, input.acquisition.as_str(), input.cost_total, input.notes, key, offset],
    )?;
    let id = tx.last_insert_rowid();
    tx.commit()?;
    Ok(id)
}

pub fn update(db: &Database, id: i64, input: SessionInput) -> AppResult<()> {
    let input = input.validate()?;
    let n = db.conn()?.execute(
        "UPDATE deck_sessions SET name = ?2, league = ?3, opened_on = ?4, planned_decks = ?5, acquisition = ?6, cost_total = ?7, notes = ?8
         WHERE id = ?1 AND game = 'poe1'",
        params![id, input.name, input.league, input.opened_on, input.planned_decks, input.acquisition.as_str(), input.cost_total, input.notes],
    )?;
    if n == 0 {
        return Err(AppError::InvalidInput("That session doesn't exist any more.".into()));
    }
    Ok(())
}

pub fn pause(db: &Database, id: i64, now: i64) -> AppResult<()> {
    db.conn()?.execute(
        "UPDATE deck_sessions SET status = 'paused', active_secs = active_secs + MAX(0, ?2 - COALESCE(resumed_at, ?2)), resumed_at = NULL
         WHERE id = ?1 AND status = 'running'",
        params![id, now],
    )?;
    Ok(())
}

/// Resumes tracking. Log lines written while paused are skipped (`log_pos` = the file's end now).
pub fn resume(db: &Database, id: i64, now: i64, log_pos: Option<(Option<String>, u64)>) -> AppResult<()> {
    let (key, offset) = log_pos.map_or((None, None), |(k, o)| (k, Some(o as i64)));
    db.conn()?.execute(
        "UPDATE deck_sessions SET status = 'running', resumed_at = ?2, log_key = COALESCE(?3, log_key), log_offset = COALESCE(?4, log_offset)
         WHERE id = ?1 AND status = 'paused'",
        params![id, now, key, offset],
    )?;
    Ok(())
}

/// Finishes the session and stores its original valuation (never overwritten later).
pub fn finish(db: &Database, id: i64, now: i64, valuation: &Valuation) -> AppResult<()> {
    let mut c = db.conn()?;
    let tx = c.transaction()?;
    let n = tx.execute(
        "UPDATE deck_sessions SET status = 'finished', ended_at = ?2,
                active_secs = active_secs + CASE WHEN status = 'running' THEN MAX(0, ?2 - COALESCE(resumed_at, ?2)) ELSE 0 END,
                resumed_at = NULL
         WHERE id = ?1 AND status IN ('running','paused')",
        params![id, now],
    )?;
    if n == 0 {
        return Err(AppError::InvalidInput("This session is already finished.".into()));
    }
    insert_valuation(&tx, id, valuation)?;
    tx.commit()?;
    Ok(())
}

pub fn insert_valuation(c: &Connection, id: i64, v: &Valuation) -> AppResult<()> {
    c.execute(
        "INSERT OR IGNORE INTO deck_valuations (session_id, game, kind, valued_at, league, prices_at, total_value, priced_cards, unpriced_cards, lines)
         VALUES (?1, 'poe1', 'final', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, v.valued_at, v.league, v.prices_at, v.total_value, v.priced_cards, v.unpriced_cards, serde_json::to_string(&v.lines)?],
    )?;
    Ok(())
}

pub fn delete(db: &Database, id: i64) -> AppResult<Vec<String>> {
    let mut c = db.conn()?;
    let tx = c.transaction()?;
    let files: Vec<String> = {
        let mut st = tx.prepare("SELECT image_file FROM deck_captures WHERE session_id = ?1 AND image_file IS NOT NULL")?;
        let rows = st.query_map([id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    tx.execute("DELETE FROM deck_sessions WHERE id = ?1 AND game = 'poe1'", [id])?;
    tx.commit()?;
    Ok(files)
}

pub fn log_position(c: &Connection, id: i64) -> AppResult<(Option<String>, Option<u64>)> {
    Ok(c.query_row("SELECT log_key, log_offset FROM deck_sessions WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.map(|o| o.max(0) as u64))))?)
}

pub fn set_log_position(c: &Connection, id: i64, key: Option<&str>, offset: u64) -> AppResult<()> {
    c.execute("UPDATE deck_sessions SET log_key = ?2, log_offset = ?3 WHERE id = ?1", params![id, key, offset as i64])?;
    Ok(())
}

/// Inserts an event unless its `source_uid` is already stored (duplicate). Returns the new id.
pub fn insert_event(c: &Connection, e: &NewEvent) -> AppResult<Option<i64>> {
    let n = c.execute(
        "INSERT OR IGNORE INTO deck_events (session_id, game, at, source, source_uid, capture_id, recognized_text, recognized_card, confidence, bbox, card, status, review_reason)
         VALUES (?1, 'poe1', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![e.session_id, e.at, e.source, e.source_uid, e.capture_id, e.recognized_text, e.recognized_card, e.confidence, e.bbox, e.card, e.status, e.review_reason],
    )?;
    Ok((n > 0).then(|| c.last_insert_rowid()))
}

fn event_row(r: &Row) -> rusqlite::Result<Event> {
    let bbox: Option<String> = r.get(9)?;
    Ok(Event {
        id: r.get(0)?,
        session_id: r.get(1)?,
        at: r.get(2)?,
        source: r.get(3)?,
        capture_id: r.get(4)?,
        recognized_text: r.get(5)?,
        recognized_card: r.get(6)?,
        confidence: r.get(7)?,
        card: r.get(8)?,
        bbox: bbox.and_then(|b| serde_json::from_str(&b).ok()),
        status: r.get(10)?,
        review_reason: r.get(11)?,
        corrected: r.get::<_, i64>(12)? != 0,
    })
}

const EVENT_COLS: &str = "id, session_id, at, source, capture_id, recognized_text, recognized_card, confidence, card, bbox, status, review_reason, corrected";

pub fn events(c: &Connection, session_id: i64) -> AppResult<Vec<Event>> {
    let mut st = c.prepare(&format!("SELECT {EVENT_COLS} FROM deck_events WHERE session_id = ?1 ORDER BY at, id"))?;
    let rows = st.query_map([session_id], event_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn event(c: &Connection, id: i64) -> AppResult<Event> {
    c.query_row(&format!("SELECT {EVENT_COLS} FROM deck_events WHERE id = ?1 AND game = 'poe1'"), [id], event_row)
        .optional()?
        .ok_or_else(|| AppError::InvalidInput("That card entry doesn't exist any more.".into()))
}

/// Recent non-removed events of `card` in the session since `since` (for duplicate checks).
pub fn recent_of_card(c: &Connection, session_id: i64, card: &str, since: i64, source: Option<&str>) -> AppResult<Vec<Event>> {
    let mut st = c.prepare(&format!(
        "SELECT {EVENT_COLS} FROM deck_events WHERE session_id = ?1 AND card = ?2 AND at >= ?3 AND status != 'removed' AND (?4 IS NULL OR source = ?4) ORDER BY at DESC"
    ))?;
    let rows = st.query_map(params![session_id, card, since, source], event_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn set_event_status(c: &Connection, id: i64, status: &str, reason: Option<&str>) -> AppResult<()> {
    c.execute("UPDATE deck_events SET status = ?2, review_reason = ?3 WHERE id = ?1", params![id, status, reason])?;
    Ok(())
}

/// The session an event belongs to must not be finished (corrections there change nothing silently).
pub fn require_open(c: &Connection, session_id: i64) -> AppResult<()> {
    let status: Option<String> = c.query_row("SELECT status FROM deck_sessions WHERE id = ?1", [session_id], |r| r.get(0)).optional()?;
    match status.as_deref() {
        Some("running") | Some("paused") => Ok(()),
        Some(_) => Err(AppError::InvalidInput("This session is finished and read-only.".into())),
        None => Err(AppError::InvalidInput("That session doesn't exist any more.".into())),
    }
}

pub fn correct_event(c: &Connection, id: i64, card: &str, now: i64) -> AppResult<()> {
    c.execute(
        "UPDATE deck_events SET card = ?2, status = 'confirmed', review_reason = NULL, corrected = 1, corrected_at = ?3 WHERE id = ?1",
        params![id, card, now],
    )?;
    Ok(())
}

pub fn insert_capture(c: &Connection, session_id: i64, taken_at: i64, source: &str, image_file: Option<&str>, w: usize, h: usize, region: &str, recognizer: i64) -> AppResult<i64> {
    c.execute(
        "INSERT INTO deck_captures (session_id, game, taken_at, source, image_file, width, height, region, recognizer)
         VALUES (?1, 'poe1', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![session_id, taken_at, source, image_file, w as i64, h as i64, region, recognizer],
    )?;
    Ok(c.last_insert_rowid())
}

pub fn finish_capture(c: &Connection, id: i64, ocr_lines: usize, ignored: usize, error: Option<&str>) -> AppResult<()> {
    c.execute("UPDATE deck_captures SET ocr_lines = ?2, ignored_lines = ?3, error = ?4 WHERE id = ?1", params![id, ocr_lines as i64, ignored as i64, error])?;
    Ok(())
}

fn capture_row(r: &Row) -> rusqlite::Result<Capture> {
    Ok(Capture {
        id: r.get(0)?,
        session_id: r.get(1)?,
        taken_at: r.get(2)?,
        source: r.get(3)?,
        has_image: r.get::<_, Option<String>>(4)?.is_some(),
        width: r.get(5)?,
        height: r.get(6)?,
        ocr_lines: r.get(7)?,
        ignored_lines: r.get(8)?,
        error: r.get(9)?,
    })
}

const CAPTURE_COLS: &str = "id, session_id, taken_at, source, image_file, width, height, ocr_lines, ignored_lines, error";

pub fn captures(c: &Connection, session_id: i64) -> AppResult<Vec<Capture>> {
    let mut st = c.prepare(&format!("SELECT {CAPTURE_COLS} FROM deck_captures WHERE session_id = ?1 ORDER BY taken_at, id"))?;
    let rows = st.query_map([session_id], capture_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// (session id, size, image file) of a capture.
pub fn capture_file(c: &Connection, id: i64) -> AppResult<(i64, i64, i64, Option<String>)> {
    c.query_row("SELECT session_id, width, height, image_file FROM deck_captures WHERE id = ?1 AND game = 'poe1'", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()?
        .ok_or_else(|| AppError::InvalidInput("That screenshot doesn't exist any more.".into()))
}

/// Captures of the session taken since `since`, newest first: (id, w, h).
pub fn recent_captures(c: &Connection, session_id: i64, since: i64, except: i64) -> AppResult<Vec<(i64, i64, i64)>> {
    let mut st = c.prepare("SELECT id, width, height FROM deck_captures WHERE session_id = ?1 AND taken_at >= ?2 AND id != ?3 ORDER BY taken_at DESC")?;
    let rows = st.query_map(params![session_id, since, except], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn capture_events(c: &Connection, capture_id: i64) -> AppResult<Vec<Event>> {
    let mut st = c.prepare(&format!("SELECT {EVENT_COLS} FROM deck_events WHERE capture_id = ?1 ORDER BY id"))?;
    let rows = st.query_map([capture_id], event_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Deletes the uncorrected events of a capture (before re-recognising it). Corrected ones stay.
pub fn clear_uncorrected(c: &Connection, capture_id: i64) -> AppResult<usize> {
    Ok(c.execute("DELETE FROM deck_events WHERE capture_id = ?1 AND corrected = 0", [capture_id])?)
}

fn valuation_of(c: &Connection, session_id: i64) -> AppResult<Option<Valuation>> {
    Ok(c
        .query_row(
            "SELECT valued_at, league, prices_at, total_value, priced_cards, unpriced_cards, lines FROM deck_valuations WHERE session_id = ?1 AND kind = 'final'",
            [session_id],
            |r| {
                let lines: String = r.get(6)?;
                Ok(Valuation {
                    valued_at: r.get(0)?,
                    league: r.get(1)?,
                    prices_at: r.get(2)?,
                    total_value: r.get(3)?,
                    priced_cards: r.get(4)?,
                    unpriced_cards: r.get(5)?,
                    lines: serde_json::from_str(&lines).unwrap_or_default(),
                })
            },
        )
        .optional()?)
}

pub fn valuation(c: &Connection, session_id: i64) -> AppResult<Option<Valuation>> {
    valuation_of(c, session_id)
}

pub fn summaries(c: &Connection, now: i64) -> AppResult<Vec<SessionSummary>> {
    let mut st = c.prepare(&format!(
        "SELECT {SESSION_COLS},
                (SELECT COUNT(*) FROM deck_events e WHERE e.session_id = s.id AND e.status = 'confirmed'),
                (SELECT COUNT(*) FROM deck_events e WHERE e.session_id = s.id AND e.status = 'review'),
                (SELECT COUNT(*) FROM deck_events e WHERE e.session_id = s.id AND e.status = 'unrecognized'),
                (SELECT MIN(at) FROM deck_events e WHERE e.session_id = s.id AND e.status = 'confirmed'),
                (SELECT MAX(at) FROM deck_events e WHERE e.session_id = s.id AND e.status = 'confirmed')
         FROM deck_sessions s WHERE game = 'poe1' ORDER BY started_at DESC, id DESC"
    ))?;
    let rows = st
        .query_map([], |r| Ok((session_row(r, now)?, r.get(15)?, r.get(16)?, r.get(17)?, r.get(18)?, r.get(19)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut out = Vec::with_capacity(rows.len());
    for (session, confirmed, review, unrecognized, first_card_at, last_card_at) in rows {
        let valuation = valuation_of(c, session.id)?;
        out.push(SessionSummary { session, confirmed, review, unrecognized, first_card_at, last_card_at, valuation });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardTotal {
    pub session_id: i64,
    pub card: String,
    pub qty: i64,
    pub first_at: i64,
    pub last_at: i64,
}

/// Confirmed card quantities per session (one row per session × card) — aggregated in SQL.
pub fn card_totals(c: &Connection) -> AppResult<Vec<CardTotal>> {
    let mut st = c.prepare(
        "SELECT session_id, card, COUNT(*), MIN(at), MAX(at) FROM deck_events
         WHERE game = 'poe1' AND status = 'confirmed' AND card IS NOT NULL GROUP BY session_id, card",
    )?;
    let rows = st
        .query_map([], |r| Ok(CardTotal { session_id: r.get(0)?, card: r.get(1)?, qty: r.get(2)?, first_at: r.get(3)?, last_at: r.get(4)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Confirmed card quantities of one session.
pub fn session_card_counts(c: &Connection, session_id: i64) -> AppResult<Vec<(String, i64)>> {
    let mut st = c.prepare("SELECT card, COUNT(*) FROM deck_events WHERE session_id = ?1 AND status = 'confirmed' AND card IS NOT NULL GROUP BY card ORDER BY card")?;
    let rows = st.query_map([session_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn overrides(c: &Connection, league: &str) -> AppResult<HashMap<String, f64>> {
    let mut st = c.prepare("SELECT card, value FROM deck_price_overrides WHERE game = 'poe1' AND league = ?1")?;
    let rows = st.query_map([league], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<HashMap<_, _>, _>>()?;
    Ok(rows)
}

pub fn set_override(db: &Database, league: &str, card: &str, value: Option<f64>, now: i64) -> AppResult<()> {
    let c = db.conn()?;
    match value {
        Some(v) if v.is_finite() && v >= 0.0 => {
            c.execute(
                "INSERT INTO deck_price_overrides (game, league, card, value, updated_at) VALUES ('poe1', ?1, ?2, ?3, ?4)
                 ON CONFLICT (game, league, card) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![league, card, v, now],
            )?;
        }
        Some(_) => return Err(AppError::InvalidInput("A price must be zero or more.".into())),
        None => {
            c.execute("DELETE FROM deck_price_overrides WHERE game = 'poe1' AND league = ?1 AND card = ?2", params![league, card])?;
        }
    }
    Ok(())
}

/// Builds a valuation from confirmed card counts: manual price first, then market, else unknown.
/// Unknown prices are never counted as zero — they are listed as unpriced.
pub fn build_valuation(counts: &[(String, i64)], market: &HashMap<String, f64>, manual: &HashMap<String, f64>, league: Option<String>, prices_at: Option<i64>, now: i64) -> Valuation {
    let mut total = 0.0;
    let (mut priced, mut unpriced) = (0, 0);
    let lines = counts
        .iter()
        .map(|(card, qty)| {
            let (unit, source) = match (manual.get(card), market.get(card)) {
                (Some(v), _) => (Some(*v), Some("manual".to_string())),
                (None, Some(v)) => (Some(*v), Some("market".to_string())),
                _ => (None, None),
            };
            match unit {
                Some(u) => {
                    total += u * *qty as f64;
                    priced += qty;
                }
                None => unpriced += qty,
            }
            ValuationLine { card: card.clone(), qty: *qty, unit, source }
        })
        .collect();
    Valuation { valued_at: now, league, prices_at, total_value: total, priced_cards: priced, unpriced_cards: unpriced, lines }
}

/// Imported (finished) session with its events; returns (session id, inserted events).
/// Events already stored (same log line) are skipped; a session that would be empty isn't kept.
#[allow(clippy::too_many_arguments)]
pub fn insert_imported(db: &Database, name: &str, league: Option<&str>, events: &[(i64, String, String)], now: i64, valuation: impl Fn(&[(String, i64)]) -> Valuation) -> AppResult<Option<(i64, usize)>> {
    if events.is_empty() {
        return Ok(None);
    }
    let mut c = db.conn()?;
    let tx = c.transaction()?;
    let start = events.iter().map(|e| e.0).min().unwrap_or(now);
    let end = events.iter().map(|e| e.0).max().unwrap_or(now);
    tx.execute(
        "INSERT INTO deck_sessions (game, name, league, created_at, status, origin, started_at, ended_at, active_secs, planned_decks, acquisition)
         VALUES ('poe1', ?1, ?2, ?3, 'finished', 'import', ?4, ?5, ?6, NULL, 'unknown')",
        params![name, league, now, start, end, end - start],
    )?;
    let id = tx.last_insert_rowid();
    let mut inserted = 0;
    for (at, uid, card) in events {
        let e = NewEvent {
            session_id: id,
            at: *at,
            source: "import",
            source_uid: uid.clone(),
            capture_id: None,
            recognized_text: None,
            recognized_card: None,
            confidence: 1.0,
            bbox: None,
            card: Some(card.clone()),
            status: "confirmed",
            review_reason: None,
        };
        if insert_event(&tx, &e)?.is_some() {
            inserted += 1;
        }
    }
    if inserted == 0 {
        tx.rollback()?;
        return Ok(None);
    }
    tx.execute("UPDATE deck_sessions SET planned_decks = ?2 WHERE id = ?1", params![id, inserted as i64])?;
    let counts = session_card_counts(&tx, id)?;
    insert_valuation(&tx, id, &valuation(&counts))?;
    tx.commit()?;
    Ok(Some((id, inserted)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str) -> SessionInput {
        SessionInput { name: name.into(), league: Some("Covens".into()), opened_on: None, planned_decks: Some(10), acquisition: Acquisition::Bulk, cost_total: Some(50.0), notes: None }
    }

    fn ev(session_id: i64, uid: &str, card: &str, status: &'static str) -> NewEvent<'static> {
        NewEvent {
            session_id,
            at: 1000,
            source: "log",
            source_uid: uid.into(),
            capture_id: None,
            recognized_text: None,
            recognized_card: None,
            confidence: 1.0,
            bbox: None,
            card: Some(card.into()),
            status,
            review_reason: None,
        }
    }

    #[test]
    fn session_lifecycle() {
        let db = Database::open_in_memory().unwrap();
        let id = create(&db, input("Evening"), 100, None).unwrap();
        assert!(create(&db, input("Second"), 101, None).is_err(), "one unfinished session at a time");
        pause(&db, id, 160).unwrap();
        let s = session(&db.conn().unwrap(), id, 500).unwrap();
        assert_eq!((s.status.as_str(), s.active_secs), ("paused", 60));
        resume(&db, id, 200, None).unwrap();
        let s = session(&db.conn().unwrap(), id, 230).unwrap();
        assert_eq!((s.status.as_str(), s.active_secs), ("running", 90));
        {
            let c = db.conn().unwrap();
            insert_event(&c, &ev(id, "log:a:1", "The Lover", "confirmed")).unwrap();
            assert!(insert_event(&c, &ev(id, "log:a:1", "The Lover", "confirmed")).unwrap().is_none(), "same line twice");
            insert_event(&c, &ev(id, "log:a:2", "The Lover", "confirmed")).unwrap();
            insert_event(&c, &ev(id, "log:a:3", "The Doctor", "review")).unwrap();
        }
        let counts = session_card_counts(&db.conn().unwrap(), id).unwrap();
        assert_eq!(counts, vec![("The Lover".to_string(), 2)], "review entries aren't counted");
        let v = build_valuation(&counts, &HashMap::from([("The Lover".into(), 2.0)]), &HashMap::new(), Some("Covens".into()), Some(90), 300);
        finish(&db, id, 300, &v).unwrap();
        assert!(finish(&db, id, 301, &v).is_err());
        let s = summaries(&db.conn().unwrap(), 400).unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!((s[0].confirmed, s[0].review, s[0].session.active_secs), (2, 1, 160));
        assert_eq!(s[0].valuation.as_ref().unwrap().total_value, 4.0);
        assert!(require_open(&db.conn().unwrap(), id).is_err(), "finished sessions are read-only");
        // A new session can start now.
        let id2 = create(&db, input("Next"), 500, Some((Some("k".into()), 42))).unwrap();
        assert_eq!(log_position(&db.conn().unwrap(), id2).unwrap(), (Some("k".into()), Some(42)));
        delete(&db, id).unwrap();
        assert_eq!(summaries(&db.conn().unwrap(), 600).unwrap().len(), 1);
    }

    #[test]
    fn valuation_never_treats_unknown_as_zero() {
        let counts = vec![("A".to_string(), 2), ("B".to_string(), 1), ("C".to_string(), 3)];
        let v = build_valuation(&counts, &HashMap::from([("A".into(), 1.5), ("C".into(), 10.0)]), &HashMap::from([("C".into(), 4.0)]), None, None, 1);
        assert_eq!(v.total_value, 1.5 * 2.0 + 4.0 * 3.0);
        assert_eq!((v.priced_cards, v.unpriced_cards), (5, 1));
        assert_eq!(v.lines[2].source.as_deref(), Some("manual"));
        assert_eq!(v.lines[1].unit, None);
    }

    #[test]
    fn imports_skip_lines_already_stored() {
        let db = Database::open_in_memory().unwrap();
        let evs = vec![(10, "log:k:0".to_string(), "The Lover".to_string()), (20, "log:k:90".to_string(), "Rain of Chaos".to_string())];
        let val = |c: &[(String, i64)]| build_valuation(c, &HashMap::new(), &HashMap::new(), None, None, 5);
        let (id, n) = insert_imported(&db, "Imported", Some("Covens"), &evs, 50, val).unwrap().unwrap();
        assert_eq!(n, 2);
        let s = session(&db.conn().unwrap(), id, 60).unwrap();
        assert_eq!((s.status.as_str(), s.origin.as_str(), s.planned_decks), ("finished", "import", Some(2)));
        // Same file again: nothing new, no empty session.
        assert!(insert_imported(&db, "Imported", None, &evs, 70, val).unwrap().is_none());
        assert_eq!(summaries(&db.conn().unwrap(), 80).unwrap().len(), 1);
    }

    #[test]
    fn overrides_round_trip() {
        let db = Database::open_in_memory().unwrap();
        set_override(&db, "Covens", "The Doctor", Some(900.0), 1).unwrap();
        assert_eq!(overrides(&db.conn().unwrap(), "Covens").unwrap().get("The Doctor"), Some(&900.0));
        assert!(set_override(&db, "Covens", "X", Some(-1.0), 1).is_err());
        set_override(&db, "Covens", "The Doctor", None, 2).unwrap();
        assert!(overrides(&db.conn().unwrap(), "Covens").unwrap().is_empty());
    }

    #[test]
    fn validation() {
        assert!(input("  ").validate().is_err());
        let mut i = input("x");
        i.cost_total = Some(-1.0);
        assert!(i.validate().is_err());
        let mut i = input("x");
        i.opened_on = Some("bad".into());
        assert_eq!(i.validate().unwrap().opened_on, None);
    }
}
