//! In-game price check: hotkey → copy item → overlay.
//!
//! - The hotkey is registered ONLY while a Path of Exile window is in the
//!   foreground, so Ctrl+D keeps working normally in every other app.
//! - The clipboard is read only right after the user's hotkey press, polled
//!   briefly for item text, then the previous text is restored (configurable).
//! - The overlay is a separate always-on-top window created on first use.

#[cfg(windows)]
pub(crate) mod win;

use crate::game::GameId;
use crate::settings;
use crate::AppState;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const OVERLAY_LABEL: &str = "overlay";
pub const EVENT_ITEM: &str = "price-check:item";
pub const EVENT_STATUS: &str = "overlay:status";
const DEFAULT_HOTKEY: &str = "Ctrl+D";
const POLL_EVERY: Duration = Duration::from_millis(40);
const POLL_LIMIT: Duration = Duration::from_millis(600);
const KEY_RESTORE_CLIPBOARD: &str = "priceCheck.restoreClipboard";
const KEY_BOUNDS: &str = "overlay.bounds";
const DEFAULT_SIZE: (u32, u32) = (480, 660);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureEvent {
    pub game: GameId,
    /// Item text on success.
    pub text: Option<String>,
    /// User-facing reason on failure.
    pub error: Option<String>,
    /// Opened from Settings to position the overlay (no item).
    #[serde(default)]
    pub preview: bool,
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayStatus {
    pub supported: bool,
    pub foreground_game: Option<GameId>,
    pub registered_hotkey: Option<String>,
    /// Act Tracker show/hide key, registered while PoE 1 is in the foreground.
    pub tracker_hotkey: Option<String>,
    pub last_error: Option<String>,
    /// Loot Tracker keys (PoE 2), registered while PoE 2 is in the foreground.
    pub loot_hotkeys: Vec<LootKeyState>,
    /// Deck Intelligence ground-screenshot key (PoE 1), registered while PoE 1 is in the foreground.
    pub deck_hotkey: DeckKeyState,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckKeyState {
    pub key: Option<String>,
    pub registered: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LootKeyState {
    pub action: crate::loot::hotkeys::Action,
    pub key: String,
    pub registered: bool,
    pub error: Option<String>,
}

fn same_key(a: &str, b: &Shortcut) -> bool {
    a.parse::<Shortcut>().is_ok_and(|s| s.id() == b.id())
}

#[derive(Default)]
pub struct OverlayState {
    status: Mutex<OverlayStatus>,
    pending: Mutex<Option<CaptureEvent>>,
    busy: Mutex<bool>,
    /// Item text the overlay currently shows (for "press again to close").
    shown: Mutex<Option<String>>,
    /// When the overlay was last shown (Quick mode ignores the focus shuffle right after).
    shown_at: Mutex<Option<Instant>>,
}

/// Quick mode closes the overlay when the game comes back to the foreground, but not during the
/// focus shuffle of opening it (the game can flicker back to the front for a moment).
const QUICK_GRACE: Duration = Duration::from_millis(1000);

/// Quick mode: the user went back to the game (not just to another window) after the grace period.
fn quick_close_due(locked: bool, visible: bool, back_in_game: bool, since_shown: Option<Duration>) -> bool {
    !locked && visible && back_in_game && since_shown.is_some_and(|d| d >= QUICK_GRACE)
}

/// Per game, default locked (stays open until closed) — the behaviour before Quick mode existed.
fn overlay_locked(app: &AppHandle, game: GameId) -> bool {
    settings::get_game(&app.state::<AppState>().db, game, "priceCheck.overlayLocked")
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

fn quick_close(app: &AppHandle, game: GameId) {
    let Some(w) = app.get_webview_window(OVERLAY_LABEL) else { return };
    let visible = w.is_visible().unwrap_or(false);
    let since = app.state::<OverlayState>().shown_at.lock().ok().and_then(|t| t.map(|t| t.elapsed()));
    if quick_close_due(overlay_locked(app, game), visible, true, since) {
        let _ = w.hide();
    }
}

impl OverlayState {
    pub fn status(&self) -> OverlayStatus {
        self.status.lock().map(|s| s.clone()).unwrap_or_default()
    }
    pub fn take_pending(&self) -> Option<CaptureEvent> {
        self.pending.lock().ok().and_then(|mut p| p.take())
    }
}

fn hotkey_for(app: &AppHandle, game: GameId) -> String {
    let db = &app.state::<AppState>().db;
    settings::get_game(db, game, "priceCheck.hotkey")
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_owned))
        .filter(|s| s.parse::<Shortcut>().is_ok())
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_owned())
}

/// Plugin + foreground tracking. Call once from setup.
pub fn init(app: &tauri::App) -> tauri::Result<()> {
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                // Loot Tracker keys (PoE 2).
                let loot = app.state::<OverlayState>().status().loot_hotkeys;
                if let Some(k) = loot.iter().find(|k| k.registered && same_key(&k.key, shortcut)) {
                    let (h, action) = (app.clone(), k.action);
                    std::thread::spawn(move || crate::loot::on_hotkey(&h, action));
                    return;
                }
                // Deck Intelligence ground screenshot (PoE 1).
                let deck = app.state::<OverlayState>().status().deck_hotkey;
                if deck.registered && deck.key.as_deref().is_some_and(|k| same_key(k, shortcut)) {
                    let h = app.clone();
                    std::thread::spawn(move || {
                        let decks = std::sync::Arc::clone(&h.state::<AppState>().decks);
                        decks.on_hotkey(&h);
                    });
                    return;
                }
                // The Act Tracker's show/hide key (PoE 1 only, registered next to the price-check key).
                let tracker = app.state::<OverlayState>().status().tracker_hotkey;
                if tracker.and_then(|t| t.parse::<Shortcut>().ok()).is_some_and(|t| t.id() == shortcut.id()) {
                    let h = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Err(e) = crate::act_tracker::toggle(&h) {
                            log::error!("act tracker toggle: {e}");
                        }
                    });
                    return;
                }
                let app = app.clone();
                std::thread::spawn(move || capture_and_show(&app));
            })
            .build(),
    )?;

    #[cfg(windows)]
    {
        let handle = app.handle().clone();
        win::watch_foreground(move |game| {
            crate::loot::on_foreground(game);
            let h = handle.clone();
            let _ = handle.run_on_main_thread(move || on_foreground(&h, game));
        });
        set_status(app.handle(), |s| s.supported = true);
    }
    #[cfg(not(windows))]
    set_status(app.handle(), |s| s.last_error = Some("The in-game overlay is only supported on Windows.".into()));
    Ok(())
}

