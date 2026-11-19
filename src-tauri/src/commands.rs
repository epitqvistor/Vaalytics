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
pub async fn trade_gem_variants(state: State<'_, AppState>, game: GameId) -> AppResult<Arc<Vec<crate::trade::GemVariant>>> {
    state.trade.gem_variants(game).await
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

// ---------- farming lab ----------

#[tauri::command]
pub fn farming_sessions(state: State<'_, AppState>, game: GameId, league: String) -> AppResult<Vec<crate::farming::FarmingSession>> {
    crate::farming::list(&state.db, game, &league)
}

#[tauri::command]
pub fn farming_save_session(state: State<'_, AppState>, game: GameId, session: crate::farming::FarmingSession) -> AppResult<()> {
    crate::farming::save(&state.db, game, &session, crate::market::http::unix_now())
}

#[tauri::command]
pub fn farming_delete_session(state: State<'_, AppState>, game: GameId, id: String) -> AppResult<()> {
    crate::farming::delete(&state.db, game, &id)
}

// ---------- regex (src-tauri/src/regex_library.rs) ----------

#[tauri::command]
pub fn regex_list(state: State<'_, AppState>, game: GameId) -> AppResult<Vec<crate::regex_library::RegexEntry>> {
    crate::regex_library::list(&state.db, game)
}

#[tauri::command]
pub fn regex_save(
    state: State<'_, AppState>,
    game: GameId,
    entry: crate::regex_library::RegexEntry,
    overwrite: bool,
) -> AppResult<crate::regex_library::SaveOutcome> {
    crate::regex_library::save(&state.db, game, &entry, overwrite, crate::market::http::unix_now())
}

#[tauri::command]
pub fn regex_set_favorite(state: State<'_, AppState>, game: GameId, id: String, favorite: bool) -> AppResult<()> {
    crate::regex_library::set_favorite(&state.db, game, &id, favorite)
}

#[tauri::command]
pub fn regex_delete(state: State<'_, AppState>, game: GameId, id: String) -> AppResult<()> {
    crate::regex_library::delete(&state.db, game, &id)
}

#[tauri::command]
pub fn regex_slots(state: State<'_, AppState>, game: GameId) -> AppResult<Vec<crate::regex_library::RegexSlot>> {
    crate::regex_library::slots(&state.db, game)
}

#[tauri::command]
pub fn regex_set_slot(state: State<'_, AppState>, game: GameId, slot: i64, value: Option<crate::regex_library::RegexSlot>) -> AppResult<()> {
    crate::regex_library::set_slot(&state.db, game, slot, value.as_ref())
}

/// Writes an export the UI built (JSON) to a file the user picks. Returns false when cancelled.
#[tauri::command]
pub async fn regex_export(app: tauri::AppHandle, file_name: String, contents: String) -> AppResult<bool> {
    use tauri_plugin_dialog::DialogExt;
    if contents.len() as u64 > crate::regex_library::MAX_IMPORT_BYTES {
        return Err(crate::error::AppError::InvalidInput("Export is too large.".into()));
    }
    let name: String = file_name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).take(80).collect();
    let picked = app
        .dialog()
        .file()
        .set_title("Export regex library")
        .set_file_name(if name.is_empty() { "vaalytics-regex.json".to_string() } else { name })
        .add_filter("JSON", &["json"])
        .blocking_save_file();
    let Some(file) = picked else { return Ok(false) };
    let path = file.into_path().map_err(|_| crate::error::AppError::InvalidInput("Unsupported file location.".into()))?;
    std::fs::write(path, contents)?;
    Ok(true)
}

