//! Core types of the Update Center: entries, payloads, change and validation vocabularies.

use crate::game::GameId;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One normalized record of a dataset. `key` is stable across versions (e.g. a card name,
/// a league id); `data` is a JSON object whose fields are compared field by field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub key: String,
    pub name: String,
    pub data: Value,
}

/// What a provider returns for one dataset after fetching, parsing and normalizing.
#[derive(Debug, Clone)]
pub struct Payload {
    pub dataset_id: &'static str,
    pub game: GameId,
    pub league: Option<String>,
    pub entries: Vec<Entry>,
    /// Version information the *source* reports (Last-Modified, build id…). None when it reports none.
    pub source_version: Option<String>,
    pub source_url: String,
    pub etag: Option<String>,
    pub bytes: u64,
}

pub enum FetchOutcome {
    /// New content (may still equal the installed version; the hash decides).
    Data(Payload),
    /// Conditional request answered 304: the installed version is current.
    NotModified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reliability {
    Official,
    Structured,
    Community,
    Unverified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    Added,
    Modified,
    Removed,
    Deprecated,
    Reclassified,
    PriceUpdated,
    DescriptionUpdated,
    MetadataUpdated,
    Structural,
    Unknown,
}

impl ChangeType {
    pub fn as_str(self) -> &'static str {
        match self {
            ChangeType::Added => "added",
            ChangeType::Modified => "modified",
            ChangeType::Removed => "removed",
            ChangeType::Deprecated => "deprecated",
            ChangeType::Reclassified => "reclassified",
            ChangeType::PriceUpdated => "price_updated",
            ChangeType::DescriptionUpdated => "description_updated",
            ChangeType::MetadataUpdated => "metadata_updated",
            ChangeType::Structural => "structural",
            ChangeType::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    Confirmed,
    High,
    Review,
    Unverified,
}

impl Confidence {
    pub fn as_str(self) -> &'static str {
        match self {
            Confidence::Confirmed => "confirmed",
            Confidence::High => "high",
            Confidence::Review => "review",
            Confidence::Unverified => "unverified",
        }
    }
    pub fn for_source(r: Reliability) -> Self {
        match r {
            Reliability::Official | Reliability::Structured => Confidence::Confirmed,
            Reliability::Community => Confidence::High,
            Reliability::Unverified => Confidence::Unverified,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Validation {
    Passed,
    Warnings,
    Review,
    Failed,
}

impl Validation {
    pub fn as_str(self) -> &'static str {
        match self {
            Validation::Passed => "passed",
            Validation::Warnings => "warnings",
            Validation::Review => "review",
            Validation::Failed => "failed",
        }
    }
    pub fn parse(s: &str) -> Self {
        match s {
            "passed" => Validation::Passed,
            "warnings" => Validation::Warnings,
            "review" => Validation::Review,
            _ => Validation::Failed,
        }
    }
}

/// Why a fetch failed. Kept apart so Sources can say *what* went wrong.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProviderError {
    #[error("source unavailable: {0}")]
    Unavailable(String),
    #[error("request timed out")]
    Timeout,
    #[error("source returned HTTP {0}")]
    Http(u16),
    #[error("rate limited by the source; retry after {0}s")]
    RateLimited(u64),
    #[error("response larger than {0} MB")]
    TooLarge(u64),
    #[error("the response structure changed: {0}")]
    Structure(String),
    #[error("invalid data: {0}")]
    Invalid(String),
    #[error("blocked URL: {0}")]
    Blocked(String),
}

impl ProviderError {
    pub fn kind(&self) -> &'static str {
        match self {
            ProviderError::Unavailable(_) => "unavailable",
            ProviderError::Timeout => "timeout",
            ProviderError::Http(401 | 403) => "auth",
            ProviderError::Http(_) => "http",
            ProviderError::RateLimited(_) => "rate_limited",
            ProviderError::TooLarge(_) => "too_large",
            ProviderError::Structure(_) => "structure",
            ProviderError::Invalid(_) => "invalid",
            ProviderError::Blocked(_) => "blocked",
        }
    }
    /// Worth retrying later without any change on our side.
    pub fn transient(&self) -> bool {
        matches!(self, ProviderError::Unavailable(_) | ProviderError::Timeout | ProviderError::RateLimited(_))
            || matches!(self, ProviderError::Http(s) if *s >= 500)
    }
}

/// Stable FNV-1a 64 hash (std's hasher is not stable across Rust versions).
pub fn fnv64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

pub fn hash_value(v: &Value) -> String {
    // serde_json's Map is ordered by key (no `preserve_order`), so this is canonical.
    format!("{:016x}", fnv64(serde_json::to_string(v).unwrap_or_default().as_bytes()))
}

/// Hash of a whole entry list, independent of entry order.
pub fn hash_entries(entries: &[Entry]) -> String {
    let mut sorted: Vec<&Entry> = entries.iter().collect();
    sorted.sort_by(|a, b| a.key.cmp(&b.key));
    let s = serde_json::to_string(&sorted).unwrap_or_default();
    format!("{:016x}", fnv64(s.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hashes_are_order_independent_and_stable() {
        let a = Entry { key: "a".into(), name: "A".into(), data: json!({"x": 1, "y": 2}) };
        let b = Entry { key: "b".into(), name: "B".into(), data: json!({"y": 2, "x": 1}) };
        assert_eq!(hash_entries(&[a.clone(), b.clone()]), hash_entries(&[b.clone(), a.clone()]));
        assert_eq!(hash_value(&json!({"x": 1, "y": 2})), hash_value(&json!({"y": 2, "x": 1})));
        assert_eq!(fnv64(b""), 0xcbf29ce484222325);
        assert_ne!(hash_entries(&[a.clone()]), hash_entries(&[b]));
    }

    #[test]
    fn classifies_errors() {
        assert_eq!(ProviderError::Http(403).kind(), "auth");
        assert!(ProviderError::Http(503).transient());
        assert!(!ProviderError::Http(404).transient());
        assert!(ProviderError::RateLimited(5).transient());
        assert!(!ProviderError::Structure("x".into()).transient());
    }
}
