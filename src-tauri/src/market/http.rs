//! HTTP client for market sources. Responsibilities:
//! - one request at a time with a minimum spacing between requests
//! - conditional requests (If-None-Match) so unchanged data costs ~nothing
//! - honour Cache-Control max-age (clamped) and Retry-After
//! - bounded retries with backoff for network errors, 429 and 5xx

use reqwest::{header, StatusCode};
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MIN_SPACING: Duration = Duration::from_millis(1500);
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_ATTEMPTS: u32 = 3;
const MAX_RETRY_AFTER: Duration = Duration::from_secs(120);
/// Used when the source sends no max-age.
pub const DEFAULT_MAX_AGE: u64 = 1800;
const MIN_MAX_AGE: u64 = 300;
const MAX_MAX_AGE: u64 = 6 * 3600;

pub enum FetchOutcome {
    Modified { body: Vec<u8>, etag: Option<String>, max_age: u64 },
    NotModified { max_age: u64 },
}

#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    #[error("network error: {0}")]
    Network(String),
    #[error("source returned HTTP {0}")]
    Status(u16),
    #[error("rate limited by source; retry after {0}s")]
    RateLimited(u64),
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpStats {
    pub requests: u64,
    pub not_modified: u64,
    pub errors: u64,
    pub bytes: u64,
    pub last_request_at: Option<i64>,
}

pub struct HttpClient {
    client: reqwest::Client,
    /// Serializes requests and remembers when the last one finished.
    gate: tokio::sync::Mutex<Option<Instant>>,
    stats: Mutex<HttpStats>,
}

impl HttpClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!(
                "Vaalytics/",
                env!("CARGO_PKG_VERSION"),
                " (Windows desktop companion for Path of Exile)"
            ))
            .timeout(TIMEOUT)
            .connect_timeout(Duration::from_secs(10))
            .gzip(true)
            .build()
            .expect("HTTP client configuration is static and valid");
        Self { client, gate: tokio::sync::Mutex::new(None), stats: Mutex::new(HttpStats::default()) }
    }

    pub fn stats(&self) -> HttpStats {
        self.stats.lock().map(|s| s.clone()).unwrap_or_default()
    }

    fn record(&self, f: impl FnOnce(&mut HttpStats)) {
        if let Ok(mut s) = self.stats.lock() {
            f(&mut s);
        }
    }

    pub async fn get(&self, url: &str, etag: Option<&str>) -> Result<FetchOutcome, FetchError> {
        let mut last = self.gate.lock().await;
        let mut attempt = 0;
        loop {
            attempt += 1;
            if let Some(prev) = *last {
                let since = prev.elapsed();
                if since < MIN_SPACING {
                    tokio::time::sleep(MIN_SPACING - since).await;
                }
            }
            let result = self.send_once(url, etag).await;
            *last = Some(Instant::now());
            match result {
                Ok(outcome) => return Ok(outcome),
                Err((err, retry_after)) => {
                    self.record(|s| s.errors += 1);
                    let retryable = matches!(err, FetchError::Network(_) | FetchError::RateLimited(_))
                        || matches!(err, FetchError::Status(code) if code >= 500);
                    if !retryable || attempt >= MAX_ATTEMPTS {
                        return Err(err);
                    }
                    let backoff = retry_after.unwrap_or(Duration::from_secs(2u64.pow(attempt) * 2));
                    log::info!("market fetch retry {attempt}/{MAX_ATTEMPTS} in {}s: {err}", backoff.as_secs());
                    tokio::time::sleep(backoff.min(MAX_RETRY_AFTER)).await;
                }
            }
        }
    }

    async fn send_once(&self, url: &str, etag: Option<&str>) -> Result<FetchOutcome, (FetchError, Option<Duration>)> {
        let mut req = self.client.get(url).header(header::ACCEPT, "application/json");
        if let Some(tag) = etag {
            req = req.header(header::IF_NONE_MATCH, tag);
        }
        self.record(|s| {
            s.requests += 1;
            s.last_request_at = Some(unix_now());
        });
        let resp = req.send().await.map_err(|e| (FetchError::Network(e.without_url().to_string()), None))?;
        let status = resp.status();
        let headers = resp.headers().clone();
        let max_age = parse_max_age(headers.get(header::CACHE_CONTROL).and_then(|v| v.to_str().ok()));

        if status == StatusCode::NOT_MODIFIED {
            self.record(|s| s.not_modified += 1);
            return Ok(FetchOutcome::NotModified { max_age });
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            let after = headers
                .get(header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.trim().parse::<u64>().ok())
                .unwrap_or(60);
            return Err((FetchError::RateLimited(after), Some(Duration::from_secs(after))));
        }
        if !status.is_success() {
            return Err((FetchError::Status(status.as_u16()), None));
        }
        let body = resp.bytes().await.map_err(|e| (FetchError::Network(e.without_url().to_string()), None))?;
        self.record(|s| s.bytes += body.len() as u64);
        let etag = headers.get(header::ETAG).and_then(|v| v.to_str().ok()).map(str::to_owned);
        Ok(FetchOutcome::Modified { body: body.to_vec(), etag, max_age })
    }
}

/// Extracts `max-age` from a Cache-Control header, clamped to a sane range.
pub fn parse_max_age(cache_control: Option<&str>) -> u64 {
    cache_control
        .and_then(|cc| {
            cc.split(',').find_map(|part| {
                let part = part.trim();
                part.strip_prefix("max-age=").and_then(|v| v.parse::<u64>().ok())
            })
        })
        .unwrap_or(DEFAULT_MAX_AGE)
        .clamp(MIN_MAX_AGE, MAX_MAX_AGE)
}

pub fn unix_now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_clamps_max_age() {
        assert_eq!(parse_max_age(Some("public, max-age=1800, stale-while-revalidate=300")), 1800);
        assert_eq!(parse_max_age(Some("max-age=5")), MIN_MAX_AGE);
        assert_eq!(parse_max_age(Some("max-age=999999")), MAX_MAX_AGE);
        assert_eq!(parse_max_age(Some("no-cache")), DEFAULT_MAX_AGE);
        assert_eq!(parse_max_age(None), DEFAULT_MAX_AGE);
    }
}