/// Reads a JSON file the user picks (≤ 2 MB). Validation and merging happen in the UI. None = cancelled.
#[tauri::command]
pub async fn regex_import(app: tauri::AppHandle) -> AppResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().set_title("Import regex library").add_filter("JSON", &["json"]).blocking_pick_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file.into_path().map_err(|_| crate::error::AppError::InvalidInput("Unsupported file location.".into()))?;
    if std::fs::metadata(&path)?.len() > crate::regex_library::MAX_IMPORT_BYTES {
        return Err(crate::error::AppError::InvalidInput("The file is larger than 2 MB.".into()));
    }
    let text = std::fs::read_to_string(&path).map_err(|_| crate::error::AppError::InvalidInput("The file is not UTF-8 text.".into()))?;
    Ok(Some(text))
}

// ---------- session intelligence (src-tauri/src/session) ----------

use crate::session::{self as sessions, store as session_store, tracker as session_tracker};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetailResponse {
    pub detail: session_store::SessionDetail,
    /// The completed session before this one (for comparisons).
    pub previous: Option<session_store::SessionSummary>,
}

#[tauri::command]
pub async fn session_status(state: State<'_, AppState>, game: GameId) -> AppResult<session_tracker::Status> {
    sessions::require_poe2(game)?;
    state.sessions.status()
}

#[tauri::command]
pub async fn session_diagnostics(state: State<'_, AppState>, game: GameId) -> AppResult<session_tracker::Diagnostics> {
    sessions::require_poe2(game)?;
    state.sessions.diagnostics()
}

#[tauri::command]
pub fn session_list(state: State<'_, AppState>, game: GameId, query: session_store::HistoryQuery) -> AppResult<Vec<session_store::SessionSummary>> {
    sessions::require_poe2(game)?;
    session_store::list(&*state.db.conn()?, game, &query)
}

#[tauri::command]
pub fn session_detail(state: State<'_, AppState>, game: GameId, id: i64) -> AppResult<Option<SessionDetailResponse>> {
    sessions::require_poe2(game)?;
    let conn = state.db.conn()?;
    let Some(detail) = session_store::detail(&conn, game, id)? else { return Ok(None) };
    let previous = session_store::previous_completed(&conn, game, detail.summary.started_at)?;
    Ok(Some(SessionDetailResponse { detail, previous }))
}

#[tauri::command]
pub fn session_delete(state: State<'_, AppState>, game: GameId, ids: Vec<i64>) -> AppResult<usize> {
    sessions::require_poe2(game)?;
    if ids.len() > 5000 {
        return Err(crate::error::AppError::InvalidInput("Too many sessions selected.".into()));
    }
    let mut conn = state.db.conn()?;
    let tx = conn.transaction()?;
    let n = session_store::delete(&tx, game, &ids)?;
    tx.commit()?;
    Ok(n)
}

#[tauri::command]
pub async fn session_set_config(state: State<'_, AppState>, game: GameId, config: session_tracker::Config) -> AppResult<session_tracker::Status> {
    sessions::require_poe2(game)?;
    state.sessions.set_config(config)
}

#[tauri::command]
pub async fn session_set_paused(state: State<'_, AppState>, game: GameId, paused: bool) -> AppResult<session_tracker::Status> {
    sessions::require_poe2(game)?;
    state.sessions.set_paused(paused)
}

#[tauri::command]
pub async fn session_check_now(state: State<'_, AppState>, game: GameId) -> AppResult<session_tracker::Status> {
    sessions::require_poe2(game)?;
    state.sessions.poke();
    state.sessions.status()
}

/// Lets the user pick Client.txt. The file is validated (read-only) and never launched. None = cancelled.
#[tauri::command]
pub async fn session_choose_log(app: tauri::AppHandle, state: State<'_, AppState>, game: GameId) -> AppResult<Option<session_tracker::Status>> {
    use tauri_plugin_dialog::DialogExt;
    sessions::require_poe2(game)?;
    let picked = app.dialog().file().set_title("Choose the Path of Exile 2 Client.txt").add_filter("Client log", &["txt"]).blocking_pick_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file.into_path().map_err(|_| crate::error::AppError::InvalidInput("Unsupported file location.".into()))?;
    state.sessions.set_manual_log(Some(path)).map(Some)
}

