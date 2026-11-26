//! Show / hide the main window over the game with one key (default Insert). Spec: docs/modules/main-window-hotkey.md
//!
//! - Registered by the shared hotkey manager (`overlay::on_foreground`) ONLY while a Path of Exile window or a
//!   Vaalytics window is the foreground window — so Insert keeps working in every other app, and the same key
//!   can hide Vaalytics while Vaalytics itself has focus. Event-driven (foreground hook), no polling.
//! - Show: restore, show and focus `main`, moved onto the game's monitor if it is elsewhere. Not always-on-top:
//!   clicking the game puts the game in front again, and the next press brings Vaalytics back.
//! - Hide: give the foreground back to the game window it was opened from, then minimise `main` (never `hide()`
//!   and never close — closing `main` exits the app, and a hidden window would have no taskbar entry).
//! - Window management of our own window only: no input is sent to the game (we call `SetForegroundWindow`
//!   directly instead of tao's `set_focus`, whose fallback injects an Alt key press).

use crate::settings;
use crate::AppState;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, PhysicalPosition};

/// App setting (not game-scoped: it manages the app window, not game data). "" = off.
pub const KEY_HOTKEY: &str = "mainWindow.hotkey";
pub const DEFAULT_HOTKEY: &str = "Insert";
/// Presses closer together than this are one press (the plugin already uses MOD_NOREPEAT; this also covers
/// a press that arrives while the previous show/hide is still settling).
const DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct MainWindowState {
    last_toggle: Mutex<Option<Instant>>,
    /// The game window Vaalytics was shown over (raw HWND), to give focus back on hide.
    game_window: Mutex<Option<isize>>,
}

/// The configured key, or None when turned off / invalid.
pub fn hotkey(app: &AppHandle) -> Option<String> {
    let db = &app.state::<AppState>().db;
    let s = match settings::get_app(db, KEY_HOTKEY).ok().flatten() {
        None => DEFAULT_HOTKEY.to_owned(),
        Some(v) => v.as_str().unwrap_or("").trim().to_owned(),
    };
    (!s.is_empty() && key_problem(&s).is_none()).then_some(s)
}

/// Same rules as the other in-game keys (no plain typing keys, no Escape / Ctrl+C / Alt+F4).
pub fn key_problem(key: &str) -> Option<String> {
    crate::loot::hotkeys::key_problem(key)
}

/// Keys of the game features (both games) that `key` would collide with, as a user-facing message.
pub fn clash(app: &AppHandle, key: &str) -> Option<String> {
    use crate::game::GameId;
    use tauri_plugin_global_shortcut::Shortcut;
    let id = key.parse::<Shortcut>().ok()?.id();
    let db = &app.state::<AppState>().db;
    let price = |g: GameId| {
        settings::get_game(db, g, "priceCheck.hotkey").ok().flatten().and_then(|v| v.as_str().map(str::to_owned)).unwrap_or_else(|| "Ctrl+D".into())
    };
    let mut taken: Vec<(String, String)> = vec![
        ("the PoE 1 price check".into(), price(GameId::Poe1)),
        ("the PoE 2 price check".into(), price(GameId::Poe2)),
    ];
    taken.extend(crate::act_tracker::hotkey(app).map(|k| ("the Act Tracker".into(), k)));
    taken.extend(crate::decks::hotkey(app).map(|k| ("Deck Intelligence".into(), k)));
    taken.extend(app.state::<AppState>().loot.config().hotkeys.bound().into_iter().map(|(a, k)| (format!("Loot Tracker “{}”", a.label()), k)));
    taken
        .into_iter()
        .find(|(_, k)| k.parse::<Shortcut>().is_ok_and(|s| s.id() == id))
        .map(|(label, _)| format!("{key} is already used for {label}."))
}

fn debounced(last: &mut Option<Instant>, now: Instant) -> bool {
    if last.is_some_and(|t| now.duration_since(t) < DEBOUNCE) {
        return true;
    }
    *last = Some(now);
    false
}

