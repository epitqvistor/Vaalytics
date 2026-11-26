//! Market Data Engine: the single entry point for market data.
//!
//! Reads are cache-first: callers always get the stored snapshot immediately.
//! If it has expired (per the source's Cache-Control), a refresh is started in
//! the background and a `market:updated` event is emitted when it finishes.
//!
//! Background sync only refreshes resources somebody looked at recently
//! ("interest"), and only once they expire — never on a blind timer.

use super::catalog::{self, CategoryDef, Endpoint};
use super::http::{unix_now, FetchError, FetchOutcome, HttpClient, HttpStats};
use super::normalize::{self, League, NormalizedItem};
use super::store::{self, FetchMeta, HistoryPoint, LEAGUES_KEY};
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::game::GameId;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const EVENT_UPDATED: &str = "market:updated";
const TICK: Duration = Duration::from_secs(60);
/// Resources viewed within this window are kept fresh in the background.
const INTEREST_TTL: Duration = Duration::from_secs(2 * 3600);
/// After a failure, wait at least this long before retrying automatically.
const ERROR_BACKOFF_SECS: i64 = 300;
const HISTORY_RETENTION_DAYS: i64 = 120;
const MAX_LEAGUE_LEN: usize = 80;

type Key = (GameId, String, String);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub category: &'static str,
    pub base_unit: &'static str,
    pub source: &'static str,
    pub items: Vec<NormalizedItem>,
    #[serde(flatten)]
    pub meta: FetchMeta,
    pub refreshing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedEvent {
    pub game: GameId,
    pub league: String,
    pub category: String,
    pub ok: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketStats {
    pub http: HttpStats,
    pub in_flight: usize,
    pub watched_resources: usize,
}

pub struct MarketEngine {
    db: Arc<Database>,
    http: HttpClient,
    app: OnceLock<AppHandle>,
    interest: Mutex<HashMap<Key, Instant>>,
    in_flight: Mutex<HashSet<Key>>,
}

fn validate_league(league: &str) -> AppResult<()> {
    if league.is_empty() || league.len() > MAX_LEAGUE_LEN || league.chars().any(char::is_control) {
        return Err(AppError::InvalidInput("invalid league name".into()));
    }
    Ok(())
}

fn category(game: GameId, id: &str) -> AppResult<&'static CategoryDef> {
    catalog::find(game, id).ok_or_else(|| AppError::InvalidInput(format!("unknown market category: {id}")))
}

const NORMALIZER_KEY: &str = "market.normalizerVersion";

impl MarketEngine {
    pub fn new(db: Arc<Database>) -> Arc<Self> {
        let stored = crate::settings::get_app(&db, NORMALIZER_KEY).ok().flatten().and_then(|v| v.as_i64());
        if stored != Some(normalize::NORMALIZER_VERSION) {
            match store::invalidate_all(&db) {
                Ok(n) => log::info!("normalizer v{} (was {stored:?}): invalidated {n} cached resources", normalize::NORMALIZER_VERSION),
                Err(e) => log::warn!("could not invalidate market cache: {e}"),
            }
            let _ = crate::settings::set_app(&db, NORMALIZER_KEY, &serde_json::json!(normalize::NORMALIZER_VERSION));
        }
        Arc::new(Self {
            db,
            http: HttpClient::new(),
            app: OnceLock::new(),
            interest: Mutex::new(HashMap::new()),
            in_flight: Mutex::new(HashSet::new()),
        })
    }

    pub fn attach(&self, app: AppHandle) {
        let _ = self.app.set(app);
    }

    pub fn stats(&self) -> MarketStats {
        MarketStats {
            http: self.http.stats(),
            in_flight: self.in_flight.lock().map(|s| s.len()).unwrap_or(0),
            watched_resources: self.interest.lock().map(|m| m.len()).unwrap_or(0),
        }
    }

    // ---------- reads ----------

