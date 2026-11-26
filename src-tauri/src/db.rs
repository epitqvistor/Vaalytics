//! SQLite access. One connection behind a mutex is enough for the current
//! workload (settings, cache writes from a single sync worker). Migrations are
//! embedded at compile time and tracked with `PRAGMA user_version`.

use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// Ordered list of migrations. Append only — never edit a shipped migration.
const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_initial", include_str!("../migrations/0001_initial.sql")),
    ("0002_market", include_str!("../migrations/0002_market.sql")),
    ("0003_market_base_type", include_str!("../migrations/0003_market_base_type.sql")),
    ("0004_farming", include_str!("../migrations/0004_farming.sql")),
    ("0005_regex", include_str!("../migrations/0005_regex.sql")),
    ("0006_sessions", include_str!("../migrations/0006_sessions.sql")),
    ("0007_loot", include_str!("../migrations/0007_loot.sql")),
    ("0008_campaign", include_str!("../migrations/0008_campaign.sql")),
    ("0009_campaign_sync", include_str!("../migrations/0009_campaign_sync.sql")),
    ("0010_campaign_passives", include_str!("../migrations/0010_campaign_passives.sql")),
    ("0011_loot_maps", include_str!("../migrations/0011_loot_maps.sql")),
    ("0012_loot_inventory", include_str!("../migrations/0012_loot_inventory.sql")),
    ("0013_decks", include_str!("../migrations/0013_decks.sql")),
    ("0014_updates", include_str!("../migrations/0014_updates.sql")),
];

pub struct Database {
    conn: Mutex<Connection>,
    path: Option<PathBuf>,
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn, Some(path.to_path_buf()))
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        Self::init(Connection::open_in_memory()?, None)
    }

    fn init(conn: Connection, path: Option<PathBuf>) -> AppResult<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let db = Self { conn: Mutex::new(conn), path };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> AppResult<()> {
        let mut conn = self.conn()?;
        let current = conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))? as usize;
        if current > MIGRATIONS.len() {
            return Err(AppError::InvalidInput(format!(
                "database schema v{current} is newer than this build supports (v{})",
                MIGRATIONS.len()
            )));
        }
        for (idx, (name, sql)) in MIGRATIONS.iter().enumerate().skip(current) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (idx + 1) as i64)?;
            tx.commit()?;
            log::info!("applied migration {name}");
        }
        Ok(())
    }

    pub fn conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| AppError::StatePoisoned)
    }

    pub fn schema_version(&self) -> AppResult<i64> {
        Ok(self.conn()?.pragma_query_value(None, "user_version", |r| r.get(0))?)
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_to_latest_version() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn migration_is_idempotent_on_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        drop(Database::open(&path).unwrap());
        let db = Database::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as i64);
    }

    #[test]
    fn rejects_unknown_game_ids_at_schema_level() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn().unwrap();
        let res = conn.execute(
            "INSERT INTO game_settings (game, key, value, updated_at) VALUES ('poe3', 'k', '1', 0)",
            [],
        );
        assert!(res.is_err());
    }
}
