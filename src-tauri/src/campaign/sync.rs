//! On-demand campaign reader for Path of Exile 1 (Location Atlas).
//!
//! The Session Intelligence tracker (which feeds the campaign hook for PoE 2) only
//! runs for PoE 2. For PoE 1 the same pieces are driven here: the shared reader
//! (`session::reader`, rotation/truncation aware), the shared parser
//! (`session::log_format`) and the same `CampaignHook` with the same attribution
//! rules and storage. It runs only when the Atlas asks (while it is visible) and
//! resumes from the position stored in `campaign_state`, so closing the Atlas
//! loses nothing: the next sync catches up. Read-only; nothing leaves the PC.

use super::hook::CampaignHook;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use crate::session::log_format::{self, LineResult, LocalStamp};
use crate::session::reader;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::path::Path;

/// One sync at a time: the Atlas window and the main-window page may both ask; the
/// second waits and then finds nothing new (positions are stored per game).
static SYNC_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Bytes read per transaction; a first sync of a big log commits in steps.
const CHUNK_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub lines: u64,
    pub events_stored: u64,
    /// The log was replaced or truncated since the last sync (read again from the start).
    pub reset: bool,
    /// Bytes still unread (more than `max_bytes` were waiting).
    pub remaining: u64,
}

fn position(db: &Database, game: GameId) -> AppResult<(Option<String>, u64)> {
    let row: Option<(Option<String>, Option<i64>)> = db
        .conn()?
        .query_row("SELECT log_key, log_offset FROM campaign_state WHERE game = ?1", params![game.as_str()], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    Ok(row.map(|(k, o)| (k, o.unwrap_or(0).max(0) as u64)).unwrap_or((None, 0)))
}

/// Reads what was appended to `path` since the last sync (at most `max_bytes`).
pub fn sync_log(db: &Database, game: GameId, path: &Path, to_unix: fn(LocalStamp) -> Option<i64>, max_bytes: u64) -> AppResult<SyncSummary> {
    if game != GameId::Poe1 {
        return Err(AppError::InvalidInput("This reader is for Path of Exile 1; PoE 2 is read by Session Intelligence.".into()));
    }
    let _guard = SYNC_LOCK.lock().map_err(|_| AppError::StatePoisoned)?;
    let (mut key, mut offset) = position(db, game)?;
    let mut hook = CampaignHook::live(game);
    let mut summary = SyncSummary::default();
    let mut read: u64 = 0;
    loop {
        let chunk = reader::read_from(path, key.as_deref(), offset, CHUNK_BYTES)?;
        summary.reset |= chunk.reset.is_some();
        let new_key = chunk.key.clone();
        let mut conn = db.conn()?;
        let tx = conn.transaction()?;
        let pos_key = new_key.as_deref().unwrap_or_default();
        let mut now = 0;
        for (off, line) in &chunk.lines {
            summary.lines += 1;
            if let LineResult::Event(p) = log_format::parse_line(line) {
                if let Some(at) = to_unix(p.at) {
                    now = at;
                    if hook.on_event(&tx, &p.event, at, pos_key, *off)? {
                        summary.events_stored += 1;
                    }
                }
            }
        }
        tx.execute(
            "INSERT INTO campaign_state (game, log_path, log_key, log_offset, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (game) DO UPDATE SET log_path = excluded.log_path, log_key = excluded.log_key, log_offset = excluded.log_offset",
            params![game.as_str(), path.to_string_lossy(), new_key, chunk.offset as i64, now],
        )?;
        tx.commit()?;
        read += chunk.offset.saturating_sub(if chunk.reset.is_some() { 0 } else { offset });
        key = new_key;
        offset = chunk.offset;
        summary.remaining = chunk.remaining;
        if chunk.remaining == 0 || chunk.lines.is_empty() || read >= max_bytes {
            break;
        }
    }
    Ok(summary)
}
