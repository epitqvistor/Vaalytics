//! Normalizes trade fetch results into listings for the UI. Only data the API
//! returned is used; missing fields stay empty.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub id: String,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    /// "~price" (fixed) or "~b/o" (negotiable), as listed.
    pub price_type: Option<String>,
    /// Price converted to the game's base unit using cached poe.ninja rates.
    pub amount_base: Option<f64>,
    pub account: String,
    pub character: Option<String>,
    /// "online" | "afk" | "offline"
    pub status: &'static str,
    pub indexed: Option<String>,
    /// "item" when the price comes from the item's own note, "stash" when
    /// inherited from the stash tab name, otherwise "unknown".
    pub price_source: &'static str,
    pub whisper: Option<String>,
    pub item: ListingItem,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListingItem {
    pub name: String,
    pub type_line: String,
    pub ilvl: Option<u32>,
    pub corrupted: bool,
    pub icon: Option<String>,
    pub mods: Vec<String>,
}

#[derive(Deserialize)]
pub struct FetchResponse {
    pub result: Vec<Option<RawResult>>,
}

#[derive(Deserialize)]
pub struct RawResult {
    id: String,
    listing: RawListing,
    item: RawItem,
}

#[derive(Deserialize)]
struct RawListing {
    indexed: Option<String>,
    stash: Option<RawStash>,
    price: Option<RawPrice>,
    account: RawAccount,
    whisper: Option<String>,
}

#[derive(Deserialize)]
struct RawStash {
    name: Option<String>,
}

