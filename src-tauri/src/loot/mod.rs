//! Loot Journal: automatic capture of PoE 2 item copies (Ctrl+C in the game),
//! categorisation, duplicate handling, valuation from cached market data and
//! session association. Spec: docs/modules/loot-journal.md
//!
//! Privacy: the clipboard is read only after a change notification that
//! arrived while a Path of Exile 2 window was in the foreground (see
//! clipboard.rs). Text that isn't an item copy is dropped immediately — never
//! stored, logged or sent anywhere. The clipboard is never written.

pub mod clipboard;
pub mod hotkeys;
pub mod inventory;
pub mod item_text;
pub mod maps;
pub mod store;
pub mod tracker_window;
pub mod valuation;

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use crate::market::MarketEngine;
use crate::session::SessionService;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use store::{CaptureContext, CaptureOutcome, DuplicateMode};
use tauri::{AppHandle, Emitter, Listener};

pub const GAME: GameId = GameId::Poe2;
pub const CONFIG_KEY: &str = "loot.config";
/// Game setting: unix time of the user's last "Reset session" (overlay counters start there); absent = follow
/// the game session from Session Intelligence.
pub const RUN_KEY: &str = "loot.sessionResetAt";
pub const EVENT_UPDATED: &str = "loot:updated";
pub const EVENT_CAPTURED: &str = "loot:captured";
pub const EVENT_STATUS: &str = "loot:status";
/// The saved configuration changed (payload: the config), so every window can follow it.
pub const EVENT_CONFIG: &str = "loot:config";
/// Result of a Loot Tracker hotkey press (shown by the overlay).
pub const EVENT_HOTKEY: &str = "loot:hotkey";
/// Coalesces bursts of clipboard notifications.
const SETTLE: Duration = Duration::from_millis(80);
const RETRY_NO_DATA_SECS: i64 = 180;
const MAX_NO_DATA_RETRIES: i64 = 6;
const VALUE_BATCH: i64 = 100;

static FOREGROUND_POE2: AtomicBool = AtomicBool::new(false);
static CAPTURE_ENABLED: AtomicBool = AtomicBool::new(false);
/// The running service, so the foreground hook can publish status changes.
static SERVICE: std::sync::OnceLock<LootService> = std::sync::OnceLock::new();

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LootConfig {
    pub enabled: bool,
    pub duplicate_mode: DuplicateMode,
    pub cooldown_minutes: u32,
    pub auto_value: bool,
    /// 0 = no automatic revaluation.
    pub revalue_minutes: u32,
    pub min_confidence: String,
    /// Market categories the scheduler may ask the Market engine to refresh per pass.
    pub max_requests: u32,
    pub notify_captures: bool,
    pub notify_unique: bool,
    /// Notify for items worth at least this much (game base unit); 0 = off.
    pub notify_threshold: f64,
    pub notify_value_changes: bool,
    pub notify_errors: bool,
    /// 0 = keep forever (favourites are always kept).
    pub retention_days: u32,
    /// Loot Tracker overlay: background opacity (0.4–1), scale (0.8–1.4), layout, rows in compact mode (5–7).
    pub overlay_opacity: f64,
    pub overlay_scale: f64,
    /// "compact" | "expanded"
    pub overlay_mode: String,
    /// Collapsed to its header bar.
    pub overlay_collapsed: bool,
    pub overlay_rows: u32,
    pub overlay_always_on_top: bool,
    /// Global hotkeys, registered only while PoE 2 is in the foreground ("" = off).
    pub hotkeys: hotkeys::LootHotkeys,
}

impl Default for LootConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            duplicate_mode: DuplicateMode::Merge,
            cooldown_minutes: 30,
            auto_value: true,
            revalue_minutes: 60,
            min_confidence: "low".into(),
            max_requests: 4,
            notify_captures: false,
            notify_unique: false,
            notify_threshold: 0.0,
            notify_value_changes: false,
            notify_errors: false,
            retention_days: 0,
            overlay_opacity: 0.9,
            overlay_scale: 1.0,
            overlay_mode: "compact".into(),
            overlay_collapsed: false,
            overlay_rows: 6,
            overlay_always_on_top: true,
            hotkeys: hotkeys::LootHotkeys::default(),
        }
    }
}

