//! SQLite persistence for market data. Every function takes an explicit game.

use super::normalize::{League, NormalizedItem};
use crate::db::Database;
use crate::error::AppResult;
use crate::game::GameId;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

pub const LEAGUES_KEY: &str = "__leagues";
const HOUR: i64 = 3600;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchMeta {
    pub fetched_at: Option<i64>,
    pub expires_at: Option<i64>,
    #[serde(skip)]
    pub etag: Option<String>,
    pub last_error: Option<String>,
    pub last_error_at: Option<i64>,
}

impl FetchMeta {
    pub fn is_expired(&self, now: i64) -> bool {
        self.expires_at.is_none_or(|e| now >= e)
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct HistoryPoint {
    pub ts: i64,
    pub value: f64,
}

pub fn fetch_meta(db: &Database, game: GameId, league: &str, category: &str) -> AppResult<FetchMeta> {
    Ok(db
        .conn()?
        .query_row(
            "SELECT fetched_at, expires_at, etag, last_error, last_error_at FROM market_fetches
             WHERE game = ?1 AND league = ?2 AND category = ?3",
            params![game.as_str(), league, category],
            |r| {
                Ok(FetchMeta {
                    fetched_at: r.get(0)?,
                    expires_at: r.get(1)?,
                    etag: r.get(2)?,
                    last_error: r.get(3)?,
                    last_error_at: r.get(4)?,
                })
            },
        )
        .optional()?
        .unwrap_or_default())
}

pub fn record_success(db: &Database, game: GameId, league: &str, category: &str, now: i64, max_age: u64, etag: Option<&str>) -> AppResult<()> {
    db.conn()?.execute(
        "INSERT INTO market_fetches (game, league, category, fetched_at, expires_at, etag, last_error, last_error_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL)
         ON CONFLICT(game, league, category) DO UPDATE SET
           fetched_at = excluded.fetched_at, expires_at = excluded.expires_at,
           etag = COALESCE(excluded.etag, market_fetches.etag), last_error = NULL, last_error_at = NULL",
        params![game.as_str(), league, category, now, now + max_age as i64, etag],
    )?;
    Ok(())
}

/// Records a failure. Pushes the next attempt out by `retry_in` seconds so a
/// failing source is not hammered by the background sync.
pub fn record_error(db: &Database, game: GameId, league: &str, category: &str, now: i64, retry_in: i64, message: &str) -> AppResult<()> {
    db.conn()?.execute(
        "INSERT INTO market_fetches (game, league, category, expires_at, last_error, last_error_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(game, league, category) DO UPDATE SET
           expires_at = excluded.expires_at, last_error = excluded.last_error, last_error_at = excluded.last_error_at",
        params![game.as_str(), league, category, now + retry_in, message, now],
    )?;
    Ok(())
}

pub fn replace_items(db: &Database, game: GameId, league: &str, category: &str, items: &[NormalizedItem], now: i64) -> AppResult<()> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM market_items WHERE game = ?1 AND league = ?2 AND category = ?3",
        params![game.as_str(), league, category],
    )?;
    {
        let mut ins = tx.prepare(
            "INSERT OR REPLACE INTO market_items (game, league, category, item_id, name, variant, icon, value, divine_value,
               change_7d, sparkline, volume_value, listings, updated_at, base_type)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        )?;
        let mut hist = tx.prepare(
            "INSERT OR REPLACE INTO price_history (game, league, category, item_id, ts, value, divine_value)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        let bucket = now - now.rem_euclid(HOUR);
        for it in items {
            let spark = serde_json::to_string(&it.sparkline)?;
            ins.execute(params![
                game.as_str(), league, category, it.item_id, it.name, it.variant, it.icon, it.value, it.divine_value,
                it.change_7d, spark, it.volume_value, it.listings, now, it.base_type
            ])?;
            hist.execute(params![game.as_str(), league, category, it.item_id, bucket, it.value, it.divine_value])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn items(db: &Database, game: GameId, league: &str, category: &str) -> AppResult<Vec<NormalizedItem>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT item_id, name, variant, icon, value, divine_value, change_7d, sparkline, volume_value, listings, base_type
         FROM market_items WHERE game = ?1 AND league = ?2 AND category = ?3 ORDER BY value DESC",
    )?;
    let rows = stmt.query_map(params![game.as_str(), league, category], |r| {
        let spark: Option<String> = r.get(7)?;
        Ok(NormalizedItem {
            item_id: r.get(0)?,
            name: r.get(1)?,
            variant: r.get(2)?,
            icon: r.get(3)?,
            value: r.get(4)?,
            divine_value: r.get(5)?,
            change_7d: r.get(6)?,
            sparkline: spark.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
            volume_value: r.get(8)?,
            listings: r.get(9)?,
            base_type: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// A cached market row matched by exact name (no variant), for valuing items
/// copied from the game. Returns the category it was found in.
#[derive(Debug, Clone, PartialEq)]
pub struct NameMatch {
    pub category: String,
    pub value: f64,
    pub volume_value: Option<f64>,
    pub listings: Option<i64>,
    pub icon: Option<String>,
    pub fetched_at: Option<i64>,
}

pub fn find_by_name(db: &Database, game: GameId, league: &str, name: &str) -> AppResult<Option<NameMatch>> {
    Ok(db
        .conn()?
        .query_row(
            "SELECT i.category, i.value, i.volume_value, i.listings, i.icon, f.fetched_at
             FROM market_items i LEFT JOIN market_fetches f ON f.game = i.game AND f.league = i.league AND f.category = i.category
             WHERE i.game = ?1 AND i.league = ?2 AND i.name = ?3 AND i.variant IS NULL
             ORDER BY COALESCE(i.volume_value, 0) DESC LIMIT 1",
            params![game.as_str(), league, name],
            |r| Ok(NameMatch { category: r.get(0)?, value: r.get(1)?, volume_value: r.get(2)?, listings: r.get(3)?, icon: r.get(4)?, fetched_at: r.get(5)? }),
        )
        .optional()?)
}

/// A cached unique-item row (stash categories), for valuing unique copies.
#[derive(Debug, Clone, PartialEq)]
pub struct UniqueRow {
    pub category: String,
    pub name: String,
    pub variant: Option<String>,
    pub value: f64,
    pub listings: Option<i64>,
    pub icon: Option<String>,
    pub fetched_at: Option<i64>,
}

/// Unique rows on `base_type` (optionally with an exact `name`), cheapest first.
pub fn uniques_on_base(db: &Database, game: GameId, league: &str, base_type: &str, name: Option<&str>) -> AppResult<Vec<UniqueRow>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT i.category, i.name, i.variant, i.value, i.listings, i.icon, f.fetched_at
         FROM market_items i LEFT JOIN market_fetches f ON f.game = i.game AND f.league = i.league AND f.category = i.category
         WHERE i.game = ?1 AND i.league = ?2 AND i.base_type = ?3 AND (?4 IS NULL OR i.name = ?4)
         ORDER BY i.value ASC",
    )?;
    let rows = stmt.query_map(params![game.as_str(), league, base_type, name], |r| {
        Ok(UniqueRow { category: r.get(0)?, name: r.get(1)?, variant: r.get(2)?, value: r.get(3)?, listings: r.get(4)?, icon: r.get(5)?, fetched_at: r.get(6)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn history(db: &Database, game: GameId, league: &str, category: &str, item_id: &str, since: i64) -> AppResult<Vec<HistoryPoint>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT ts, value FROM price_history
         WHERE game = ?1 AND league = ?2 AND category = ?3 AND item_id = ?4 AND ts >= ?5 ORDER BY ts",
    )?;
    let rows = stmt.query_map(params![game.as_str(), league, category, item_id, since], |r| {
        Ok(HistoryPoint { ts: r.get(0)?, value: r.get(1)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Forces the next fetch of every resource to be a full download.
pub fn invalidate_all(db: &Database) -> AppResult<usize> {
    Ok(db.conn()?.execute("UPDATE market_fetches SET etag = NULL, expires_at = 0", [])?)
}

pub fn prune_history(db: &Database, older_than: i64) -> AppResult<usize> {
    Ok(db.conn()?.execute("DELETE FROM price_history WHERE ts < ?1", params![older_than])?)
}

pub fn replace_leagues(db: &Database, game: GameId, leagues: &[League], now: i64) -> AppResult<()> {
    let mut conn = db.conn()?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM market_leagues WHERE game = ?1", params![game.as_str()])?;
    for (i, l) in leagues.iter().enumerate() {
        tx.execute(
            "INSERT OR REPLACE INTO market_leagues (game, name, display_name, hardcore, indexed, sort_order, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![game.as_str(), l.name, l.display_name, l.hardcore, l.indexed, i as i64, now],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn leagues(db: &Database, game: GameId) -> AppResult<Vec<League>> {
    let conn = db.conn()?;
    let mut stmt = conn.prepare(
        "SELECT name, display_name, hardcore, indexed FROM market_leagues WHERE game = ?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map(params![game.as_str()], |r| {
        Ok(League { name: r.get(0)?, display_name: r.get(1)?, hardcore: r.get(2)?, indexed: r.get(3)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, value: f64) -> NormalizedItem {
        NormalizedItem {
            item_id: id.into(),
            name: id.into(),
            variant: None,
            icon: None,
            value,
            divine_value: Some(value / 100.0),
            change_7d: Some(0.1),
            sparkline: vec![None, Some(1.5)],
            volume_value: Some(10.0),
            listings: None,
            base_type: Some("Leather Belt".into()),
        }
    }

    #[test]
    fn items_round_trip_and_are_isolated_per_game_and_league() {
        let db = Database::open_in_memory().unwrap();
        replace_items(&db, GameId::Poe1, "Standard", "currency", &[item("a", 5.0), item("b", 9.0)], 7200).unwrap();
        replace_items(&db, GameId::Poe2, "Standard", "currency", &[item("z", 1.0)], 7200).unwrap();
        let got = items(&db, GameId::Poe1, "Standard", "currency").unwrap();
        assert_eq!(got.iter().map(|i| i.item_id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        assert_eq!(got[0].sparkline, vec![None, Some(1.5)]);
        assert!(items(&db, GameId::Poe1, "Other", "currency").unwrap().is_empty());
        assert_eq!(items(&db, GameId::Poe2, "Standard", "currency").unwrap().len(), 1);
    }

    #[test]
    fn replace_drops_items_no_longer_listed() {
        let db = Database::open_in_memory().unwrap();
        replace_items(&db, GameId::Poe1, "L", "c", &[item("a", 1.0), item("b", 2.0)], 0).unwrap();
        replace_items(&db, GameId::Poe1, "L", "c", &[item("b", 3.0)], 10).unwrap();
        let got = items(&db, GameId::Poe1, "L", "c").unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].value, 3.0);
    }

    #[test]
    fn history_keeps_one_point_per_hour() {
        let db = Database::open_in_memory().unwrap();
        replace_items(&db, GameId::Poe1, "L", "c", &[item("a", 1.0)], 3600 * 5 + 10).unwrap();
        replace_items(&db, GameId::Poe1, "L", "c", &[item("a", 2.0)], 3600 * 5 + 1800).unwrap();
        replace_items(&db, GameId::Poe1, "L", "c", &[item("a", 3.0)], 3600 * 6 + 5).unwrap();
        let h = history(&db, GameId::Poe1, "L", "c", "a", 0).unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].value, 2.0, "later fetch in the same hour wins");
        assert_eq!(prune_history(&db, 3600 * 6).unwrap(), 1);
    }

    #[test]
    fn fetch_meta_success_and_error() {
        let db = Database::open_in_memory().unwrap();
        assert!(fetch_meta(&db, GameId::Poe1, "L", "c").unwrap().is_expired(0));
        record_success(&db, GameId::Poe1, "L", "c", 100, 1800, Some("W/abc")).unwrap();
        let m = fetch_meta(&db, GameId::Poe1, "L", "c").unwrap();
        assert_eq!((m.fetched_at, m.expires_at, m.etag.as_deref()), (Some(100), Some(1900), Some("W/abc")));
        assert!(!m.is_expired(1000));
        record_error(&db, GameId::Poe1, "L", "c", 2000, 300, "HTTP 503").unwrap();
        let m = fetch_meta(&db, GameId::Poe1, "L", "c").unwrap();
        assert_eq!(m.fetched_at, Some(100), "last good fetch is kept");
        assert_eq!(m.expires_at, Some(2300));
        assert_eq!(m.last_error.as_deref(), Some("HTTP 503"));
        record_success(&db, GameId::Poe1, "L", "c", 2400, 1800, None).unwrap();
        let m = fetch_meta(&db, GameId::Poe1, "L", "c").unwrap();
        assert_eq!(m.etag.as_deref(), Some("W/abc"), "304 keeps the previous etag");
        assert_eq!(m.last_error, None);
    }

    #[test]
    fn leagues_round_trip_in_order() {
        let db = Database::open_in_memory().unwrap();
        let ls = vec![
            League { name: "B".into(), display_name: "B".into(), hardcore: false, indexed: true },
            League { name: "A".into(), display_name: "A".into(), hardcore: true, indexed: false },
        ];
        replace_leagues(&db, GameId::Poe2, &ls, 1).unwrap();
        assert_eq!(leagues(&db, GameId::Poe2).unwrap(), ls);
        assert!(leagues(&db, GameId::Poe1).unwrap().is_empty());
    }
}
