//! Built-in browser: each tab is a WebView2 child webview embedded in the main
//! window, positioned over the Browser section's content area.
//!
//! Isolation:
//! - Tabs load remote content only (http/https). They are created with labels
//!   `browser-*`; no capability grants them anything, and remote origins have
//!   no IPC access (verified in docs/modules/browser.md).
//! - Cookies/sessions live in the app's WebView2 profile so a pathofexile.com
//!   login persists, but they are never readable by the Vaalytics UI (different
//!   origin) and Vaalytics never sees passwords.
//! - Popups (target=_blank, window.open) open in a new tab instead of a new window.

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl};

pub const EVENT: &str = "browser:event";
const PREFIX: &str = "browser-";

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BrowserEvent {
    #[serde(rename_all = "camelCase")]
    Navigated { tab: String, url: String },
    #[serde(rename_all = "camelCase")]
    Loading { tab: String, loading: bool, url: String },
    #[serde(rename_all = "camelCase")]
    Title { tab: String, title: String },
    /// A page asked for a new window; the UI opens it as a new tab.
    #[serde(rename_all = "camelCase")]
    NewTab { url: String },
}

fn label(tab: &str) -> Result<String, String> {
    if tab.is_empty() || tab.len() > 32 || !tab.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid tab id".into());
    }
    Ok(format!("{PREFIX}{tab}"))
}

/// Only web pages; never file:, javascript:, data:, custom protocols, etc.
pub fn parse_web_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "Invalid address.".to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        other => Err(format!("“{other}:” addresses can't be opened in the built-in browser.")),
    }
}

fn emit(app: &AppHandle, e: BrowserEvent) {
    let _ = app.emit_to("main", EVENT, e);
}

/// Opens (or reuses) a tab's webview at `bounds` and navigates it to `url`.
pub fn open(app: &AppHandle, tab: &str, url: &str, bounds: Bounds) -> Result<(), String> {
    let label = label(tab)?;
    let url = parse_web_url(url)?;
    if let Some(wv) = app.get_webview(&label) {
        wv.navigate(url).map_err(|e| e.to_string())?;
        place(&wv, bounds)?;
        wv.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let window = app.get_window("main").ok_or("main window missing")?;
    let tab_nav = tab.to_owned();
    let tab_load = tab.to_owned();
    let tab_title = tab.to_owned();
    let (app_nav, app_load, app_title, app_new) = (app.clone(), app.clone(), app.clone(), app.clone());

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .on_navigation(move |u| {
            let allowed = matches!(u.scheme(), "http" | "https" | "about");
            if allowed && u.scheme() != "about" {
                emit(&app_nav, BrowserEvent::Navigated { tab: tab_nav.clone(), url: u.to_string() });
            }
            allowed
        })
        .on_page_load(move |_wv, payload| {
            emit(
                &app_load,
                BrowserEvent::Loading { tab: tab_load.clone(), loading: matches!(payload.event(), PageLoadEvent::Started), url: payload.url().to_string() },
            );
        })
        .on_document_title_changed(move |_wv, title| emit(&app_title, BrowserEvent::Title { tab: tab_title.clone(), title }))
        .on_new_window(move |u, _features| {
            if matches!(u.scheme(), "http" | "https") {
                emit(&app_new, BrowserEvent::NewTab { url: u.to_string() });
            }
            NewWindowResponse::Deny
        });

    let wv = window
        .add_child(builder, LogicalPosition::new(bounds.x, bounds.y), LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)))
        .map_err(|e| e.to_string())?;
    let _ = wv.set_focus();
    Ok(())
}

fn place(wv: &tauri::Webview, b: Bounds) -> Result<(), String> {
    wv.set_position(LogicalPosition::new(b.x, b.y)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(b.width.max(1.0), b.height.max(1.0))).map_err(|e| e.to_string())
}

pub fn set_bounds(app: &AppHandle, tab: &str, bounds: Bounds) -> Result<(), String> {
    match app.get_webview(&label(tab)?) {
        Some(wv) => place(&wv, bounds),
        None => Ok(()),
    }
}

/// Shows exactly one tab (or none) — all other browser webviews are hidden.
pub fn show_only(app: &AppHandle, tab: Option<&str>) -> Result<(), String> {
    let keep = tab.map(label).transpose()?;
    for (l, wv) in app.webviews() {
        if !l.starts_with(PREFIX) {
            continue;
        }
        if Some(&l) == keep.as_ref() {
            wv.show().map_err(|e| e.to_string())?;
        } else {
            wv.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub enum Action {
    Back,
    Forward,
    Reload,
}

pub fn act(app: &AppHandle, tab: &str, action: Action) -> Result<(), String> {
    let Some(wv) = app.get_webview(&label(tab)?) else { return Ok(()) };
    match action {
        Action::Back => wv.eval("history.back()"),
        Action::Forward => wv.eval("history.forward()"),
        Action::Reload => wv.reload(),
    }
    .map_err(|e| e.to_string())
}

pub fn close(app: &AppHandle, tab: &str) -> Result<(), String> {
    if let Some(wv) = app.get_webview(&label(tab)?) {
        wv.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn current_url(app: &AppHandle, tab: &str) -> Option<String> {
    app.get_webview(&label(tab).ok()?)?.url().ok().map(|u| u.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_urls_are_allowed() {
        assert!(parse_web_url("https://www.pathofexile.com/trade").is_ok());
        assert!(parse_web_url("http://example.com").is_ok());
        for bad in ["file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,x", "tauri://localhost", "not a url"] {
            assert!(parse_web_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn validates_tab_ids() {
        assert_eq!(label("t1").unwrap(), "browser-t1");
        assert!(label("").is_err());
        assert!(label("../main").is_err());
        assert!(label(&"a".repeat(40)).is_err());
    }
}