impl LootConfig {
    pub fn sanitized(mut self) -> Self {
        self.cooldown_minutes = self.cooldown_minutes.clamp(1, 24 * 60);
        self.revalue_minutes = if self.revalue_minutes == 0 { 0 } else { self.revalue_minutes.clamp(15, 24 * 60) };
        if !valuation::MIN_CONFIDENCE_ORDER.contains(&self.min_confidence.as_str()) {
            self.min_confidence = "low".into();
        }
        self.max_requests = self.max_requests.min(13);
        if !self.notify_threshold.is_finite() || self.notify_threshold < 0.0 {
            self.notify_threshold = 0.0;
        }
        self.retention_days = self.retention_days.min(3650);
        self.overlay_opacity = if self.overlay_opacity.is_finite() { self.overlay_opacity.clamp(0.4, 1.0) } else { 0.9 };
        self.overlay_scale = if self.overlay_scale.is_finite() { self.overlay_scale.clamp(0.8, 1.4) } else { 1.0 };
        if !matches!(self.overlay_mode.as_str(), "compact" | "expanded") {
            self.overlay_mode = "compact".into();
        }
        self.overlay_rows = self.overlay_rows.clamp(5, 7);
        for k in [
            &mut self.hotkeys.toggle_overlay,
            &mut self.hotkeys.collapse_overlay,
            &mut self.hotkeys.start_map,
            &mut self.hotkeys.finish_map,
            &mut self.hotkeys.screenshot,
        ] {
            *k = k.trim().chars().take(64).collect();
        }
        self
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub enabled: bool,
    /// The OS listener is registered right now (PoE 2 in the foreground).
    pub listening: bool,
    pub game_focused: bool,
    /// Windows has the listener registered (diagnostics; follows `listening` within milliseconds).
    pub registered: bool,
    pub available: bool,
    pub captured_this_run: u64,
    pub last_capture_at: Option<i64>,
    pub last_item_name: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedEvent {
    pub item_id: i64,
    pub name: String,
    pub rarity: String,
    pub value_status: String,
    pub value_total: Option<f64>,
    pub unit: &'static str,
    /// Why the user asked to be told, or None (no notification).
    pub notify: Option<String>,
}

/// Everything the Loot Tracker overlay shows, in one read.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerSummary {
    pub now: i64,
    pub session_id: Option<i64>,
    pub session_started_at: Option<i64>,
    /// Area the player is in right now (from Session Intelligence), when known.
    pub area_name: Option<String>,
    pub area_kind: Option<String>,
    pub open_map: Option<maps::MapRun>,
    /// The most recent finished map of this session (shown when no map is open).
    pub last_map: Option<maps::MapRun>,
    pub maps_finished: i64,
    pub session_totals: maps::Totals,
    /// Newest first: this session's captures, or the latest captures when no session is active.
    pub recent: Vec<store::LootItem>,
    pub capture: CaptureStatus,
    /// Inventory snapshot assigned to the last map, with its change: (snapshot id, estimated gain, lines to review).
    pub last_map_inventory: Option<(i64, f64, usize)>,
    /// Set when the counters start at the user's "Reset session" instead of the game session.
    pub reset_at: Option<i64>,
    /// The latest inventory snapshot of this session (or since the reset).
    pub inventory: Option<inventory::service::OverlayInventory>,
}

/// Session context for a capture (from Session Intelligence).
pub type SessionContextFn = Box<dyn Fn() -> Option<SessionContext> + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct SessionContext {
    pub session_id: i64,
    pub started_at: i64,
    /// Current (open) area; None between areas.
    pub area_name: Option<String>,
    pub area_kind: Option<String>,
    pub area_id: Option<String>,
    pub area_level: Option<i64>,
    pub seed: Option<i64>,
    pub area_entered_at: Option<i64>,
    /// The player is inside that area right now (its visit has no exit yet).
    pub in_area: bool,
}

struct Inner {
    db: Arc<Database>,
    market: Option<Arc<MarketEngine>>,
    session: SessionContextFn,
    config: Mutex<LootConfig>,
    status: Mutex<CaptureStatus>,
    app: std::sync::OnceLock<AppHandle>,
    wake: (Mutex<bool>, Condvar),
    now: fn() -> i64,
    inventory: inventory::service::InventoryState,
}

#[derive(Clone)]
pub struct LootService {
    inner: Arc<Inner>,
}

fn load_config(db: &Database) -> LootConfig {
    match crate::settings::get_game(db, GAME, CONFIG_KEY) {
        Ok(Some(v)) => serde_json::from_value::<LootConfig>(v).map(LootConfig::sanitized).unwrap_or_else(|e| {
            log::warn!("loot config unreadable, using defaults: {e}");
            LootConfig::default()
        }),
        Ok(None) => LootConfig::default(),
        Err(e) => {
            log::warn!("loot config unavailable, using defaults: {e}");
            LootConfig::default()
        }
    }
}

pub fn session_context_from(sessions: SessionService) -> SessionContextFn {
    Box::new(move || match sessions.status() {
        Ok(s) => s.active_session.map(|a| {
            let area = s.current_area.filter(|v| v.exited_at.is_none());
            SessionContext {
                session_id: a.id,
                started_at: a.started_at,
                area_name: area.as_ref().map(|v| v.area_name.clone().unwrap_or_else(|| v.area_id.clone())),
                area_kind: area.as_ref().map(|v| v.kind.clone()),
                area_id: area.as_ref().map(|v| v.area_id.clone()),
                area_level: area.as_ref().and_then(|v| v.area_level),
                seed: area.as_ref().and_then(|v| v.seed),
                area_entered_at: area.as_ref().map(|v| v.entered_at),
                in_area: area.is_some(),
            }
        }),
        Err(e) => {
            log::warn!("loot capture: session context unavailable: {e}");
            None
        }
    })
}

/// Categories to offer the Market engine, the ones items were actually priced from first.
fn refresh_order(priority: Vec<&'static str>, rest: Vec<&'static str>) -> Vec<&'static str> {
    let mut order = priority;
    for c in rest {
        if !order.contains(&c) {
            order.push(c);
        }
    }
    order
}

/// Loot Tracker hotkey pressed (only registered while PoE 2 is in the foreground). Runs off the main thread.
/// Presses of the same action within 400 ms are ignored (one press = one action).
pub fn on_hotkey(app: &AppHandle, action: hotkeys::Action) {
    static LAST: Mutex<Vec<(hotkeys::Action, std::time::Instant)>> = Mutex::new(Vec::new());
    if let Ok(mut last) = LAST.lock() {
        let now = std::time::Instant::now();
        if last.iter().any(|(a, t)| *a == action && now.duration_since(*t) < Duration::from_millis(400)) {
            return;
        }
        last.retain(|(a, _)| *a != action);
        last.push((action, now));
    }
    let Some(service) = SERVICE.get() else { return };
    let report = |ok: bool, message: String| {
        let _ = app.emit(EVENT_HOTKEY, serde_json::json!({ "action": action, "ok": ok, "message": message }));
    };
    match action {
        hotkeys::Action::ToggleOverlay => {
            let h = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Err(e) = tracker_window::toggle(&h) {
                    log::error!("loot tracker toggle: {e}");
                }
            });
        }
        hotkeys::Action::CollapseOverlay => {
            let h = app.clone();
            let _ = app.run_on_main_thread(move || {
                if tracker_window::state(&h).visible {
                    tracker_window::request_collapse_toggle(&h);
                } else if let Err(e) = tracker_window::open(&h) {
                    log::error!("loot tracker open: {e}");
                }
            });
        }
        hotkeys::Action::StartMap => match service.map_control("start", None, None) {
            Ok(_) => report(true, "Map started".into()),
            Err(e) => report(false, e.to_string()),
        },
        hotkeys::Action::FinishMap => {
            let open = service.inner.db.conn().ok().and_then(|c| maps::open_run(&c, GAME, (service.inner.now)()).ok().flatten());
            match open {
                Some(m) => match service.map_control("finish", Some(m.id), None) {
                    Ok(_) => report(true, "Map finished".into()),
                    Err(e) => report(false, e.to_string()),
                },
                None => report(false, "No map is open.".into()),
            }
        }
        hotkeys::Action::Screenshot => {
            report(true, "Capturing the inventory…".into());
            service.capture_inventory_hotkey();
        }
    }
}