#[derive(Deserialize)]
struct RawPrice {
    #[serde(rename = "type")]
    kind: Option<String>,
    amount: Option<f64>,
    currency: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAccount {
    name: String,
    last_character_name: Option<String>,
    online: Option<RawOnline>,
}

#[derive(Deserialize)]
struct RawOnline {
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawItem {
    #[serde(default)]
    name: String,
    #[serde(default)]
    type_line: String,
    ilvl: Option<u32>,
    #[serde(default)]
    corrupted: bool,
    icon: Option<String>,
    note: Option<String>,
    #[serde(default)]
    implicit_mods: Vec<serde_json::Value>,
    #[serde(default)]
    explicit_mods: Vec<serde_json::Value>,
    #[serde(default)]
    crafted_mods: Vec<serde_json::Value>,
    #[serde(default)]
    fractured_mods: Vec<serde_json::Value>,
    #[serde(default)]
    enchant_mods: Vec<serde_json::Value>,
    #[serde(default)]
    rune_mods: Vec<serde_json::Value>,
}

/// Mods arrive either as plain strings or as objects with a `description`
/// (newer API). PoE 2 descriptions contain "[Tag|Text]" markup.
fn mod_text(v: &serde_json::Value) -> Option<String> {
    let raw = v.as_str().map(str::to_owned).or_else(|| v.get("description").and_then(|d| d.as_str()).map(str::to_owned))?;
    Some(strip_markup(&raw))
}

pub fn strip_markup(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find('[') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find(']') {
            Some(end) => {
                let inner = &after[..end];
                out.push_str(inner.rsplit('|').next().unwrap_or(inner));
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn is_price_note(s: &str) -> bool {
    s.starts_with("~price ") || s.starts_with("~b/o ")
}

pub fn normalize(raw: RawResult, to_base: impl Fn(&str, f64) -> Option<f64>) -> Listing {
    let RawResult { id, listing, item } = raw;
    let price = listing.price;
    let amount = price.as_ref().and_then(|p| p.amount).filter(|a| a.is_finite() && *a > 0.0);
    let currency = price.as_ref().and_then(|p| p.currency.clone());
    let amount_base = match (amount, currency.as_deref()) {
        (Some(a), Some(c)) => to_base(c, a),
        _ => None,
    };
    let status = match &listing.account.online {
        None => "offline",
        Some(o) if o.status.as_deref() == Some("afk") => "afk",
        Some(_) => "online",
    };
    let price_source = if item.note.as_deref().is_some_and(is_price_note) {
        "item"
    } else if listing.stash.as_ref().and_then(|s| s.name.as_deref()).is_some_and(is_price_note) {
        "stash"
    } else {
        "unknown"
    };
    let mods = [&item.enchant_mods, &item.implicit_mods, &item.rune_mods, &item.fractured_mods, &item.explicit_mods, &item.crafted_mods]
        .into_iter()
        .flat_map(|v| v.iter().filter_map(mod_text))
        .collect();
    Listing {
        id,
        amount,
        currency,
        price_type: price.and_then(|p| p.kind),
        amount_base,
        account: listing.account.name,
        character: listing.account.last_character_name,
        status,
        indexed: listing.indexed,
        price_source,
        whisper: listing.whisper,
        item: ListingItem {
            name: item.name,
            type_line: item.type_line,
            ilvl: item.ilvl,
            corrupted: item.corrupted,
            icon: item.icon.filter(|u| u.starts_with("https://web.poecdn.com/")),
            mods,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Shape of real fetch responses (Nov 2026); account/character names replaced.
    const POE1: &str = r#"{"result":[{"id":"abc","listing":{"method":"psapi","indexed":"2026-11-14T10:35:09Z",
      "stash":{"name":"Trade-L","x":20,"y":4},"price":{"type":"~price","amount":1,"currency":"alch"},
      "account":{"name":"SampleAccount#0001","online":{"league":"Covens"},"lastCharacterName":"SampleChar","realm":"pc"},
      "whisper":"@SampleChar Hi, I would like to buy your Pain Turn Two-Stone Ring listed for 1 alch in Covens"},
      "item":{"name":"Pain Turn","typeLine":"Two-Stone Ring","baseType":"Two-Stone Ring","ilvl":40,"note":"~price 1 alch",
        "icon":"https://web.poecdn.com/gen/image/x.png",
        "implicitMods":["+15% to Fire and Cold Resistances"],
        "explicitMods":[{"description":"+78 to maximum Life","domain":"explicit","hash":"stat.explicit.stat_3299347043"}]}},
      null]}"#;

    const POE2_STASH_PRICED_AFK: &str = r#"{"result":[{"id":"def","listing":{"indexed":"2026-11-16T21:45:35Z",
      "stash":{"name":"~price 1 exalted D"},"price":{"type":"~price","amount":1,"currency":"exalted"},
      "account":{"name":"Other#0002","online":{"league":"Runes of Aldur","status":"afk"},"lastCharacterName":"Char2"}},
      "item":{"name":"Agony Loop","typeLine":"Sapphire Ring","icon":"https://evil.example/i.png",
        "explicitMods":[{"description":"Adds 10 to 14 [Fire] damage to [Attack|Attacks]"}]}}]}"#;

    fn parse(json: &str) -> Vec<Listing> {
        let r: FetchResponse = serde_json::from_str(json).unwrap();
        r.result.into_iter().flatten().map(|x| normalize(x, |c, a| (c == "alch").then_some(a * 0.3).or((c == "exalted").then_some(a)))).collect()
    }

    #[test]
    fn normalizes_item_priced_online_listing() {
        let l = &parse(POE1)[0];
        assert_eq!(l.status, "online");
        assert_eq!(l.price_source, "item");
        assert_eq!((l.amount, l.currency.as_deref(), l.amount_base), (Some(1.0), Some("alch"), Some(0.3)));
        assert_eq!(l.item.mods, vec!["+15% to Fire and Cold Resistances", "+78 to maximum Life"]);
        assert_eq!(l.character.as_deref(), Some("SampleChar"));
    }

    #[test]
    fn detects_stash_price_afk_and_strips_markup() {
        let l = &parse(POE2_STASH_PRICED_AFK)[0];
        assert_eq!(l.status, "afk");
        assert_eq!(l.price_source, "stash");
        assert_eq!(l.item.mods, vec!["Adds 10 to 14 Fire damage to Attacks"]);
        assert_eq!(l.item.icon, None, "non-CDN icons are dropped");
        assert_eq!(l.whisper, None);
    }

    #[test]
    fn markup_helper() {
        assert_eq!(strip_markup("a [B|C] d [E] [unclosed"), "a C d E [unclosed");
    }
}