#[tauri::command]
pub async fn session_clear_log(state: State<'_, AppState>, game: GameId) -> AppResult<session_tracker::Status> {
    sessions::require_poe2(game)?;
    state.sessions.set_manual_log(None)
}

#[tauri::command]
pub async fn session_reset(state: State<'_, AppState>, game: GameId) -> AppResult<session_tracker::Status> {
    sessions::require_poe2(game)?;
    state.sessions.reset()
}

/// Exports sessions (all when `ids` is empty) as JSON or CSV through a save dialog. False = cancelled.
#[tauri::command]
pub async fn session_export(app: tauri::AppHandle, state: State<'_, AppState>, game: GameId, ids: Vec<i64>, format: String) -> AppResult<bool> {
    use tauri_plugin_dialog::DialogExt;
    sessions::require_poe2(game)?;
    let now = crate::market::http::unix_now();
    let (contents, ext, label) = {
        let conn = state.db.conn()?;
        let all = session_store::list(&conn, game, &session_store::HistoryQuery { sort: Some("oldest".into()), limit: Some(5000), ..Default::default() })?;
        let chosen: Vec<_> = all.into_iter().filter(|s| ids.is_empty() || ids.contains(&s.id)).collect();
        if chosen.is_empty() {
            return Err(crate::error::AppError::InvalidInput("No sessions to export.".into()));
        }
        match format.as_str() {
            "csv" => (sessions::export::to_csv(&chosen), "csv", "CSV"),
            "json" => {
                let mut details = Vec::with_capacity(chosen.len());
                for s in &chosen {
                    if let Some(d) = session_store::detail(&conn, game, s.id)? {
                        details.push(d);
                    }
                }
                (sessions::export::to_json(game, &details, now)?, "json", "JSON")
            }
            _ => return Err(crate::error::AppError::InvalidInput("Unknown export format.".into())),
        }
    };
    let picked = app
        .dialog()
        .file()
        .set_title("Export sessions")
        .set_file_name(format!("vaalytics-poe2-sessions.{ext}"))
        .add_filter(label, &[ext])
        .blocking_save_file();
    let Some(file) = picked else { return Ok(false) };
    let path = file.into_path().map_err(|_| crate::error::AppError::InvalidInput("Unsupported file location.".into()))?;
    std::fs::write(path, contents)?;
    Ok(true)
}

// ---------- loot journal (src-tauri/src/loot) ----------

use crate::loot::{self, store as loot_store};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LootDetailResponse {
    pub item: loot_store::LootItem,
    /// The copy exactly as captured (never modified).
    pub raw_text: String,
    pub valuations: Vec<loot_store::Valuation>,
}

fn require_loot_game(game: GameId) -> AppResult<()> {
    if game == loot::GAME {
        Ok(())
    } else {
        Err(crate::error::AppError::InvalidInput("Loot Journal is available for Path of Exile 2 only.".into()))
    }
}

#[tauri::command]
pub async fn loot_status(state: State<'_, AppState>, game: GameId) -> AppResult<loot::CaptureStatus> {
    require_loot_game(game)?;
    Ok(state.loot.status())
}

#[tauri::command]
pub async fn loot_config(state: State<'_, AppState>, game: GameId) -> AppResult<loot::LootConfig> {
    require_loot_game(game)?;
    Ok(state.loot.config())
}

#[tauri::command]
pub async fn loot_set_config(state: State<'_, AppState>, game: GameId, config: loot::LootConfig) -> AppResult<loot::LootConfig> {
    require_loot_game(game)?;
    state.loot.set_config(config)
}

#[tauri::command]
pub async fn loot_list(state: State<'_, AppState>, game: GameId, query: loot_store::LibraryQuery) -> AppResult<Vec<loot_store::LootItem>> {
    require_loot_game(game)?;
    loot_store::list(&*state.db.conn()?, game, &query)
}

