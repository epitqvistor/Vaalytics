//! Campaign Intelligence persistence: characters, events, manual marks.

use crate::error::{AppError, AppResult};
use crate::game::GameId;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CharacterRow {
    pub id: i64,
    pub name: String,
    pub class: String,
    pub base_class: String,
    pub level: i64,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub hidden: bool,
    /// Zone events in campaign areas (acts/interludes) — 0 = never seen in the campaign.
    pub campaign_zones: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventRow {
    pub at: i64,
    pub kind: String,
    pub area_id: Option<String>,
    pub area_name: Option<String>,
    pub area_level: Option<i64>,
    pub amount: Option<i64>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarkRow {
    pub objective_id: String,
    pub mark: String,
    pub choice: Option<String>,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CampaignStatus {
    /// Character the live reader currently attributes events to.
    pub active_character_id: Option<i64>,
    /// `poe2_production/tags/<tag>` last seen in Client.txt.
    pub client_tag: Option<String>,
    pub client_tag_at: Option<i64>,
    /// Events waiting for their login segment's character to be identified.
    pub unassigned_events: i64,
    /// Change token: the newest campaign event id (rowid, O(1)). The UI re-reads
    /// characters and events only when this (or `unassigned_events`) changes.
    pub revision: i64,
}

pub fn status(c: &Connection, game: GameId) -> AppResult<CampaignStatus> {
    let row: Option<(Option<i64>, Option<String>, Option<i64>)> = c
        .query_row("SELECT character_id, client_tag, client_tag_at FROM campaign_state WHERE game = ?1", params![game.as_str()], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let unassigned: i64 = c.query_row("SELECT COUNT(*) FROM campaign_events WHERE game = ?1 AND character_id IS NULL", params![game.as_str()], |r| r.get(0))?;
    let revision: i64 = c.query_row("SELECT COALESCE(MAX(id), 0) FROM campaign_events", [], |r| r.get(0))?;
    let (active_character_id, client_tag, client_tag_at) = row.unwrap_or((None, None, None));
    Ok(CampaignStatus { active_character_id, client_tag, client_tag_at, unassigned_events: unassigned, revision })
}

pub fn characters(c: &Connection, game: GameId) -> AppResult<Vec<CharacterRow>> {
    let mut st = c.prepare(
        "SELECT ch.id, ch.name, ch.class, ch.base_class, ch.level, ch.first_seen_at, ch.last_seen_at, ch.hidden,
                (SELECT COUNT(*) FROM campaign_events e WHERE e.character_id = ch.id AND e.kind = 'zone'
                    AND (e.area_id GLOB 'G[0-9]*_*' OR e.area_id GLOB 'P[0-9]*_*'))
         FROM campaign_characters ch WHERE ch.game = ?1 ORDER BY ch.last_seen_at DESC",
    )?;
    let rows = st.query_map(params![game.as_str()], |r| {
        Ok(CharacterRow {
            id: r.get(0)?,
            name: r.get(1)?,
            class: r.get(2)?,
            base_class: r.get(3)?,
            level: r.get(4)?,
            first_seen_at: r.get(5)?,
            last_seen_at: r.get(6)?,
            hidden: r.get::<_, i64>(7)? != 0,
            campaign_zones: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn ensure_character(c: &Connection, game: GameId, id: i64) -> AppResult<()> {
    let ok: Option<i64> = c.query_row("SELECT 1 FROM campaign_characters WHERE id = ?1 AND game = ?2", params![id, game.as_str()], |r| r.get(0)).optional()?;
    ok.map(|_| ()).ok_or_else(|| AppError::InvalidInput("Unknown character.".into()))
}

pub fn events(c: &Connection, game: GameId, character_id: i64) -> AppResult<Vec<EventRow>> {
    ensure_character(c, game, character_id)?;
    let mut st = c.prepare(
        "SELECT at, kind, area_id, area_name, area_level, amount, detail FROM campaign_events
         WHERE character_id = ?1 ORDER BY at, log_key, log_offset, id",
    )?;
    let rows = st.query_map(params![character_id], |r| {
        Ok(EventRow { at: r.get(0)?, kind: r.get(1)?, area_id: r.get(2)?, area_name: r.get(3)?, area_level: r.get(4)?, amount: r.get(5)?, detail: r.get(6)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn marks(c: &Connection, game: GameId, character_id: i64) -> AppResult<Vec<MarkRow>> {
    ensure_character(c, game, character_id)?;
    let mut st = c.prepare("SELECT objective_id, mark, choice, at FROM campaign_marks WHERE character_id = ?1 ORDER BY at")?;
    let rows = st.query_map(params![character_id], |r| Ok(MarkRow { objective_id: r.get(0)?, mark: r.get(1)?, choice: r.get(2)?, at: r.get(3)? }))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Objective ids are dataset ids like `a1.king-in-the-mists`.
fn valid_objective_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
}

/// `mark = None` removes the player's mark (back to automatic detection).
pub fn set_mark(c: &Connection, game: GameId, character_id: i64, objective_id: &str, mark: Option<&str>, choice: Option<&str>, now: i64) -> AppResult<()> {
    ensure_character(c, game, character_id)?;
    if !valid_objective_id(objective_id) {
        return Err(AppError::InvalidInput("Invalid objective id.".into()));
    }
    if choice.is_some_and(|s| s.len() > 200) {
        return Err(AppError::InvalidInput("Choice text is too long.".into()));
    }
    match mark {
        None => {
            c.execute("DELETE FROM campaign_marks WHERE character_id = ?1 AND objective_id = ?2", params![character_id, objective_id])?;
        }
        Some(m @ ("done" | "skipped" | "not-done")) => {
            c.execute(
                "INSERT INTO campaign_marks (character_id, objective_id, mark, choice, at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (character_id, objective_id) DO UPDATE SET mark = excluded.mark, choice = excluded.choice, at = excluded.at",
                params![character_id, objective_id, m, choice, now],
            )?;
        }
        Some(_) => return Err(AppError::InvalidInput("Invalid mark.".into())),
    }
    Ok(())
}

pub fn set_hidden(c: &Connection, game: GameId, character_id: i64, hidden: bool) -> AppResult<()> {
    ensure_character(c, game, character_id)?;
    c.execute("UPDATE campaign_characters SET hidden = ?1 WHERE id = ?2", params![hidden as i64, character_id])?;
    Ok(())
}

/// Deletes a character with its events and marks. Its log lines would be
/// re-imported by a later history import.
pub fn delete_character(c: &Connection, game: GameId, character_id: i64) -> AppResult<()> {
    ensure_character(c, game, character_id)?;
    c.execute("DELETE FROM campaign_characters WHERE id = ?1", params![character_id])?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RewardMarkRow {
    pub reward_id: String,
    pub stage: String,
    pub choice: Option<String>,
    pub at: i64,
}

pub const REWARD_STAGES: &[&str] = &["not-claimed", "boss-defeated", "item-acquired", "submitted", "applied", "complete"];

pub fn reward_marks(c: &Connection, game: GameId, character_id: i64) -> AppResult<Vec<RewardMarkRow>> {
    ensure_character(c, game, character_id)?;
    let mut st = c.prepare("SELECT reward_id, stage, choice, at FROM campaign_reward_marks WHERE character_id = ?1 ORDER BY at")?;
    let rows = st.query_map(params![character_id], |r| Ok(RewardMarkRow { reward_id: r.get(0)?, stage: r.get(1)?, choice: r.get(2)?, at: r.get(3)? }))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// `stage = None` removes the player's reward mark.
pub fn set_reward_mark(c: &Connection, game: GameId, character_id: i64, reward_id: &str, stage: Option<&str>, choice: Option<&str>, now: i64) -> AppResult<()> {
    ensure_character(c, game, character_id)?;
    if !valid_objective_id(reward_id) {
        return Err(AppError::InvalidInput("Invalid reward id.".into()));
    }
    if choice.is_some_and(|s| s.len() > 200) {
        return Err(AppError::InvalidInput("Choice text is too long.".into()));
    }
    match stage {
        None => {
            c.execute("DELETE FROM campaign_reward_marks WHERE character_id = ?1 AND reward_id = ?2", params![character_id, reward_id])?;
        }
        Some(s) if REWARD_STAGES.contains(&s) => {
            c.execute(
                "INSERT INTO campaign_reward_marks (character_id, reward_id, stage, choice, at) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (character_id, reward_id) DO UPDATE SET stage = excluded.stage, choice = excluded.choice, at = excluded.at",
                params![character_id, reward_id, s, choice, now],
            )?;
        }
        Some(_) => return Err(AppError::InvalidInput("Invalid reward stage.".into())),
    }
    Ok(())
}