/// Called by the foreground hook (overlay) with the game in the foreground.
pub fn on_foreground(game: Option<GameId>) {
    let poe2 = game == Some(GAME);
    let was = FOREGROUND_POE2.swap(poe2, Ordering::SeqCst);
    clipboard::set_listening(poe2 && CAPTURE_ENABLED.load(Ordering::SeqCst));
    if was != poe2 {
        if let Some(s) = SERVICE.get() {
            s.update_status(|_| {});
        }
    }
}

impl LootService {
    pub fn new(db: Arc<Database>, market: Option<Arc<MarketEngine>>, session: SessionContextFn, now: fn() -> i64) -> Self {
        let config = load_config(&db);
        CAPTURE_ENABLED.store(config.enabled, Ordering::SeqCst);
        Self {
            inner: Arc::new(Inner {
                db,
                market,
                session,
                status: Mutex::new(CaptureStatus { enabled: config.enabled, ..Default::default() }),
                config: Mutex::new(config),
                app: std::sync::OnceLock::new(),
                wake: (Mutex::new(false), Condvar::new()),
                now,
                inventory: Default::default(),
            }),
        }
    }

    pub fn config(&self) -> LootConfig {
        self.inner.config.lock().map(|c| c.clone()).unwrap_or_default()
    }

    pub fn set_config(&self, c: LootConfig) -> AppResult<LootConfig> {
        let c = c.sanitized();
        let before = self.config();
        if c.hotkeys != before.hotkeys {
            let price = hotkeys::price_check_key(&self.inner.db);
            hotkeys::validate(&c.hotkeys, &[("Price check", price)]).map_err(AppError::InvalidInput)?;
        }
        crate::settings::set_game(&self.inner.db, GAME, CONFIG_KEY, &serde_json::to_value(&c)?)?;
        *self.inner.config.lock().map_err(|_| AppError::StatePoisoned)? = c.clone();
        CAPTURE_ENABLED.store(c.enabled, Ordering::SeqCst);
        clipboard::set_listening(c.enabled && FOREGROUND_POE2.load(Ordering::SeqCst));
        self.update_status(|s| s.enabled = c.enabled);
        self.poke();
        if let Some(app) = self.inner.app.get() {
            let _ = app.emit(EVENT_CONFIG, &c);
            let h = app.clone();
            let (keys, top) = (c.hotkeys != before.hotkeys, c.overlay_always_on_top != before.overlay_always_on_top);
            let _ = app.run_on_main_thread(move || {
                if keys {
                    crate::overlay::refresh_hotkeys(&h);
                }
                if top {
                    tracker_window::apply_always_on_top(&h);
                }
            });
        }
        Ok(c)
    }

    pub fn status(&self) -> CaptureStatus {
        let mut s = self.inner.status.lock().map(|s| s.clone()).unwrap_or_default();
        s.game_focused = FOREGROUND_POE2.load(Ordering::SeqCst);
        s.available = clipboard::available();
        s.registered = clipboard::is_listening();
        // Registration is posted to the listener thread; report the intended state.
        s.listening = s.available && s.enabled && s.game_focused;
        s
    }

    fn update_status(&self, f: impl FnOnce(&mut CaptureStatus)) {
        if let Ok(mut s) = self.inner.status.lock() {
            f(&mut s);
        }
        if let Some(app) = self.inner.app.get() {
            let _ = app.emit(EVENT_STATUS, self.status());
        }
    }

    fn emit_updated(&self) {
        if let Some(app) = self.inner.app.get() {
            let _ = app.emit(EVENT_UPDATED, serde_json::json!({ "game": GAME }));
        }
    }

    pub fn poke(&self) {
        if let Ok(mut w) = self.inner.wake.0.lock() {
            *w = true;
            self.inner.wake.1.notify_one();
        }
    }

    /// Starts the clipboard listener, the capture worker and the valuation scheduler.
    pub fn start(&self, app: AppHandle) {
        if self.inner.app.set(app).is_err() {
            return;
        }
        let _ = SERVICE.set(self.clone());
        let (tx, rx) = mpsc::channel::<()>();
        clipboard::start(tx);
        let me = self.clone();
        let _ = std::thread::Builder::new().name("vaalytics-loot-capture".into()).spawn(move || me.capture_worker(rx));
        let me = self.clone();
        let _ = std::thread::Builder::new().name("vaalytics-loot-values".into()).spawn(move || me.valuation_worker());
        // Map records follow Session Intelligence's (debounced) updates — event-driven, no polling.
        if let Some(app) = self.inner.app.get() {
            let me = self.clone();
            app.listen(crate::session::EVENT_UPDATED, move |_| {
                if let Err(e) = me.sync_maps() {
                    log::warn!("loot: map sync failed: {e}");
                }
            });
        }
        // Retention once per start; uniques saved before unique prices existed get valued again.
        let cfg = self.config();
        if let Ok(c) = self.inner.db.conn() {
            if let Err(e) = c.execute(
                "UPDATE loot_items SET value_status = 'pending', value_checks = 0 WHERE game = ?1 AND rarity = 'Unique' AND value_status = 'unsupported'",
                [GAME.as_str()],
            ) {
                log::warn!("loot: could not queue uniques for valuation: {e}");
            }
            if let Err(e) = store::apply_retention(&c, GAME, cfg.retention_days, (self.inner.now)()) {
                log::warn!("loot retention failed: {e}");
            }
            match maps::backfill(&c, GAME, (self.inner.now)()) {
                Ok(n) if n > 0 => log::info!("loot: {n} earlier map instances imported from Session Intelligence"),
                Ok(_) => {}
                Err(e) => log::warn!("loot: map backfill failed: {e}"),
            }
        }
    }

