//! Official Trade integration (pathofexile.com/trade and /trade2).
//!
//! - Requests identify Vaalytics and the user's contact address (GGG asks
//!   third-party tools to do so). Without a configured contact, live Trade
//!   searches are disabled rather than sent anonymously.
//! - Every search/fetch goes through `RateLimiter`, which follows the limits the
//!   server announces. If a wait would be long, we report it instead of queuing.
//! - No session cookies are used; only public trade endpoints.

pub mod listings;
pub mod ratelimit;

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use crate::market::{catalog::encode_path, MarketEngine};
use crate::settings;
use listings::{FetchResponse, Listing};
use ratelimit::RateLimiter;
use reqwest::header;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const CONTACT_KEY: &str = "trade.contact";
const BASE: &str = "https://www.pathofexile.com";
const SEARCH_POLICY: &str = "trade-search-request-limit";
const FETCH_POLICY: &str = "trade-fetch-request-limit";
/// Waits up to this long inline; longer waits are reported to the user.
const MAX_INLINE_WAIT: Duration = Duration::from_secs(10);
const FETCH_CHUNK: usize = 10;
const MAX_LISTINGS_PER_CALL: usize = 20;
const STATS_TTL_SECS: u64 = 24 * 3600;
const MAX_QUERY_BYTES: usize = 64 * 1024;
const SEARCH_CACHE: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatEntry {
    pub id: String,
    pub text: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub options: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceCheck {
    pub search_id: String,
    pub total: u64,
    pub trade_url: String,
    pub listings: Vec<Listing>,
    pub has_more: bool,
    pub base_unit: &'static str,
    /// Whether poe.ninja currency rates were available for conversion.
    pub rates_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoreListings {
    pub listings: Vec<Listing>,
    pub has_more: bool,
}

struct SearchRecord {
    id: String,
    game: GameId,
    league: String,
    ids: Vec<String>,
}

/// A gem the Trade site addresses as base type + discriminator
/// (transfigured gems: "Static Strike of Gathering Lightning" = "Static Strike" + "alt_x").
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GemVariant {
    /// Name as shown in game.
    pub text: String,
    /// Base gem name sent as `type.option`.
    #[serde(rename = "type")]
    pub base: String,
    /// Sent as `type.discriminator`.
    pub disc: String,
}

/// Gem entries with a discriminator from `/data/items` (group id "gem").
pub fn parse_gem_variants(body: &[u8]) -> AppResult<Vec<GemVariant>> {
    #[derive(Deserialize)]
    struct Entry {
        #[serde(rename = "type")]
        base: String,
        text: Option<String>,
        disc: Option<String>,
    }
    #[derive(Deserialize)]
    struct Group {
        id: String,
        entries: Vec<Entry>,
    }
    #[derive(Deserialize)]
    struct Resp {
        result: Vec<Group>,
    }
    let resp: Resp = serde_json::from_slice(body)?;
    Ok(resp
        .result
        .into_iter()
        .filter(|g| g.id == "gem")
        .flat_map(|g| g.entries)
        .filter_map(|e| Some(GemVariant { text: e.text?, base: e.base, disc: e.disc? }))
        .collect())
}

pub struct TradeService {
    db: Arc<Database>,
    market: Arc<MarketEngine>,
    data_dir: PathBuf,
    http: reqwest::Client,
    limiter: tokio::sync::Mutex<RateLimiter>,
    searches: Mutex<VecDeque<SearchRecord>>,
    stats: Mutex<HashMap<GameId, Arc<Vec<StatEntry>>>>,
    gems: Mutex<HashMap<GameId, Arc<Vec<GemVariant>>>>,
}

fn api(game: GameId) -> &'static str {
    match game {
        GameId::Poe1 => "api/trade",
        GameId::Poe2 => "api/trade2",
    }
}

fn realm_path(game: GameId) -> &'static str {
    match game {
        GameId::Poe1 => "",
        GameId::Poe2 => "poe2/",
    }
}

pub fn trade_site_url(game: GameId, league: &str, search_id: &str) -> String {
    let site = match game {
        GameId::Poe1 => "trade",
        GameId::Poe2 => "trade2",
    };
    format!("{BASE}/{site}/search/{}{}/{search_id}", realm_path(game), encode_path(league))
}