#[tauri::command]
pub async fn loot_detail(state: State<'_, AppState>, game: GameId, id: i64) -> AppResult<Option<LootDetailResponse>> {
    require_loot_game(game)?;
    let conn = state.db.conn()?;
    let Some(item) = loot_store::get(&conn, game, id)? else { return Ok(None) };
    let raw_text = loot_store::raw_text(&conn, game, id)?.unwrap_or_default();
    let valuations = loot_store::valuations(&conn, id)?;
    Ok(Some(LootDetailResponse { item, raw_text, valuations }))
}

#[tauri::command]
pub async fn loot_edit(state: State<'_, AppState>, game: GameId, id: i64, edit: loot_store::ItemEdit) -> AppResult<()> {
    require_loot_game(game)?;
    loot_store::edit(&*state.db.conn()?, game, id, &edit)
}

/// Re-values items now from cached market data (and asks the Market engine to refresh expired categories).
#[tauri::command]
pub async fn loot_revalue(state: State<'_, AppState>, game: GameId, ids: Vec<i64>) -> AppResult<usize> {
    require_loot_game(game)?;
    if ids.len() > 500 {
        return Err(crate::error::AppError::InvalidInput("Revalue at most 500 items at once.".into()));
    }
    if ids.is_empty() {
        // e.g. the market league changed: the scheduler requeues and revalues now.
        state.loot.poke();
        return Ok(0);
    }
    state.loot.value_items(&ids, false)
}

