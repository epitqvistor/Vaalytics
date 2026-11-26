//! HTTP fetcher for Update Center sources that have no existing Vaalytics client
//! (poe.ninja goes through the Market engine). External content is untrusted:
//! - HTTPS only, host allowlist, redirects only to allowlisted hosts (max 3)
//! - timeouts, a hard response-size cap, gzip
//! - per-host spacing so a check never bursts requests at one site
//! - 429 / Retry-After reported as `RateLimited`; bounded retries for transient errors
//! - conditional requests (If-None-Match) where the caller has an ETag

use super::model::ProviderError;
use reqwest::{header, redirect, StatusCode, Url};
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub const ALLOWED_HOSTS: &[&str] = &["repoe-fork.github.io", "www.pathofexile.com"];
const TIMEOUT: Duration = Duration::from_secs(90);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const ATTEMPTS: u32 = 2;

pub struct Response {
    pub body: Vec<u8>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

pub enum Fetched {
    Body(Response),
    NotModified,
}

pub struct Fetcher {
    client: reqwest::Client,
    last_start: tokio::sync::Mutex<HashMap<String, Instant>>,
}

pub fn check_url(url: &str) -> Result<Url, ProviderError> {
    let u = Url::parse(url).map_err(|_| ProviderError::Blocked(url.chars().take(80).collect()))?;
    let host = u.host_str().unwrap_or("");
    if u.scheme() != "https" || !ALLOWED_HOSTS.contains(&host) {
        return Err(ProviderError::Blocked(format!("{}://{host}", u.scheme())));
    }
    Ok(u)
}

/// Minimum gap between request starts per host.
fn spacing(host: &str) -> Duration {
    if host == "www.pathofexile.com" {
        Duration::from_secs(2)
    } else {
        Duration::from_millis(500)
    }
}

impl Fetcher {
    pub fn new() -> Self {
        let policy = redirect::Policy::custom(|attempt| {
            let ok = attempt.previous().len() < 3
                && attempt.url().scheme() == "https"
                && attempt.url().host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h));
            if ok {
                attempt.follow()
            } else {
                attempt.stop()
            }
        });
        let client = reqwest::Client::builder()
            .user_agent(concat!("Vaalytics/", env!("CARGO_PKG_VERSION"), " (Windows desktop companion for Path of Exile)"))
            .timeout(TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .redirect(policy)
            .gzip(true)
            .build()
            .expect("HTTP client configuration is static and valid");
        Self { client, last_start: tokio::sync::Mutex::new(HashMap::new()) }
    }

    async fn wait_turn(&self, host: &str) {
        let mut map = self.last_start.lock().await;
        if let Some(prev) = map.get(host) {
            let next = *prev + spacing(host);
            let now = Instant::now();
            if next > now {
                tokio::time::sleep(next - now).await;
            }
        }
        map.insert(host.to_string(), Instant::now());
    }

    /// GET with an optional ETag; `max_bytes` caps the body.
    pub async fn get(&self, url: &str, etag: Option<&str>, accept: &str, max_bytes: u64) -> Result<Fetched, ProviderError> {
        let u = check_url(url)?;
        let host = u.host_str().unwrap_or("").to_string();
        let mut last = ProviderError::Unavailable("no attempt".into());
        for attempt in 0..ATTEMPTS {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(2 * attempt as u64)).await;
            }
            self.wait_turn(&host).await;
            match self.once(u.clone(), etag, accept, max_bytes).await {
                Ok(r) => return Ok(r),
                Err(e) if e.transient() && !matches!(e, ProviderError::RateLimited(_)) => last = e,
                Err(e) => return Err(e),
            }
        }
        Err(last)
    }

    async fn once(&self, url: Url, etag: Option<&str>, accept: &str, max_bytes: u64) -> Result<Fetched, ProviderError> {
        let mut req = self.client.get(url).header(header::ACCEPT, accept);
        if let Some(t) = etag {
            req = req.header(header::IF_NONE_MATCH, t);
        }
        let mut resp = req.send().await.map_err(|e| if e.is_timeout() { ProviderError::Timeout } else { ProviderError::Unavailable(e.without_url().to_string()) })?;
        let status = resp.status();
        if status == StatusCode::NOT_MODIFIED {
            return Ok(Fetched::NotModified);
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            let after = resp.headers().get(header::RETRY_AFTER).and_then(|v| v.to_str().ok()).and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(60);
            return Err(ProviderError::RateLimited(after.min(3600)));
        }
        if status.is_redirection() {
            return Err(ProviderError::Blocked("redirect to a host outside the allowlist".into()));
        }
        if !status.is_success() {
            return Err(ProviderError::Http(status.as_u16()));
        }
        if resp.content_length().is_some_and(|n| n > max_bytes) {
            return Err(ProviderError::TooLarge(max_bytes / 1_048_576));
        }
        let header_str = |h: header::HeaderName, r: &reqwest::Response| r.headers().get(h).and_then(|v| v.to_str().ok()).map(str::to_owned);
        let etag = header_str(header::ETAG, &resp);
        let last_modified = header_str(header::LAST_MODIFIED, &resp);
        let mut body = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(|e| if e.is_timeout() { ProviderError::Timeout } else { ProviderError::Unavailable(e.without_url().to_string()) })? {
            if body.len() as u64 + chunk.len() as u64 > max_bytes {
                return Err(ProviderError::TooLarge(max_bytes / 1_048_576));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(Fetched::Body(Response { body, etag, last_modified }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_allowlisted_https_urls_pass() {
        assert!(check_url("https://repoe-fork.github.io/base_items.min.json").is_ok());
        assert!(check_url("https://www.pathofexile.com/news/rss").is_ok());
        assert!(check_url("http://www.pathofexile.com/news/rss").is_err());
        assert!(check_url("https://evil.example.com/x").is_err());
        assert!(check_url("https://www.pathofexile.com.evil.com/x").is_err());
        assert!(check_url("file:///C:/Windows").is_err());
        assert!(check_url("not a url").is_err());
    }
}
