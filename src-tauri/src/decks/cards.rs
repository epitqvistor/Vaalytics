//! Divination Card database (PoE 1): name, stack size and reward from the community RePoE export
//! (https://repoe-fork.github.io/base_items.min.json, extracted from the game files — the same source
//! Crafting uses). Downloaded, validated and versioned by the Update Center (`updates::providers::RepoeCards`),
//! so a new league's cards arrive without an app update.
//!
//! Prices are not here: they come from the Market Data `divination` category (poe.ninja).
//! Per-card artwork has no verified source yet; the UI shows the official card icon.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub name: String,
    pub stack_size: Option<u32>,
    /// Reward text without game markup, e.g. "3x Chaos Orb"; lines joined with " · ".
    pub reward: String,
    /// First markup tag of the reward ("uniqueitem", "currencyitem", …) or "" when none.
    pub reward_kind: String,
    pub drop_level: Option<u32>,
    /// `legacy` cards can't drop any more.
    pub legacy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDb {
    pub format: u32,
    pub cards: Vec<Card>,
    /// Unix seconds of the last check against the source.
    pub checked_at: i64,
    pub source_modified: Option<String>,
    #[serde(default)]
    pub etag: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardDbResponse {
    pub cards: Vec<Card>,
    pub checked_at: i64,
    pub source: &'static str,
    pub source_modified: Option<String>,
    /// Set when the refresh failed and the cached copy is returned.
    pub stale_error: Option<String>,
}

/// `<currencyitem>{3x Chaos Orb}` → ("3x Chaos Orb", "currencyitem"). Multi-line rewards are joined.
pub fn clean_reward(raw: &str) -> (String, String) {
    let mut out = String::new();
    let mut kind = String::new();
    let mut rest = raw;
    loop {
        match (rest.find('<'), rest.find('{')) {
            (Some(lt), _) if rest[lt..].find('>').is_some() && rest[lt..].find('{').is_some() => {
                out.push_str(&rest[..lt]);
                let gt = lt + rest[lt..].find('>').unwrap();
                let tag = rest[lt + 1..gt].trim();
                if kind.is_empty() && !tag.starts_with("size:") {
                    kind = tag.to_string();
                }
                rest = &rest[gt + 1..];
                if let Some(r) = rest.strip_prefix('{') {
                    rest = r;
                }
            }
            _ => {
                out.push_str(rest);
                break;
            }
        }
    }
    let text = out.replace('}', "").replace("\r\n", "\n");
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    (lines.join(" · "), kind)
}

/// Divination cards from a RePoE `base_items` export.
pub fn build(base_items: &Value) -> AppResult<Vec<Card>> {
    let obj = base_items.as_object().ok_or_else(|| AppError::InvalidInput("unexpected base_items format".into()))?;
    let mut cards: Vec<Card> = obj
        .values()
        .filter(|v| v.get("item_class").and_then(Value::as_str) == Some("DivinationCard"))
        .filter_map(|v| {
            let state = v.get("release_state").and_then(Value::as_str).unwrap_or("");
            if state == "unreleased" {
                return None;
            }
            let name = v.get("name")?.as_str()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let props = v.get("properties");
            let (reward, reward_kind) = clean_reward(props.and_then(|p| p.get("description")).and_then(Value::as_str).unwrap_or(""));
            Some(Card {
                name,
                stack_size: props.and_then(|p| p.get("stack_size")).and_then(Value::as_u64).map(|n| n as u32),
                reward,
                reward_kind,
                drop_level: v.get("drop_level").and_then(Value::as_u64).map(|n| n as u32),
                legacy: state == "legacy",
            })
        })
        .collect();
    cards.sort_by(|a, b| a.name.cmp(&b.name));
    cards.dedup_by(|a, b| a.name == b.name);
    if cards.len() < 100 {
        return Err(AppError::InvalidInput(format!("the card list looks incomplete ({} cards)", cards.len())));
    }
    Ok(cards)
}

/// Deck Intelligence's former on-disk card cache (`decks/cards.json`). The card list is now an
/// Update Center dataset (`poe1.divination-cards`); this only reads the old cache so it can be
/// imported on first use when the source is unreachable, and as a last-resort matcher fallback.
pub struct CardService {
    dir: PathBuf,
}

impl CardService {
    pub fn new(data_dir: PathBuf) -> Self {
        Self { dir: data_dir.join("decks") }
    }

    fn path(&self) -> PathBuf {
        self.dir.join("cards.json")
    }

    /// The legacy cached card list, if any (no network).
    pub fn cached(&self) -> Option<CardDb> {
        let bytes = std::fs::read(self.path()).ok()?;
        let d: CardDb = serde_json::from_slice(&bytes).ok()?;
        (d.format == FORMAT_VERSION).then_some(d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cleans_reward_markup() {
        assert_eq!(clean_reward("<currencyitem>{3x Chaos Orb}"), ("3x Chaos Orb".into(), "currencyitem".into()));
        assert_eq!(clean_reward("<uniqueitem>{Headhunter}"), ("Headhunter".into(), "uniqueitem".into()));
        assert_eq!(clean_reward("<size:26>{<uniqueitem>{Mageblood}}\r\n<corrupted>{Corrupted}"), ("Mageblood · Corrupted".into(), "uniqueitem".into()));
        assert_eq!(clean_reward(""), (String::new(), String::new()));
    }

    #[test]
    fn builds_cards_from_base_items() {
        let mut m = serde_json::Map::new();
        for i in 0..120 {
            m.insert(
                format!("Metadata/Items/DivinationCards/C{i}"),
                json!({"item_class":"DivinationCard","name":format!("Card {i:03}"),"release_state":"released","drop_level":i,
                       "properties":{"stack_size":7,"description":"<currencyitem>{3x Chaos Orb}"}}),
            );
        }
        m.insert("Old".into(), json!({"item_class":"DivinationCard","name":"Birth of the Three","release_state":"legacy","properties":{"stack_size":3,"description":""}}));
        m.insert("Hidden".into(), json!({"item_class":"DivinationCard","name":"Nope","release_state":"unreleased"}));
        m.insert("Ring".into(), json!({"item_class":"Ring","name":"Gold Ring","release_state":"released"}));
        let cards = build(&Value::Object(m)).unwrap();
        assert_eq!(cards.len(), 121);
        let old = cards.iter().find(|c| c.name == "Birth of the Three").unwrap();
        assert!(old.legacy);
        let c = cards.iter().find(|c| c.name == "Card 005").unwrap();
        assert_eq!((c.stack_size, c.reward.as_str(), c.drop_level), (Some(7), "3x Chaos Orb", Some(5)));
        assert!(build(&json!({})).is_err());
    }
}
