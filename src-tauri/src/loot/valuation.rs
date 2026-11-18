//! Automatic valuation from the Market engine's poe.ninja cache.
//!
//! PoE 2 market data in Vaalytics covers exchange categories (currency,
//! fragments, essences, runes, soul cores, idols, expedition, ritual, breach,
//! delirium, abyss, uncut and lineage gems) and unique items (weapons, armours,
//! accessories, jewels, flasks, charms, tablets).
//! - Stackables are priced by exact name × stack size.
//! - Identified uniques by name + base type (corrupted state preferred).
//! - Unidentified uniques by base type: the only unique on that base, or —
//!   when several share it — the cheapest, with the full range in the note.
//! - Rare / magic / normal equipment, waystones, relics → `unsupported`
//!   (priced by modifiers; the user can run a live Trade check or enter a value).
//! Nothing here sends requests: refreshing expired categories is left to the
//! Market engine (`refresh_if_expired`, which honours poe.ninja max-age).

use super::store::{NewValuation, ValueTarget};
use crate::db::Database;
use crate::error::AppResult;
use crate::game::GameId;
use crate::market::catalog::{self, Endpoint};
use crate::market::store as market;

pub const MIN_CONFIDENCE_ORDER: [&str; 3] = ["low", "medium", "high"];

fn rank(c: &str) -> usize {
    MIN_CONFIDENCE_ORDER.iter().position(|x| *x == c).unwrap_or(0)
}

/// Volume/listing-based confidence of a poe.ninja value.
fn confidence(volume: Option<f64>, listings: Option<i64>) -> &'static str {
    let v = volume.unwrap_or(0.0).max(listings.unwrap_or(0) as f64);
    if v >= 100.0 {
        "high"
    } else if v >= 10.0 {
        "medium"
    } else {
        "low"
    }
}

/// Equipment-like categories that are priced only when the item is unique.
const EQUIPMENT: &[&str] = &["weapon", "armour", "accessory", "flask", "jewel", "relic", "unique", "waystone", "tablet"];

pub fn supports_automatic(category: &str, rarity: &str) -> bool {
    rarity == "Unique" || !(EQUIPMENT.contains(&category) || matches!(rarity, "Rare" | "Magic"))
}

/// Unique market category for an item class.
fn unique_category(item_class: &str) -> &'static [&'static str] {
    const WEAPONS: &[&str] = &[
        "Claws", "Daggers", "Wands", "One Hand Swords", "One Hand Axes", "One Hand Maces", "Sceptres", "Spears", "Flails", "Bows", "Staves",
        "Two Hand Swords", "Two Hand Axes", "Two Hand Maces", "Quarterstaves", "Crossbows", "Traps",
    ];
    match item_class {
        "Jewels" => &["unique-jewels"],
        "Rings" | "Amulets" | "Belts" => &["unique-accessories"],
        "Charms" => &["unique-charms"],
        "Life Flasks" | "Mana Flasks" => &["unique-flasks"],
        c if c.contains("Tablet") => &["unique-tablets"],
        c if WEAPONS.contains(&c) => &["unique-weapons"],
        _ => &["unique-armours"],
    }
}

/// Market categories worth refreshing for this item (most relevant first).
pub fn market_categories_for(t: &ValueTarget) -> Vec<&'static str> {
    if t.rarity == "Unique" {
        return unique_category(&t.item_class).to_vec();
    }
    catalog::categories(GameId::Poe2).iter().filter(|c| c.endpoint == Endpoint::Exchange).map(|c| c.id).collect()
}

fn fmt(v: f64) -> String {
    if v >= 100.0 {
        format!("{v:.0}")
    } else if v >= 1.0 {
        format!("{v:.1}")
    } else {
        format!("{v:.2}")
    }
}

