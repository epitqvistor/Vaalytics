//! Act Tracker overlay (PoE 1): a small, always-on-top, frameless window loading the same bundle at
//! `#act-tracker`. Spec: docs/modules/act-tracker.md
//!
//! - One instance. It never takes focus from the game: the window is not focusable (`WS_EX_NOACTIVATE`; clicks
//!   still reach it; showing it doesn't activate it), so the game keeps the keyboard and the foreground-only
//!   hotkeys stay registered.
//! - Show / hide: the main window page, the overlay's own button, and a hotkey that is registered ONLY while
//!   Path of Exile 1 is the foreground window (registered by `overlay::on_foreground`, same rule as price check).
//! - Click-through (`set_ignore_cursor_events`) is opt-in and persisted; the main window page always turns it
//!   off again, so it can never lock the overlay.
//! - Local app content only (`capabilities/act-tracker.json`). Hidden = no reading: the page only syncs the log
//!   while it is visible.

use crate::settings;
use crate::AppState;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "act-tracker";
pub const EVENT_STATE: &str = "act-tracker:state";
/// App setting: bounds (written by the window, `useToolWindow`).
const KEY_WINDOW: &str = "actTracker.window";
/// App setting: click-through on/off (owned by Rust).
const KEY_CLICK_THROUGH: &str = "actTracker.clickThrough";
/// PoE 1 setting: show/hide hotkey ("" = off).
pub const KEY_HOTKEY: &str = "actTracker.hotkey";
pub const DEFAULT_HOTKEY: &str = "Ctrl+Shift+T";
const DEFAULT_SIZE: (f64, f64) = (380.0, 420.0);
const MIN_SIZE: (f64, f64) = (260.0, 44.0);

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerWindowState {
    pub open: bool,
    pub visible: bool,
    pub click_through: bool,
}

fn click_through_saved(app: &AppHandle) -> bool {
    let db = &app.state::<AppState>().db;
    settings::get_app(db, KEY_CLICK_THROUGH).ok().flatten().and_then(|v| v.as_bool()).unwrap_or(false)
}

/// The tracker hotkey to register while PoE 1 is in the foreground (validated), or None when turned off.
pub fn hotkey(app: &AppHandle) -> Option<String> {
    let db = &app.state::<AppState>().db;
    let raw = settings::get_game(db, crate::game::GameId::Poe1, KEY_HOTKEY).ok().flatten();
    let s = match raw {
        None => DEFAULT_HOTKEY.to_owned(),
        Some(v) => v.as_str().unwrap_or("").to_owned(),
    };
    valid_hotkey(&s).then_some(s)
}

pub fn valid_hotkey(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.parse::<tauri_plugin_global_shortcut::Shortcut>().is_ok()
}

/// Whether the window is on screen (asked from Windows directly).
fn is_shown(w: &WebviewWindow) -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;
        w.hwnd().map(|h| unsafe { IsWindowVisible(h) }.as_bool()).unwrap_or(false)
    }
    #[cfg(not(windows))]
    w.is_visible().unwrap_or(false)
}

pub fn state(app: &AppHandle) -> TrackerWindowState {
    let w = app.get_webview_window(LABEL);
    TrackerWindowState {
        open: w.is_some(),
        visible: w.as_ref().is_some_and(is_shown),
        click_through: click_through_saved(app),
    }
}

fn emit_state(app: &AppHandle) {
    let _ = app.emit(EVENT_STATE, state(app));
}

fn build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let db = &app.state::<AppState>().db;
    let saved = settings::get_app(db, KEY_WINDOW).ok().flatten();
    let num = |k: &str| saved.as_ref().and_then(|v| v.get(k)).and_then(|v| v.as_i64());
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#act-tracker".into()))
        .title("Vaalytics — Act Tracker")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
        .build()?;
    // Ignore implausible bounds (saved while minimised: -32000, 160×28).
    match (num("x"), num("y"), num("width"), num("height")) {
        (Some(x), Some(y), Some(width), Some(height)) if (260..=4000).contains(&width) && (44..=4000).contains(&height) && x > -20000 && y > -20000 => {
            let on_screen = w.available_monitors().unwrap_or_default().iter().any(|m| {
                let (mx, my) = (m.position().x as i64, m.position().y as i64);
                let (mw, mh) = (m.size().width as i64, m.size().height as i64);
                x + 40 >= mx && x + 40 < mx + mw && y + 10 >= my && y + 10 < my + mh
            });
            let _ = w.set_size(PhysicalSize::new(width as u32, height as u32));
            if on_screen {
                let _ = w.set_position(PhysicalPosition::new(x as i32, y as i32));
            }
        }
        _ => {
            // Default: top-right corner of the primary monitor, clear of the game's minimap edge.
            if let Ok(Some(m)) = w.primary_monitor() {
                let x = m.position().x + m.size().width as i32 - (DEFAULT_SIZE.0 * m.scale_factor()) as i32 - 24;
                let _ = w.set_position(PhysicalPosition::new(x, m.position().y + (320.0 * m.scale_factor()) as i32));
            }
        }
    }
    Ok(w)
}

/// Runs a window operation without taking focus from the game. The window is not focusable (`WS_EX_NOACTIVATE`),
/// but showing it (or a style update, which re-shows it) can still activate it, so the window that had the focus
/// (the game, after the hotkey) gets it back right away. Only Tauri's show/hide are used: a raw `ShowWindow`
/// desynchronised Tauri's window state, and a later style update (click-through) then hid the window.
fn keep_focus<T>(w: &WebviewWindow, op: impl FnOnce() -> T) -> T {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};
        let before = unsafe { GetForegroundWindow() };
        let out = op();
        if let Ok(me) = w.hwnd() {
            unsafe {
                if !before.is_invalid() && before != me && GetForegroundWindow() == me {
                    let _ = SetForegroundWindow(before);
                }
            }
        }
        out
    }
    #[cfg(not(windows))]
    {
        let _ = w;
        op()
    }
}

/// Opens (creates) or shows the tracker. Must run on the main thread (commands are async; the hotkey handler
/// hops to the main thread).
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    let w = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => build(app)?,
    };
    keep_focus(&w, || -> tauri::Result<()> {
        let _ = w.set_ignore_cursor_events(click_through_saved(app));
        w.show()?;
        let _ = w.set_always_on_top(true);
        Ok(())
    })?;
    emit_state(app);
    Ok(())
}

pub fn hide(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        w.hide()?;
    }
    emit_state(app);
    Ok(())
}

/// Hotkey / page button: hidden or not open → show, visible → hide.
pub fn toggle(app: &AppHandle) -> tauri::Result<()> {
    if state(app).visible {
        hide(app)
    } else {
        open(app)
    }
}

/// Destroys the window (no hidden webview left behind).
pub fn close(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        w.destroy()?;
    }
    emit_state(app);
    Ok(())
}

pub fn set_click_through(app: &AppHandle, on: bool) -> crate::error::AppResult<()> {
    let db = &app.state::<AppState>().db;
    settings::set_app(db, KEY_CLICK_THROUGH, &serde_json::Value::Bool(on))?;
    if let Some(w) = app.get_webview_window(LABEL) {
        keep_focus(&w, || {
            let _ = w.set_ignore_cursor_events(on);
        });
    }
    emit_state(app);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn hotkeys_are_validated() {
        assert!(super::valid_hotkey("Ctrl+Shift+T"));
        assert!(super::valid_hotkey("F7"));
        assert!(!super::valid_hotkey(""));
        assert!(!super::valid_hotkey("Ctrl+Nope+"));
    }
}
