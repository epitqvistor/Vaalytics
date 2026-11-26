//! Mercenary Intelligence (PoE 1): market evidence for Mercenary Warrants.
//!
//! Queries are planned by the frontend (catalog + comparison levels) and executed here through
//! the existing `TradeService` (same rate limiter, User-Agent and contact requirement). This
//! module adds what a valuation needs on top:
//! - validation of every query against the live official stat list (`/api/trade/data/stats`) —
//!   no invented stat ids, at most one bound `mercenary` group (the anonymous limit, verified live);
//! - a 10-minute cache, de-duplication of identical in-flight searches, one retry on a network
//!   error, source health;
//! - schema and size checks on every listing, and snapshots kept per league in SQLite.
//!
//! Seller account names are never read or stored. Spec: docs/modules/mercenary-intelligence.md

pub mod model;
pub mod store;

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use crate::trade::TradeService;
use model::*;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_LISTINGS: usize = 20;

#[derive(Default)]
struct Health {
    last_ok: Option<i64>,
    last_error: Option<(i64, String)>,
    ok: u32,
    failed: u32,
}

pub struct MercenaryService {
    db: Arc<Database>,
    trade: Arc<TradeService>,
    cache: Mutex<HashMap<String, (Instant, SearchOutcome)>>,
    /// One mercenary search at a time: identical requests wait and then hit the cache.
    gate: tokio::sync::Mutex<()>,
    health: Mutex<HashMap<String, Health>>,
}

impl MercenaryService {
    pub fn new(db: Arc<Database>, trade: Arc<TradeService>) -> Self {
        Self { db, trade, cache: Mutex::new(HashMap::new()), gate: tokio::sync::Mutex::new(()), health: Mutex::new(HashMap::new()) }
    }

    pub fn db(&self) -> &Database {
        &self.db
    }

    async fn live_stat_ids(&self) -> AppResult<HashSet<String>> {
        let stats = self.trade.stats(GameId::Poe1).await.map_err(|e| {
            AppError::InvalidInput(format!("The official Trade stat list is unavailable, so the query can't be verified ({}).", public(&e)))
        })?;
        Ok(stats.iter().filter(|s| s.id.starts_with("mercenary.")).map(|s| s.id.clone()).collect())
    }

    pub async fn search(&self, league: &str, req: SearchRequest) -> AppResult<SearchOutcome> {
        validate_league(league)?;
        req.validate_meta()?;
        let ids = self.live_stat_ids().await?;
        validate_query(&req.query, &ids)?;
        let hash = query_hash(league, &req.query);

        let _gate = self.gate.lock().await;
        if !req.force {
            if let Some(hit) = self.cached(&hash) {
                return Ok(SearchOutcome { cached: true, ..hit });
            }
        }
        let count = req.count.clamp(1, MAX_LISTINGS);
        let mut attempt = self.trade.search_raw(GameId::Poe1, league, req.query.clone(), count).await;
        if let Err(e) = &attempt {
            if is_transient(e) {
                log::info!("mercenary search: transient error, retrying once: {e}");
                tokio::time::sleep(Duration::from_secs(2)).await;
                attempt = self.trade.search_raw(GameId::Poe1, league, req.query.clone(), count).await;
            }
        }
        let now = crate::market::http::unix_now();
        match attempt {
            Ok(raw) => {
                let mut skipped = 0;
                let listings: Vec<MercListing> = raw
                    .results
                    .iter()
                    .filter_map(|v| {
                        let l = parse_listing(v, |cur, amount| raw.rates.get(cur).map(|r| r * amount));
                        if l.is_none() {
                            skipped += 1;
                        }
                        l
                    })
                    .collect();
                let rates = used_rates(&raw.rates, &listings);
                let mut outcome = SearchOutcome {
                    snapshot_id: None,
                    status: "ok",
                    error: None,
                    league: league.to_owned(),
                    query_hash: hash.clone(),
                    level: req.level,
                    label: req.label.clone(),
                    search_id: Some(raw.search_id),
                    total: Some(raw.total),
                    complexity: raw.complexity,
                    trade_url: Some(raw.trade_url),
                    fetched_at: now,
                    cached: false,
                    stale: false,
                    skipped_listings: skipped,
                    rates_available: raw.rates.len() > 1,
                    rates,
                    listings,
                    game_version: req.game_version.clone(),
                    catalog_version: req.catalog_version.clone(),
                };
                outcome.snapshot_id = Some(store::save_snapshot(&self.db, &req, &outcome)?);
                self.note(league, Ok(now));
                if let Ok(mut c) = self.cache.lock() {
                    c.retain(|_, (t, _)| t.elapsed() < CACHE_TTL);
                    c.insert(hash, (Instant::now(), outcome.clone()));
                }
                Ok(outcome)
            }
            Err(e) => {
                let msg = public(&e);
                store::save_failed_snapshot(&self.db, league, &req, &hash, &msg, now)?;
                self.note(league, Err((now, msg.clone())));
                // A failed refresh never shows cached data as current: the last good snapshot comes
                // back marked stale, with its own time, next to the error.
                let previous = store::latest_ok_snapshot(&self.db, league, &hash)?;
                Ok(match previous {
                    Some(prev) => SearchOutcome { status: "error", error: Some(msg), stale: true, cached: true, ..prev },
                    None => SearchOutcome::failed(league, &hash, &req, msg, now),
                })
            }
        }
    }