/// Values one item from cached market data for `league`.
pub fn value(db: &Database, game: GameId, league: Option<&str>, t: &ValueTarget, min_confidence: &str) -> AppResult<NewValuation> {
    let unit = catalog::base_unit(game);
    let qty = t.stack_size.unwrap_or(1).max(1);
    let base = |status: &'static str, note: &str| NewValuation {
        status,
        unit_value: None,
        quantity: qty,
        unit,
        source: "poe.ninja".into(),
        market_category: None,
        league: league.map(str::to_owned),
        confidence: None,
        data_fetched_at: None,
        note: Some(note.to_string()),
        icon: None,
    };
    if !supports_automatic(&t.category, &t.rarity) {
        let note = if t.rarity == "Rare" || t.rarity == "Magic" {
            "Rare and magic items are priced by their modifiers; a base type or name isn't enough. Run a live Trade check or enter a value."
        } else {
            "No automatic price source for this kind of item in Vaalytics."
        };
        return Ok(base("unsupported", note));
    }
    let Some(league) = league else {
        return Ok(base("no_market_data", "No market league selected yet — open Currency Tracker once to choose one."));
    };
    let priced = |unit_value: f64, cat: String, conf: &'static str, fetched: Option<i64>, icon: Option<String>, note: Option<String>, quantity: i64| -> NewValuation {
        if rank(conf) < rank(min_confidence) {
            let mut v = base("no_market_data", &format!("Only {conf}-confidence market data (below your minimum of {min_confidence}).{}", note.as_deref().map(|n| format!(" {n}")).unwrap_or_default()));
            v.market_category = Some(cat);
            v.icon = icon;
            return v;
        }
        NewValuation {
            status: "priced",
            unit_value: Some(unit_value),
            quantity,
            unit,
            source: "poe.ninja".into(),
            market_category: Some(cat),
            league: Some(league.to_owned()),
            confidence: Some(conf),
            data_fetched_at: fetched,
            note,
            icon,
        }
    };

    if t.rarity == "Unique" {
        let identified = !t.unidentified && t.item_name.is_some();
        let rows = market::uniques_on_base(db, game, league, &t.base_type, if identified { t.item_name.as_deref() } else { None })?;
        if rows.is_empty() {
            return Ok(base("no_market_data", &format!("No unique {} in the cached poe.ninja data for {league}.", if identified { "with this name and base" } else { "on this base" })));
        }
        // One row per unique name, preferring the matching corrupted state.
        let mut names: Vec<String> = Vec::new();
        let mut picks: Vec<(market::UniqueRow, bool)> = Vec::new();
        for r in &rows {
            if !names.contains(&r.name) {
                names.push(r.name.clone());
            }
        }
        for n in &names {
            let of_name: Vec<&market::UniqueRow> = rows.iter().filter(|r| &r.name == n).collect();
            let is_corrupt = |r: &market::UniqueRow| r.variant.as_deref().is_some_and(|v| v.contains("Corrupted"));
            let exact = of_name.iter().find(|r| is_corrupt(r) == t.corrupted).copied();
            let row = exact.or_else(|| of_name.first().copied()).cloned();
            if let Some(row) = row {
                picks.push((row, exact.is_some()));
            }
        }
        picks.sort_by(|a, b| a.0.value.total_cmp(&b.0.value));
        let (cheapest, exact) = picks[0].clone();
        let state_note = (!exact).then(|| format!("Only the {} version is listed.", if t.corrupted { "uncorrupted" } else { "corrupted" }));
        if identified || picks.len() == 1 {
            let mut conf = confidence(None, cheapest.listings);
            let mut notes: Vec<String> = state_note.into_iter().collect();
            if !identified {
                notes.push(format!("Unidentified: {} is the only unique on {} in poe.ninja data.", cheapest.name, t.base_type));
                if conf == "high" {
                    conf = "medium";
                }
            }
            let note = (!notes.is_empty()).then(|| notes.join(" "));
            return Ok(priced(cheapest.value, cheapest.category.clone(), conf, cheapest.fetched_at, cheapest.icon.clone(), note, 1));
        }
        let max = picks.iter().map(|p| p.0.value).fold(f64::MIN, f64::max);
        let list: Vec<String> = picks.iter().take(8).map(|p| format!("{} {}", p.0.name, fmt(p.0.value))).collect();
        let note = format!(
            "Unidentified: one of {} uniques on {} ({}–{} {unit}); valued at the lowest. {}{}",
            picks.len(),
            t.base_type,
            fmt(cheapest.value),
            fmt(max),
            list.join(", "),
            if picks.len() > 8 { ", …" } else { "" }
        );
        return Ok(priced(cheapest.value, cheapest.category.clone(), "low", cheapest.fetched_at, None, Some(note), 1));
    }

    match market::find_by_name(db, game, league, &t.base_type)? {
        Some(m) => {
            let conf = confidence(m.volume_value, m.listings);
            Ok(priced(m.value, m.category, conf, m.fetched_at, m.icon, None, qty))
        }
        None => Ok(base("no_market_data", &format!("Not listed in the cached poe.ninja exchange data for {league}. If you play another league, choose it at the top of Loot Journal."))),
    }
}