    fn capture_worker(&self, rx: mpsc::Receiver<()>) {
        while rx.recv().is_ok() {
            std::thread::sleep(SETTLE);
            while rx.try_recv().is_ok() {}
            // Re-check the gate at read time: only while PoE 2 is focused and capture is on.
            if !FOREGROUND_POE2.load(Ordering::SeqCst) || !CAPTURE_ENABLED.load(Ordering::SeqCst) {
                continue;
            }
            match clipboard::read_text() {
                Ok(Some(text)) => {
                    if let Err(e) = self.process_text(&text) {
                        self.capture_error(&format!("{e}"));
                    }
                }
                Ok(None) => {}
                Err(e) => self.capture_error(&e),
            }
        }
    }

    fn capture_error(&self, e: &str) {
        log::warn!("loot capture: {e}");
        if let Ok(c) = self.inner.db.conn() {
            let _ = store::log_event(&c, GAME, (self.inner.now)(), "error", None, None, Some(e));
        }
        self.update_status(|s| s.last_error = Some(e.to_string()));
        if self.config().notify_errors {
            if let Some(app) = self.inner.app.get() {
                let _ = app.emit(EVENT_CAPTURED, serde_json::json!({ "error": e }));
            }
        }
    }

    /// The Loot Tracker overlay's data (read-only).
    pub fn tracker_summary(&self, recent: i64) -> AppResult<TrackerSummary> {
        let now = (self.inner.now)();
        let ctx = (self.inner.session)();
        // Read before locking the connection (settings take it too).
        let reset_at = self.session_reset_at();
        let c = self.inner.db.conn()?;
        let open_map = maps::open_run(&c, GAME, now)?;
        let sid = ctx.as_ref().map(|s| s.session_id);
        let last_map = match (&open_map, reset_at, sid) {
            (Some(_), _, _) => None,
            (None, Some(t), _) => maps::latest_since(&c, GAME, t, now)?,
            (None, None, Some(s)) => maps::list(&c, GAME, Some(s), 1, now)?.into_iter().next(),
            _ => None,
        };
        let (maps_finished, session_totals) = match (reset_at, sid) {
            (Some(t), _) => (maps::finished_since(&c, GAME, t)?, maps::totals_since(&c, GAME, t)?),
            (None, Some(s)) => (maps::finished_in_session(&c, GAME, s)?, maps::session_totals(&c, GAME, s)?),
            (None, None) => (0, maps::Totals::default()),
        };
        let snap_for_last: Option<i64> = match &last_map {
            Some(m) => c
                .query_row(
                    "SELECT id FROM loot_inventory_snapshots WHERE game = ?1 AND map_run_id = ?2 AND status != 'cancelled' ORDER BY taken_at DESC LIMIT 1",
                    rusqlite::params![GAME.as_str(), m.id],
                    |r| r.get(0),
                )
                .ok(),
            None => None,
        };
        let recent = store::list(
            &c,
            GAME,
            &store::LibraryQuery {
                session_id: if reset_at.is_some() { None } else { sid },
                from: reset_at,
                sort: Some("newest".into()),
                limit: Some(recent.clamp(1, 200)),
                ..Default::default()
            },
        )?;
        drop(c);
        let last_map_inventory = snap_for_last.and_then(|id| self.snapshot_delta(id, None).ok().map(|d| (id, d.estimated_gain, d.needs_review)));
        // Snapshots of this session: since the reset, else since the game session started, else the last 12 h.
        let since = reset_at.or(ctx.as_ref().map(|s| s.started_at)).unwrap_or(now - 12 * 3600);
        let inventory = self.overlay_inventory(since).unwrap_or_else(|e| {
            log::warn!("loot tracker: inventory summary failed: {e}");
            None
        });
        Ok(TrackerSummary {
            inventory,
            last_map_inventory,
            now,
            session_id: sid,
            session_started_at: reset_at.or(ctx.as_ref().map(|s| s.started_at)),
            reset_at,
            area_name: ctx.as_ref().filter(|s| s.in_area).and_then(|s| s.area_name.clone()),
            area_kind: ctx.as_ref().filter(|s| s.in_area).and_then(|s| s.area_kind.clone()),
            open_map,
            last_map,
            maps_finished,
            session_totals,
            recent,
            capture: self.status(),
        })
    }

    pub fn session_reset_at(&self) -> Option<i64> {
        crate::settings::get_game(&self.inner.db, GAME, RUN_KEY).ok().flatten().and_then(|v| v.as_i64())
    }

    /// "Reset session": overlay counters (time, value, captures, maps) start now; nothing is deleted.
    /// `clear` goes back to following the game session.
    pub fn reset_session(&self, clear: bool) -> AppResult<Option<i64>> {
        let at = if clear {
            crate::settings::set_game(&self.inner.db, GAME, RUN_KEY, &serde_json::Value::Null)?;
            None
        } else {
            let now = (self.inner.now)();
            crate::settings::set_game(&self.inner.db, GAME, RUN_KEY, &serde_json::json!(now))?;
            Some(now)
        };
        self.emit_updated();
        Ok(at)
    }

    /// Tells every view (main window, overlay) that Loot Journal data changed.
    pub fn notify_changed(&self) {
        self.emit_updated();
    }

    /// Manual map control (see maps.rs): "start" | "pause" | "resume" | "finish".
    pub fn map_control(&self, action: &str, id: Option<i64>, name: Option<&str>) -> AppResult<Option<maps::MapRun>> {
        let now = (self.inner.now)();
        let ctx = (self.inner.session)();
        let c = self.inner.db.conn()?;
        let need_id = || id.ok_or_else(|| AppError::InvalidInput("Which map?".into()));
        let target = match action {
            "start" => maps::start_manual(&c, GAME, ctx.as_ref(), name, now)?,
            "pause" => {
                maps::set_paused(&c, GAME, need_id()?, true, now)?;
                need_id()?
            }
            "resume" => {
                maps::set_paused(&c, GAME, need_id()?, false, now)?;
                need_id()?
            }
            "finish" => {
                maps::finish(&c, GAME, need_id()?, now)?;
                need_id()?
            }
            _ => return Err(AppError::InvalidInput("Unknown map action.".into())),
        };
        let run = maps::get(&c, GAME, target, now)?;
        drop(c);
        self.emit_updated();
        Ok(run)
    }