/// Records the user's own valuation (base unit, whole stack); `None` returns the item to automatic pricing.
#[tauri::command]
pub async fn loot_set_manual_value(state: State<'_, AppState>, game: GameId, id: i64, value: Option<f64>, note: Option<String>) -> AppResult<()> {
    require_loot_game(game)?;
    let now = crate::market::http::unix_now();
    match value {
        Some(v) if v.is_finite() && (0.0..1e9).contains(&v) => {
            let v = loot_store::NewValuation {
                status: "manual",
                unit_value: Some(v),
                quantity: 1,
                unit: crate::market::catalog::base_unit(game),
                source: "you".into(),
                market_category: None,
                league: None,
                confidence: None,
                data_fetched_at: None,
                note: note.map(|n| n.chars().take(200).collect()),
                icon: None,
            };
            loot_store::record_valuation(&*state.db.conn()?, game, id, &v, now)?;
        }
        Some(_) => return Err(crate::error::AppError::InvalidInput("Enter a value of 0 or more.".into())),
        None => {
            state.db.conn()?.execute(
                "UPDATE loot_items SET value_status = 'pending', value_checks = 0 WHERE game = ?1 AND id = ?2",
                rusqlite::params![game.as_str(), id],
            )?;
            state.loot.poke();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn loot_delete(state: State<'_, AppState>, game: GameId, ids: Vec<i64>) -> AppResult<usize> {
    require_loot_game(game)?;
    if ids.len() > 20_000 {
        return Err(crate::error::AppError::InvalidInput("Too many items selected.".into()));
    }
    let mut conn = state.db.conn()?;
    let tx = conn.transaction()?;
    let n = loot_store::delete(&tx, game, &ids)?;
    tx.commit()?;
    Ok(n)
}

#[tauri::command]
pub async fn loot_clear(state: State<'_, AppState>, game: GameId) -> AppResult<usize> {
    require_loot_game(game)?;
    loot_store::clear(&*state.db.conn()?, game)
}

#[tauri::command]
pub async fn loot_events(state: State<'_, AppState>, game: GameId, limit: i64) -> AppResult<Vec<loot_store::CaptureEventRow>> {
    require_loot_game(game)?;
    loot_store::recent_events(&*state.db.conn()?, game, limit)
}

/// Exports items (all when `ids` is empty) as JSON (with raw text and valuations) or CSV. False = cancelled.
#[tauri::command]
pub async fn loot_export(app: tauri::AppHandle, state: State<'_, AppState>, game: GameId, ids: Vec<i64>, format: String) -> AppResult<bool> {
    use tauri_plugin_dialog::DialogExt;
    require_loot_game(game)?;
    let (contents, ext, label) = {
        let conn = state.db.conn()?;
        match format.as_str() {
            "json" => {
                let items = loot_store::export_items(&conn, game, &ids)?;
                if items.is_empty() {
                    return Err(crate::error::AppError::InvalidInput("No items to export.".into()));
                }
                let doc = serde_json::json!({
                    "app": "Vaalytics", "appVersion": env!("CARGO_PKG_VERSION"), "kind": "loot-journal", "game": game.as_str(),
                    "exportedAt": crate::market::http::unix_now(), "unit": crate::market::catalog::base_unit(game), "items": items
                });
                (serde_json::to_string_pretty(&doc)?, "json", "JSON")
            }
            "csv" => {
                let all = loot_store::list(&conn, game, &loot_store::LibraryQuery { sort: Some("oldest".into()), limit: Some(20_000), ..Default::default() })?;
                let chosen: Vec<_> = all.into_iter().filter(|i| ids.is_empty() || ids.contains(&i.id)).collect();
                if chosen.is_empty() {
                    return Err(crate::error::AppError::InvalidInput("No items to export.".into()));
                }
                (loot::export_csv(&chosen), "csv", "CSV")
            }
            _ => return Err(crate::error::AppError::InvalidInput("Unknown export format.".into())),
        }
    };
    let picked = app.dialog().file().set_title("Export Loot Journal").set_file_name(format!("vaalytics-poe2-loot.{ext}")).add_filter(label, &[ext]).blocking_save_file();
    let Some(file) = picked else { return Ok(false) };
    let path = file.into_path().map_err(|_| crate::error::AppError::InvalidInput("Unsupported file location.".into()))?;
    std::fs::write(path, contents)?;
    Ok(true)
}

/// Imports a Loot Journal JSON export (at most 20 MB). Every item's text is re-validated. None = cancelled.
#[tauri::command]
pub async fn loot_import(app: tauri::AppHandle, state: State<'_, AppState>, game: GameId) -> AppResult<Option<loot_store::ImportResult>> {
    use tauri_plugin_dialog::DialogExt;
    require_loot_game(game)?;
    let picked = app.dialog().file().set_title("Import Loot Journal").add_filter("JSON", &["json"]).blocking_pick_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file.into_path().map_err(|_| crate::error::AppError::InvalidInput("Unsupported file location.".into()))?;
    if std::fs::metadata(&path)?.len() > 20 * 1024 * 1024 {
        return Err(crate::error::AppError::InvalidInput("The file is larger than 20 MB.".into()));
    }
    let text = std::fs::read_to_string(&path).map_err(|_| crate::error::AppError::InvalidInput("The file is not UTF-8 text.".into()))?;
    let result = loot::import_json(&state.db, game, &text, crate::market::http::unix_now())?;
    state.loot.poke();
    Ok(Some(result))
}

// ---------- Campaign Intelligence (PoE 2) ----------

fn now_unix() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[tauri::command]
pub async fn campaign_status(state: State<'_, AppState>, game: GameId) -> AppResult<crate::campaign::store::CampaignStatus> {
    crate::campaign::require_campaign_game(game)?;
    crate::campaign::store::status(&*state.db.conn()?, game)
}

#[tauri::command]
pub async fn campaign_characters(state: State<'_, AppState>, game: GameId) -> AppResult<Vec<crate::campaign::store::CharacterRow>> {
    crate::campaign::require_campaign_game(game)?;
    crate::campaign::store::characters(&*state.db.conn()?, game)
}

#[tauri::command]
pub async fn campaign_events(state: State<'_, AppState>, game: GameId, character_id: i64) -> AppResult<Vec<crate::campaign::store::EventRow>> {
    crate::campaign::require_campaign_game(game)?;
    crate::campaign::store::events(&*state.db.conn()?, game, character_id)
}

#[tauri::command]
pub async fn campaign_marks(state: State<'_, AppState>, game: GameId, character_id: i64) -> AppResult<Vec<crate::campaign::store::MarkRow>> {
    crate::campaign::require_campaign_game(game)?;
    crate::campaign::store::marks(&*state.db.conn()?, game, character_id)
}

#[tauri::command]
pub async fn campaign_set_mark(
    state: State<'_, AppState>,
    game: GameId,
    character_id: i64,
    objective_id: String,
    mark: Option<String>,
    choice: Option<String>,
) -> AppResult<()> {
    crate::campaign::require_campaign_game(game)?;
    crate::campaign::store::set_mark(&*state.db.conn()?, game, character_id, &objective_id, mark.as_deref(), choice.as_deref(), now_unix())
}

#[tauri::command]
pub async fn campaign_set_hidden(state: State<'_, AppState>, game: GameId, character_id: i64, hidden: bool) -> AppResult<()> {
    crate::campaign::require_campaign_game(game)?;
    crate::campaign::store::set_hidden(&*state.db.conn()?, game, character_id, hidden)
}

#[tauri::command]
pub async fn campaign_delete_character(state: State<'_, AppState>, game: GameId, character_id: i64) -> AppResult<()> {
    crate::campaign::require_campaign_game(game)?;
    crate::campaign::store::delete_character(&*state.db.conn()?, game, character_id)
}

/// Reads the whole Client.txt once (explicit user action) on a blocking thread.
#[tauri::command]
pub async fn campaign_import_log(state: State<'_, AppState>, game: GameId) -> AppResult<crate::campaign::import::ImportSummary> {
    crate::campaign::require_poe2(game)?;
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::campaign::resolve_log_path(&db, game)?;
        crate::campaign::import::import_log(&db, game, &path, crate::session::localtime::local_to_unix)
    })
    .await
    .map_err(|_| crate::error::AppError::StatePoisoned)?
}

/// Opens (or focuses) the Location Atlas window, optionally on a campaign area.
/// Window creation must be async (sync deadlocks on Windows).
#[tauri::command]
pub async fn atlas_open(app: tauri::AppHandle, game: GameId, area: Option<String>) -> AppResult<()> {
    crate::campaign::require_poe1(game)?;
    crate::atlas::open(&app, area).map_err(|e| {
        log::error!("atlas window: {e}");
        crate::error::AppError::InvalidInput("The Location Atlas window couldn't be opened.".into())
    })
}

/// Location Atlas (PoE 1): reads what was appended to the PoE 1 Client.txt since the last call
/// (same reader, parser and campaign hook as PoE 2). Called by the Atlas only while it is visible.
#[tauri::command]
pub async fn atlas_sync(state: State<'_, AppState>, game: GameId) -> AppResult<crate::campaign::sync::SyncSummary> {
    crate::campaign::require_poe1(game)?;
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = crate::campaign::resolve_poe1_log(&db)?;
        crate::campaign::sync::sync_log(&db, game, &path, crate::session::localtime::local_to_unix, 64 * 1024 * 1024)
    })
    .await
    .map_err(|_| crate::error::AppError::StatePoisoned)?
}

