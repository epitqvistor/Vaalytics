//! Loot Tracker hotkeys (PoE 2). Registered by `overlay::on_foreground` only while a Path of Exile 2
//! window is in the foreground — the same rule as the price-check key — so they never block those keys
//! in other programs. Each action is optional ("" = off) and independently rebindable.

use crate::game::GameId;
use serde::{Deserialize, Serialize};
use tauri_plugin_global_shortcut::Shortcut;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LootHotkeys {
    pub toggle_overlay: String,
    pub collapse_overlay: String,
    pub start_map: String,
    pub finish_map: String,
    /// One inventory screenshot per press (see docs; empty until the user sets it).
    pub screenshot: String,
}

pub const DEFAULT_TOGGLE: &str = "Ctrl+Shift+L";

impl Default for LootHotkeys {
    fn default() -> Self {
        Self { toggle_overlay: DEFAULT_TOGGLE.into(), collapse_overlay: String::new(), start_map: String::new(), finish_map: String::new(), screenshot: String::new() }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    ToggleOverlay,
    CollapseOverlay,
    StartMap,
    FinishMap,
    Screenshot,
}

impl Action {
    pub fn label(self) -> &'static str {
        match self {
            Action::ToggleOverlay => "Show / hide the Loot Tracker",
            Action::CollapseOverlay => "Collapse / expand the Loot Tracker",
            Action::StartMap => "Start a map",
            Action::FinishMap => "Finish the map",
            Action::Screenshot => "Inventory screenshot",
        }
    }
}

impl LootHotkeys {
    /// (action, key) for every action that has a key.
    pub fn bound(&self) -> Vec<(Action, String)> {
        [
            (Action::ToggleOverlay, &self.toggle_overlay),
            (Action::CollapseOverlay, &self.collapse_overlay),
            (Action::StartMap, &self.start_map),
            (Action::FinishMap, &self.finish_map),
            (Action::Screenshot, &self.screenshot),
        ]
        .into_iter()
        .filter(|(_, k)| !k.trim().is_empty())
        .map(|(a, k)| (a, k.trim().to_string()))
        .collect()
    }
}

/// Keys PoE 2 or Windows need, or that would swallow typing in the game while registered.
fn reserved(s: &Shortcut) -> Option<&'static str> {
    use tauri_plugin_global_shortcut::{Code, Modifiers};
    let mods = s.mods;
    let none = mods.is_empty();
    let shift_only = mods == Modifiers::SHIFT;
    let key = s.key;
    let typing = matches!(
        key,
        Code::KeyA | Code::KeyB | Code::KeyC | Code::KeyD | Code::KeyE | Code::KeyF | Code::KeyG | Code::KeyH | Code::KeyI | Code::KeyJ | Code::KeyK | Code::KeyL
            | Code::KeyM | Code::KeyN | Code::KeyO | Code::KeyP | Code::KeyQ | Code::KeyR | Code::KeyS | Code::KeyT | Code::KeyU | Code::KeyV | Code::KeyW
            | Code::KeyX | Code::KeyY | Code::KeyZ | Code::Digit0 | Code::Digit1 | Code::Digit2 | Code::Digit3 | Code::Digit4 | Code::Digit5 | Code::Digit6
            | Code::Digit7 | Code::Digit8 | Code::Digit9 | Code::Space | Code::Enter | Code::Tab | Code::Backspace | Code::Minus | Code::Equal
            | Code::BracketLeft | Code::BracketRight | Code::Semicolon | Code::Quote | Code::Comma | Code::Period | Code::Slash | Code::Backslash | Code::Backquote
    );
    if typing && (none || shift_only) {
        return Some("a key without Ctrl/Alt would stop working for typing and skills in the game");
    }
    if key == Code::Escape {
        return Some("Escape closes game panels");
    }
    if mods == Modifiers::CONTROL && matches!(key, Code::KeyC | Code::KeyV | Code::KeyX | Code::KeyA | Code::KeyZ) {
        return Some("it's a standard copy / paste key (Ctrl+C is how items are captured)");
    }
    if mods == Modifiers::ALT && matches!(key, Code::F4 | Code::Tab | Code::Enter) {
        return Some("Windows uses it");
    }
    None
}