    /// Brings map records in line with Session Intelligence; emits `loot:updated` when they changed.
    pub fn sync_maps(&self) -> AppResult<bool> {
        let ctx = (self.inner.session)();
        let changed = maps::sync(&*self.inner.db.conn()?, GAME, ctx.as_ref(), (self.inner.now)())?;
        if changed {
            self.emit_updated();
        }
        Ok(changed)
    }

    /// Handles clipboard text. Non-item text returns Ok(None) and is dropped.
    pub fn process_text(&self, text: &str) -> AppResult<Option<CaptureOutcome>> {
        let Some(h) = item_text::parse_header(text) else { return Ok(None) };
        let cfg = self.config();
        let now = (self.inner.now)();
        let session = (self.inner.session)();
        let map_run_id = {
            let c = self.inner.db.conn()?;
            maps::sync(&c, GAME, session.as_ref(), now)?;
            maps::map_for_capture(&c, GAME, session.as_ref(), now)?
        };
        let ctx = CaptureContext {
            now,
            session_id: session.as_ref().map(|s| s.session_id),
            area_name: session.as_ref().and_then(|s| s.area_name.clone()),
            area_kind: session.as_ref().and_then(|s| s.area_kind.clone()),
            session_elapsed_secs: session.as_ref().map(|s| (now - s.started_at).max(0)),
            map_run_id,
        };
        let fp = item_text::fingerprint(text);
        let outcome = {
            let mut c = self.inner.db.conn()?;
            let tx = c.transaction()?;
            let o = store::capture(&tx, GAME, text, &h, &fp, &ctx, cfg.duplicate_mode, cfg.cooldown_minutes as i64 * 60, "clipboard")?;
            tx.commit()?;
            o
        };
        let display = h.name.clone().unwrap_or_else(|| h.base_type.clone());
        match outcome {
            CaptureOutcome::New(id) => {
                log::info!("loot: captured item {id} ({})", h.category);
                self.update_status(|s| {
                    s.captured_this_run += 1;
                    s.last_capture_at = Some(now);
                    s.last_item_name = Some(display);
                    s.last_error = None;
                });
                if cfg.auto_value {
                    self.value_items(&[id], true)?;
                } else {
                    self.announce(id)?;
                }
                self.emit_updated();
            }
            CaptureOutcome::Merged(_) => {
                self.update_status(|s| {
                    s.last_capture_at = Some(now);
                    s.last_item_name = Some(display);
                });
                self.emit_updated();
            }
            CaptureOutcome::Debounced(_) => {}
        }
        Ok(Some(outcome))
    }

    /// Emits `loot:captured` for a new item with the notification reason, if any.
    fn announce(&self, id: i64) -> AppResult<()> {
        let Some(app) = self.inner.app.get() else { return Ok(()) };
        let cfg = self.config();
        let Some(it) = store::get(&*self.inner.db.conn()?, GAME, id)? else { return Ok(()) };
        let notify = if cfg.notify_threshold > 0.0 && it.value_total.is_some_and(|v| v >= cfg.notify_threshold) {
            Some("valuable".to_string())
        } else if cfg.notify_unique && it.rarity == "Unique" {
            Some("unique".to_string())
        } else if cfg.notify_captures {
            Some("captured".to_string())
        } else {
            None
        };
        let _ = app.emit(
            EVENT_CAPTURED,
            CapturedEvent {
                item_id: id,
                name: it.item_name.clone().unwrap_or(it.base_type.clone()),
                rarity: it.rarity,
                value_status: it.value_status,
                value_total: it.value_total,
                unit: crate::market::catalog::base_unit(GAME),
                notify,
            },
        );
        Ok(())
    }

    /// Values the given items now from cached market data; asks the Market
    /// engine to refresh expired/unfetched categories (bounded by `max_requests`).
    pub fn value_items(&self, ids: &[i64], announce_new: bool) -> AppResult<usize> {
        let cfg = self.config();
        let db = &self.inner.db;
        let league = valuation::league_for(db, GAME);
        let now = (self.inner.now)();
        let mut changed = 0;
        let mut priority: Vec<&'static str> = Vec::new();
        let mut wanted: Vec<&'static str> = Vec::new();
        for id in ids {
            let Some(t) = store::value_target(&*db.conn()?, GAME, *id)? else { continue };
            let first = t.value_status == "pending";
            let prev_total = store::get(&*db.conn()?, GAME, *id)?.and_then(|i| i.value_total);
            let v = valuation::value(db, GAME, league.as_deref(), &t, &cfg.min_confidence)?;
            let v = valuation::with_last_listed(db, GAME, league.as_deref(), &t, v, now, &cfg.min_confidence)?;
            if v.status == "no_market_data" || v.status == "priced" {
                let all = valuation::market_categories_for(&t);
                // The category the item was actually priced from goes first: with a per-pass budget, the
                // fast-expiring categories at the head of the list must not starve it (found 2026-11-25:
                // delirium data 128 h old while currency/fragments/essences/runes refreshed every pass).
                if let Some(own) = v.market_category.as_deref().and_then(|m| all.iter().find(|c| **c == m)) {
                    if !priority.contains(own) {
                        priority.push(own);
                    }
                }
                for c in all {
                    if !wanted.contains(&c) {
                        wanted.push(c);
                    }
                }
            }
            if store::record_valuation(&*db.conn()?, GAME, *id, &v, now)? {
                changed += 1;
                if !first && cfg.notify_value_changes {
                    if let (Some(a), Some(b), Some(app)) = (prev_total, v.total(), self.inner.app.get()) {
                        if a > 0.0 && ((b - a) / a).abs() >= 0.25 {
                            let _ = app.emit(EVENT_CAPTURED, serde_json::json!({ "valueChange": { "itemId": id, "from": a, "to": b } }));
                        }
                    }
                }
            }
            if first && announce_new {
                self.announce(*id)?;
            }
        }
        if !wanted.is_empty() || !priority.is_empty() {
            self.refresh_market(league.as_deref(), &refresh_order(priority, wanted), cfg.max_requests as usize);
        }
        Ok(changed)
    }

