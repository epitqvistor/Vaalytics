//! Character attribution for campaign events, fed by the Session Intelligence
//! log reader (one reader, one pass) and by the one-off history import.
//!
//! Rules verified on a real PoE 2 log (docs/modules/campaign-intelligence.md):
//! - level-up lines name a character and its class, but party members level up
//!   in the same log. A level-up by a name that joined/left the area this run is
//!   never the player.
//! - the active character can only change after the client starts or connects
//!   to the login server (log in / character select). Within a login segment, a
//!   level-up by another name is a party member and is ignored.
//! - events before the segment's first level-up are stored without a character
//!   and assigned once it is known.

use crate::error::AppResult;
use crate::game::GameId;
use crate::session::areas::{self, AreaKind};
use crate::session::log_format::LogEvent;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;

pub struct CampaignHook {
    game: GameId,
    /// Live hook persists its state in `campaign_state`; the importer doesn't.
    live: bool,
    loaded: bool,
    segment: Option<String>,
    character: Option<(i64, String)>,
    joined: HashSet<String>,
    in_campaign: bool,
    /// Zone event still waiting for its display name (`[SCENE] Set Source`).
    pending_name: Option<i64>,
}

impl CampaignHook {
    pub fn live(game: GameId) -> Self {
        Self::new(game, true)
    }

    pub fn import(game: GameId) -> Self {
        let mut h = Self::new(game, false);
        h.loaded = true;
        h
    }

    fn new(game: GameId, live: bool) -> Self {
        Self { game, live, loaded: false, segment: None, character: None, joined: HashSet::new(), in_campaign: false, pending_name: None }
    }

