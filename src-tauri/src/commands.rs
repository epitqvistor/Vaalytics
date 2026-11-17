//! IPC command surface for the trusted main window. Commands stay thin:
//! validate, delegate to a module, return serializable data.

use crate::diagnostics::DiagnosticsSnapshot;
use crate::error::AppResult;
use crate::game::GameId;
use crate::{settings, AppState};
use serde_json::Value;
use tauri::State;

#[tauri::command]
pub fn get_last_game(state: State<'_, AppState>) -> AppResult<Option<GameId>> {
    settings::last_game(&state.db)
}

#[tauri::command]
pub fn set_last_game(state: State<'_, AppState>, game: Option<GameId>) -> AppResult<()> {
    let value = game.map(|g| Value::from(g.as_str())).unwrap_or(Value::Null);
    settings::set_app(&state.db, settings::KEY_LAST_GAME, &value)
}

#[tauri::command]
pub fn get_app_setting(state: State<'_, AppState>, key: String) -> AppResult<Option<Value>> {
    settings::get_app(&state.db, &key)
}

#[tauri::command]
pub fn set_app_setting(state: State<'_, AppState>, key: String, value: Value) -> AppResult<()> {
    settings::set_app(&state.db, &key, &value)
}

#[tauri::command]
pub fn get_game_setting(state: State<'_, AppState>, game: GameId, key: String) -> AppResult<Option<Value>> {
    settings::get_game(&state.db, game, &key)
}

#[tauri::command]
pub fn set_game_setting(state: State<'_, AppState>, game: GameId, key: String, value: Value) -> AppResult<()> {
    settings::set_game(&state.db, game, &key, &value)
}

#[tauri::command]
pub fn get_diagnostics(state: State<'_, AppState>) -> AppResult<DiagnosticsSnapshot> {
    state.diagnostics.snapshot(&state.db)
}

// ---------- market data ----------

use crate::market::catalog::{self, CategoryDef};
use crate::market::engine::{MarketStats, Snapshot};
use crate::market::normalize::League;
use crate::market::store::HistoryPoint;

#[tauri::command]
pub fn market_categories(game: GameId) -> Vec<CategoryDef> {
    catalog::categories(game).to_vec()
}

#[tauri::command]
pub async fn market_leagues(state: State<'_, AppState>, game: GameId) -> AppResult<Vec<League>> {
    state.market.leagues(game).await
}

#[tauri::command]
pub fn market_overview(state: State<'_, AppState>, game: GameId, league: String, category: String) -> AppResult<Snapshot> {
    state.market.snapshot(game, &league, &category)
}

#[tauri::command]
pub fn market_refresh(state: State<'_, AppState>, game: GameId, league: String, category: String) -> AppResult<bool> {
    state.market.refresh_if_expired(game, &league, &category)
}

#[tauri::command]
pub fn market_history(
    state: State<'_, AppState>,
    game: GameId,
    league: String,
    category: String,
    item_id: String,
    days: i64,
) -> AppResult<Vec<HistoryPoint>> {
    state.market.history(game, &league, &category, &item_id, days)
}

#[tauri::command]
pub fn market_stats(state: State<'_, AppState>) -> MarketStats {
    state.market.stats()
}

// ---------- official trade ----------

use crate::trade::{MoreListings, PriceCheck, StatEntry};
use std::sync::Arc;

#[tauri::command]
pub async fn trade_stats(state: State<'_, AppState>, game: GameId) -> AppResult<Arc<Vec<StatEntry>>> {
    state.trade.stats(game).await
}

#[tauri::command]
pub async fn trade_price_check(
    state: State<'_, AppState>,
    game: GameId,
    league: String,
    query: Value,
    count: usize,
) -> AppResult<PriceCheck> {
    if league.is_empty() || league.len() > 80 || league.chars().any(char::is_control) {
        return Err(crate::error::AppError::InvalidInput("invalid league name".into()));
    }
    state.trade.price_check(game, &league, query, count).await
}

#[tauri::command]
pub async fn trade_fetch_more(
    state: State<'_, AppState>,
    game: GameId,
    search_id: String,
    offset: usize,
    count: usize,
) -> AppResult<MoreListings> {
    state.trade.fetch_more(game, &search_id, offset, count).await
}

// ---------- overlay ----------

use crate::overlay::{CaptureEvent, OverlayState, OverlayStatus};

#[tauri::command]
pub fn overlay_status(state: State<'_, OverlayState>) -> OverlayStatus {
    state.status()
}

/// The overlay calls this on load to receive the capture that opened it.
#[tauri::command]
pub fn overlay_take_pending(state: State<'_, OverlayState>) -> Option<CaptureEvent> {
    state.take_pending()
}

/// Opens the overlay without the game (Settings → "Preview overlay"), so the
/// user can position and size it. With `text`, it price-checks that item text.
///
/// Async on purpose: creating a webview window inside a synchronous command
/// deadlocks on Windows.
#[tauri::command]
pub async fn overlay_preview(app: tauri::AppHandle, game: GameId, text: Option<String>) -> AppResult<()> {
    crate::overlay::preview(&app, game, text.filter(|t| t.len() <= 64 * 1024)).map_err(|e| crate::error::AppError::InvalidInput(e.to_string()))
}