fn set_status(app: &AppHandle, f: impl FnOnce(&mut OverlayStatus)) {
    let state = app.state::<OverlayState>();
    let snapshot = {
        let Ok(mut s) = state.status.lock() else { return };
        f(&mut s);
        s.clone()
    };
    let _ = app.emit(EVENT_STATUS, snapshot);
}

fn on_foreground(app: &AppHandle, game: Option<GameId>) {
    let gs = app.global_shortcut();
    let status = app.state::<OverlayState>().status();
    let current = status.registered_hotkey;
    if let Some(g) = game {
        quick_close(app, g);
    }
    match game {
        Some(g) => {
            let wanted = hotkey_for(app, g);
            let tracker = (g == GameId::Poe1)
                .then(|| crate::act_tracker::hotkey(app))
                .flatten()
                .filter(|t| t.parse::<Shortcut>().ok().map(|t| t.id()) != wanted.parse::<Shortcut>().ok().map(|w| w.id()));
            let loot_wanted = loot_keys_for(app, g, &wanted);
            let deck_wanted = (g == crate::decks::GAME)
                .then(|| crate::decks::hotkey(app))
                .flatten()
                .filter(|k| !same_key_str(k, &wanted) && !tracker.as_deref().is_some_and(|t| same_key_str(k, t)));
            let loot_current: Vec<(crate::loot::hotkeys::Action, String)> = status.loot_hotkeys.iter().map(|k| (k.action, k.key.clone())).collect();
            if current.as_deref() == Some(wanted.as_str()) && status.tracker_hotkey == tracker && loot_current == loot_wanted && status.deck_hotkey.key == deck_wanted {
                set_status(app, |s| s.foreground_game = Some(g));
                return;
            }
            let _ = gs.unregister_all();
            register_tracker_hotkey(app, tracker);
            register_loot_hotkeys(app, loot_wanted);
            register_deck_hotkey(app, deck_wanted);
            match gs.register(wanted.as_str()) {
                Ok(()) => set_status(app, |s| {
                    s.foreground_game = Some(g);
                    s.registered_hotkey = Some(wanted.clone());
                    s.last_error = None;
                }),
                Err(e) => {
                    log::warn!("could not register {wanted}: {e}");
                    set_status(app, |s| {
                        s.foreground_game = Some(g);
                        s.registered_hotkey = None;
                        s.last_error = Some(format!("{wanted} is already used by another application."));
                    });
                }
            }
        }
        None => {
            if current.is_some() || status.tracker_hotkey.is_some() || !status.loot_hotkeys.is_empty() || status.deck_hotkey.registered {
                let _ = gs.unregister_all();
            }
            set_status(app, |s| {
                s.foreground_game = None;
                s.registered_hotkey = None;
                s.tracker_hotkey = None;
                s.loot_hotkeys.clear();
                s.deck_hotkey.registered = false;
                s.deck_hotkey.error = None;
            });
        }
    }
}