    /// Asks the Market engine to refresh expired categories (it skips fresh ones).
    fn refresh_market(&self, league: Option<&str>, categories: &[&str], max: usize) {
        let (Some(market), Some(league)) = (&self.inner.market, league) else { return };
        let mut sent = 0;
        for cat in categories {
            if sent >= max {
                break;
            }
            match market.refresh_if_expired(GAME, league, cat) {
                Ok(true) => sent += 1,
                Ok(false) => {}
                Err(e) => log::warn!("loot: market refresh {cat}: {e}"),
            }
        }
    }

    /// One scheduler pass: values pending items and revalues due ones.
    pub fn valuation_pass(&self) -> AppResult<usize> {
        let cfg = self.config();
        if !cfg.auto_value {
            return Ok(0);
        }
        let now = (self.inner.now)();
        if let Some(league) = valuation::league_for(&self.inner.db, GAME) {
            let n = store::requeue_other_league(&*self.inner.db.conn()?, GAME, &league)?;
            if n > 0 {
                log::info!("loot: {n} items queued for revaluation in {league}");
            }
        }
        let due = store::due_for_valuation(&*self.inner.db.conn()?, GAME, now, cfg.revalue_minutes as i64 * 60, RETRY_NO_DATA_SECS, MAX_NO_DATA_RETRIES, VALUE_BATCH)?;
        if due.is_empty() {
            return Ok(0);
        }
        let ids: Vec<i64> = due.iter().map(|t| t.id).collect();
        let n = self.value_items(&ids, true)?;
        self.emit_updated();
        Ok(n)
    }

    fn valuation_worker(&self) {
        loop {
            if let Err(e) = self.valuation_pass() {
                log::warn!("loot valuation pass failed: {e}");
            }
            let (lock, cv) = &self.inner.wake;
            let Ok(guard) = lock.lock() else { return };
            let Ok((mut woke, _)) = cv.wait_timeout_while(guard, Duration::from_secs(120), |w| !*w) else { return };
            *woke = false;
        }
    }

    pub fn db(&self) -> &Arc<Database> {
        &self.inner.db
    }
}

