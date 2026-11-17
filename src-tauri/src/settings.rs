//! Settings repository. Application-wide settings and per-game settings live in
//! separate tables; per-game access always requires an explicit `GameId`.

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

pub const KEY_LAST_GAME: &str = "app.lastGame";
const MAX_KEY_LEN: usize = 128;
const MAX_VALUE_BYTES: usize = 64 * 1024;

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn validate_key(key: &str) -> AppResult<()> {
    let ok = !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if ok {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!("invalid settings key: {key:?}")))
    }
}

fn encode(value: &Value) -> AppResult<String> {
    let s = serde_json::to_string(value)?;
    if s.len() > MAX_VALUE_BYTES {
        return Err(AppError::InvalidInput("settings value too large".into()));
    }
    Ok(s)
}

fn decode(raw: Option<String>) -> AppResult<Option<Value>> {
    raw.map(|s| serde_json::from_str(&s).map_err(Into::into)).transpose()
}

pub fn get_app(db: &Database, key: &str) -> AppResult<Option<Value>> {
    validate_key(key)?;
    let raw = db
        .conn()?
        .query_row("SELECT value FROM app_settings WHERE key = ?1", params![key], |r| r.get(0))
        .optional()?;
    decode(raw)
}

pub fn set_app(db: &Database, key: &str, value: &Value) -> AppResult<()> {
    validate_key(key)?;
    db.conn()?.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, encode(value)?, now()],
    )?;
    Ok(())
}

pub fn get_game(db: &Database, game: GameId, key: &str) -> AppResult<Option<Value>> {
    validate_key(key)?;
    let raw = db
        .conn()?
        .query_row(
            "SELECT value FROM game_settings WHERE game = ?1 AND key = ?2",
            params![game.as_str(), key],
            |r| r.get(0),
        )
        .optional()?;
    decode(raw)
}

pub fn set_game(db: &Database, game: GameId, key: &str, value: &Value) -> AppResult<()> {
    validate_key(key)?;
    db.conn()?.execute(
        "INSERT INTO game_settings (game, key, value, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(game, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![game.as_str(), key, encode(value)?, now()],
    )?;
    Ok(())
}

pub fn last_game(db: &Database) -> AppResult<Option<GameId>> {
    Ok(get_app(db, KEY_LAST_GAME)?
        .and_then(|v| v.as_str().map(str::to_owned))
        .and_then(|s| s.parse().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn game_settings_are_isolated_per_game() {
        let db = Database::open_in_memory().unwrap();
        set_game(&db, GameId::Poe1, "market.league", &json!("Standard")).unwrap();
        assert_eq!(get_game(&db, GameId::Poe2, "market.league").unwrap(), None);
        set_game(&db, GameId::Poe2, "market.league", &json!("Standard 2")).unwrap();
        assert_eq!(get_game(&db, GameId::Poe1, "market.league").unwrap(), Some(json!("Standard")));
        assert_eq!(get_game(&db, GameId::Poe2, "market.league").unwrap(), Some(json!("Standard 2")));
    }

    #[test]
    fn upsert_overwrites_value() {
        let db = Database::open_in_memory().unwrap();
        set_app(&db, "ui.reducedMotion", &json!(false)).unwrap();
        set_app(&db, "ui.reducedMotion", &json!(true)).unwrap();
        assert_eq!(get_app(&db, "ui.reducedMotion").unwrap(), Some(json!(true)));
    }

    #[test]
    fn last_game_round_trip_and_garbage_is_ignored() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(last_game(&db).unwrap(), None);
        set_app(&db, KEY_LAST_GAME, &json!("poe2")).unwrap();
        assert_eq!(last_game(&db).unwrap(), Some(GameId::Poe2));
        set_app(&db, KEY_LAST_GAME, &json!("nonsense")).unwrap();
        assert_eq!(last_game(&db).unwrap(), None);
    }

    #[test]
    fn rejects_bad_keys_and_oversized_values() {
        let db = Database::open_in_memory().unwrap();
        assert!(set_app(&db, "", &json!(1)).is_err());
        assert!(set_app(&db, "a b", &json!(1)).is_err());
        assert!(get_app(&db, "x;DROP").is_err());
        let big = "x".repeat(MAX_VALUE_BYTES + 1);
        assert!(set_app(&db, "big", &json!(big)).is_err());
    }
}
