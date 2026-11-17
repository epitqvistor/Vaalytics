//! Vaalytics native host. See docs/architecture/overview.md.

mod browser;
mod commands;
mod crafting;
mod db;
mod diagnostics;
mod error;
mod game;
mod market;
mod overlay;
mod pob;
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
            std::fs::create_dir_all(&data_dir)?;
            let db = Arc::new(db::Database::open(&data_dir.join("vaalytics.db"))?);
            log::info!("Vaalytics {} started, schema v{}", env!("CARGO_PKG_VERSION"), db.schema_version()?);
            let market = market::MarketEngine::new(Arc::clone(&db));
            market.attach(app.handle().clone());
            market.start_background();
            let trade = Arc::new(trade::TradeService::new(Arc::clone(&db), Arc::clone(&market), data_dir.clone()));
            app.manage(AppState { db, diagnostics: diagnostics::Diagnostics::new(), market, trade, pob: pob::PobService::new(), crafting: crafting::CraftingService::new(data_dir.clone()) });
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vaalytics");
}