    pub fn snapshot(self: &Arc<Self>, game: GameId, league: &str, category_id: &str) -> AppResult<Snapshot> {
        validate_league(league)?;
        let cat = category(game, category_id)?;
        let key: Key = (game, league.to_owned(), cat.id.to_owned());
        if let Ok(mut i) = self.interest.lock() {
            i.insert(key.clone(), Instant::now());
        }
        let meta = store::fetch_meta(&self.db, game, league, cat.id)?;
        let items = store::items(&self.db, game, league, cat.id)?;
        let refreshing = if meta.is_expired(unix_now()) { self.spawn_refresh(key) } else { self.is_in_flight(&key) };
        Ok(Snapshot {
            category: cat.id,
            base_unit: catalog::base_unit(game),
            source: "poe.ninja",
            items,
            meta,
            refreshing,
        })
    }

    /// Starts a refresh only if the data has expired. Returns whether one is running.
    pub fn refresh_if_expired(self: &Arc<Self>, game: GameId, league: &str, category_id: &str) -> AppResult<bool> {
        validate_league(league)?;
        let cat = category(game, category_id)?;
        let key: Key = (game, league.to_owned(), cat.id.to_owned());
        let meta = store::fetch_meta(&self.db, game, league, cat.id)?;
        Ok(if meta.is_expired(unix_now()) { self.spawn_refresh(key) } else { self.is_in_flight(&key) })
    }

    pub fn history(&self, game: GameId, league: &str, category_id: &str, item_id: &str, days: i64) -> AppResult<Vec<HistoryPoint>> {
        validate_league(league)?;
        let cat = category(game, category_id)?;
        if item_id.is_empty() || item_id.len() > 200 {
            return Err(AppError::InvalidInput("invalid item id".into()));
        }
        let since = unix_now() - days.clamp(1, HISTORY_RETENTION_DAYS) * 86_400;
        store::history(&self.db, game, league, cat.id, item_id, since)
    }