/// User-facing message for a failed Trade request. Trade API errors are JSON (`error.message`);
/// an HTML page with 403/405/503 is the site's bot protection (Cloudflare) refusing automated
/// requests — seen on 2026-11-20 for every search POST. Vaalytics never tries to get around it.
pub fn error_message(status: u16, body: &str) -> String {
    if let Some(msg) = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(|m| m.as_str()).map(str::to_owned))
    {
        return format!("Trade returned an error: {msg}");
    }
    let lower = body.to_ascii_lowercase();
    let html = lower.contains("<html") || lower.contains("<!doctype html");
    let protection = ["cloudflare", "just a moment", "openresty", "__cf"].iter().any(|m| lower.contains(m));
    if matches!(status, 403 | 405 | 503) && html && protection {
        return format!(
            "The Trade site is refusing automated searches right now (pathofexile.com protection, HTTP {status}).              This is on the site's side and Vaalytics doesn't get around it — open the search on the Trade site, or try again later."
        );
    }
    format!("Trade returned an error: HTTP {status}")
}

pub fn validate_contact(s: &str) -> Option<String> {
    let s = s.trim();
    let ok = (4..=120).contains(&s.len())
        && !s.chars().any(|c| c.is_control() || c == '(' || c == ')')
        && (s.contains('@') || s.starts_with("https://"));
    ok.then(|| s.to_owned())
}

