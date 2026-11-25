//! Loot Tracker overlay (PoE 2): a small frameless window loading the same bundle at `#loot-tracker`.
//! Spec: docs/modules/loot-journal.md ("Loot Tracker overlay").
//!
//! - One instance, created on first use. Not focusable (`WS_EX_NOACTIVATE`): showing it or clicking it never
//!   takes the keyboard from the game, so the foreground-only hotkeys stay registered.
//! - Always on top when the user wants it (`loot.config` → `overlayAlwaysOnTop`, default on).
//! - Click-through (`set_ignore_cursor_events`) is opt-in and persisted; the main window's Loot Journal page
//!   always offers to turn it off, so it can never lock the overlay.
//! - Local app content only (`capabilities/loot-tracker.json`). It shows only what Vaalytics stored or
//!   calculated; while hidden its page is unmounted (no reads, no timers).

use crate::settings;
use crate::AppState;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "loot-tracker";
pub const EVENT_STATE: &str = "loot-tracker:state";
/// App setting: bounds (written by the window, `useToolWindow`).
pub const KEY_WINDOW: &str = "lootTracker.window";
/// App setting: click-through on/off (owned by Rust).
const KEY_CLICK_THROUGH: &str = "lootTracker.clickThrough";
const DEFAULT_SIZE: (f64, f64) = (320.0, 470.0);
const MIN_SIZE: (f64, f64) = (240.0, 40.0);

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

fn always_on_top(app: &AppHandle) -> bool {
    app.state::<AppState>().loot.config().overlay_always_on_top
}

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
    TrackerWindowState { open: w.is_some(), visible: w.as_ref().is_some_and(is_shown), click_through: click_through_saved(app) }
}

fn emit_state(app: &AppHandle) {
    let _ = app.emit(EVENT_STATE, state(app));
}

fn build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let db = &app.state::<AppState>().db;
    let saved = settings::get_app(db, KEY_WINDOW).ok().flatten();
    let num = |k: &str| saved.as_ref().and_then(|v| v.get(k)).and_then(|v| v.as_i64());
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#loot-tracker".into()))
        .title("Vaalytics — Loot Tracker")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(always_on_top(app))
        .skip_taskbar(true)
        .resizable(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
        .build()?;
    // Ignore implausible bounds (saved while minimised: -32000, 160×28) and positions on a monitor that's gone.
    match (num("x"), num("y"), num("width"), num("height")) {
        (Some(x), Some(y), Some(width), Some(height)) if (200..=4000).contains(&width) && (36..=4000).contains(&height) && x > -20000 && y > -20000 => {
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
            // Default: top-right corner of the primary monitor, below the game's top-right UI.
            if let Ok(Some(m)) = w.primary_monitor() {
                let x = m.position().x + m.size().width as i32 - (DEFAULT_SIZE.0 * m.scale_factor()) as i32 - 16;
                let _ = w.set_position(PhysicalPosition::new(x, m.position().y + (96.0 * m.scale_factor()) as i32));
            }
        }
    }
    Ok(w)
}

/// Runs a window operation without taking focus from the game (see act_tracker.rs for why).
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

/// Opens (creates) or shows the overlay. Main thread only (commands are async; hotkeys hop to the main thread).
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    let w = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => build(app)?,
    };
    let top = always_on_top(app);
    keep_focus(&w, || -> tauri::Result<()> {
        let _ = w.set_ignore_cursor_events(click_through_saved(app));
        w.show()?;
        let _ = w.set_always_on_top(top);
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

/// Applies the always-on-top preference to an open overlay (after the setting changed).
pub fn apply_always_on_top(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let top = always_on_top(app);
        keep_focus(&w, || {
            let _ = w.set_always_on_top(top);
        });
    }
}

/// Tells the overlay page to collapse / expand (hotkey).
pub fn request_collapse_toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.emit("loot-tracker:collapse", ());
    }
}