/// How long a price from an earlier poe.ninja snapshot is still used.
pub const LAST_LISTED_MAX_AGE_SECS: i64 = 7 * 86_400;
/// Note prefix of a value carried over from an earlier snapshot (the UI keys on it).
pub const LAST_LISTED_NOTE: &str = "Not in the latest poe.ninja data";

/// poe.ninja's exchange snapshots list only items traded recently, so a thinly
/// traded item (e.g. some Perfect Essences) drops in and out. When the current
/// snapshot has no row, the most recent price Vaalytics recorded in the same
/// league (this item, or another capture of the same non-unique base type) is
/// used for up to 7 days: low confidence, the original data time kept, and a
/// note saying so. Never across leagues, never for unidentified uniques.
pub fn with_last_listed(db: &Database, game: GameId, league: Option<&str>, t: &ValueTarget, v: NewValuation, now: i64, min_confidence: &str) -> AppResult<NewValuation> {
    // Only "not listed", not "below your minimum confidence" (that one has a category).
    if v.status != "no_market_data" || v.market_category.is_some() {
        return Ok(v);
    }
    let Some(league) = league else { return Ok(v) };
    if t.rarity == "Unique" && (t.unidentified || t.item_name.is_none()) {
        return Ok(v);
    }
    let Some(last) = super::store::last_listed(&*db.conn()?, game, league, t)? else { return Ok(v) };
    if now - last.seen_at > LAST_LISTED_MAX_AGE_SECS {
        let mut v = v;
        v.note = Some(format!("Not in the current poe.ninja data for {league}; the last listing is more than 7 days old, too old to use."));
        return Ok(v);
    }
    if rank("low") < rank(min_confidence) {
        let mut v = v;
        v.note = Some(format!("{LAST_LISTED_NOTE} for {league}; only an earlier listing exists (low confidence, below your minimum of {min_confidence})."));
        return Ok(v);
    }
    Ok(NewValuation {
        status: "priced",
        unit_value: Some(last.unit_value),
        market_category: last.market_category,
        league: Some(league.to_owned()),
        confidence: Some("low"),
        data_fetched_at: Some(last.seen_at),
        note: Some(format!("{LAST_LISTED_NOTE} (it lists only recently traded items); using the last listed price in {league}.")),
        ..v
    })
}

