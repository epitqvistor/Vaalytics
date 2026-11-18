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
    pub last_error: Option<String>,
}

#[derive(Default)]
pub struct OverlayState {
    status: Mutex<OverlayStatus>,
    pending: Mutex<Option<CaptureEvent>>,
    busy: Mutex<bool>,
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
            .with_handler(|app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let app = app.clone();
                    std::thread::spawn(move || capture_and_show(&app));
                }
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
    let current = app.state::<OverlayState>().status().registered_hotkey;
    match game {
        Some(g) => {
            let wanted = hotkey_for(app, g);
            if current.as_deref() == Some(wanted.as_str()) {
                set_status(app, |s| s.foreground_game = Some(g));
                return;
            }
            let _ = gs.unregister_all();
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
            if current.is_some() {
                let _ = gs.unregister_all();
            }
            set_status(app, |s| {
                s.foreground_game = None;
                s.registered_hotkey = None;
            });
        }
    }
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

fn capture_and_show(app: &AppHandle) {
    let state = app.state::<OverlayState>();
    {
        let Ok(mut busy) = state.busy.lock() else { return };
        if *busy {
            return; // ignore repeats while a capture is running
        }
        *busy = true;
    }
    let event = match capture(app) {
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