impl TradeService {
    pub fn new(db: Arc<Database>, market: Arc<MarketEngine>, data_dir: PathBuf) -> Self {
        Self {
            db,
            market,
            data_dir,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(20))
                .connect_timeout(Duration::from_secs(10))
                .gzip(true)
                .build()
                .expect("static HTTP client configuration"),
            limiter: tokio::sync::Mutex::new(RateLimiter::default()),
            searches: Mutex::new(VecDeque::new()),
            stats: Mutex::new(HashMap::new()),
            gems: Mutex::new(HashMap::new()),
        }
    }

    fn contact(&self) -> Option<String> {
        settings::get_app(&self.db, CONTACT_KEY)
            .ok()
            .flatten()
            .and_then(|v| v.as_str().and_then(validate_contact))
    }

    fn user_agent(&self) -> AppResult<String> {
        let contact = self.contact().ok_or_else(|| {
            AppError::InvalidInput("Add a contact email in Settings → Price checker to enable live Trade searches. GGG asks tools to identify themselves.".into())
        })?;
        Ok(format!("Vaalytics/{} (Windows desktop companion; contact: {contact})", env!("CARGO_PKG_VERSION")))
    }

    /// Sends a request under a rate-limit policy, applying the server's limit headers.
    async fn send(&self, policy: &str, req: reqwest::RequestBuilder) -> AppResult<reqwest::Response> {
        let mut limiter = self.limiter.lock().await;
        let wait = limiter.wait_time(policy, Instant::now());
        if wait > MAX_INLINE_WAIT {
            return Err(AppError::InvalidInput(format!(
                "Trade rate limit reached — try again in {}s.",
                wait.as_secs().max(1)
            )));
        }
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        limiter.record_request(policy, Instant::now());
        let resp = req.send().await.map_err(|e| AppError::InvalidInput(format!("Trade could not be reached ({}).", e.without_url())))?;

        let h = resp.headers();
        let get = |name: &str| h.get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
        let actual_policy = get("x-rate-limit-policy").unwrap_or_else(|| policy.to_owned());
        if let Some(rules) = get("x-rate-limit-rules") {
            for rule in rules.split(',').map(str::trim).filter(|r| !r.is_empty()) {
                if let (Some(limits), Some(state)) = (get(&format!("x-rate-limit-{rule}")), get(&format!("x-rate-limit-{rule}-state"))) {
                    limiter.apply_headers(&actual_policy, &limits, &state, Instant::now());
                }
            }
        }
        let status = resp.status();
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let after = get("retry-after").and_then(|v| v.parse::<u64>().ok()).unwrap_or(60);
            limiter.block_for(&actual_policy, Duration::from_secs(after), Instant::now());
            log::warn!("trade 429 on {actual_policy}; blocked {after}s");
            return Err(AppError::InvalidInput(format!("Trade asked us to slow down — try again in {after}s.")));
        }
        drop(limiter);
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            let msg = error_message(status.as_u16(), &body);
            log::warn!("trade request failed: {status} ({policy}): {msg}");
            return Err(AppError::InvalidInput(msg));
        }
        Ok(resp)
    }

    // ---------- item data: gem variants ----------

    /// Transfigured gems and other base+discriminator gems, cached on disk like the stat list.
    pub async fn gem_variants(&self, game: GameId) -> AppResult<Arc<Vec<GemVariant>>> {
        if let Some(g) = self.gems.lock().map_err(|_| AppError::StatePoisoned)?.get(&game) {
            return Ok(Arc::clone(g));
        }
        let path = self.data_dir.join(format!("trade-gem-variants-{}.json", game.as_str()));
        let fresh = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .map(|t| t.elapsed().map(|e| e.as_secs() < STATS_TTL_SECS).unwrap_or(false))
            .unwrap_or(false);
        let list = if fresh {
            serde_json::from_slice::<Vec<GemVariant>>(&std::fs::read(&path)?)?
        } else {
            match self.download_items(game).await {
                Ok(body) => {
                    let list = parse_gem_variants(&body)?;
                    std::fs::write(&path, serde_json::to_vec(&list)?)?;
                    log::info!("downloaded {} trade gem variants for {game}", list.len());
                    list
                }
                Err(e) if path.exists() => {
                    log::warn!("gem variant refresh failed, using cached copy: {e}");
                    serde_json::from_slice::<Vec<GemVariant>>(&std::fs::read(&path)?)?
                }
                Err(e) => return Err(e),
            }
        };
        let list = Arc::new(list);
        self.gems.lock().map_err(|_| AppError::StatePoisoned)?.insert(game, Arc::clone(&list));
        Ok(list)
    }

    async fn download_items(&self, game: GameId) -> AppResult<Vec<u8>> {
        let ua = self.user_agent().unwrap_or_else(|_| format!("Vaalytics/{} (Windows desktop companion)", env!("CARGO_PKG_VERSION")));
        let url = format!("{BASE}/{}/data/items", api(game));
        let resp = self
            .http
            .get(&url)
            .header(header::USER_AGENT, ua)
            .send()
            .await
            .map_err(|e| AppError::InvalidInput(format!("Could not download Trade item data ({}).", e.without_url())))?;
        if !resp.status().is_success() {
            return Err(AppError::InvalidInput(format!("Trade item data unavailable (HTTP {}).", resp.status().as_u16())));
        }
        Ok(resp.bytes().await.map_err(|e| AppError::InvalidInput(format!("Trade item data incomplete ({}).", e.without_url())))?.to_vec())
    }

    // ---------- stats data ----------

    pub async fn stats(&self, game: GameId) -> AppResult<Arc<Vec<StatEntry>>> {
        if let Some(s) = self.stats.lock().map_err(|_| AppError::StatePoisoned)?.get(&game) {
            return Ok(Arc::clone(s));
        }
        let path = self.data_dir.join(format!("trade-stats-{}.json", game.as_str()));
        let fresh = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .map(|t| t.elapsed().map(|e| e.as_secs() < STATS_TTL_SECS).unwrap_or(false))
            .unwrap_or(false);
        let entries = if fresh {
            serde_json::from_slice::<Vec<StatEntry>>(&std::fs::read(&path)?)?
        } else {
            match self.download_stats(game).await {
                Ok(entries) => {
                    std::fs::write(&path, serde_json::to_vec(&entries)?)?;
                    entries
                }
                // Stale cache beats nothing.
                Err(e) if path.exists() => {
                    log::warn!("stats refresh failed, using cached copy: {e}");
                    serde_json::from_slice::<Vec<StatEntry>>(&std::fs::read(&path)?)?
                }
                Err(e) => return Err(e),
            }
        };
        let entries = Arc::new(entries);
        self.stats.lock().map_err(|_| AppError::StatePoisoned)?.insert(game, Arc::clone(&entries));
        Ok(entries)
    }

    async fn download_stats(&self, game: GameId) -> AppResult<Vec<StatEntry>> {
        #[derive(Deserialize)]
        struct Group {
            entries: Vec<RawEntry>,
        }
        #[derive(Deserialize)]
        struct RawEntry {
            id: String,
            text: String,
            #[serde(rename = "type")]
            kind: String,
            option: Option<serde_json::Value>,
        }
        #[derive(Deserialize)]
        struct Resp {
            result: Vec<Group>,
        }
        let ua = self.user_agent().unwrap_or_else(|_| format!("Vaalytics/{} (Windows desktop companion)", env!("CARGO_PKG_VERSION")));
        let url = format!("{BASE}/{}/data/stats", api(game));
        let resp = self
            .http
            .get(&url)
            .header(header::USER_AGENT, ua)
            .send()
            .await
            .map_err(|e| AppError::InvalidInput(format!("Could not download Trade stat data ({}).", e.without_url())))?;
        if !resp.status().is_success() {
            return Err(AppError::InvalidInput(format!("Trade stat data unavailable (HTTP {}).", resp.status().as_u16())));
        }
        let body: Resp = resp.json().await.map_err(|e| AppError::InvalidInput(format!("Unexpected Trade stat data ({e}).")))?;
        let entries: Vec<StatEntry> = body
            .result
            .into_iter()
            .flat_map(|g| g.entries)
            .map(|e| StatEntry { id: e.id, text: e.text, kind: e.kind, options: e.option.is_some() })
            .collect();
        log::info!("downloaded {} trade stats for {game}", entries.len());
        Ok(entries)
    }

    // ---------- search ----------

    fn rates(&self, game: GameId, league: &str) -> HashMap<String, f64> {
        let mut map: HashMap<String, f64> = self
            .market
            .snapshot(game, league, "currency")
            .map(|s| s.items.into_iter().map(|i| (i.item_id, i.value)).collect())
            .unwrap_or_default();
        map.insert(crate::market::catalog::base_unit(game).to_owned(), 1.0);
        map
    }

    pub async fn price_check(&self, game: GameId, league: &str, query: serde_json::Value, count: usize) -> AppResult<PriceCheck> {
        if !query.is_object() || serde_json::to_vec(&query)?.len() > MAX_QUERY_BYTES {
            return Err(AppError::InvalidInput("invalid trade query".into()));
        }
        let ua = self.user_agent()?;
        let url = format!("{BASE}/{}/search/{}{}", api(game), realm_path(game), encode_path(league));
        let resp = self.send(SEARCH_POLICY, self.http.post(&url).header(header::USER_AGENT, &ua).json(&query)).await?;

        #[derive(Deserialize)]
        struct SearchResp {
            id: String,
            #[serde(default)]
            result: Vec<String>,
            #[serde(default)]
            total: u64,
        }
        let search: SearchResp = resp.json().await.map_err(|e| AppError::InvalidInput(format!("Unexpected Trade response ({e}).")))?;
        let take = count.clamp(1, MAX_LISTINGS_PER_CALL).min(search.result.len());
        let rates = self.rates(game, league);
        let rates_available = rates.len() > 1;
        let listings = self.fetch(game, &search.id, &search.result[..take], &ua, &rates).await?;
        let has_more = search.result.len() > take;

        if let Ok(mut cache) = self.searches.lock() {
            cache.push_back(SearchRecord { id: search.id.clone(), game, league: league.to_owned(), ids: search.result });
            while cache.len() > SEARCH_CACHE {
                cache.pop_front();
            }
        }
        Ok(PriceCheck {
            trade_url: trade_site_url(game, league, &search.id),
            search_id: search.id,
            total: search.total,
            listings,
            has_more,
            base_unit: crate::market::catalog::base_unit(game),
            rates_available,
        })
    }

    pub async fn fetch_more(&self, game: GameId, search_id: &str, offset: usize, count: usize) -> AppResult<MoreListings> {
        let (league, ids) = {
            let cache = self.searches.lock().map_err(|_| AppError::StatePoisoned)?;
            let rec = cache
                .iter()
                .find(|r| r.id == search_id && r.game == game)
                .ok_or_else(|| AppError::InvalidInput("This search has expired — run the price check again.".into()))?;
            (rec.league.clone(), rec.ids.clone())
        };
        let end = (offset + count.clamp(1, MAX_LISTINGS_PER_CALL)).min(ids.len());
        if offset >= end {
            return Ok(MoreListings { listings: vec![], has_more: false });
        }
        let ua = self.user_agent()?;
        let rates = self.rates(game, &league);
        let listings = self.fetch(game, search_id, &ids[offset..end], &ua, &rates).await?;
        Ok(MoreListings { listings, has_more: end < ids.len() })
    }

    async fn fetch(&self, game: GameId, search_id: &str, ids: &[String], ua: &str, rates: &HashMap<String, f64>) -> AppResult<Vec<Listing>> {
        let mut out = Vec::with_capacity(ids.len());
        for chunk in ids.chunks(FETCH_CHUNK) {
            if chunk.iter().any(|id| id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric())) {
                return Err(AppError::InvalidInput("unexpected listing id".into()));
            }
            let realm = if game == GameId::Poe2 { "&realm=poe2" } else { "" };
            let url = format!("{BASE}/{}/fetch/{}?query={}{realm}", api(game), chunk.join(","), encode_path(search_id));
            let resp = self.send(FETCH_POLICY, self.http.get(&url).header(header::USER_AGENT, ua)).await?;
            let body: FetchResponse = resp.json().await.map_err(|e| AppError::InvalidInput(format!("Unexpected Trade listing data ({e}).")))?;
            out.extend(
                body.result
                    .into_iter()
                    .flatten()
                    .map(|r| listings::normalize(r, |currency, amount| rates.get(currency).map(|rate| rate * amount))),
            );
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_gem_variants() {
        let body = br#"{"result":[
          {"id":"gem","label":"Gems","entries":[
            {"type":"Static Strike"},
            {"type":"Static Strike","text":"Static Strike of Gathering Lightning","disc":"alt_x"}
          ]},
          {"id":"currency","label":"Currency","entries":[{"type":"Divine Orb","text":"Divine Orb","disc":"x"}]}
        ]}"#;
        let v = super::parse_gem_variants(body).unwrap();
        assert_eq!(
            v,
            vec![super::GemVariant { text: "Static Strike of Gathering Lightning".into(), base: "Static Strike".into(), disc: "alt_x".into() }]
        );
    }

    use super::*;

    #[test]
    fn builds_trade_site_urls() {
        assert_eq!(trade_site_url(GameId::Poe1, "Covens", "abc"), "https://www.pathofexile.com/trade/search/Covens/abc");
        assert_eq!(
            trade_site_url(GameId::Poe2, "Runes of Aldur", "xyz"),
            "https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur/xyz"
        );
    }

    #[test]
    fn explains_blocked_and_api_errors() {
        // Real 405 body (shortened) returned for every search POST on 2026-11-20.
        let blocked = "<html>
<head><title>405 Not Allowed</title></head>
<body>
<center><h1>405 Not Allowed</h1></center>
<hr><center>openresty</center>
<script>window.__CF$cv$params={r:'x'};</script></body></html>";
        let m = error_message(405, blocked);
        assert!(m.contains("refusing automated searches") && m.contains("HTTP 405"), "{m}");
        assert!(error_message(403, "<!DOCTYPE html><html><head><title>Just a moment...</title>").contains("refusing automated searches"));
        assert_eq!(error_message(400, r#"{"error":{"code":2,"message":"Unknown item base type"}}"#), "Trade returned an error: Unknown item base type");
        assert_eq!(error_message(500, ""), "Trade returned an error: HTTP 500");
        assert_eq!(error_message(405, "plain"), "Trade returned an error: HTTP 405");
    }

    #[test]
    fn validates_contact() {
        assert_eq!(validate_contact(" me@example.com ").as_deref(), Some("me@example.com"));
        assert!(validate_contact("https://example.com/contact").is_some());
        assert!(validate_contact("nope").is_none());
        assert!(validate_contact("a@b) evil (").is_none());
        assert!(validate_contact("line\nbreak@x.com").is_none());
    }

    /// Live end-to-end check (network, opt-in). Requires your contact address:
    ///   set VAALYTICS_TRADE_CONTACT=you@example.com
    ///   cargo test live_trade -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_trade_search_and_fetch() {
        let Ok(contact) = std::env::var("VAALYTICS_TRADE_CONTACT") else {
            eprintln!("VAALYTICS_TRADE_CONTACT not set; skipping");
            return;
        };
        let contact = validate_contact(&contact).expect("valid contact");
        let ua = format!("Vaalytics/{} (Windows desktop companion; contact: {contact})", env!("CARGO_PKG_VERSION"));
        let http = reqwest::Client::new();
        for (game, league, base) in [(GameId::Poe1, "Standard", "Two-Stone Ring"), (GameId::Poe2, "Standard", "Sapphire Ring")] {
            let q = serde_json::json!({"query":{"status":{"option":"online"},"type":base},"sort":{"price":"asc"}});
            let url = format!("{BASE}/{}/search/{}{}", api(game), realm_path(game), encode_path(league));
            let resp = http.post(&url).header(header::USER_AGENT, &ua).json(&q).send().await.unwrap();
            println!("{game} search: {} policy={:?}", resp.status(), resp.headers().get("x-rate-limit-ip"));
            let v: serde_json::Value = resp.json().await.unwrap();
            let ids: Vec<String> = v["result"].as_array().unwrap().iter().take(3).map(|x| x.as_str().unwrap().to_owned()).collect();
            let realm = if game == GameId::Poe2 { "&realm=poe2" } else { "" };
            let f = format!("{BASE}/{}/fetch/{}?query={}{realm}", api(game), ids.join(","), v["id"].as_str().unwrap());
            let body: FetchResponse = http.get(&f).header(header::USER_AGENT, &ua).send().await.unwrap().json().await.unwrap();
            let listings: Vec<Listing> = body.result.into_iter().flatten().map(|r| listings::normalize(r, |_, _| None)).collect();
            assert!(!listings.is_empty());
            for l in &listings {
                println!("  {:?} {:?} {} {} {}", l.amount, l.currency, l.status, l.price_source, l.item.type_line);
            }
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    }
}