    fn cached(&self, hash: &str) -> Option<SearchOutcome> {
        let c = self.cache.lock().ok()?;
        c.get(hash).filter(|(t, _)| t.elapsed() < CACHE_TTL).map(|(_, o)| o.clone())
    }

    fn note(&self, league: &str, r: Result<i64, (i64, String)>) {
        if let Ok(mut h) = self.health.lock() {
            let e = h.entry(league.to_owned()).or_default();
            match r {
                Ok(t) => {
                    e.last_ok = Some(t);
                    e.ok += 1;
                }
                Err(err) => {
                    e.last_error = Some(err);
                    e.failed += 1;
                }
            }
        }
    }

    pub fn health(&self, league: &str) -> SourceHealth {
        let h = self.health.lock().ok();
        let e = h.as_ref().and_then(|h| h.get(league));
        SourceHealth {
            source: "Official Trade API (pathofexile.com)",
            last_ok: e.and_then(|e| e.last_ok),
            last_error: e.and_then(|e| e.last_error.as_ref().map(|(t, m)| ErrorInfo { at: *t, message: m.clone() })),
            ok: e.map_or(0, |e| e.ok),
            failed: e.map_or(0, |e| e.failed),
            contact_configured: self.trade.has_contact(),
        }
    }
}

fn public(e: &AppError) -> String {
    match e {
        AppError::InvalidInput(m) => m.clone(),
        other => other.to_string(),
    }
}

fn is_transient(e: &AppError) -> bool {
    matches!(e, AppError::InvalidInput(m) if m.contains("could not be reached") || m.contains("HTTP 502") || m.contains("HTTP 503") && !m.contains("refusing"))
}

pub fn validate_league(league: &str) -> AppResult<()> {
    if league.is_empty() || league.len() > 80 || league.chars().any(char::is_control) {
        return Err(AppError::InvalidInput("invalid league name".into()));
    }
    Ok(())
}

/// Stable hash of league + query (FNV-1a over canonical JSON; serde_json sorts object keys).
pub fn query_hash(league: &str, query: &serde_json::Value) -> String {
    let s = format!("{league}\n{}", serde_json::to_string(query).unwrap_or_default());
    format!("{:016x}", crate::updates::model::fnv64(s.as_bytes()))
}

fn bad(msg: &str) -> AppError {
    AppError::InvalidInput(format!("Mercenary query rejected: {msg}"))
}

