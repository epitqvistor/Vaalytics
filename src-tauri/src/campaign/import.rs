//! One-off history import: reads the whole Client.txt once, on the player's
//! request, so a character already mid-campaign has its past progress. Uses the
//! same parser and attribution as the live reader; events are keyed by
//! (log file, byte offset), so importing twice — or importing what the live
//! reader already stored — never duplicates anything. Read-only, streamed, with
//! periodic commits; nothing is sent anywhere.

use super::hook::CampaignHook;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use crate::session::log_format::{self, LineResult, LocalStamp};
use crate::session::reader;
use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

const COMMIT_EVERY_LINES: u64 = 50_000;
const MAX_LINE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub lines: u64,
    pub events_stored: u64,
    pub characters: i64,
}

pub fn import_log(db: &Database, game: GameId, path: &Path, to_unix: fn(LocalStamp) -> Option<i64>) -> AppResult<ImportSummary> {
    if game != GameId::Poe2 {
        return Err(AppError::InvalidInput("Campaign Intelligence is available for Path of Exile 2 only.".into()));
    }
    let key = reader::probe(path)?.key.ok_or_else(|| AppError::InvalidInput("Client.txt is empty.".into()))?;
    let mut input = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut hook = CampaignHook::import(game);
    let mut summary = ImportSummary::default();
    let mut conn = db.conn()?;
    let mut tx = conn.transaction()?;
    let mut buf = Vec::with_capacity(4096);
    let mut offset: u64 = 0;
    loop {
        buf.clear();
        let n = input.read_until(b'\n', &mut buf)?;
        if n == 0 || buf.last() != Some(&b'\n') {
            break; // EOF or an incomplete last line (the game is still writing it)
        }
        let line_start = offset;
        offset += n as u64;
        summary.lines += 1;
        if buf.len() > MAX_LINE_BYTES {
            continue;
        }
        let line = String::from_utf8_lossy(&buf);
        if let LineResult::Event(p) = log_format::parse_line(&line) {
            if let Some(at) = to_unix(p.at) {
                if hook.on_event(&tx, &p.event, at, &key, line_start)? {
                    summary.events_stored += 1;
                }
            }
        }
        if summary.lines % COMMIT_EVERY_LINES == 0 {
            tx.commit()?;
            tx = conn.transaction()?;
        }
    }
    tx.commit()?;
    summary.characters = conn.query_row("SELECT COUNT(*) FROM campaign_characters WHERE game = ?1", [game.as_str()], |r| r.get(0))?;
    Ok(summary)
}
