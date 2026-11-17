//! Converts poe.ninja payloads into `NormalizedItem`s expressed in the game's
//! base unit. Conversion uses only the rates reported in the same response.
//! Lines that cannot be priced are counted and skipped, never invented.

use super::catalog::ICON_CDN;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Bump when normalization output changes, so cached rows are re-derived
/// (stored ETags are dropped once and the next fetch is a full download).
pub const NORMALIZER_VERSION: i64 = 3;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedItem {
    pub item_id: String,
    pub name: String,
    pub variant: Option<String>,
    pub icon: Option<String>,
    pub value: f64,
    pub divine_value: Option<f64>,
    pub change_7d: Option<f64>,
    pub sparkline: Vec<Option<f64>>,
    pub volume_value: Option<f64>,
    pub listings: Option<i64>,
}

#[derive(Debug, Default)]
pub struct Normalized {
    pub items: Vec<NormalizedItem>,
    /// Lines skipped because they lacked a value or metadata.
    pub skipped: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum NormalizeError {
    #[error("unexpected response format: {0}")]
    Format(#[from] serde_json::Error),
    #[error("source did not report a rate for '{0}'")]
    MissingRate(String),
}

// ---------- league index ----------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct League {
    pub name: String,
    pub display_name: String,
    pub hardcore: bool,
    pub indexed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexState {
    economy_leagues: Vec<RawLeague>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLeague {
    name: String,
    display_name: Option<String>,
    hardcore: Option<bool>,
    indexed: Option<bool>,
    #[serde(default)]
    is_private: bool,
}

pub fn parse_leagues(body: &[u8]) -> Result<Vec<League>, NormalizeError> {
    let state: IndexState = serde_json::from_slice(body)?;
    Ok(state
        .economy_leagues
        .into_iter()
        .filter(|l| !l.is_private)
        .map(|l| {
            let lower = l.name.to_ascii_lowercase();
            League {
                hardcore: l.hardcore.unwrap_or(lower.contains("hardcore") || lower.starts_with("hc ")),
                indexed: l.indexed.unwrap_or(true),
                display_name: l.display_name.unwrap_or_else(|| l.name.clone()),
                name: l.name,
            }
        })
        .collect())
}

// ---------- shared ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sparkline {
    total_change: Option<f64>,
    #[serde(default)]
    data: Vec<Option<f64>>,
}

fn icon_url(raw: Option<String>) -> Option<String> {
    let raw = raw?;
    if raw.starts_with('/') {
        Some(format!("{ICON_CDN}{raw}"))
    } else if raw.starts_with(&format!("{ICON_CDN}/")) {
        Some(raw)
    } else {
        None // never load images from unexpected hosts
    }
}

fn finite(v: Option<f64>) -> Option<f64> {
    v.filter(|x| x.is_finite())
}

/// 7-day change as a ratio. Reported only when the source has at least two data
/// points; otherwise poe.ninja's `totalChange: 0` would read as "no movement".
fn trend(s: Option<Sparkline>) -> (Option<f64>, Vec<Option<f64>>) {
    let Some(s) = s else { return (None, Vec::new()) };
    let points = s.data.iter().filter(|v| v.is_some_and(f64::is_finite)).count();
    let change = if points >= 2 { finite(s.total_change).map(|c| c / 100.0) } else { None };
    (change, s.data)
}

// ---------- exchange ----------

#[derive(Deserialize)]
struct ExchangeResponse {
    core: Core,
    lines: Vec<ExLine>,
    items: Vec<ExItem>,
}

#[derive(Deserialize)]
struct Core {
    primary: String,
    #[serde(default)]
    rates: HashMap<String, f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExLine {
    id: String,
    primary_value: Option<f64>,
    volume_primary_value: Option<f64>,
    sparkline: Option<Sparkline>,
}

#[derive(Deserialize)]
struct ExItem {
    id: String,
    name: String,
    image: Option<String>,
}

pub fn normalize_exchange(body: &[u8], base_unit: &str) -> Result<Normalized, NormalizeError> {
    let resp: ExchangeResponse = serde_json::from_slice(body)?;
    let rate = |unit: &str| -> Option<f64> {
        if unit == resp.core.primary {
            Some(1.0)
        } else {
            resp.core.rates.get(unit).copied().filter(|r| r.is_finite() && *r > 0.0)
        }
    };
    let to_base = rate(base_unit).ok_or_else(|| NormalizeError::MissingRate(base_unit.to_string()))?;
    let to_divine = rate("divine");

    let meta: HashMap<String, ExItem> = resp.items.into_iter().map(|i| (i.id.clone(), i)).collect();
    let mut out = Normalized::default();
    for line in resp.lines {
        let (Some(pv), Some(item)) = (finite(line.primary_value), meta.get(&line.id)) else {
            out.skipped += 1;
            continue;
        };
        let (change, spark) = trend(line.sparkline);
        out.items.push(NormalizedItem {
            item_id: line.id.clone(),
            name: item.name.clone(),
            variant: None,
            icon: icon_url(item.image.clone()),
            value: pv * to_base,
            divine_value: to_divine.map(|r| pv * r),
            change_7d: change,
            sparkline: spark,
            volume_value: finite(line.volume_primary_value).map(|v| v * to_base),
            listings: None,
        });
    }
    Ok(out)
}

// ---------- stash item overview (PoE 1) ----------

#[derive(Deserialize)]
struct StashResponse {
    lines: Vec<StashLine>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StashLine {
    name: String,
    variant: Option<String>,
    icon: Option<String>,
    details_id: Option<String>,
    chaos_value: Option<f64>,
    exalted_value: Option<f64>,
    divine_value: Option<f64>,
    spark_line: Option<Sparkline>,
    listing_count: Option<i64>,
    /// Linked sockets; distinguishes otherwise identical unique rows (5L/6L).
    links: Option<u8>,
}

pub fn normalize_stash(body: &[u8], base_unit: &str) -> Result<Normalized, NormalizeError> {
    let resp: StashResponse = serde_json::from_slice(body)?;
    let mut out = Normalized::default();
    for line in resp.lines {
        let base = match base_unit {
            "chaos" => finite(line.chaos_value),
            "exalted" => finite(line.exalted_value),
            other => return Err(NormalizeError::MissingRate(other.to_string())),
        };
        let (Some(value), Some(id)) = (base, line.details_id) else {
            out.skipped += 1;
            continue;
        };
        let (change, spark) = trend(line.spark_line);
        out.items.push(NormalizedItem {
            item_id: id,
            name: line.name,
            variant: {
                let parts: Vec<String> = line
                    .links
                    .filter(|l| *l > 0)
                    .map(|l| format!("{l}L"))
                    .into_iter()
                    .chain(line.variant.filter(|v| !v.is_empty()))
                    .collect();
                (!parts.is_empty()).then(|| parts.join(" · "))
            },
            icon: icon_url(line.icon),
            value,
            divine_value: finite(line.divine_value),
            change_7d: change,
            sparkline: spark,
            volume_value: None,
            listings: line.listing_count,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shapes mirror real responses captured during research (trimmed).
    const POE2_EXCHANGE: &str = r#"{
      "core": {"items": [], "rates": {"exalted": 547.6, "chaos": 7.22}, "primary": "divine", "secondary": "chaos"},
      "lines": [
        {"id": "exalted", "primaryValue": 0.001826, "volumePrimaryValue": 39.67, "maxVolumeCurrency": "divine", "maxVolumeRate": 547.6,
         "sparkline": {"totalChange": -1.03, "data": [-1.19, 1.62, 0.39, 2.07, 0.72, -0.5, -1.03]}},
        {"id": "divine", "primaryValue": 1, "sparkline": {"totalChange": 0, "data": []}},
        {"id": "orphan", "primaryValue": 2},
        {"id": "alch"}
      ],
      "items": [
        {"id": "exalted", "name": "Exalted Orb", "image": "/gen/image/abc/CurrencyAddModToRare.png", "category": "Currency"},
        {"id": "divine", "name": "Divine Orb", "image": "https://evil.example/x.png", "category": "Currency"},
        {"id": "alch", "name": "Orb of Alchemy", "category": "Currency"}
      ]
    }"#;

    #[test]
    fn exchange_converts_primary_to_base_unit() {
        let n = normalize_exchange(POE2_EXCHANGE.as_bytes(), "exalted").unwrap();
        assert_eq!(n.items.len(), 2);
        assert_eq!(n.skipped, 2, "orphan line without item + line without value");
        let ex = &n.items[0];
        assert_eq!(ex.name, "Exalted Orb");
        assert!((ex.value - 0.001826 * 547.6).abs() < 1e-9);
        assert_eq!(ex.divine_value, Some(0.001826));
        assert_eq!(ex.change_7d, Some(-0.0103));
        assert_eq!(ex.icon.as_deref(), Some("https://web.poecdn.com/gen/image/abc/CurrencyAddModToRare.png"));
        let div = &n.items[1];
        assert!((div.value - 547.6).abs() < 1e-9);
        assert_eq!(div.change_7d, None, "no data points means unknown change, not 0 %");
        assert_eq!(div.icon, None, "foreign image hosts are dropped");
    }

    #[test]
    fn exchange_errors_without_base_rate() {
        let body = r#"{"core":{"primary":"divine","rates":{}},"lines":[],"items":[]}"#;
        assert!(matches!(normalize_exchange(body.as_bytes(), "exalted"), Err(NormalizeError::MissingRate(_))));
        // base == primary needs no rate
        assert!(normalize_exchange(body.as_bytes(), "divine").is_ok());
    }

    #[test]
    fn stash_uses_base_value_and_details_id() {
        let body = r#"{"lines":[
          {"id":135642,"name":"Nightmare Map","icon":"https://web.poecdn.com/gen/image/x/NightmareMapSymbol.png","variant":"Gen-24",
           "sparkLine":{"totalChange":70,"data":[null,null,0,60,70]},"chaosValue":68,"exaltedValue":100.1,"divineValue":0.46,
           "count":399,"detailsId":"nightmare-map-t0-gen-24","listingCount":3972},
          {"id":1,"name":"No price","detailsId":"np"},
          {"id":2,"name":"Replica Farrul's Fur","links":6,"chaosValue":2852,"detailsId":"replica-farruls-fur-6l","listingCount":8}
        ]}"#;
        let n = normalize_stash(body.as_bytes(), "chaos").unwrap();
        assert_eq!(n.items.len(), 2);
        assert_eq!(n.skipped, 1);
        assert_eq!(n.items[1].variant.as_deref(), Some("6L"));
        let m = &n.items[0];
        assert_eq!(m.item_id, "nightmare-map-t0-gen-24");
        assert_eq!(m.value, 68.0);
        assert_eq!(m.listings, Some(3972));
        assert_eq!(m.sparkline, vec![None, None, Some(0.0), Some(60.0), Some(70.0)]);
    }

    #[test]
    fn parses_leagues_and_drops_private() {
        let body = r#"{"economyLeagues":[
          {"name":"Runes of Aldur","url":"runesofaldur","displayName":"Runes of Aldur","hardcore":false,"indexed":true,"isPrivate":false},
          {"name":"Hardcore Covens","url":"covenshc","displayName":"Hardcore Covens","isPrivate":false},
          {"name":"Secret","displayName":"Secret","isPrivate":true}
        ]}"#;
        let l = parse_leagues(body.as_bytes()).unwrap();
        assert_eq!(l.len(), 2);
        assert!(!l[0].hardcore && l[0].indexed);
        assert!(l[1].hardcore, "inferred from name when the flag is absent");
    }

    #[test]
    fn rejects_garbage() {
        assert!(normalize_exchange(b"<html>", "chaos").is_err());
    }
}