/// Only the shapes Mercenary Intelligence builds are allowed, every stat id must exist in the live
/// official list, and at most one bound `mercenary` group is sent (a second one is refused for
/// anonymous searches — verified 2026-11-26, docs/mercenary-intelligence/MARKET_METHODOLOGY.md).
pub fn validate_query(v: &serde_json::Value, live_ids: &HashSet<String>) -> AppResult<()> {
    let top = v.as_object().ok_or_else(|| bad("not an object"))?;
    if top.keys().any(|k| k != "query" && k != "sort") {
        return Err(bad("unexpected top-level field"));
    }
    let q = top.get("query").and_then(|q| q.as_object()).ok_or_else(|| bad("missing query"))?;
    if q.keys().any(|k| !matches!(k.as_str(), "status" | "type" | "stats" | "filters")) {
        return Err(bad("unexpected query field"));
    }
    let status = q.get("status").and_then(|s| s.get("option")).and_then(|s| s.as_str()).unwrap_or("");
    if !matches!(status, "securable" | "online" | "available" | "any") {
        return Err(bad("unknown listing status"));
    }
    let ty = q.get("type").ok_or_else(|| bad("missing warrant type"))?;
    let opt = ty.get("option").and_then(|o| o.as_str()).unwrap_or("");
    if !(3..=64).contains(&opt.len()) || !opt.chars().all(|c| c.is_ascii_alphanumeric()) || ty.get("discriminator").and_then(|d| d.as_str()) != Some("mercenary_warrant") {
        return Err(bad("invalid warrant type"));
    }
    let groups = q.get("stats").and_then(|s| s.as_array()).ok_or_else(|| bad("missing stats"))?;
    // An empty list is the family baseline (warrant type only).
    if groups.len() > 3 {
        return Err(bad("at most three stat groups"));
    }
    let mut bound = 0;
    for g in groups {
        let kind = g.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match kind {
            "mercenary" => bound += 1,
            "and" | "not" => {}
            _ => return Err(bad("unknown stat group type")),
        }
        let filters = g.get("filters").and_then(|f| f.as_array()).ok_or_else(|| bad("group without filters"))?;
        if filters.is_empty() || filters.len() > 8 {
            return Err(bad("between one and eight filters per group"));
        }
        for f in filters {
            let id = f.get("id").and_then(|i| i.as_str()).unwrap_or("");
            if !id.starts_with("mercenary.") || !live_ids.contains(id) {
                return Err(bad(&format!("stat {id} is not in the official Trade stat list")));
            }
            if f.as_object().is_some_and(|o| o.keys().any(|k| k != "id")) {
                return Err(bad("unexpected filter field"));
            }
            // Unbound groups may only carry skills: a support outside its skill's group would lose its binding.
            if kind != "mercenary" && !id.starts_with("mercenary.skill_") {
                return Err(bad("supports must stay in their skill's bound group"));
            }
        }
        if kind == "mercenary" && !filters[0].get("id").and_then(|i| i.as_str()).unwrap_or("").starts_with("mercenary.skill_") {
            return Err(bad("a bound group starts with its skill"));
        }
    }
    if bound > 1 {
        return Err(bad("only one bound skill group per search (anonymous Trade limit)"));
    }
    if let Some(filters) = q.get("filters") {
        let obj = filters.as_object().ok_or_else(|| bad("invalid filters"))?;
        if obj.keys().any(|k| k != "misc_filters") {
            return Err(bad("only the level filter is allowed"));
        }
        let misc = obj["misc_filters"].get("filters").and_then(|f| f.as_object()).ok_or_else(|| bad("invalid level filter"))?;
        if misc.keys().any(|k| k != "ilvl") {
            return Err(bad("only the level filter is allowed"));
        }
        for (k, val) in misc["ilvl"].as_object().ok_or_else(|| bad("invalid level filter"))? {
            if !matches!(k.as_str(), "min" | "max") || !val.as_u64().is_some_and(|n| (1..=100).contains(&n)) {
                return Err(bad("invalid level filter"));
            }
        }
    }
    if let Some(sort) = top.get("sort") {
        if sort != &serde_json::json!({"price": "asc"}) {
            return Err(bad("only ascending price sort"));
        }
    }
    Ok(())
}

fn used_rates(all: &HashMap<String, f64>, listings: &[MercListing]) -> HashMap<String, f64> {
    let mut out: HashMap<String, f64> = HashMap::new();
    for key in listings.iter().filter_map(|l| l.currency.as_deref()).chain(["divine", "chaos"]) {
        if let Some(r) = all.get(key) {
            out.insert(key.to_owned(), *r);
        }
    }
    out
}

#[cfg(test)]
mod tests;
