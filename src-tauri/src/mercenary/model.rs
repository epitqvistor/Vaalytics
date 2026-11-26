//! Types and listing parsing for Mercenary Intelligence. Every external field is checked for
//! type and size; a listing that doesn't match the expected shape is skipped and counted.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const MAX_SKILLS: usize = 12;
const MAX_SUPPORTS: usize = 10;
const MAX_NAME: usize = 96;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: serde_json::Value,
    /// Comparison level: 1 exact warrant, 2 exact value package, 3 similar configuration, 4 family baseline.
    pub level: u8,
    pub label: String,
    pub count: usize,
    pub game_version: String,
    pub catalog_version: String,
    #[serde(default)]
    pub force: bool,
}

fn short_text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(char::is_control)
}

impl SearchRequest {
    pub fn validate_meta(&self) -> AppResult<()> {
        if !(1..=4).contains(&self.level) {
            return Err(AppError::InvalidInput("invalid comparison level".into()));
        }
        if !short_text(&self.label, 160) || !short_text(&self.game_version, 24) || !short_text(&self.catalog_version, 32) {
            return Err(AppError::InvalidInput("invalid search description".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListingSupport {
    pub stat: String,
    pub name: String,
    pub tier: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListingSkill {
    pub stat: String,
    pub name: String,
    pub supports: Vec<ListingSupport>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MercListing {
    pub id: String,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    pub price_type: Option<String>,
    /// Converted with the rates of the snapshot (poe.ninja); `None` when no rate was available.
    pub amount_chaos: Option<f64>,
    pub indexed: Option<String>,
    pub instant_buyout: bool,
    /// "Build" property, e.g. "Kineticist" or "Infamous Kineticist".
    pub build: Option<String>,
    pub level: Option<u32>,
    pub skills: Vec<ListingSkill>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub snapshot_id: Option<i64>,
    /// "ok" or "error". With "error", `stale` tells whether the listings are an older snapshot.
    pub status: &'static str,
    pub error: Option<String>,
    pub league: String,
    pub query_hash: String,
    pub level: u8,
    pub label: String,
    pub search_id: Option<String>,
    pub total: Option<u64>,
    pub complexity: Option<u64>,
    pub trade_url: Option<String>,
    pub fetched_at: i64,
    pub cached: bool,
    pub stale: bool,
    pub skipped_listings: usize,
    pub rates_available: bool,
    /// Rates actually used (currency → chaos), kept with the snapshot.
    pub rates: HashMap<String, f64>,
    pub listings: Vec<MercListing>,
    pub game_version: String,
    pub catalog_version: String,
}

impl SearchOutcome {
    pub fn failed(league: &str, hash: &str, req: &SearchRequest, msg: String, now: i64) -> Self {
        Self {
            snapshot_id: None,
            status: "error",
            error: Some(msg),
            league: league.to_owned(),
            query_hash: hash.to_owned(),
            level: req.level,
            label: req.label.clone(),
            search_id: None,
            total: None,
            complexity: None,
            trade_url: None,
            fetched_at: now,
            cached: false,
            stale: false,
            skipped_listings: 0,
            rates_available: false,
            rates: HashMap::new(),
            listings: vec![],
            game_version: req.game_version.clone(),
            catalog_version: req.catalog_version.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorInfo {
    pub at: i64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceHealth {
    pub source: &'static str,
    pub last_ok: Option<i64>,
    pub last_error: Option<ErrorInfo>,
    pub ok: u32,
    pub failed: u32,
    pub contact_configured: bool,
}

fn text(v: &serde_json::Value) -> Option<String> {
    v.as_str().filter(|s| short_text(s, MAX_NAME)).map(str::to_owned)
}

/// Reads one raw Trade fetch result. Returns `None` (skipped, counted) when the shape is not a
/// mercenary warrant or a field is out of range. Account names are not read.
pub fn parse_listing(v: &serde_json::Value, to_chaos: impl Fn(&str, f64) -> Option<f64>) -> Option<MercListing> {
    let id = v.get("id")?.as_str().filter(|s| !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric()))?.to_owned();
    let item = v.get("item")?;
    let listing = v.get("listing")?;
    if item.get("baseType").and_then(|b| b.as_str()) != Some("Mercenary Warrant") {
        return None;
    }
    let raw_skills = item.get("mercenarySkills")?.as_array()?;
    if raw_skills.is_empty() || raw_skills.len() > MAX_SKILLS {
        return None;
    }
    let mut skills = Vec::with_capacity(raw_skills.len());
    for s in raw_skills {
        let hash = s.get("hash")?.as_u64().filter(|h| *h <= u32::MAX as u64)?;
        let supports_raw = s.get("supports").and_then(|x| x.as_array()).map(Vec::as_slice).unwrap_or(&[]);
        if supports_raw.len() > MAX_SUPPORTS {
            return None;
        }
        let mut supports = Vec::with_capacity(supports_raw.len());
        for p in supports_raw {
            let h = p.get("hash")?.as_u64().filter(|h| *h <= u32::MAX as u64)?;
            let tier = p.get("tier")?.as_u64().filter(|t| (1..=3).contains(t))? as u8;
            supports.push(ListingSupport { stat: format!("mercenary.support_{h}"), name: text(p.get("name")?)?, tier });
        }
        skills.push(ListingSkill { stat: format!("mercenary.skill_{hash}"), name: text(s.get("name")?)?, supports });
    }
    let props = item.get("properties").and_then(|p| p.as_array()).map(Vec::as_slice).unwrap_or(&[]);
    let prop = |name: &str| {
        props
            .iter()
            .find(|p| p.get("name").and_then(|n| n.as_str()) == Some(name))
            .and_then(|p| p.pointer("/values/0/0"))
            .and_then(text)
    };
    let price = listing.get("price");
    let amount = price.and_then(|p| p.get("amount")).and_then(|a| a.as_f64()).filter(|a| a.is_finite() && *a > 0.0);
    let currency = price.and_then(|p| p.get("currency")).and_then(text).filter(|c| c.len() <= 32);
    let amount_chaos = match (amount, currency.as_deref()) {
        (Some(a), Some(c)) => to_chaos(c, a).filter(|x| x.is_finite()),
        _ => None,
    };
    Some(MercListing {
        id,
        amount,
        currency,
        price_type: price.and_then(|p| p.get("type")).and_then(text),
        amount_chaos,
        indexed: listing.get("indexed").and_then(text),
        instant_buyout: listing.get("fee").is_some_and(|f| !f.is_null()),
        build: prop("Build"),
        level: prop("Mercenary Level").and_then(|l| l.parse().ok()).filter(|l| (1..=100).contains(l)),
        skills,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValuationRecord {
    pub game_version: String,
    pub catalog_version: String,
    pub rules_version: String,
    pub fingerprint: String,
    pub family: String,
    pub title: String,
    pub category: String,
    pub confidence: String,
    pub level: Option<u8>,
    pub count: u32,
    pub p25_chaos: Option<f64>,
    pub median_chaos: Option<f64>,
    pub p75_chaos: Option<f64>,
    pub divine_rate: Option<f64>,
    pub summary: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValuationRow {
    pub id: i64,
    pub league: String,
    pub created_at: i64,
    #[serde(flatten)]
    pub record: ValuationRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleCandidate {
    pub game_version: String,
    pub catalog_version: String,
    pub rule_key: String,
    pub family: String,
    pub title: String,
    pub evidence: serde_json::Value,
    pub with_count: u32,
    pub without_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleCandidateRow {
    pub id: i64,
    pub league: String,
    pub status: String,
    pub created_at: i64,
    pub reviewed_at: Option<i64>,
    #[serde(flatten)]
    pub candidate: RuleCandidate,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub id: i64,
    pub league: String,
    pub level: u8,
    pub label: String,
    pub status: String,
    pub error: Option<String>,
    pub total: Option<i64>,
    pub fetched: i64,
    pub trade_url: Option<String>,
    pub created_at: i64,
    pub catalog_version: String,
    pub game_version: String,
}
