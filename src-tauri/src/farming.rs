//! Farming Lab: farming sessions recorded by the user (per game and league).
//! Values inside `data` are the user's own records priced at save time; the
//! host only validates and stores them. Spec: docs/modules/farming-lab.md

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_DATA_BYTES: usize = 64 * 1024;
const MAX_STRATEGY: usize = 80;
const MAX_LEAGUE: usize = 80;
const MAX_SESSIONS_PER_LEAGUE: i64 = 2000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FarmingSession {
    pub id: String,
    pub league: String,
    pub strategy: String,
    pub started_at: i64,
    pub duration_secs: i64,
    pub maps: i64,
    /// Cost/loot lines and notes (shape owned by the UI, see farming-lab/types.ts).
    pub data: Value,
    #[serde(default)]
    pub saved_at: i64,
}

fn validate(s: &FarmingSession) -> AppResult<String> {
    let bad = |m: &str| Err(AppError::InvalidInput(m.into()));
    if s.id.is_empty() || s.id.len() > 64 || !s.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return bad("invalid session id");
    }
    if s.league.trim().is_empty() || s.league.len() > MAX_LEAGUE {
        return bad("invalid league");
    }
    let strategy = s.strategy.trim();
    if strategy.is_empty() || strategy.chars().count() > MAX_STRATEGY {
        return bad("Strategy name must be 1–80 characters.");
    }
    if s.duration_secs < 0 || s.duration_secs > 7 * 24 * 3600 || s.maps < 0 || s.maps > 100_000 {
        return bad("Duration or map count out of range.");
    }
    if !s.data.is_object() {
        return bad("invalid session data");
    }
    let data = serde_json::to_string(&s.data)?;
    if data.len() > MAX_DATA_BYTES {
        return bad("Session is too large (more than 64 KB of lines).");
    }
    Ok(data)
}

pub fn list(db: &Database, game: GameId, league: &str) -> AppResult<Vec<FarmingSession>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, league, strategy, started_at, duration_secs, maps, data, saved_at
         FROM farming_sessions WHERE game = ?1 AND league = ?2 ORDER BY started_at DESC",
    )?;
    let rows = stmt.query_map(params![game.as_str(), league], |r| {
        let data: String = r.get(6)?;
        Ok(FarmingSession {
            id: r.get(0)?,
            league: r.get(1)?,
            strategy: r.get(2)?,
            started_at: r.get(3)?,
            duration_secs: r.get(4)?,
            maps: r.get(5)?,
            data: serde_json::from_str(&data).unwrap_or(Value::Null),
            saved_at: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Inserts or replaces a session (same id = edit).
pub fn save(db: &Database, game: GameId, s: &FarmingSession, now: i64) -> AppResult<()> {
    let data = validate(s)?;
    let conn = db.conn()?;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM farming_sessions WHERE game = ?1 AND league = ?2 AND id != ?3",
        params![game.as_str(), s.league, s.id],
        |r| r.get(0),
    )?;
    if count >= MAX_SESSIONS_PER_LEAGUE {
        return Err(AppError::InvalidInput("Too many sessions in this league (2000).".into()));
    }
    conn.execute(
        "INSERT OR REPLACE INTO farming_sessions (game, id, league, strategy, started_at, duration_secs, maps, data, saved_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![game.as_str(), s.id, s.league.trim(), s.strategy.trim(), s.started_at, s.duration_secs, s.maps, data, now],
    )?;
    Ok(())
}

pub fn delete(db: &Database, game: GameId, id: &str) -> AppResult<()> {
    db.conn()?.execute("DELETE FROM farming_sessions WHERE game = ?1 AND id = ?2", params![game.as_str(), id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session(id: &str, league: &str) -> FarmingSession {
        FarmingSession {
            id: id.into(),
            league: league.into(),
            strategy: "Essence + Harbinger".into(),
            started_at: 100,
            duration_secs: 3600,
            maps: 12,
            data: json!({"loot":[{"name":"Divine Orb","qty":1,"unitPrice":155}],"costs":[]}),
            saved_at: 0,
        }
    }

    #[test]
    fn saves_lists_edits_and_deletes_per_game_and_league() {
        let db = Database::open_in_memory().unwrap();
        save(&db, GameId::Poe1, &session("a", "Covens"), 5).unwrap();
        save(&db, GameId::Poe1, &session("b", "Standard"), 5).unwrap();
        save(&db, GameId::Poe2, &session("a", "Covens"), 5).unwrap();
        let list = list(&db, GameId::Poe1, "Covens").unwrap();
        assert_eq!(list.len(), 1, "league and game are separate");
        assert_eq!(list[0].saved_at, 5);
        assert_eq!(list[0].data["loot"][0]["unitPrice"], 155);

        let mut edited = session("a", "Covens");
        edited.maps = 20;
        save(&db, GameId::Poe1, &edited, 6).unwrap();
        assert_eq!(super::list(&db, GameId::Poe1, "Covens").unwrap()[0].maps, 20);

        delete(&db, GameId::Poe1, "a").unwrap();
        assert!(super::list(&db, GameId::Poe1, "Covens").unwrap().is_empty());
        assert_eq!(super::list(&db, GameId::Poe2, "Covens").unwrap().len(), 1, "other game untouched");
    }

    #[test]
    fn rejects_invalid_sessions() {
        let db = Database::open_in_memory().unwrap();
        let mut s = session("x", "Covens");
        s.strategy = " ".into();
        assert!(save(&db, GameId::Poe1, &s, 0).is_err());
        let mut s = session("../x", "Covens");
        s.id = "../x".into();
        assert!(save(&db, GameId::Poe1, &s, 0).is_err());
        let mut s = session("x", "Covens");
        s.maps = -1;
        assert!(save(&db, GameId::Poe1, &s, 0).is_err());
        let mut s = session("x", "Covens");
        s.data = json!({"notes": "x".repeat(70_000)});
        assert!(save(&db, GameId::Poe1, &s, 0).is_err());
        let mut s = session("x", "Covens");
        s.data = json!([1, 2]);
        assert!(save(&db, GameId::Poe1, &s, 0).is_err());
    }
}
