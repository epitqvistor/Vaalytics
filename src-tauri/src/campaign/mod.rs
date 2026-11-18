//! Campaign Intelligence (PoE 2): per-character campaign events from Client.txt.
//! Spec: docs/modules/campaign-intelligence.md
//!
//! There is no second log reader: the Session Intelligence tracker calls
//! `CampaignHook::on_event` for every parsed line inside its own transaction.
//! The navigator itself (dataset, progress, recommendations) is pure TypeScript.

pub mod hook;
pub mod build_stats;
pub mod import;
pub mod store;

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