/// Loot Tracker keys to register for `game` (PoE 2 only), minus any that clash with the price-check key.
fn loot_keys_for(app: &AppHandle, game: GameId, price_key: &str) -> Vec<(crate::loot::hotkeys::Action, String)> {
    if game != crate::loot::GAME {
        return Vec::new();
    }
    let cfg = app.state::<AppState>().loot.config();
    let price = price_key.parse::<Shortcut>().ok();
    cfg.hotkeys
        .bound()
        .into_iter()
        .filter(|(_, k)| crate::loot::hotkeys::key_problem(k).is_none() && !price.as_ref().is_some_and(|p| same_key(k, p)))
        .collect()
}

/// Registers the Loot Tracker keys (after `unregister_all`); each failure is reported, never blocks the others.
fn register_loot_hotkeys(app: &AppHandle, keys: Vec<(crate::loot::hotkeys::Action, String)>) {
    let states: Vec<LootKeyState> = keys
        .into_iter()
        .map(|(action, key)| match app.global_shortcut().register(key.as_str()) {
            Ok(()) => LootKeyState { action, key, registered: true, error: None },
            Err(e) => {
                log::warn!("loot tracker: could not register {key}: {e}");
                LootKeyState { action, error: Some(format!("{key} is already used by another application.")), key, registered: false }
            }
        })
        .collect();
    set_status(app, |s| s.loot_hotkeys = states);
}

fn same_key_str(a: &str, b: &str) -> bool {
    b.parse::<Shortcut>().is_ok_and(|b| same_key(a, &b))
}

/// Registers the Deck Intelligence key (after `unregister_all`); a failure is shown in its settings.
fn register_deck_hotkey(app: &AppHandle, key: Option<String>) {
    let state = match key {
        None => DeckKeyState::default(),
        Some(k) => match app.global_shortcut().register(k.as_str()) {
            Ok(()) => DeckKeyState { key: Some(k), registered: true, error: None },
            Err(e) => {
                log::warn!("deck intelligence: could not register {k}: {e}");
                DeckKeyState { error: Some(format!("{k} is already used by another application.")), key: Some(k), registered: false }
            }
        },
    };
    set_status(app, |s| s.deck_hotkey = state);
}

/// Registers the keys again after the user changed one (only does anything while a game is in the foreground).
pub fn refresh_hotkeys(app: &AppHandle) {
    let status = app.state::<OverlayState>().status();
    set_status(app, |s| s.registered_hotkey = None);
    on_foreground(app, status.foreground_game);
}

/// Registers the Act Tracker key (after `unregister_all`); a failure is logged, never blocks price check.
fn register_tracker_hotkey(app: &AppHandle, key: Option<String>) {
    let registered = key.filter(|k| match app.global_shortcut().register(k.as_str()) {
        Ok(()) => true,
        Err(e) => {
            log::warn!("act tracker: could not register {k}: {e}");
            false
        }
    });
    set_status(app, |s| s.tracker_hotkey = registered);
}

