//! Divination Card database (PoE 1): name, stack size and reward from the community RePoE export
//! (https://repoe-fork.github.io/base_items.min.json, extracted from the game files — the same source
//! Crafting uses). Downloaded on first use, reduced to the cards, cached on disk and re-checked at most
//! once per day with an ETag, so a new league's cards arrive without an app update.
//!
//! Prices are not here: they come from the Market Data `divination` category (poe.ninja).
//! Per-card artwork has no verified source yet; the UI shows the official card icon.

use crate::error::{AppError, AppResult};
use reqwest::{header, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;

const SOURCE_URL: &str = "https://repoe-fork.github.io/base_items.min.json";
pub const SOURCE_LABEL: &str = "RePoE (game files)";
const FORMAT_VERSION: u32 = 1;
const MAX_AGE_SECS: i64 = 24 * 3600;

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

pub struct CardService {
    dir: PathBuf,
    client: reqwest::Client,
    lock: tokio::sync::Mutex<()>,
}

impl CardService {
    pub fn new(data_dir: PathBuf) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Vaalytics/", env!("CARGO_PKG_VERSION"), " (Windows desktop companion for Path of Exile)"))
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(10))
            .gzip(true)
            .build()
            .expect("HTTP client configuration is static and valid");
        Self { dir: data_dir.join("decks"), client, lock: tokio::sync::Mutex::new(()) }
    }

    fn path(&self) -> PathBuf {
        self.dir.join("cards.json")
    }

    /// The cached card list, if any (no network).
    pub fn cached(&self) -> Option<CardDb> {
        let bytes = std::fs::read(self.path()).ok()?;
        let d: CardDb = serde_json::from_slice(&bytes).ok()?;
        (d.format == FORMAT_VERSION).then_some(d)
    }

    pub async fn get(&self, force: bool) -> AppResult<CardDbResponse> {
        let _guard = self.lock.lock().await;
        let cached = self.cached();
        let now = crate::market::http::unix_now();
        let respond = |d: CardDb, stale_error| CardDbResponse { cards: d.cards, checked_at: d.checked_at, source: SOURCE_LABEL, source_modified: d.source_modified, stale_error };
        if let Some(d) = &cached {
            if !force && now - d.checked_at < MAX_AGE_SECS {
                return Ok(respond(d.clone(), None));
            }
        }
        match self.refresh(cached.as_ref(), now).await {
            Ok(d) => Ok(respond(d, None)),
            Err(e) => match cached {
                Some(d) => {
                    log::warn!("deck intelligence: card list refresh failed, using cache: {e}");
                    Ok(respond(d, Some(e)))
                }
                None => Err(AppError::InvalidInput(format!("Couldn't download the Divination Card list: {e}"))),
            },
        }
    }

    async fn refresh(&self, cached: Option<&CardDb>, now: i64) -> Result<CardDb, String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let mut req = self.client.get(SOURCE_URL).header(header::ACCEPT, "application/json");
        if let Some(t) = cached.and_then(|c| c.etag.as_deref()) {
            req = req.header(header::IF_NONE_MATCH, t);
        }
        let resp = req.send().await.map_err(|e| e.without_url().to_string())?;
        let data = if resp.status() == StatusCode::NOT_MODIFIED {
            let mut d = cached.cloned().ok_or("no cache")?;
            d.checked_at = now;
            d
        } else {
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status().as_u16()));
            }
            let etag = resp.headers().get(header::ETAG).and_then(|v| v.to_str().ok()).map(str::to_owned);
            let modified = resp.headers().get(header::LAST_MODIFIED).and_then(|v| v.to_str().ok()).map(str::to_owned);
            let body = resp.bytes().await.map_err(|e| e.without_url().to_string())?;
            let v: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
            let cards = build(&v).map_err(|e| e.to_string())?;
            CardDb { format: FORMAT_VERSION, cards, checked_at: now, source_modified: modified, etag }
        };
        std::fs::write(self.path(), serde_json::to_vec(&data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        log::info!("deck intelligence: {} divination cards", data.cards.len());
        Ok(data)
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

    #[tokio::test]
    #[ignore]
    async fn live_repoe_cards() {
        let dir = tempfile::tempdir().unwrap();
        let s = CardService::new(dir.path().to_path_buf());
        let r = s.get(true).await.unwrap();
        assert!(r.cards.len() > 400, "{}", r.cards.len());
        let doctor = r.cards.iter().find(|c| c.name == "The Doctor").unwrap();
        assert_eq!(doctor.stack_size, Some(8));
        assert_eq!(doctor.reward, "Headhunter");
        let again = s.get(true).await.unwrap();
        assert_eq!(again.cards.len(), r.cards.len());
    }
}