fn csv_cell(s: &str) -> String {
    // Neutralise spreadsheet formulas, quote when needed.
    let s = if s.starts_with(['=', '+', '-', '@']) { format!("'{s}") } else { s.to_string() };
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

/// One row per item (no raw text; use the JSON export for full copies).
pub fn export_csv(items: &[store::LootItem]) -> String {
    let mut out = String::from(
        "id,captured_at_utc,last_captured_at_utc,capture_count,name,base_type,rarity,category,item_level,stack_size,value_status,value_total,unit,session_id,capture_area,origin,status,favorite,tags\r\n",
    );
    let unit = crate::market::catalog::base_unit(GAME);
    for i in items {
        let row = [
            i.id.to_string(),
            crate::session::export::iso(i.captured_at),
            crate::session::export::iso(i.last_captured_at),
            i.capture_count.to_string(),
            csv_cell(i.item_name.as_deref().unwrap_or("")),
            csv_cell(&i.base_type),
            csv_cell(&i.rarity),
            csv_cell(&i.category),
            i.item_level.map(|v| v.to_string()).unwrap_or_default(),
            i.stack_size.map(|v| v.to_string()).unwrap_or_default(),
            csv_cell(&i.value_status),
            i.value_total.map(|v| format!("{v:.4}")).unwrap_or_default(),
            unit.to_string(),
            i.session_id.map(|v| v.to_string()).unwrap_or_default(),
            csv_cell(i.capture_area_name.as_deref().unwrap_or("")),
            csv_cell(&i.origin_status),
            csv_cell(&i.status),
            (i.favorite as u8).to_string(),
            csv_cell(&i.tags.join("; ")),
        ];
        out.push_str(&row.join(","));
        out.push_str("\r\n");
    }
    out
}

/// Imports a Loot Journal JSON export in one transaction.
pub fn import_json(db: &Database, game: GameId, text: &str, now: i64) -> AppResult<store::ImportResult> {
    let doc: serde_json::Value = serde_json::from_str(text).map_err(|_| AppError::InvalidInput("Not a Loot Journal export.".into()))?;
    if doc.get("kind").and_then(|v| v.as_str()) != Some("loot-journal") || doc.get("game").and_then(|v| v.as_str()) != Some(game.as_str()) {
        return Err(AppError::InvalidInput("Not a Path of Exile 2 Loot Journal export.".into()));
    }
    let items: Vec<store::ExportedItem> =
        serde_json::from_value(doc.get("items").cloned().unwrap_or_default()).map_err(|_| AppError::InvalidInput("The export's item list is malformed.".into()))?;
    let mut c = db.conn()?;
    let tx = c.transaction()?;
    let r = store::import_items(&tx, game, &items, now)?;
    tx.commit()?;
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::item_text::samples;
    use super::*;

    #[test]
    fn csv_export_and_json_import_guard() {
        let s = service(None);
        s.process_text(samples::RARE).unwrap();
        let items = store::list(&s.db().conn().unwrap(), GAME, &Default::default()).unwrap();
        let csv = export_csv(&items);
        assert!(csv.lines().nth(1).unwrap().contains("Sample Coil,Sapphire Ring,Rare,accessory,79,,unsupported"));
        assert!(import_json(s.db(), GAME, "{\"kind\":\"regex\"}", now()).is_err());
        assert!(import_json(s.db(), GAME, "not json", now()).is_err());
        let doc = serde_json::json!({ "kind": "loot-journal", "game": "poe2", "items": store::export_items(&s.db().conn().unwrap(), GAME, &[]).unwrap() });
        let r = import_json(s.db(), GAME, &doc.to_string(), now()).unwrap();
        assert_eq!(r.skipped_duplicates, 1, "same item and capture time");
    }

    fn now() -> i64 {
        2_000_000
    }

    static CLOCK: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(2_000_000);
    fn clock() -> i64 {
        CLOCK.load(Ordering::SeqCst)
    }

    const ESSENCE: &str = "Item Class: Stackable Currency\nRarity: Currency\nPerfect Essence of Haste\n--------\nStack Size: 2/10\n--------\nUpgrades a Rare item by adding a modifier\n";
    const ESSENCE_ONE: &str = "Item Class: Stackable Currency\nRarity: Currency\nPerfect Essence of Haste\n--------\nStack Size: 1/10\n--------\nUpgrades a Rare item by adding a modifier\n";

    fn list_essences(db: &Database, league: &str, haste: Option<f64>, at: i64) {
        use crate::market::normalize::NormalizedItem;
        let row = |id: &str, name: &str, value: f64| NormalizedItem {
            item_id: id.into(),
            name: name.into(),
            variant: None,
            icon: None,
            value,
            divine_value: None,
            change_7d: None,
            sparkline: vec![],
            volume_value: Some(50.0),
            listings: None,
            base_type: None,
        };
        let mut rows = vec![row("perfect-essence-of-the-mind", "Perfect Essence of the Mind", 9.0)];
        if let Some(v) = haste {
            rows.push(row("perfect-essence-of-haste", "Perfect Essence of Haste", v));
        }
        crate::market::store::replace_items(db, GAME, league, "essences", &rows, at).unwrap();
    }

    #[test]
    fn categories_items_were_priced_from_are_refreshed_first() {
        let order = refresh_order(vec!["delirium", "essences"], vec!["currency", "fragments", "essences", "runes", "delirium", "ritual"]);
        assert_eq!(order, vec!["delirium", "essences", "currency", "fragments", "runes", "ritual"]);
        assert_eq!(&order[..4], &["delirium", "essences", "currency", "fragments"], "within a budget of 4");
    }

    static RESET_CLOCK: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(3_000_000);
    fn reset_clock() -> i64 {
        RESET_CLOCK.load(Ordering::SeqCst)
    }

    #[test]
    fn reset_session_restarts_the_counters_without_deleting_anything() {
        RESET_CLOCK.store(3_000_000, Ordering::SeqCst);
        let db = Arc::new(Database::open_in_memory().unwrap());
        let s = LootService::new(db.clone(), None, Box::new(|| None), reset_clock);
        s.process_text(ESSENCE).unwrap();
        let before = s.tracker_summary(10).unwrap();
        assert_eq!((before.reset_at, before.recent.len(), before.session_totals.items), (None, 1, 0), "no game session, no reset: latest captures, no session totals");
        RESET_CLOCK.fetch_add(60, Ordering::SeqCst);
        assert_eq!(s.reset_session(false).unwrap(), Some(reset_clock()));
        let after = s.tracker_summary(10).unwrap();
        assert_eq!((after.reset_at, after.session_started_at, after.recent.len(), after.session_totals.items), (Some(reset_clock()), Some(reset_clock()), 0, 0));
        RESET_CLOCK.fetch_add(10, Ordering::SeqCst);
        s.process_text(ESSENCE_ONE).unwrap();
        let t = s.tracker_summary(10).unwrap();
        assert_eq!((t.recent.len(), t.session_totals.items, t.session_totals.quantity), (1, 1, 1));
        let all = store::list(&db.conn().unwrap(), GAME, &Default::default()).unwrap();
        assert_eq!(all.len(), 2, "history is kept");
        assert_eq!(s.reset_session(true).unwrap(), None);
        assert_eq!(s.tracker_summary(10).unwrap().reset_at, None);
    }

    /// poe.ninja lists only recently traded items: a thinly traded essence drops out of a
    /// snapshot and comes back. The journal keeps the last listed price (same league, ≤ 7 days,
    /// low confidence, labelled), keeps rechecking, and never prices from another league.
    #[test]
    fn items_missing_from_a_snapshot_keep_the_last_listed_price_and_are_rechecked() {
        CLOCK.store(2_000_000, Ordering::SeqCst);
        let db = Arc::new(Database::open_in_memory().unwrap());
        let s = LootService::new(db.clone(), None, Box::new(|| None), clock);
        let leagues = [
            crate::market::normalize::League { name: "Rise".into(), display_name: "Rise".into(), hardcore: false, indexed: true },
            crate::market::normalize::League { name: "Standard".into(), display_name: "Standard".into(), hardcore: false, indexed: true },
        ];
        crate::market::store::replace_leagues(&db, GAME, &leagues, 1).unwrap();
        list_essences(&db, "Rise", Some(2.0), clock());
        list_essences(&db, "Standard", Some(500.0), clock());
        let Some(CaptureOutcome::New(a)) = s.process_text(ESSENCE).unwrap() else { panic!() };
        let get = |id| store::get(&db.conn().unwrap(), GAME, id).unwrap().unwrap();
        assert_eq!((get(a).value_status.as_str(), get(a).value_total), ("priced", Some(4.0)));
        let listed_at = clock();

        // Next snapshot: Haste isn't listed. After the revalue interval the price is kept, labelled.
        CLOCK.fetch_add(3_700, Ordering::SeqCst);
        list_essences(&db, "Rise", None, clock());
        assert_eq!(s.valuation_pass().unwrap(), 1);
        let it = get(a);
        assert_eq!((it.value_status.as_str(), it.value_total), ("priced", Some(4.0)));
        assert!(it.value_note.as_deref().unwrap().starts_with(valuation::LAST_LISTED_NOTE));
        let hist = store::valuations(&db.conn().unwrap(), a).unwrap();
        let last = hist.last().unwrap();
        assert_eq!((last.confidence.as_deref(), last.data_fetched_at, last.league.as_deref()), (Some("low"), Some(listed_at), Some("Rise")));

        // A new copy of the same essence while it's unlisted uses that price too (never Standard's).
        CLOCK.fetch_add(10, Ordering::SeqCst);
        let Some(CaptureOutcome::New(b)) = s.process_text(ESSENCE_ONE).unwrap() else { panic!() };
        assert_eq!((get(b).value_status.as_str(), get(b).value_total), ("priced", Some(2.0)));

        // Stricter minimum confidence: not used.
        s.set_config(LootConfig { min_confidence: "medium".into(), ..Default::default() }).unwrap();
        s.value_items(&[b], false).unwrap();
        assert_eq!(get(b).value_status, "no_market_data");
        s.set_config(LootConfig::default()).unwrap();

        // More than 7 days later the old price isn't used any more.
        CLOCK.fetch_add(8 * 86_400, Ordering::SeqCst);
        list_essences(&db, "Rise", None, clock());
        s.value_items(&[a], false).unwrap();
        let it = get(a);
        assert_eq!((it.value_status.as_str(), it.value_total), ("no_market_data", None));
        assert!(it.value_note.as_deref().unwrap().contains("more than 7 days"));

        // Listed again: picked up by the scheduler's retry, priced from the new snapshot.
        list_essences(&db, "Rise", Some(3.0), clock());
        CLOCK.fetch_add(RETRY_NO_DATA_SECS + 1, Ordering::SeqCst);
        s.valuation_pass().unwrap();
        let it = get(a);
        assert_eq!((it.value_status.as_str(), it.value_total, it.value_note.clone()), ("priced", Some(6.0), None));
    }

    fn service(session: Option<SessionContext>) -> LootService {
        let db = Arc::new(Database::open_in_memory().unwrap());
        LootService::new(db, None, Box::new(move || session.clone()), now)
    }

    #[test]
    fn captures_items_only_and_links_the_session_without_claiming_a_drop() {
        let s = service(Some(SessionContext { session_id: 7, started_at: now() - 600, area_name: Some("Razed Fields".into()), area_kind: Some("map".into()), ..Default::default() }));
        // The session row must exist for the foreign key.
        {
            let c = s.db().conn().unwrap();
            c.execute("INSERT INTO play_sessions (id, game, started_at, last_activity_at, status, created_at) VALUES (7, 'poe2', ?1, ?1, 'active', 0)", [now() - 600]).unwrap();
        }
        for junk in ["password123", "https://example.com/?token=abc", "", "Item Class: x"] {
            assert_eq!(s.process_text(junk).unwrap(), None);
        }
        let Some(CaptureOutcome::New(id)) = s.process_text(samples::RARE).unwrap() else { panic!() };
        let c = s.db().conn().unwrap();
        let it = store::get(&c, GAME, id).unwrap().unwrap();
        assert_eq!((it.session_id, it.capture_area_name.as_deref(), it.session_elapsed_secs, it.origin_status.as_str()), (Some(7), Some("Razed Fields"), Some(600), "unknown"));
        assert_eq!(it.value_status, "unsupported", "rares are never auto-priced");
        let n: i64 = c.query_row("SELECT COUNT(*) FROM loot_items", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "nothing else was stored");
        let ev: i64 = c.query_row("SELECT COUNT(*) FROM loot_capture_events WHERE detail LIKE '%password%' OR detail LIKE '%token%'", [], |r| r.get(0)).unwrap();
        assert_eq!(ev, 0, "unrelated text never reaches the log");
    }

    #[test]
    fn without_a_session_the_capture_has_no_session_or_area() {
        let s = service(None);
        let Some(CaptureOutcome::New(id)) = s.process_text(samples::CURRENCY).unwrap() else { panic!() };
        let it = store::get(&s.db().conn().unwrap(), GAME, id).unwrap().unwrap();
        assert_eq!((it.session_id, it.capture_area_name, it.stack_size), (None, None, Some(3)));
        assert_eq!(it.value_status, "no_market_data", "no league/market data cached → not priced");
        assert_eq!(s.process_text(samples::CURRENCY).unwrap(), Some(CaptureOutcome::Debounced(id)));
    }

    #[test]
    fn config_round_trips_and_is_sanitised() {
        let s = service(None);
        let c = s.set_config(LootConfig { cooldown_minutes: 0, revalue_minutes: 5, min_confidence: "bogus".into(), notify_threshold: -3.0, ..Default::default() }).unwrap();
        assert_eq!((c.cooldown_minutes, c.revalue_minutes, c.min_confidence.as_str(), c.notify_threshold), (1, 15, "low", 0.0));
        assert_eq!(load_config(s.db()), c, "persisted");
        let off = s.set_config(LootConfig { enabled: false, ..Default::default() }).unwrap();
        assert!(!off.enabled);
        assert!(!s.status().enabled);
        assert!(!CAPTURE_ENABLED.load(Ordering::SeqCst));
    }

    #[test]
    fn scheduler_retries_missing_market_data_and_prices_when_it_arrives() {
        let s = service(None);
        let Some(CaptureOutcome::New(id)) = s.process_text(samples::CURRENCY).unwrap() else { panic!() };
        // Market data for the league arrives later (and items valued without a league are requeued once one exists).
        {
            let db = s.db();
            crate::market::store::replace_leagues(db, GAME, &[crate::market::normalize::League { name: "Rise".into(), display_name: "Rise".into(), hardcore: false, indexed: true }], 1).unwrap();
            let item = crate::market::normalize::NormalizedItem {
                item_id: "exalted".into(),
                name: "Exalted Orb".into(),
                variant: None,
                icon: None,
                value: 1.0,
                divine_value: None,
                change_7d: None,
                sparkline: vec![],
                volume_value: Some(1000.0),
                listings: None,
                base_type: None,
            };
            crate::market::store::replace_items(db, GAME, "Rise", "currency", &[item], 1).unwrap();
        }
        // The item was checked without a league; now that one is known it is requeued at once.
        assert_eq!(s.valuation_pass().unwrap(), 1);
        // Same league again: nothing is due (no repeated checks).
        assert_eq!(s.valuation_pass().unwrap(), 0);
        let c = s.db().conn().unwrap();
        let it = store::get(&c, GAME, id).unwrap().unwrap();
        assert_eq!((it.value_status.as_str(), it.value_total), ("priced", Some(3.0)));
        assert_eq!(store::valuations(&c, id).unwrap().len(), 2, "history kept: no data → priced");
    }
}
