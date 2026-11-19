//! Per-character campaign events from Client.txt.
//! - PoE 2 (Campaign Intelligence, docs/modules/campaign-intelligence.md): the Session
//!   Intelligence tracker calls `CampaignHook::on_event` for every parsed line.
//! - PoE 1 (Location Atlas, docs/modules/location-atlas.md): `sync` drives the same
//!   reader, parser and hook on demand.
//! Game data and the navigator are TypeScript; storage is shared, isolated by `game`.

pub mod hook;
pub mod build_stats;
pub mod import;
pub mod store;
pub mod sync;

pub use hook::CampaignHook;

use crate::error::{AppError, AppResult};
use crate::game::GameId;

pub fn require_poe2(game: GameId) -> AppResult<()> {
    if game == GameId::Poe2 {
        Ok(())
    } else {
        Err(AppError::InvalidInput("Campaign Intelligence is available for Path of Exile 2 only.".into()))
    }
}

/// Campaign storage commands work for both games; rows are isolated by `game`.
pub fn require_campaign_game(game: GameId) -> AppResult<()> {
    match game {
        GameId::Poe1 | GameId::Poe2 => Ok(()),
    }
}

pub fn require_poe1(game: GameId) -> AppResult<()> {
    if game == GameId::Poe1 {
        Ok(())
    } else {
        Err(AppError::InvalidInput("Location Atlas is available for Path of Exile 1 only.".into()))
    }
}

/// PoE 1 Client.txt for the Atlas: the one the player chose, else the first PoE 1 log found.
pub fn resolve_poe1_log(db: &crate::db::Database) -> AppResult<std::path::PathBuf> {
    use crate::session::discover;
    use rusqlite::OptionalExtension;
    let chosen: Option<String> = db
        .conn()?
        .query_row("SELECT log_path FROM campaign_state WHERE game = 'poe1'", [], |r| r.get(0))
        .optional()?
        .flatten();
    if let Some(p) = chosen.map(std::path::PathBuf::from).filter(|p| p.is_file()) {
        return Ok(p);
    }
    discover::poe1_candidates()
        .into_iter()
        .find(|p| discover::is_poe1_log(p))
        .ok_or_else(|| AppError::InvalidInput("No Path of Exile 1 Client.txt found. Choose it in the Location Atlas settings.".into()))
}

/// Saves the player's PoE 1 log choice after checking it is a PoE 1 client log.
pub fn set_poe1_log(db: &crate::db::Database, path: &std::path::Path) -> AppResult<()> {
    if !path.is_file() || !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("txt")) {
        return Err(AppError::InvalidInput("Choose the game's log file (Client.txt).".into()));
    }
    if !crate::session::discover::is_poe1_log(path) {
        return Err(AppError::InvalidInput("This doesn't look like a Path of Exile 1 log.".into()));
    }
    db.conn()?.execute(
        "INSERT INTO campaign_state (game, log_path, updated_at) VALUES ('poe1', ?1, 0)
         ON CONFLICT (game) DO UPDATE SET log_path = excluded.log_path, log_key = NULL, log_offset = NULL",
        rusqlite::params![path.to_string_lossy()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;

/// Client.txt to import from: the path the player chose in Session Intelligence,
/// else the first discovered Path of Exile 2 log.
pub fn resolve_log_path(db: &crate::db::Database, game: GameId) -> AppResult<std::path::PathBuf> {
    use crate::session::{discover, store as session_store};
    let manual = session_store::tracker_state(&*db.conn()?, game)?.log_path;
    if let Some(p) = manual {
        return Ok(p.into());
    }
    discover::candidates()
        .into_iter()
        .find(|p| p.is_file() && matches!(discover::validate(p), Ok(discover::LogCheck::Poe2)))
        .ok_or_else(|| AppError::InvalidInput("No Path of Exile 2 Client.txt found. Choose it in Session Intelligence → Settings.".into()))
}