    /// Cached leagues; fetches synchronously only when nothing is cached yet.
    pub async fn leagues(self: &Arc<Self>, game: GameId) -> AppResult<Vec<League>> {
        let cached = store::leagues(&self.db, game)?;
        let meta = store::fetch_meta(&self.db, game, "", LEAGUES_KEY)?;
        if cached.is_empty() {
            self.fetch_leagues(game).await.map_err(AppError::InvalidInput)?;
            return store::leagues(&self.db, game);
        }
        if meta.is_expired(unix_now()) {
            let this = Arc::clone(self);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = this.fetch_leagues(game).await {
                    log::warn!("league refresh failed for {game}: {e}");
                }
            });
        }
        Ok(cached)
    }

    /// Checks the league index now (conditional request) and returns the stored list.
    /// Used by the Update Center; errors are recorded like any other league refresh.
    pub async fn refresh_leagues(self: &Arc<Self>, game: GameId) -> Result<Vec<League>, String> {
        self.fetch_leagues(game).await?;
        store::leagues(&self.db, game).map_err(|e| e.to_string())
    }

    /// Last successful league-index fetch and last error, for source health.
    pub fn leagues_meta(&self, game: GameId) -> AppResult<FetchMeta> {
        store::fetch_meta(&self.db, game, "", LEAGUES_KEY)
    }

    // ---------- refresh ----------

    fn is_in_flight(&self, key: &Key) -> bool {
        self.in_flight.lock().map(|s| s.contains(key)).unwrap_or(false)
    }

    fn spawn_refresh(self: &Arc<Self>, key: Key) -> bool {
        {
            let Ok(mut set) = self.in_flight.lock() else { return false };
            if !set.insert(key.clone()) {
                return true; // already running
            }
        }
        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let (game, league, cat) = key.clone();
            let ok = match this.refresh(game, &league, &cat).await {
                Ok(()) => true,
                Err(e) => {
                    log::warn!("market refresh {game}/{league}/{cat} failed: {e}");
                    false
                }
            };
            if let Ok(mut set) = this.in_flight.lock() {
                set.remove(&key);
            }
            if let Some(app) = this.app.get() {
                let _ = app.emit(EVENT_UPDATED, UpdatedEvent { game, league, category: cat, ok });
            }
        });
        true
    }

    async fn refresh(&self, game: GameId, league: &str, category_id: &str) -> Result<(), String> {
        let cat = catalog::find(game, category_id).ok_or("unknown category")?;
        let meta = store::fetch_meta(&self.db, game, league, cat.id).map_err(|e| e.to_string())?;
        let url = catalog::overview_url(game, league, cat);
        let started = Instant::now();
        let result = self.http.get(&url, meta.etag.as_deref()).await;
        let now = unix_now();
        match result {
            Ok(FetchOutcome::NotModified { max_age }) => {
                store::record_success(&self.db, game, league, cat.id, now, max_age, None).map_err(|e| e.to_string())?;
                log::debug!("market {game}/{league}/{} not modified ({} ms)", cat.id, started.elapsed().as_millis());
                Ok(())
            }
            Ok(FetchOutcome::Modified { body, etag, max_age }) => {
                let base = catalog::base_unit(game);
                let parsed = match cat.endpoint {
                    Endpoint::Exchange => normalize::normalize_exchange(&body, base),
                    Endpoint::Item => normalize::normalize_stash(&body, base),
                };
                let parsed = match parsed {
                    Ok(p) => p,
                    Err(e) => {
                        let msg = format!("Unexpected data from poe.ninja ({e})");
                        let _ = store::record_error(&self.db, game, league, cat.id, now, ERROR_BACKOFF_SECS, &msg);
                        return Err(msg);
                    }
                };
                store::replace_items(&self.db, game, league, cat.id, &parsed.items, now).map_err(|e| e.to_string())?;
                store::record_success(&self.db, game, league, cat.id, now, max_age, etag.as_deref()).map_err(|e| e.to_string())?;
                log::info!(
                    "market {game}/{league}/{}: {} items ({} skipped), {} KB, {} ms, max-age {max_age}s",
                    cat.id,
                    parsed.items.len(),
                    parsed.skipped,
                    body.len() / 1024,
                    started.elapsed().as_millis()
                );
                Ok(())
            }
            Err(e) => {
                let retry = match e {
                    FetchError::RateLimited(after) => (after as i64).max(ERROR_BACKOFF_SECS),
                    _ => ERROR_BACKOFF_SECS,
                };
                let msg = describe(&e);
                let _ = store::record_error(&self.db, game, league, cat.id, now, retry, &msg);
                Err(msg)
            }
        }
    }

    async fn fetch_leagues(&self, game: GameId) -> Result<(), String> {
        let meta = store::fetch_meta(&self.db, game, "", LEAGUES_KEY).map_err(|e| e.to_string())?;
        let now = || unix_now();
        match self.http.get(&catalog::leagues_url(game), meta.etag.as_deref()).await {
            Ok(FetchOutcome::NotModified { max_age }) => {
                store::record_success(&self.db, game, "", LEAGUES_KEY, now(), max_age, None).map_err(|e| e.to_string())
            }
            Ok(FetchOutcome::Modified { body, etag, max_age }) => {
                let leagues = normalize::parse_leagues(&body).map_err(|e| format!("Unexpected league data from poe.ninja ({e})"))?;
                store::replace_leagues(&self.db, game, &leagues, now()).map_err(|e| e.to_string())?;
                store::record_success(&self.db, game, "", LEAGUES_KEY, now(), max_age, etag.as_deref()).map_err(|e| e.to_string())
            }
            Err(e) => {
                let msg = describe(&e);
                let _ = store::record_error(&self.db, game, "", LEAGUES_KEY, now(), ERROR_BACKOFF_SECS, &msg);
                Err(msg)
            }
        }
    }

    // ---------- background ----------

    pub fn start_background(self: &Arc<Self>) {
        let this = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut last_prune: Option<Instant> = None;
            loop {
                if last_prune.is_none_or(|t| t.elapsed() > Duration::from_secs(86_400)) {
                    match store::prune_history(&this.db, unix_now() - HISTORY_RETENTION_DAYS * 86_400) {
                        Ok(n) if n > 0 => log::info!("pruned {n} old price history points"),
                        Ok(_) => {}
                        Err(e) => log::warn!("history prune failed: {e}"),
                    }
                    last_prune = Some(Instant::now());
                }
                tokio::time::sleep(TICK).await;
                this.sync_tick();
            }
        });
    }

    fn sync_tick(self: &Arc<Self>) {
        let due: Vec<Key> = {
            let Ok(mut interest) = self.interest.lock() else { return };
            interest.retain(|_, seen| seen.elapsed() < INTEREST_TTL);
            interest.keys().cloned().collect()
        };
        let now = unix_now();
        for key in due {
            let expired = store::fetch_meta(&self.db, key.0, &key.1, &key.2).map(|m| m.is_expired(now)).unwrap_or(false);
            if expired {
                self.spawn_refresh(key); // requests are serialized and spaced by the HTTP client
            }
        }
    }
}

