//! Location Atlas window (PoE 1): a separate, resizable window loading the same
//! bundle at `#atlas`. One instance only — opening it again focuses it (and moves
//! it to the requested area). Local app content only (`capabilities/atlas.json`);
//! its size, position and always-on-top choice are restored from `atlas.window`.

use crate::settings;
use crate::AppState;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

pub const ATLAS_LABEL: &str = "atlas";
pub const EVENT_SELECT: &str = "atlas:select";
const KEY_WINDOW: &str = "atlas.window";
const DEFAULT_SIZE: (f64, f64) = (1180.0, 760.0);

fn valid_area(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Opens (or focuses) the Atlas. `area` = a campaign area id to show.
pub fn open(app: &AppHandle, area: Option<String>) -> tauri::Result<()> {
    let area = area.filter(|a| valid_area(a));
    if let Some(w) = app.get_webview_window(ATLAS_LABEL) {
        if let Some(a) = &area {
            let _ = w.emit(EVENT_SELECT, a);
        }
        let _ = w.unminimize();
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }
    let db = &app.state::<AppState>().db;
    let saved = settings::get_app(db, KEY_WINDOW).ok().flatten();
    let num = |k: &str| saved.as_ref().and_then(|v| v.get(k)).and_then(|v| v.as_i64());
    let on_top = saved.as_ref().and_then(|v| v.get("alwaysOnTop")).and_then(|v| v.as_bool()).unwrap_or(false);
    let url = match &area {
        Some(a) => format!("index.html#atlas?area={a}"),
        None => "index.html#atlas".into(),
    };
    let w = WebviewWindowBuilder::new(app, ATLAS_LABEL, WebviewUrl::App(url.into()))
        .title("Vaalytics — Location Atlas")
        .decorations(false)
        .shadow(true)
        .resizable(true)
        .always_on_top(on_top)
        .visible(false)
        .min_inner_size(360.0, 320.0)
        .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
        .center()
        .build()?;
    // Ignore implausible bounds (e.g. saved while minimised: -32000, 160×28).
    let bounds = match (num("x"), num("y"), num("width"), num("height")) {
        (Some(x), Some(y), Some(w), Some(h)) if (360..=8000).contains(&w) && (320..=6000).contains(&h) && x > -20000 && y > -20000 => Some((x, y, w, h)),
        _ => None,
    };
    if let Some((x, y, width, height)) = bounds {
        // Only restore a position that is still on a connected monitor.
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
    w.show()?;
    w.set_focus()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_area_ids_are_passed_to_the_window_url() {
        assert!(super::valid_area("1_1_2"));
        assert!(super::valid_area("2_8_7_1_"));
        assert!(!super::valid_area("1_1_2&x=1"));
        assert!(!super::valid_area("../x"));
        assert!(!super::valid_area(""));
    }
}
