//! Vaalytics native host. See docs/architecture/overview.md.

mod browser;
mod act_tracker;
mod atlas;
mod campaign;
mod commands;
mod crafting;
mod db;
mod diagnostics;
mod farming;
mod regex_library;
mod error;
mod game;
mod loot;
mod market;
mod overlay;
mod pob;
mod session;
mod settings;
mod trade;

use std::sync::Arc;
use tauri::Manager;

pub struct AppState {
    pub db: Arc<db::Database>,
    pub diagnostics: diagnostics::Diagnostics,
    pub market: Arc<market::MarketEngine>,
    pub trade: Arc<trade::TradeService>,
    pub pob: pob::PobService,
    pub crafting: crafting::CraftingService,
    pub sessions: session::SessionService,
    pub loot: loot::LootService,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                .max_file_size(2 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            // Dev builds only: a throwaway data folder for visual QA, so a test run never
            // migrates or writes the user's real database (docs/development/setup.md).
            #[cfg(debug_assertions)]
            let data_dir = std::env::var_os("VAALYTICS_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(data_dir);
            std::fs::create_dir_all(&data_dir)?;
            let db = Arc::new(db::Database::open(&data_dir.join("vaalytics.db"))?);
            log::info!("Vaalytics {} started, schema v{}", env!("CARGO_PKG_VERSION"), db.schema_version()?);
            let market = market::MarketEngine::new(Arc::clone(&db));
            market.attach(app.handle().clone());
            market.start_background();
            let trade = Arc::new(trade::TradeService::new(Arc::clone(&db), Arc::clone(&market), data_dir.clone()));
            let sessions = session::SessionService::new(Arc::clone(&db));
            sessions.start(app.handle().clone());
            let loot = loot::LootService::new(Arc::clone(&db), Some(Arc::clone(&market)), loot::session_context_from(sessions.clone()), market::http::unix_now);
            loot.start(app.handle().clone());
            app.manage(AppState { db, diagnostics: diagnostics::Diagnostics::new(), market, trade, pob: pob::PobService::new(), crafting: crafting::CraftingService::new(data_dir.clone()), sessions, loot });
            app.manage(overlay::OverlayState::default());
            overlay::init(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_last_game,
            commands::set_last_game,
            commands::get_app_setting,
            commands::set_app_setting,
            commands::get_game_setting,
            commands::set_game_setting,
            commands::get_diagnostics,
            commands::market_categories,
            commands::market_leagues,
            commands::market_overview,
            commands::market_refresh,
            commands::market_history,
            commands::market_stats,
            commands::trade_stats,
            commands::farming_sessions,
            commands::farming_save_session,
            commands::farming_delete_session,
            commands::regex_list,
            commands::regex_save,
            commands::regex_set_favorite,
            commands::regex_delete,
            commands::regex_slots,
            commands::regex_set_slot,
            commands::regex_export,
            commands::regex_import,
            commands::trade_gem_variants,
            commands::trade_price_check,
            commands::trade_fetch_more,
            commands::overlay_status,
            commands::overlay_take_pending,
            commands::overlay_preview,
            commands::pob_status,
            commands::pob_choose_exe,
            commands::pob_clear_path,
            commands::pob_launch,
            commands::pob_builds,
            commands::pob_open_builds_folder,
            commands::browser_open,
            commands::browser_set_bounds,
            commands::browser_show_only,
            commands::browser_action,
            commands::browser_close,
            commands::browser_open_external,
            commands::crafting_data,
            commands::session_status,
            commands::session_diagnostics,
            commands::session_list,
            commands::session_detail,
            commands::session_delete,
            commands::session_set_config,
            commands::session_set_paused,
            commands::session_check_now,
            commands::session_choose_log,
            commands::session_clear_log,
            commands::session_reset,
            commands::campaign_status,
            commands::campaign_characters,
            commands::campaign_events,
            commands::campaign_marks,
            commands::campaign_set_mark,
            commands::campaign_set_hidden,
            commands::campaign_delete_character,
            commands::campaign_import_log,
            commands::campaign_reward_marks,
            commands::campaign_set_reward_mark,
            commands::campaign_build_stats,
            commands::atlas_open,
            commands::atlas_sync,
            commands::atlas_set_log_path,
            commands::act_tracker_open,
            commands::act_tracker_hide,
            commands::act_tracker_close,
            commands::act_tracker_state,
            commands::act_tracker_set_click_through,
            commands::act_tracker_set_hotkey,
            commands::session_export,
            commands::loot_status,
            commands::loot_config,
            commands::loot_set_config,
            commands::loot_list,
            commands::loot_detail,
            commands::loot_edit,
            commands::loot_revalue,
            commands::loot_set_manual_value,
            commands::loot_delete,
            commands::loot_clear,
            commands::loot_events,
            commands::loot_export,
            commands::loot_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vaalytics");
}