/// Location Atlas (PoE 1): the player's choice of Client.txt (validated as a PoE 1 log).
#[tauri::command]
pub async fn atlas_set_log_path(state: State<'_, AppState>, game: GameId, path: String) -> AppResult<()> {
    crate::campaign::require_poe1(game)?;
    crate::campaign::set_poe1_log(&state.db, std::path::Path::new(&path))
}

#[tauri::command]
pub async fn campaign_reward_marks(state: State<'_, AppState>, game: GameId, character_id: i64) -> AppResult<Vec<crate::campaign::store::RewardMarkRow>> {
    crate::campaign::require_campaign_game(game)?;
    crate::campaign::store::reward_marks(&*state.db.conn()?, game, character_id)
}

#[tauri::command]
pub async fn campaign_set_reward_mark(
    state: State<'_, AppState>,
    game: GameId,
    character_id: i64,
    reward_id: String,
    stage: Option<String>,
    choice: Option<String>,
) -> AppResult<()> {
    crate::campaign::require_campaign_game(game)?;
    crate::campaign::store::set_reward_mark(&*state.db.conn()?, game, character_id, &reward_id, stage.as_deref(), choice.as_deref(), now_unix())
}

/// Planned-build numbers from a PoB (PoE 2) build for build-aware campaign hints.
/// `rel` is the "folder/name" listed by `pob_builds`; the folder is computed here.
#[tauri::command]
pub async fn campaign_build_stats(app: tauri::AppHandle, game: GameId, rel: String) -> AppResult<crate::campaign::build_stats::BuildStats> {
    crate::campaign::require_poe2(game)?;
    let dir = pob::builds_dir(game, documents(&app).as_deref()).ok_or_else(|| crate::error::AppError::InvalidInput("Path of Building builds folder not found.".into()))?;
    crate::campaign::build_stats::read(&dir, &rel)
}