/// What a press does: hide when Vaalytics is in front and on screen, otherwise bring it to the front.
fn should_hide(main_in_front: bool, visible: bool, minimized: bool) -> bool {
    main_in_front && visible && !minimized
}

/// Hotkey handler (main thread).
pub fn toggle(app: &AppHandle) {
    let state = app.state::<MainWindowState>();
    {
        let Ok(mut last) = state.last_toggle.lock() else { return };
        if debounced(&mut last, Instant::now()) {
            return;
        }
    }
    let Some(w) = app.get_webview_window("main") else { return };
    #[cfg(windows)]
    {
        use crate::overlay::win;
        let visible = w.is_visible().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        let main_in_front = w.hwnd().is_ok_and(|h| win::foreground_window() == h.0 as isize);
        if should_hide(main_in_front, visible, minimized) {
            let game = state.game_window.lock().ok().and_then(|g| *g).filter(|&g| win::is_game_window(g));
            if let Some(g) = game {
                // While we are still the foreground process, hand it back to the game, then minimise.
                if !win::set_foreground(g) {
                    log::debug!("main window hotkey: could not give focus back to the game");
                }
            }
            let _ = w.minimize();
            return;
        }
        let game = win::foreground_game_window();
        if game.is_some() {
            if let Ok(mut g) = state.game_window.lock() {
                *g = game;
            }
        }
        let _ = w.unminimize();
        let _ = w.show();
        if let Some(g) = game {
            move_to_game_monitor(&w, g);
        }
        match w.hwnd() {
            Ok(h) => {
                if !win::set_foreground(h.0 as isize) {
                    log::info!("main window hotkey: Windows did not allow bringing Vaalytics to the front");
                }
            }
            Err(e) => log::warn!("main window hotkey: {e}"),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Keeps the main window on the monitor the game is on: if its centre is on another monitor, centre it on the game's.
#[cfg(windows)]
fn move_to_game_monitor(w: &tauri::WebviewWindow, game: isize) {
    let Some((l, t, r, b)) = crate::overlay::win::window_rect(game) else { return };
    let (gx, gy) = ((l + r) / 2, (t + b) / 2);
    let monitors = w.available_monitors().unwrap_or_default();
    let contains = |m: &tauri::Monitor, x: i32, y: i32| {
        let (p, s) = (m.position(), m.size());
        x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32
    };
    let Some(target) = monitors.iter().find(|m| contains(m, gx, gy)) else { return };
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) else { return };
    let (cx, cy) = (pos.x + size.width as i32 / 2, pos.y + size.height as i32 / 2);
    if contains(target, cx, cy) {
        return;
    }
    let maximized = w.is_maximized().unwrap_or(false);
    if maximized {
        let _ = w.unmaximize();
    }
    let (p, s) = (target.position(), target.size());
    let x = p.x + (s.width as i32 - size.width as i32).max(0) / 2;
    let y = p.y + (s.height as i32 - size.height as i32).max(0) / 2;
    let _ = w.set_position(PhysicalPosition::new(x, y));
    if maximized {
        let _ = w.maximize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_press_hides_only_when_vaalytics_is_in_front_and_on_screen() {
        assert!(should_hide(true, true, false));
        // In game (Vaalytics behind the game, minimised or never shown): show.
        assert!(!should_hide(false, true, false));
        assert!(!should_hide(true, true, true));
        assert!(!should_hide(true, false, false));
    }

    #[test]
    fn presses_within_the_debounce_window_count_once() {
        let t = Instant::now();
        let mut last = None;
        assert!(!debounced(&mut last, t));
        assert!(debounced(&mut last, t + Duration::from_millis(100)));
        assert!(!debounced(&mut last, t + DEBOUNCE + Duration::from_millis(1)));
    }

    #[test]
    fn default_key_is_allowed() {
        assert_eq!(key_problem(DEFAULT_HOTKEY), None);
        assert!(key_problem("A").is_some());
    }
}