/// Checks one key on its own: "" (off) is fine; anything else must parse and not be reserved.
pub fn key_problem(key: &str) -> Option<String> {
    let k = key.trim();
    if k.is_empty() {
        return None;
    }
    if k.len() > 64 {
        return Some("That shortcut is too long.".into());
    }
    let Ok(s) = k.parse::<Shortcut>() else { return Some(format!("{k} isn't a shortcut Vaalytics can register.")) };
    reserved(&s).map(|why| format!("{k} can't be used: {why}."))
}

/// Validates every key and checks for clashes between them and with `others` (label, key) —
/// e.g. the PoE 2 price-check key. Returns the first problem as a user-facing message.
pub fn validate(h: &LootHotkeys, others: &[(&str, String)]) -> Result<(), String> {
    let mut seen: Vec<(String, u32)> = others
        .iter()
        .filter_map(|(label, k)| k.trim().parse::<Shortcut>().ok().map(|s| (label.to_string(), s.id())))
        .collect();
    for (action, key) in h.bound() {
        if let Some(p) = key_problem(&key) {
            return Err(p);
        }
        let id = key.parse::<Shortcut>().map(|s| s.id()).unwrap_or_default();
        if let Some((label, _)) = seen.iter().find(|(_, other)| *other == id) {
            return Err(format!("{key} is already used for “{label}”."));
        }
        seen.push((action.label().to_string(), id));
    }
    Ok(())
}

/// The PoE 2 price-check key (setting `priceCheck.hotkey`, default Ctrl+D), for clash checks.
pub fn price_check_key(db: &crate::db::Database) -> String {
    crate::settings::get_game(db, GameId::Poe2, "priceCheck.hotkey")
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_owned))
        .filter(|s| s.parse::<Shortcut>().is_ok())
        .unwrap_or_else(|| "Ctrl+D".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_checked_for_typing_reserved_and_invalid() {
        assert_eq!(key_problem(""), None, "off");
        assert_eq!(key_problem("F8"), None);
        assert_eq!(key_problem("Ctrl+Shift+S"), None);
        assert_eq!(key_problem("Ctrl+Alt+I"), None);
        assert_eq!(key_problem("Shift+F8"), None);
        assert!(key_problem("S").is_some(), "plain letters would swallow typing");
        assert!(key_problem("Shift+1").is_some());
        assert!(key_problem("Space").is_some());
        assert!(key_problem("Escape").is_some());
        assert!(key_problem("Ctrl+C").unwrap().contains("Ctrl+C"));
        assert!(key_problem("Alt+F4").is_some());
        assert!(key_problem("Ctrl+Nope+").is_some());
    }

    #[test]
    fn clashes_between_actions_and_with_other_keys_are_rejected() {
        let ok = LootHotkeys { screenshot: "F8".into(), ..Default::default() };
        assert_eq!(validate(&ok, &[("Price check", "Ctrl+D".into())]), Ok(()));
        let twice = LootHotkeys { start_map: "F9".into(), finish_map: "F9".into(), ..Default::default() };
        assert!(validate(&twice, &[]).unwrap_err().contains("Start a map"));
        let price = LootHotkeys { screenshot: "ctrl+d".into(), ..Default::default() };
        assert!(validate(&price, &[("Price check", "Ctrl+D".into())]).unwrap_err().contains("Price check"));
        let bad = LootHotkeys { collapse_overlay: "Q".into(), ..Default::default() };
        assert!(validate(&bad, &[]).is_err());
        assert_eq!(LootHotkeys::default().bound(), vec![(Action::ToggleOverlay, DEFAULT_TOGGLE.to_string())]);
    }
}