fn is_item_text(s: &str) -> bool {
    s.trim_start_matches('\u{feff}').starts_with("Item Class: ")
}

/// Copies the hovered item via the game's own shortcut and reads the result.
#[cfg(windows)]
fn capture(app: &AppHandle) -> Result<(GameId, String), (Option<GameId>, String)> {
    let game = win::foreground_game().ok_or((None, "Path of Exile is not the active window.".to_string()))?;
    let restore = settings::get_app(&app.state::<AppState>().db, KEY_RESTORE_CLIPBOARD)
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let mut cb = arboard::Clipboard::new().map_err(|e| (Some(game), format!("Clipboard unavailable: {e}")))?;
    let mut previous = cb.get_text().ok();
    if previous.as_deref().is_some_and(is_item_text) {
        // Never mistake an older copied item for the current one.
        let _ = cb.clear();
        previous = None;
    }
    if !win::send_copy() {
        return Err((Some(game), "Windows blocked the simulated key press. If Path of Exile runs as administrator, run Vaalytics as administrator too.".into()));
    }
    let started = Instant::now();
    let text = loop {
        std::thread::sleep(POLL_EVERY);
        if let Ok(t) = cb.get_text() {
            if is_item_text(&t) {
                break Some(t);
            }
        }
        if started.elapsed() > POLL_LIMIT {
            break None;
        }
    };
    if restore {
        if let Some(prev) = previous {
            let _ = cb.set_text(prev);
        }
    }
    text.map(|t| (game, t)).ok_or((
        Some(game),
        "No item text was copied. Hover over an item and try again. Exclusive Fullscreen and an elevated (administrator) game can prevent this."
            .into(),
    ))
}

#[cfg(not(windows))]
fn capture(_app: &AppHandle) -> Result<(GameId, String), (Option<GameId>, String)> {
    Err((None, "The in-game price check is only supported on Windows.".into()))
}

/// A hotkey press while the overlay is open closes it when it targets the item already shown,
/// or no item at all; a different item is price-checked instead.
fn closes_overlay(visible: bool, shown: Option<&str>, captured: Result<&str, ()>) -> bool {
    visible && captured.map_or(true, |text| shown == Some(text))
}

fn capture_and_show(app: &AppHandle) {
    let state = app.state::<OverlayState>();
    {
        let Ok(mut busy) = state.busy.lock() else { return };
        if *busy {
            return; // ignore repeats while a capture is running
        }
        *busy = true;
    }
    let captured = capture(app);
    let visible = app.get_webview_window(OVERLAY_LABEL).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    let not_in_game = matches!(&captured, Err((None, _)));
    let shown = state.shown.lock().ok().and_then(|s| s.clone());
    if !not_in_game && closes_overlay(visible, shown.as_deref(), captured.as_ref().map(|(_, t)| t.as_str()).map_err(|_| ())) {
        if let Ok(mut busy) = state.busy.lock() {
            *busy = false;
        }
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(w) = app2.get_webview_window(OVERLAY_LABEL) {
                let _ = w.hide();
            }
        });
        return;
    }
    let event = match captured {
        Ok((game, text)) => CaptureEvent { game, text: Some(text), error: None, preview: false },
        Err((game, error)) => {
            log::info!("price check capture failed: {error}");
            CaptureEvent { game: game.unwrap_or(GameId::Poe1), text: None, error: Some(error), preview: false }
        }
    };
    if let Ok(mut busy) = state.busy.lock() {
        *busy = false;
    }
    if event.text.is_none() && event.error.as_deref() == Some("Path of Exile is not the active window.") {
        return;
    }
    if let Ok(mut p) = state.pending.lock() {
        *p = Some(event.clone());
    }
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(e) = show_overlay(&app2, &event) {
            log::error!("overlay failed: {e}");
        }
    });
}

fn overlay_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("index.html#overlay".into()))
        .title("Vaalytics Price Check")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
        .min_inner_size(380.0, 320.0)
        .inner_size(DEFAULT_SIZE.0 as f64, DEFAULT_SIZE.1 as f64)
        .build()
}