fn describe(e: &FetchError) -> String {
    match e {
        FetchError::Network(_) => "poe.ninja could not be reached. Check your connection.".into(),
        FetchError::Status(404) => "poe.ninja has no data for this league or category.".into(),
        FetchError::Status(code) => format!("poe.ninja returned an error (HTTP {code})."),
        FetchError::RateLimited(after) => format!("poe.ninja asked us to slow down; retrying after {after}s."),
    }
}

/// Live checks against poe.ninja. Opt-in (network): `cargo test -- --ignored live_`.
#[cfg(test)]
mod live_tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn live_every_catalog_category_normalizes() {
        let http = HttpClient::new();
        for game in GameId::ALL {
            let FetchOutcome::Modified { body, .. } = http.get(&catalog::leagues_url(game), None).await.unwrap() else { panic!() };
            let leagues = normalize::parse_leagues(&body).unwrap();
            let league = leagues.iter().find(|l| l.indexed && !l.hardcore && l.name != "Standard").or(leagues.first()).unwrap();
            println!("{game}: league '{}' ({} leagues)", league.name, leagues.len());
            for cat in catalog::categories(game) {
                let FetchOutcome::Modified { body, max_age, .. } =
                    http.get(&catalog::overview_url(game, &league.name, cat), None).await.unwrap()
                else {
                    panic!()
                };
                let n = match cat.endpoint {
                    Endpoint::Exchange => normalize::normalize_exchange(&body, catalog::base_unit(game)),
                    Endpoint::Item => normalize::normalize_stash(&body, catalog::base_unit(game)),
                }
                .unwrap_or_else(|e| panic!("{game}/{}: {e}", cat.id));
                let top = n.items.iter().max_by(|a, b| a.value.total_cmp(&b.value));
                println!(
                    "  {:<20} {:>4} items, {:>3} skipped, max-age {max_age}, top: {}",
                    cat.id,
                    n.items.len(),
                    n.skipped,
                    top.map(|t| format!("{} = {:.1} {}", t.name, t.value, catalog::base_unit(game))).unwrap_or_default()
                );
                assert!(!n.items.is_empty() || cat.endpoint == Endpoint::Item, "{game}/{} returned no items", cat.id);
            }
        }
    }

    #[tokio::test]
    #[ignore]
    async fn live_conditional_request_returns_not_modified() {
        let http = HttpClient::new();
        let url = catalog::leagues_url(GameId::Poe1);
        let FetchOutcome::Modified { etag, .. } = http.get(&url, None).await.unwrap() else { panic!("expected a body") };
        let etag = etag.expect("poe.ninja sends an ETag");
        match http.get(&url, Some(&etag)).await.unwrap() {
            FetchOutcome::NotModified { max_age } => println!("304 Not Modified, max-age {max_age}"),
            FetchOutcome::Modified { .. } => println!("data changed between requests (allowed, but unlikely)"),
        }
        let stats = http.stats();
        assert_eq!(stats.requests, 2);
        println!("stats: {stats:?}");
    }
}