    fn load(&mut self, c: &Connection) -> AppResult<()> {
        if self.loaded {
            return Ok(());
        }
        self.loaded = true;
        let row: Option<(Option<String>, Option<i64>)> = c
            .query_row("SELECT segment, character_id FROM campaign_state WHERE game = ?1", params![self.game.as_str()], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        if let Some((segment, cid)) = row {
            self.segment = segment;
            if let Some(cid) = cid {
                self.character = c
                    .query_row("SELECT id, name FROM campaign_characters WHERE id = ?1", params![cid], |r| Ok((r.get(0)?, r.get(1)?)))
                    .optional()?;
            }
        }
        Ok(())
    }

    fn persist(&self, c: &Connection, now: i64) -> AppResult<()> {
        if !self.live {
            return Ok(());
        }
        c.execute(
            "INSERT INTO campaign_state (game, segment, character_id, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (game) DO UPDATE SET segment = excluded.segment, character_id = excluded.character_id, updated_at = excluded.updated_at",
            params![self.game.as_str(), self.segment, self.character.as_ref().map(|c| c.0), now],
        )?;
        Ok(())
    }

    fn new_segment(&mut self, c: &Connection, key: &str, off: u64, at: i64) -> AppResult<()> {
        self.segment = Some(format!("{key}:{off}"));
        self.character = None;
        self.pending_name = None;
        self.persist(c, at)
    }

    /// Handles one parsed line inside the caller's transaction. Returns whether
    /// campaign data changed.
    pub fn on_event(&mut self, c: &Connection, ev: &LogEvent, at: i64, key: &str, off: u64) -> AppResult<bool> {
        if self.game != GameId::Poe2 {
            return Ok(false);
        }
        self.load(c)?;
        if self.segment.is_none() {
            self.segment = Some(format!("{key}:{off}"));
        }
        Ok(match ev {
            LogEvent::ClientStart => {
                self.joined.clear();
                self.in_campaign = false;
                self.new_segment(c, key, off, at)?;
                false
            }
            LogEvent::LoginConnect => {
                self.new_segment(c, key, off, at)?;
                false
            }
            LogEvent::ClientVersion { tag } => {
                if self.live {
                    c.execute(
                        "INSERT INTO campaign_state (game, client_tag, client_tag_at, updated_at) VALUES (?1, ?2, ?3, ?3)
                         ON CONFLICT (game) DO UPDATE SET client_tag = excluded.client_tag, client_tag_at = excluded.client_tag_at, updated_at = excluded.updated_at",
                        params![self.game.as_str(), tag, at],
                    )?;
                } else {
                    // Import: keep the newest tag seen without touching the live attribution state.
                    c.execute(
                        "INSERT INTO campaign_state (game, client_tag, client_tag_at, updated_at) VALUES (?1, ?2, ?3, ?3)
                         ON CONFLICT (game) DO UPDATE SET client_tag = excluded.client_tag, client_tag_at = excluded.client_tag_at
                         WHERE campaign_state.client_tag_at IS NULL OR campaign_state.client_tag_at <= excluded.client_tag_at",
                        params![self.game.as_str(), tag, at],
                    )?;
                }
                false
            }
            LogEvent::PlayerJoined { name } | LogEvent::PlayerLeft { name } => {
                self.joined.insert(name.clone());
                false
            }
            LogEvent::LevelUp { level, name, class } => self.level_up(c, *level, name, class, at, key, off)?,
            LogEvent::AreaGenerated { level, area_id, .. } => {
                let kind = areas::classify(area_id);
                let campaign = matches!(kind, AreaKind::Campaign | AreaKind::Town);
                if campaign || self.in_campaign {
                    let id = self.insert(c, at, "zone", Some(area_id), Some(*level as i64), None, None, key, off)?;
                    self.pending_name = if campaign { id } else { None };
                    self.in_campaign = campaign;
                    id.is_some()
                } else {
                    false
                }
            }
            LogEvent::SceneName(name) | LogEvent::LoadingScreen { name, .. } => {
                if let Some(id) = self.pending_name.take() {
                    c.execute("UPDATE campaign_events SET area_name = ?1 WHERE id = ?2", params![name.trim(), id])?;
                }
                false
            }
            LogEvent::PassivePoints { amount, weapon_set } => {
                let kind = if *weapon_set { "weapon_set_points" } else { "passive_points" };
                self.insert(c, at, kind, None, None, Some(*amount as i64), None, key, off)?.is_some()
            }
            LogEvent::Slain { name } => match &self.character {
                Some((_, cur)) if cur == name && self.in_campaign => self.insert(c, at, "death", None, None, None, None, key, off)?.is_some(),
                _ => false,
            },
            _ => false,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn level_up(&mut self, c: &Connection, level: u32, name: &str, class: &str, at: i64, key: &str, off: u64) -> AppResult<bool> {
        if self.joined.contains(name) {
            return Ok(false); // a party member
        }
        let id = match &self.character {
            Some((id, cur)) if cur == name => *id,
            Some(_) => return Ok(false), // another name without a login in between: party member
            None => {
                let id = upsert_character(c, self.game, name, class, level, at)?;
                self.character = Some((id, name.to_string()));
                if let Some(seg) = &self.segment {
                    c.execute(
                        "UPDATE campaign_events SET character_id = ?1 WHERE game = ?2 AND segment = ?3 AND character_id IS NULL",
                        params![id, self.game.as_str(), seg],
                    )?;
                }
                self.persist(c, at)?;
                id
            }
        };
        let (old_class, last_seen): (String, i64) =
            c.query_row("SELECT class, last_seen_at FROM campaign_characters WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        // Only a newer line can change the class: re-reading older lines (crash
        // recovery, history import) must not "un-ascend" the character.
        if at >= last_seen && old_class != class {
            self.insert(c, at, "ascended", None, None, None, Some(&format!("{old_class}\u{2192}{class}")), key, off)?;
            c.execute("UPDATE campaign_characters SET class = ?1 WHERE id = ?2", params![class, id])?;
        }
        c.execute(
            "UPDATE campaign_characters SET level = MAX(level, ?1), last_seen_at = MAX(last_seen_at, ?2) WHERE id = ?3",
            params![level, at, id],
        )?;
        Ok(self.insert(c, at, "level", None, None, Some(level as i64), None, key, off)?.is_some())
    }

    #[allow(clippy::too_many_arguments)]
    fn insert(
        &self,
        c: &Connection,
        at: i64,
        kind: &str,
        area_id: Option<&str>,
        area_level: Option<i64>,
        amount: Option<i64>,
        detail: Option<&str>,
        key: &str,
        off: u64,
    ) -> AppResult<Option<i64>> {
        let n = c.execute(
            "INSERT OR IGNORE INTO campaign_events (game, character_id, segment, at, kind, area_id, area_level, amount, detail, log_key, log_offset)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                self.game.as_str(),
                self.character.as_ref().map(|c| c.0),
                self.segment.as_deref().unwrap_or(""),
                at,
                kind,
                area_id,
                area_level,
                amount,
                detail,
                key,
                off as i64
            ],
        )?;
        Ok((n > 0).then(|| c.last_insert_rowid()))
    }
}

fn upsert_character(c: &Connection, game: GameId, name: &str, class: &str, level: u32, at: i64) -> AppResult<i64> {
    c.execute(
        "INSERT INTO campaign_characters (game, name, class, base_class, level, first_seen_at, last_seen_at) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?5)
         ON CONFLICT (game, name) DO UPDATE SET last_seen_at = MAX(last_seen_at, excluded.last_seen_at), first_seen_at = MIN(first_seen_at, excluded.first_seen_at)",
        params![game.as_str(), name, class, level, at],
    )?;
    Ok(c.query_row("SELECT id FROM campaign_characters WHERE game = ?1 AND name = ?2", params![game.as_str(), name], |r| r.get(0))?)
}