// ---------- Act Tracker (PoE 1) overlay window ----------

fn require_act_tracker(game: GameId) -> AppResult<()> {
    if game == GameId::Poe1 {
        Ok(())
    } else {
        Err(crate::error::AppError::InvalidInput("The Act Tracker is available for Path of Exile 1 only.".into()))
    }
}

fn tracker_window_error(e: tauri::Error) -> crate::error::AppError {
    log::error!("act tracker window: {e}");
    crate::error::AppError::InvalidInput("The Act Tracker window couldn't be shown.".into())
}

/// Shows the overlay (creating it on first use) without taking focus. Async: window creation must not block.
#[tauri::command]
pub async fn act_tracker_open(app: tauri::AppHandle, game: GameId) -> AppResult<crate::act_tracker::TrackerWindowState> {
    require_act_tracker(game)?;
    crate::act_tracker::open(&app).map_err(tracker_window_error)?;
    Ok(crate::act_tracker::state(&app))
}

#[tauri::command]
pub async fn act_tracker_hide(app: tauri::AppHandle, game: GameId) -> AppResult<crate::act_tracker::TrackerWindowState> {
    require_act_tracker(game)?;
    crate::act_tracker::hide(&app).map_err(tracker_window_error)?;
    Ok(crate::act_tracker::state(&app))
}

#[tauri::command]
pub async fn act_tracker_close(app: tauri::AppHandle, game: GameId) -> AppResult<crate::act_tracker::TrackerWindowState> {
    require_act_tracker(game)?;
    crate::act_tracker::close(&app).map_err(tracker_window_error)?;
    Ok(crate::act_tracker::state(&app))
}

#[tauri::command]
pub async fn act_tracker_state(app: tauri::AppHandle, game: GameId) -> AppResult<crate::act_tracker::TrackerWindowState> {
    require_act_tracker(game)?;
    Ok(crate::act_tracker::state(&app))
}

#[tauri::command]
pub async fn act_tracker_set_click_through(app: tauri::AppHandle, game: GameId, on: bool) -> AppResult<crate::act_tracker::TrackerWindowState> {
    require_act_tracker(game)?;
    crate::act_tracker::set_click_through(&app, on)?;
    Ok(crate::act_tracker::state(&app))
}

/// Validates and stores the show/hide hotkey ("" turns it off). It is registered the next time Path of Exile 1
/// becomes the foreground window.
#[tauri::command]
pub async fn act_tracker_set_hotkey(state: State<'_, AppState>, game: GameId, hotkey: String) -> AppResult<()> {
    require_act_tracker(game)?;
    let hotkey = hotkey.trim().to_owned();
    if !hotkey.is_empty() && !crate::act_tracker::valid_hotkey(&hotkey) {
        return Err(crate::error::AppError::InvalidInput("That shortcut isn't valid (e.g. Ctrl+Shift+T).".into()));
    }
    crate::settings::set_game(&state.db, game, crate::act_tracker::KEY_HOTKEY, &serde_json::Value::String(hotkey))
}
