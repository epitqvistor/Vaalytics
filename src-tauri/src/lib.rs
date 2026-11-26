//! Vaalytics native host. See docs/architecture/overview.md.

mod browser;
mod act_tracker;
mod atlas;
mod campaign;
mod commands;
mod crafting;
mod decks;
mod db;
mod diagnostics;
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
mod updates;

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
    pub decks: std::sync::Arc<decks::DeckService>,
    pub updates: Arc<updates::UpdateService>,
}

pub fn run() {
    tauri::Builder::default()
        // One Vaalytics at a time: a second launch focuses the running window and exits.
        // Must be the first plugin (tauri-plugin-single-instance docs).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
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
            loot.set_data_dir(data_dir.clone());
            loot.start(app.handle().clone());
            let decks = decks::DeckService::new(Arc::clone(&db), data_dir.clone());
            decks.start(app.handle().clone());
            // Update Center: game-data synchronisation. Modules are notified when a dataset they read changes.
            let updates = updates::UpdateService::new(Arc::clone(&db), Arc::clone(&market));
            updates.set_data_dir(data_dir.clone());
            {
                let decks = Arc::clone(&decks);
                updates.on_dataset_changed(move |ev| {
                    if ev.dataset_id == "poe1.divination-cards" {
                        decks.reset_matcher();
                    }
                });
            }
            updates.start(app.handle().clone());
            app.manage(AppState { db, diagnostics: diagnostics::Diagnostics::new(), market, trade, pob: pob::PobService::new(), crafting: crafting::CraftingService::new(data_dir.clone()), sessions, loot, decks, updates });
            app.manage(overlay::OverlayState::default());
            overlay::init(app)?;
            Ok(())
        })
        // Closing the main window quits Vaalytics. Helper windows (price-check overlay,
        // Act Tracker) are hidden rather than closed after use, and a hidden window would
        // otherwise keep the process running with no visible UI.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                log::info!("main window closed; exiting");
                window.app_handle().exit(0);
            }
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
            commands::decks_cards,
            commands::decks_config,
            commands::decks_set_config,
            commands::decks_sessions,
            commands::decks_session,
            commands::decks_card_totals,
            commands::decks_create,
            commands::decks_update,
            commands::decks_pause,
            commands::decks_set_opened,
            commands::decks_resume,
            commands::decks_finish,
            commands::decks_delete,
            commands::decks_event_confirm,
            commands::decks_event_remove,
            commands::decks_event_restore,
            commands::decks_event_correct,
            commands::decks_add_manual,
            commands::decks_recognize_file,
            commands::decks_retry_capture,
            commands::decks_capture_image,
            commands::decks_price_overrides,
            commands::decks_set_price_override,
            commands::decks_log_status,
            commands::decks_import_start,
            commands::decks_import_cancel,
            commands::decks_import_status,
            commands::decks_hotkey_status,
            commands::decks_save_export,
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
            commands::loot_maps,
            commands::loot_map_counts,
            commands::loot_map_control,
            commands::loot_map_edit,
            commands::loot_map_delete,
            commands::loot_assign_map,
            commands::loot_tracker_summary,
            commands::loot_tracker_state,
            commands::loot_tracker_window,
            commands::loot_tracker_set_click_through,
            commands::loot_hotkey_problem,
            commands::loot_reset_session,
            commands::loot_inventory_snapshots,
            commands::loot_inventory_detail,
            commands::loot_inventory_edit_entry,
            commands::loot_inventory_update,
            commands::loot_inventory_reprocess,
            commands::loot_inventory_delete,
            commands::loot_inventory_from_file,
            commands::loot_inventory_item_names,
            commands::updates_overview,
            commands::updates_run,
            commands::updates_apply,
            commands::updates_rollback,
            commands::updates_changes,
            commands::updates_set_change_status,
            commands::updates_versions,
            commands::updates_history,
            commands::updates_checks,
            commands::updates_leagues,
            commands::updates_articles,
            commands::updates_process_article,
            commands::updates_set_article_reviewed,
            commands::updates_set_source_enabled,
            commands::updates_test_source,
            commands::updates_set_settings,
            commands::updates_refresh_managed,
            commands::updates_analytics,
            commands::updates_app_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vaalytics");
}
