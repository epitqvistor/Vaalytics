//! Dataset providers. Each turns one external source into normalized `Entry` lists.
//! A provider fetches + parses + normalizes; central validation and change detection
//! happen in the Update manager, so every provider goes through the same pipeline.

use super::fetch::{Fetched, Fetcher};
use super::model::{Entry, FetchOutcome, Payload, ProviderError};
use crate::game::GameId;
use crate::market::MarketEngine;
use serde_json::{json, Value};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait DatasetProvider: Send + Sync {
    fn id(&self) -> &'static str;
    /// Datasets this provider can produce.
    fn datasets(&self) -> &'static [&'static str];
    /// Fetch, parse and normalize one dataset. `etag` is the last one stored for it.
    fn fetch<'a>(&'a self, dataset_id: &'static str, etag: Option<String>) -> BoxFut<'a, Result<FetchOutcome, ProviderError>>;
}

// ---------- RePoE (PoE 1): divination cards ----------

pub const REPOE_BASE_ITEMS: &str = "https://repoe-fork.github.io/base_items.min.json";
const REPOE_MAX_BYTES: u64 = 48 * 1024 * 1024;

pub struct RepoeCards {
    pub fetcher: Arc<Fetcher>,
}

/// Normalized card entries from RePoE `base_items` (reuses Deck Intelligence's parser).
pub fn card_entries(base_items: &Value) -> Result<Vec<Entry>, ProviderError> {
    let cards = crate::decks::cards::build(base_items).map_err(|e| ProviderError::Structure(e.to_string()))?;
    Ok(cards.into_iter().map(card_entry).collect())
}

pub fn card_entry(c: crate::decks::cards::Card) -> Entry {
    Entry {
        key: c.name.clone(),
        name: c.name,
        data: json!({ "stackSize": c.stack_size, "reward": c.reward, "rewardKind": c.reward_kind, "dropLevel": c.drop_level, "legacy": c.legacy }),
    }
}

impl DatasetProvider for RepoeCards {
    fn id(&self) -> &'static str {
        "repoe-poe1"
    }
    fn datasets(&self) -> &'static [&'static str] {
        &["poe1.divination-cards"]
    }
    fn fetch<'a>(&'a self, dataset_id: &'static str, etag: Option<String>) -> BoxFut<'a, Result<FetchOutcome, ProviderError>> {
        Box::pin(async move {
            match self.fetcher.get(REPOE_BASE_ITEMS, etag.as_deref(), "application/json", REPOE_MAX_BYTES).await? {
                Fetched::NotModified => Ok(FetchOutcome::NotModified),
                Fetched::Body(r) => {
                    let v: Value = serde_json::from_slice(&r.body).map_err(|e| ProviderError::Invalid(format!("not JSON ({e})")))?;
                    if !v.is_object() {
                        return Err(ProviderError::Structure("base_items is not an object".into()));
                    }
                    let entries = card_entries(&v)?;
                    Ok(FetchOutcome::Data(Payload {
                        dataset_id,
                        game: GameId::Poe1,
                        league: None,
                        entries,
                        source_version: r.last_modified,
                        source_url: REPOE_BASE_ITEMS.into(),
                        etag: r.etag,
                        bytes: r.body.len() as u64,
                    }))
                }
            }
        })
    }
}

// ---------- poe.ninja league index (through the Market engine) ----------

pub struct NinjaLeagues {
    pub market: Arc<MarketEngine>,
}

pub fn league_entries(leagues: &[crate::market::normalize::League]) -> Vec<Entry> {
    leagues
        .iter()
        .map(|l| Entry { key: l.name.clone(), name: l.display_name.clone(), data: json!({ "hardcore": l.hardcore, "indexed": l.indexed }) })
        .collect()
}

impl DatasetProvider for NinjaLeagues {
    fn id(&self) -> &'static str {
        "poe-ninja"
    }
    fn datasets(&self) -> &'static [&'static str] {
        &["poe1.leagues", "poe2.leagues"]
    }
    fn fetch<'a>(&'a self, dataset_id: &'static str, _etag: Option<String>) -> BoxFut<'a, Result<FetchOutcome, ProviderError>> {
        Box::pin(async move {
            let game = if dataset_id.starts_with("poe2") { GameId::Poe2 } else { GameId::Poe1 };
            let leagues = self.market.refresh_leagues(game).await.map_err(|e| {
                if e.contains("rate limited") {
                    ProviderError::RateLimited(300)
                } else if e.contains("Unexpected") {
                    ProviderError::Structure(e)
                } else {
                    ProviderError::Unavailable(e)
                }
            })?;
            let url = crate::market::catalog::leagues_url(game);
            Ok(FetchOutcome::Data(Payload { dataset_id, game, league: None, entries: league_entries(&leagues), source_version: None, source_url: url, etag: None, bytes: 0 }))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_cards_from_base_items_fixture() {
        let mut m = serde_json::Map::new();
        for i in 0..320 {
            m.insert(format!("Metadata/Items/DivinationCards/C{i}"), json!({"item_class":"DivinationCard","name":format!("Card {i:03}"),"release_state":"released","drop_level":1,"properties":{"stack_size":4,"description":"<uniqueitem>{Headhunter}"}}));
        }
        let e = card_entries(&Value::Object(m)).unwrap();
        assert_eq!(e.len(), 320);
        assert_eq!(e[0].data["reward"], "Headhunter");
        assert_eq!(e[0].data["rewardKind"], "uniqueitem");
        assert!(card_entries(&json!({"x": {"item_class": "Ring"}})).is_err(), "changed structure is reported");
    }
}