fn show_overlay(app: &AppHandle, event: &CaptureEvent) -> tauri::Result<()> {
    let created = app.get_webview_window(OVERLAY_LABEL).is_none();
    let w = overlay_window(app)?;
    let db = &app.state::<AppState>().db;
    let saved = settings::get_app(db, KEY_BOUNDS).ok().flatten();
    let num = |k: &str| saved.as_ref().and_then(|v| v.get(k)).and_then(|v| v.as_i64());

    if let (Some(x), Some(y), Some(width), Some(height)) = (num("x"), num("y"), num("width"), num("height")) {
        let _ = w.set_size(PhysicalSize::new(width.clamp(380, 2000) as u32, height.clamp(320, 2000) as u32));
        let _ = w.set_position(PhysicalPosition::new(x as i32, y as i32));
    } else {
        #[cfg(windows)]
        if let Some((cx, cy)) = win::cursor_position() {
            let monitor = w.current_monitor().ok().flatten();
            let (mx, my, mw, mh) = monitor
                .map(|m| (m.position().x, m.position().y, m.size().width as i32, m.size().height as i32))
                .unwrap_or((0, 0, 1920, 1080));
            let x = (cx + 24).min(mx + mw - DEFAULT_SIZE.0 as i32).max(mx);
            let y = (cy - 120).min(my + mh - DEFAULT_SIZE.1 as i32).max(my);
            let _ = w.set_position(PhysicalPosition::new(x, y));
        }
    }
    // Always interactive when (re)opened via the hotkey; click-through is opt-in per session.
    let _ = w.set_ignore_cursor_events(false);
    if let Ok(mut shown) = app.state::<OverlayState>().shown.lock() {
        *shown = event.text.clone();
    }
    if let Ok(mut at) = app.state::<OverlayState>().shown_at.lock() {
        *at = Some(Instant::now());
    }
    if !created {
        let _ = w.emit(EVENT_ITEM, event);
    }
    w.show()?;
    w.set_always_on_top(true)?;
    w.set_focus()?;
    Ok(())
}

/// Shows the overlay outside the game (positioning preview, or a given item text).
pub fn preview(app: &AppHandle, game: GameId, text: Option<String>) -> tauri::Result<()> {
    let event = match text {
        Some(t) => CaptureEvent { game, text: Some(t), error: None, preview: false },
        None => CaptureEvent {
            game,
            text: None,
            error: Some("Drag the header to move the overlay and resize it from its edges — Vaalytics remembers where you leave it. In game, hover an item and press your price-check shortcut.".into()),
            preview: true,
        },
    };
    if let Ok(mut p) = app.state::<OverlayState>().pending.lock() {
        *p = Some(event.clone());
    }
    show_overlay(app, &event)
}

#[cfg(test)]
mod tests {
    use super::closes_overlay;

    #[test]
    fn quick_mode_closes_only_when_back_in_game_after_the_grace_period() {
        use super::{quick_close_due, QUICK_GRACE};
        use std::time::Duration;
        let later = Some(QUICK_GRACE + Duration::from_millis(1));
        assert!(quick_close_due(false, true, true, later));
        // Locked, hidden, another window, or the opening focus shuffle: stays.
        assert!(!quick_close_due(true, true, true, later));
        assert!(!quick_close_due(false, false, true, later));
        assert!(!quick_close_due(false, true, false, later));
        assert!(!quick_close_due(false, true, true, Some(Duration::from_millis(300))));
        assert!(!quick_close_due(false, true, true, None));
    }

    #[test]
    fn second_press_on_the_same_item_or_nothing_closes() {
        assert!(closes_overlay(true, Some("Item Class: A"), Ok("Item Class: A")));
        assert!(closes_overlay(true, Some("Item Class: A"), Err(())));
        assert!(closes_overlay(true, None, Err(())));
    }

    #[test]
    fn a_different_item_or_a_hidden_overlay_shows_the_check() {
        assert!(!closes_overlay(true, Some("Item Class: A"), Ok("Item Class: B")));
        assert!(!closes_overlay(false, Some("Item Class: A"), Ok("Item Class: A")));
        assert!(!closes_overlay(false, None, Err(())));
    }
}