// ---------- Path of Building ----------

use crate::pob::{self, PobBuild, PobStatus};
use tauri::Manager;

fn documents(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().document_dir().ok()
}

/// Detection touches the registry and file system; run off the main thread.
#[tauri::command]
pub async fn pob_status(app: tauri::AppHandle, state: State<'_, AppState>, game: GameId) -> AppResult<PobStatus> {
    Ok(state.pob.status(&state.db, game, documents(&app).as_deref()))
}

/// Opens a native file picker (in Rust — the frontend never supplies paths),
/// validates the choice for `game`, and saves it. Returns the new status, or
/// None if the user cancelled.
#[tauri::command]
pub async fn pob_choose_exe(app: tauri::AppHandle, state: State<'_, AppState>, game: GameId) -> AppResult<Option<PobStatus>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title(format!("Select {}", pob::product(game)))
        .add_filter("Path of Building", &["exe"])
        .blocking_pick_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file.into_path().map_err(|_| crate::error::AppError::InvalidInput("Unsupported file location.".into()))?;
    state.pob.set_path(&state.db, game, &path)?;
    Ok(Some(state.pob.status(&state.db, game, documents(&app).as_deref())))
}

#[tauri::command]
pub async fn pob_clear_path(app: tauri::AppHandle, state: State<'_, AppState>, game: GameId) -> AppResult<PobStatus> {
    state.pob.clear_path(&state.db, game)?;
    Ok(state.pob.status(&state.db, game, documents(&app).as_deref()))
}

#[tauri::command]
pub async fn pob_launch(app: tauri::AppHandle, state: State<'_, AppState>, game: GameId) -> AppResult<()> {
    state.pob.launch(&state.db, game, documents(&app).as_deref())
}

#[tauri::command]
pub async fn pob_builds(app: tauri::AppHandle, game: GameId) -> AppResult<Vec<PobBuild>> {
    Ok(pob::builds_dir(game, documents(&app).as_deref()).map(|d| pob::list_builds(&d)).unwrap_or_default())
}

/// Opens the game's PoB builds folder in Explorer (path computed here, not passed in).
#[tauri::command]
pub async fn pob_open_builds_folder(app: tauri::AppHandle, game: GameId) -> AppResult<()> {
    let dir = pob::builds_dir(game, documents(&app).as_deref())
        .ok_or_else(|| crate::error::AppError::InvalidInput("The Path of Building builds folder was not found.".into()))?;
    std::process::Command::new("explorer.exe")
        .arg(&dir)
        .spawn()
        .map_err(|e| crate::error::AppError::InvalidInput(format!("Could not open Explorer: {e}")))?;
    Ok(())
}

// ---------- built-in browser ----------
// Async: creating webviews from a synchronous command deadlocks on Windows.

use crate::browser::{self, Bounds};

fn browser_err(e: String) -> crate::error::AppError {
    crate::error::AppError::InvalidInput(e)
}

#[tauri::command]
pub async fn browser_open(app: tauri::AppHandle, tab: String, url: String, bounds: Bounds) -> AppResult<()> {
    browser::open(&app, &tab, &url, bounds).map_err(browser_err)
}

#[tauri::command]
pub async fn browser_set_bounds(app: tauri::AppHandle, tab: String, bounds: Bounds) -> AppResult<()> {
    browser::set_bounds(&app, &tab, bounds).map_err(browser_err)
}

/// Shows one tab's page (or none, when leaving the Browser section).
#[tauri::command]
pub async fn browser_show_only(app: tauri::AppHandle, tab: Option<String>) -> AppResult<()> {
    browser::show_only(&app, tab.as_deref()).map_err(browser_err)
}

#[tauri::command]
pub async fn browser_action(app: tauri::AppHandle, tab: String, action: String) -> AppResult<()> {
    let a = match action.as_str() {
        "back" => browser::Action::Back,
        "forward" => browser::Action::Forward,
        "reload" => browser::Action::Reload,
        _ => return Err(browser_err("unknown action".into())),
    };
    browser::act(&app, &tab, a).map_err(browser_err)
}

#[tauri::command]
pub async fn browser_close(app: tauri::AppHandle, tab: String) -> AppResult<()> {
    browser::close(&app, &tab).map_err(browser_err)
}

/// Opens the tab's current page in the user's default browser (login fallback).
#[tauri::command]
pub async fn browser_open_external(app: tauri::AppHandle, tab: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let url = browser::current_url(&app, &tab).ok_or_else(|| browser_err("No page is open in this tab.".into()))?;
    let url = browser::parse_web_url(&url).map_err(browser_err)?;
    app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| browser_err(e.to_string()))
}

// ---------- crafting ----------

#[tauri::command]
pub async fn crafting_data(state: State<'_, AppState>, game: GameId, force: bool) -> AppResult<crate::crafting::CraftingDataResponse> {
    state.crafting.get(game, force).await
}