/// League used for valuations: the user's market league for the game, else
/// the default rule of the Currency Tracker (first indexed non-Standard softcore league).
pub fn league_for(db: &Database, game: GameId) -> Option<String> {
    let stored = crate::settings::get_game(db, game, "market.league").ok().flatten().and_then(|v| v.as_str().map(str::to_owned)).filter(|s| !s.is_empty());
    let leagues = market::leagues(db, game).unwrap_or_default();
    if let Some(s) = stored {
        if leagues.is_empty() || leagues.iter().any(|l| l.name == s) {
            return Some(s);
        }
    }
    let soft: Vec<_> = leagues.iter().filter(|l| !l.hardcore).collect();
    soft.iter().find(|l| l.indexed && l.name != "Standard").or(soft.first()).map(|l| l.name.clone()).or_else(|| leagues.first().map(|l| l.name.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::market::normalize::NormalizedItem;

    fn target(category: &str, rarity: &str, base: &str, stack: Option<i64>) -> ValueTarget {
        ValueTarget {
            id: 1,
            category: category.into(),
            rarity: rarity.into(),
            base_type: base.into(),
            stack_size: stack,
            value_status: "pending".into(),
            value_checks: 0,
            item_class: "Stackable Currency".into(),
            item_name: None,
            corrupted: false,
            unidentified: false,
        }
    }

    fn unique(name: Option<&str>, base: &str, corrupted: bool, unidentified: bool) -> ValueTarget {
        ValueTarget { item_class: "Jewels".into(), item_name: name.map(Into::into), corrupted, unidentified, ..target("unique", "Unique", base, None) }
    }

    fn row(id: &str, name: &str, value: f64, vol: f64) -> NormalizedItem {
        NormalizedItem {
            item_id: id.into(),
            name: name.into(),
            variant: None,
            icon: Some("https://web.poecdn.com/x.png".into()),
            value,
            divine_value: None,
            change_7d: None,
            sparkline: vec![],
            volume_value: Some(vol),
            listings: None,
            base_type: None,
        }
    }

    fn uniq(id: &str, name: &str, base: &str, value: f64, listings: i64, corrupted: bool) -> NormalizedItem {
        NormalizedItem { base_type: Some(base.into()), listings: Some(listings), volume_value: None, variant: corrupted.then(|| "Corrupted".into()), ..row(id, name, value, 0.0) }
    }

    fn seed(db: &Database) {
        market::replace_items(db, GameId::Poe2, "Rise", "currency", &[row("exalted", "Exalted Orb", 1.0, 5000.0), row("rare-orb", "Odd Orb", 40.0, 3.0)], 100).unwrap();
        market::record_success(db, GameId::Poe2, "Rise", "currency", 100, 1800, None).unwrap();
        market::replace_items(db, GameId::Poe2, "Rise", "runes", &[row("iron", "Greater Iron Rune", 0.5, 300.0)], 100).unwrap();
        // Values in exalted, as normalised from the PoE 2 UniqueJewels overview.
        market::replace_items(
            db,
            GameId::Poe2,
            "Rise",
            "unique-jewels",
            &[
                uniq("prism", "Prism of Belief", "Diamond", 1.0, 10000, true),
                uniq("heart", "Heart of the Well", "Diamond", 53.0, 10000, false),
                uniq("adorned", "The Adorned", "Diamond", 5522.0, 2721, true),
                uniq("voices", "Voices", "Sapphire", 827_000.0, 75, true),
            ],
            200,
        )
        .unwrap();
        market::record_success(db, GameId::Poe2, "Rise", "unique-jewels", 200, 1800, None).unwrap();
    }

    #[test]
    fn prices_stacks_from_cached_market_data() {
        let db = Database::open_in_memory().unwrap();
        seed(&db);
        let v = value(&db, GameId::Poe2, Some("Rise"), &target("currency", "Currency", "Exalted Orb", Some(3)), "low").unwrap();
        assert_eq!((v.status, v.unit_value, v.total(), v.confidence, v.data_fetched_at), ("priced", Some(1.0), Some(3.0), Some("high"), Some(100)));
        assert_eq!(v.market_category.as_deref(), Some("currency"));
        let rune = value(&db, GameId::Poe2, Some("Rise"), &target("socketable", "Currency", "Greater Iron Rune", Some(4)), "low").unwrap();
        assert_eq!((rune.total(), rune.market_category.as_deref(), rune.data_fetched_at), (Some(2.0), Some("runes"), None));
    }

    #[test]
    fn prices_identified_uniques_by_name_and_base() {
        let db = Database::open_in_memory().unwrap();
        seed(&db);
        let prism = value(&db, GameId::Poe2, Some("Rise"), &unique(Some("Prism of Belief"), "Diamond", true, false), "low").unwrap();
        assert_eq!((prism.status, prism.total(), prism.confidence, prism.market_category.as_deref(), prism.data_fetched_at), ("priced", Some(1.0), Some("high"), Some("unique-jewels"), Some(200)));
        assert_eq!(prism.note, None);
        // Uncorrupted copy, only the corrupted listing exists → priced, with a note.
        let clean = value(&db, GameId::Poe2, Some("Rise"), &unique(Some("Prism of Belief"), "Diamond", false, false), "low").unwrap();
        assert!(clean.note.unwrap().contains("Only the corrupted version"));
        let missing = value(&db, GameId::Poe2, Some("Rise"), &unique(Some("Brand New Unique"), "Diamond", false, false), "low").unwrap();
        assert_eq!((missing.status, missing.total()), ("no_market_data", None));
    }

    #[test]
    fn prices_unidentified_uniques_by_base_with_the_range() {
        let db = Database::open_in_memory().unwrap();
        seed(&db);
        let d = value(&db, GameId::Poe2, Some("Rise"), &unique(None, "Diamond", false, true), "low").unwrap();
        assert_eq!((d.status, d.total(), d.confidence), ("priced", Some(1.0), Some("low")));
        let note = d.note.unwrap();
        assert!(note.contains("one of 3 uniques on Diamond (1.0–5522 exalted)"), "{note}");
        assert!(note.contains("The Adorned 5522"));
        let only = value(&db, GameId::Poe2, Some("Rise"), &unique(None, "Sapphire", false, true), "low").unwrap();
        assert_eq!((only.status, only.total(), only.confidence), ("priced", Some(827_000.0), Some("medium")), "75 listings → medium");
        assert!(only.note.unwrap().contains("Voices is the only unique on Sapphire"));
        assert_eq!(value(&db, GameId::Poe2, Some("Rise"), &unique(None, "Diamond", false, true), "medium").unwrap().status, "no_market_data", "range estimate is low confidence");
        assert_eq!(value(&db, GameId::Poe2, Some("Rise"), &unique(None, "Ruby", false, true), "low").unwrap().status, "no_market_data");
    }

    #[test]
    fn never_invents_prices() {
        let db = Database::open_in_memory().unwrap();
        seed(&db);
        let rare = value(&db, GameId::Poe2, Some("Rise"), &target("accessory", "Rare", "Sapphire Ring", None), "low").unwrap();
        assert_eq!((rare.status, rare.unit_value), ("unsupported", None));
        let magic_jewel = value(&db, GameId::Poe2, Some("Rise"), &target("jewel", "Magic", "Diamond", None), "low").unwrap();
        assert_eq!(magic_jewel.status, "unsupported", "a magic Diamond is not priced like a unique");
        let missing = value(&db, GameId::Poe2, Some("Rise"), &target("currency", "Currency", "Brand New Orb", Some(1)), "low").unwrap();
        assert_eq!((missing.status, missing.total()), ("no_market_data", None));
        assert_eq!(value(&db, GameId::Poe2, Some("Standard"), &target("currency", "Currency", "Exalted Orb", Some(1)), "low").unwrap().status, "no_market_data");
        assert_eq!(value(&db, GameId::Poe2, None, &target("currency", "Currency", "Exalted Orb", Some(1)), "low").unwrap().status, "no_market_data");
        let thin = value(&db, GameId::Poe2, Some("Rise"), &target("currency", "Currency", "Odd Orb", Some(1)), "medium").unwrap();
        assert_eq!((thin.status, thin.unit_value), ("no_market_data", None), "below minimum confidence");
        assert_eq!(value(&db, GameId::Poe1, Some("Rise"), &target("currency", "Currency", "Exalted Orb", Some(1)), "low").unwrap().status, "no_market_data", "game isolation");
    }

    #[test]
    fn refreshes_the_relevant_market_categories() {
        assert_eq!(market_categories_for(&unique(None, "Diamond", false, true)), vec!["unique-jewels"]);
        let ring = ValueTarget { item_class: "Rings".into(), ..unique(Some("X"), "Gold Ring", false, false) };
        assert_eq!(market_categories_for(&ring), vec!["unique-accessories"]);
        let c = market_categories_for(&target("currency", "Currency", "Exalted Orb", None));
        assert!(c.contains(&"currency") && !c.iter().any(|x| x.starts_with("unique-")));
    }
}
