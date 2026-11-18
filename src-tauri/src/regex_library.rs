//! REGEX module storage: the user's saved search strings (library) and the
//! eight quick slots, per game. The host validates and stores; generation,
//! import merging and duplicate handling live in the UI.
//! Spec: docs/modules/regex.md

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Generous: the game box takes 250 characters, but split sets and notes-like
/// strings may be stored for reference.
const MAX_REGEX: usize = 4000;
const MAX_NAME: usize = 80;
const MAX_TEXT: usize = 4000;
const MAX_TAGS: usize = 20;
const MAX_TAG: usize = 40;
const MAX_ENTRIES: i64 = 5000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexEntry {
    pub id: String,
    pub name: String,
    pub category: String,
    pub regex: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    Saved { entry: RegexEntry },
    /// Another entry already has this name; nothing was written.
    #[serde(rename_all = "camelCase")]
    NameTaken { existing_id: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegexSlot {
    pub slot: i64,
    pub label: String,
    pub regex: String,
    pub library_id: Option<String>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn validate(e: &mut RegexEntry) -> AppResult<()> {
    let bad = |m: &str| Err(AppError::InvalidInput(m.into()));
    if !valid_id(&e.id) {
        return bad("invalid entry id");
    }
    e.name = e.name.trim().to_string();
    e.category = e.category.trim().to_string();
    if e.name.is_empty() || e.name.chars().count() > MAX_NAME {
        return bad("Name must be 1–80 characters.");
    }
    if e.category.is_empty() || e.category.chars().count() > MAX_NAME {
        return bad("Category must be 1–80 characters.");
    }
    if e.regex.trim().is_empty() {
        return bad("The regex is empty.");
    }
    if e.regex.chars().count() > MAX_REGEX {
        return bad("The regex is too long (more than 4000 characters).");
    }
    if e.description.chars().count() > MAX_TEXT || e.notes.chars().count() > MAX_TEXT {
        return bad("Description and notes are limited to 4000 characters.");
    }
    let mut tags: Vec<String> = Vec::new();
    for t in &e.tags {
        let t = t.trim();
        if t.is_empty() {
            continue;
        }
        if t.chars().count() > MAX_TAG {
            return bad("Tags are limited to 40 characters.");
        }
        if !tags.iter().any(|x| x.eq_ignore_ascii_case(t)) {
            tags.push(t.to_string());
        }
    }
    if tags.len() > MAX_TAGS {
        return bad("At most 20 tags.");
    }
    e.tags = tags;
    Ok(())
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<RegexEntry> {
    let tags: String = r.get(6)?;
    Ok(RegexEntry {
        id: r.get(0)?,
        name: r.get(1)?,
        category: r.get(2)?,
        regex: r.get(3)?,
        description: r.get(4)?,
        notes: r.get(5)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        favorite: r.get::<_, i64>(7)? != 0,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

const COLS: &str = "id, name, category, regex, description, notes, tags, favorite, created_at, updated_at";

pub fn list(db: &Database, game: GameId) -> AppResult<Vec<RegexEntry>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM regex_library WHERE game = ?1 ORDER BY name COLLATE NOCASE"))?;
    let rows = stmt.query_map(params![game.as_str()], row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Inserts or updates (same id). A name used by a *different* entry is a
/// conflict unless `overwrite` is set, in which case that entry is replaced.
pub fn save(db: &Database, game: GameId, entry: &RegexEntry, overwrite: bool, now: i64) -> AppResult<SaveOutcome> {
    let mut e = entry.clone();
    validate(&mut e)?;
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    let other: Option<String> = tx
        .query_row(
            "SELECT id FROM regex_library WHERE game = ?1 AND name = ?2 AND id != ?3",
            params![game.as_str(), e.name, e.id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(existing_id) = other {
        if !overwrite {
            return Ok(SaveOutcome::NameTaken { existing_id });
        }
        // Explicit overwrite: the existing entry is replaced by this one.
        // Quick slots keep their own copy; repoint them to the surviving entry.
        tx.execute("DELETE FROM regex_library WHERE game = ?1 AND id = ?2", params![game.as_str(), existing_id])?;
        tx.execute(
            "UPDATE regex_slots SET library_id = ?3 WHERE game = ?1 AND library_id = ?2",
            params![game.as_str(), existing_id, e.id],
        )?;
    }
    let created: Option<i64> = tx
        .query_row(
            "SELECT created_at FROM regex_library WHERE game = ?1 AND id = ?2",
            params![game.as_str(), e.id],
            |r| r.get(0),
        )
        .optional()?;
    if created.is_none() {
        let count: i64 = tx.query_row("SELECT COUNT(*) FROM regex_library WHERE game = ?1", params![game.as_str()], |r| r.get(0))?;
        if count >= MAX_ENTRIES {
            return Err(AppError::InvalidInput("The library is full (5000 entries).".into()));
        }
    }
    e.created_at = created.unwrap_or(if e.created_at > 0 { e.created_at } else { now });
    e.updated_at = now;
    tx.execute(
        "INSERT INTO regex_library (game, id, name, category, regex, description, tags, notes, favorite, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT (game, id) DO UPDATE SET name = excluded.name, category = excluded.category, regex = excluded.regex,
           description = excluded.description, tags = excluded.tags, notes = excluded.notes, favorite = excluded.favorite,
           updated_at = excluded.updated_at",
        params![
            game.as_str(),
            e.id,
            e.name,
            e.category,
            e.regex,
            e.description,
            serde_json::to_string(&e.tags)?,
            e.notes,
            e.favorite as i64,
            e.created_at,
            e.updated_at
        ],
    )?;
    tx.commit()?;
    Ok(SaveOutcome::Saved { entry: e })
}

pub fn set_favorite(db: &Database, game: GameId, id: &str, favorite: bool) -> AppResult<()> {
    db.conn()?.execute(
        "UPDATE regex_library SET favorite = ?3 WHERE game = ?1 AND id = ?2",
        params![game.as_str(), id, favorite as i64],
    )?;
    Ok(())
}

pub fn delete(db: &Database, game: GameId, id: &str) -> AppResult<()> {
    let conn = db.conn()?;
    conn.execute("DELETE FROM regex_library WHERE game = ?1 AND id = ?2", params![game.as_str(), id])?;
    conn.execute("UPDATE regex_slots SET library_id = NULL WHERE game = ?1 AND library_id = ?2", params![game.as_str(), id])?;
    Ok(())
}

pub fn slots(db: &Database, game: GameId) -> AppResult<Vec<RegexSlot>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare("SELECT slot, label, regex, library_id FROM regex_slots WHERE game = ?1 ORDER BY slot")?;
    let rows = stmt.query_map(params![game.as_str()], |r| {
        Ok(RegexSlot { slot: r.get(0)?, label: r.get(1)?, regex: r.get(2)?, library_id: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// `None` clears the slot.
pub fn set_slot(db: &Database, game: GameId, slot: i64, value: Option<&RegexSlot>) -> AppResult<()> {
    if !(1..=8).contains(&slot) {
        return Err(AppError::InvalidInput("Quick slots are numbered 1–8.".into()));
    }
    let conn = db.conn()?;
    match value {
        None => {
            conn.execute("DELETE FROM regex_slots WHERE game = ?1 AND slot = ?2", params![game.as_str(), slot])?;
        }
        Some(v) => {
            let label = v.label.trim();
            if label.is_empty() || label.chars().count() > MAX_NAME {
                return Err(AppError::InvalidInput("Slot label must be 1–80 characters.".into()));
            }
            if v.regex.trim().is_empty() || v.regex.chars().count() > MAX_REGEX {
                return Err(AppError::InvalidInput("The slot's regex is empty or too long.".into()));
            }
            if let Some(id) = &v.library_id {
                if !valid_id(id) {
                    return Err(AppError::InvalidInput("invalid entry id".into()));
                }
            }
            conn.execute(
                "INSERT OR REPLACE INTO regex_slots (game, slot, label, regex, library_id) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![game.as_str(), slot, label, v.regex, v.library_id],
            )?;
        }
    }
    Ok(())
}

/// Import files are read whole by the host and validated in the UI.
pub const MAX_IMPORT_BYTES: u64 = 2 * 1024 * 1024;

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, name: &str) -> RegexEntry {
        RegexEntry {
            id: id.into(),
            name: name.into(),
            category: "Maps".into(),
            regex: "\"!reflect|regen\"".into(),
            description: String::new(),
            tags: vec!["juice".into(), " Juice ".into(), String::new()],
            notes: String::new(),
            favorite: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn saves_lists_and_keeps_games_apart() {
        let db = Database::open_in_memory().unwrap();
        let out = save(&db, GameId::Poe1, &entry("a", "Safe maps"), false, 10).unwrap();
        let SaveOutcome::Saved { entry: e } = out else { panic!("expected saved") };
        assert_eq!(e.tags, vec!["juice".to_string()], "tags trimmed and de-duplicated");
        assert_eq!((e.created_at, e.updated_at), (10, 10));
        assert!(list(&db, GameId::Poe2).unwrap().is_empty());

        // Edit keeps created_at.
        let mut edited = entry("a", "Safe maps (T16)");
        edited.favorite = true;
        save(&db, GameId::Poe1, &edited, false, 20).unwrap();
        let l = list(&db, GameId::Poe1).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!((l[0].name.as_str(), l[0].created_at, l[0].updated_at, l[0].favorite), ("Safe maps (T16)", 10, 20, true));
    }

    #[test]
    fn name_collision_needs_explicit_overwrite() {
        let db = Database::open_in_memory().unwrap();
        save(&db, GameId::Poe1, &entry("a", "Safe maps"), false, 1).unwrap();
        set_slot(&db, GameId::Poe1, 3, Some(&RegexSlot { slot: 3, label: "maps".into(), regex: "x".into(), library_id: Some("a".into()) })).unwrap();
        // Case-insensitive.
        let out = save(&db, GameId::Poe1, &entry("b", "SAFE MAPS"), false, 2).unwrap();
        assert_eq!(out, SaveOutcome::NameTaken { existing_id: "a".into() });
        assert_eq!(list(&db, GameId::Poe1).unwrap().len(), 1, "nothing written");
        // Same name in the other game is fine.
        assert!(matches!(save(&db, GameId::Poe2, &entry("b", "Safe maps"), false, 2).unwrap(), SaveOutcome::Saved { .. }));

        let out = save(&db, GameId::Poe1, &entry("b", "SAFE MAPS"), true, 3).unwrap();
        assert!(matches!(out, SaveOutcome::Saved { .. }));
        let l = list(&db, GameId::Poe1).unwrap();
        assert_eq!(l.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec!["b"]);
        assert_eq!(slots(&db, GameId::Poe1).unwrap()[0].library_id.as_deref(), Some("b"), "slot follows the overwrite");
    }

    #[test]
    fn slots_and_delete() {
        let db = Database::open_in_memory().unwrap();
        save(&db, GameId::Poe1, &entry("a", "Safe maps"), false, 1).unwrap();
        let s = RegexSlot { slot: 8, label: "Safe".into(), regex: "\"!reflect\"".into(), library_id: Some("a".into()) };
        set_slot(&db, GameId::Poe1, 8, Some(&s)).unwrap();
        assert!(set_slot(&db, GameId::Poe1, 9, Some(&s)).is_err());
        assert!(set_slot(&db, GameId::Poe1, 0, None).is_err());
        delete(&db, GameId::Poe1, "a").unwrap();
        let got = slots(&db, GameId::Poe1).unwrap();
        assert_eq!(got.len(), 1, "slot keeps its copy");
        assert_eq!(got[0].library_id, None);
        assert_eq!(got[0].regex, "\"!reflect\"");
        set_slot(&db, GameId::Poe1, 8, None).unwrap();
        assert!(slots(&db, GameId::Poe1).unwrap().is_empty());
        assert!(slots(&db, GameId::Poe2).unwrap().is_empty());
    }

    #[test]
    fn rejects_invalid_entries() {
        let db = Database::open_in_memory().unwrap();
        let mut e = entry("a", " ");
        assert!(save(&db, GameId::Poe1, &e, false, 0).is_err());
        e = entry("../a", "x");
        assert!(save(&db, GameId::Poe1, &e, false, 0).is_err());
        e = entry("a", "x");
        e.regex = "  ".into();
        assert!(save(&db, GameId::Poe1, &e, false, 0).is_err());
        e = entry("a", "x");
        e.category = String::new();
        assert!(save(&db, GameId::Poe1, &e, false, 0).is_err());
        e = entry("a", "x");
        e.tags = (0..25).map(|i| format!("t{i}")).collect();
        assert!(save(&db, GameId::Poe1, &e, false, 0).is_err());
    }
}
