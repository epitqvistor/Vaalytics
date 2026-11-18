//! Market category catalog per game, verified against poe.ninja on 2026-11-16
//! (see docs/research/price-check-and-data-sources.md). Only categories that
//! returned data at that time are listed.

use crate::game::GameId;
use serde::Serialize;

pub const NINJA_BASE: &str = "https://poe.ninja";
/// Official PoE image CDN; poe.ninja exchange icons are paths on this host.
pub const ICON_CDN: &str = "https://web.poecdn.com";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Endpoint {
    /// `/{game}/api/economy/exchange/current/overview` — currency-like items.
    Exchange,
    /// `/{game}/api/economy/stash/current/item/overview` — uniques, maps, … (PoE 1 only).
    Item,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryDef {
    pub id: &'static str,
    pub label: &'static str,
    pub endpoint: Endpoint,
    #[serde(skip)]
    pub api_type: &'static str,
}

const fn ex(id: &'static str, label: &'static str, api_type: &'static str) -> CategoryDef {
    CategoryDef { id, label, endpoint: Endpoint::Exchange, api_type }
}
const fn item(id: &'static str, label: &'static str, api_type: &'static str) -> CategoryDef {
    CategoryDef { id, label, endpoint: Endpoint::Item, api_type }
}

const POE1: &[CategoryDef] = &[
    ex("currency", "Currency", "Currency"),
    ex("fragments", "Fragments", "Fragment"),
    ex("essences", "Essences", "Essence"),
    ex("fossils", "Fossils", "Fossil"),
    ex("resonators", "Resonators", "Resonator"),
    ex("oils", "Oils", "Oil"),
    ex("delirium-orbs", "Delirium Orbs", "DeliriumOrb"),
    ex("divination", "Divination Cards", "DivinationCard"),
    ex("tattoos", "Tattoos", "Tattoo"),
    ex("omens", "Omens", "Omen"),
    ex("artifacts", "Artifacts", "Artifact"),
    item("maps", "Maps", "Map"),
    item("invitations", "Invitations", "Invitation"),
    item("unique-weapons", "Unique Weapons", "UniqueWeapon"),
    item("unique-armours", "Unique Armours", "UniqueArmour"),
    item("unique-accessories", "Unique Accessories", "UniqueAccessory"),
    item("unique-jewels", "Unique Jewels", "UniqueJewel"),
    item("unique-flasks", "Unique Flasks", "UniqueFlask"),
    item("unique-maps", "Unique Maps", "UniqueMap"),
];

const POE2: &[CategoryDef] = &[
    ex("currency", "Currency", "Currency"),
    ex("fragments", "Fragments", "Fragments"),
    ex("essences", "Essences", "Essences"),
    ex("runes", "Runes", "Runes"),
    ex("soul-cores", "Soul Cores", "SoulCores"),
    ex("idols", "Idols", "Idols"),
    ex("expedition", "Expedition", "Expedition"),
    ex("ritual", "Ritual", "Ritual"),
    ex("breach", "Breach", "Breach"),
    ex("delirium", "Delirium", "Delirium"),
    ex("abyss", "Abyss", "Abyss"),
    ex("uncut-gems", "Uncut Gems", "UncutGems"),
    ex("lineage-gems", "Lineage Support Gems", "LineageSupportGems"),
    ex("verisium", "Verisium", "Verisium"),
    // Stash item overviews. PoE 2 uses plural type names (verified 2026-11-17:
    // `UniqueJewels` → 200, `UniqueJewel` → 404, `UniqueRelics` → 404).
    item("unique-weapons", "Unique Weapons", "UniqueWeapons"),
    item("unique-armours", "Unique Armours", "UniqueArmours"),
    item("unique-accessories", "Unique Accessories", "UniqueAccessories"),
    item("unique-jewels", "Unique Jewels", "UniqueJewels"),
    item("unique-flasks", "Unique Flasks", "UniqueFlasks"),
    item("unique-charms", "Unique Charms", "UniqueCharms"),
    item("unique-tablets", "Unique Tablets", "UniqueTablets"),
];

pub fn categories(game: GameId) -> &'static [CategoryDef] {
    match game {
        GameId::Poe1 => POE1,
        GameId::Poe2 => POE2,
    }
}

pub fn find(game: GameId, id: &str) -> Option<&'static CategoryDef> {
    categories(game).iter().find(|c| c.id == id)
}

/// Unit every stored value is expressed in.
pub fn base_unit(game: GameId) -> &'static str {
    match game {
        GameId::Poe1 => "chaos",
        GameId::Poe2 => "exalted",
    }
}

pub fn leagues_url(game: GameId) -> String {
    format!("{NINJA_BASE}/{}/api/data/index-state", game.as_str())
}

pub fn overview_url(game: GameId, league: &str, cat: &CategoryDef) -> String {
    let path = match cat.endpoint {
        Endpoint::Exchange => "exchange/current/overview",
        Endpoint::Item => "stash/current/item/overview",
    };
    format!(
        "{NINJA_BASE}/{}/api/economy/{path}?league={}&type={}",
        game.as_str(),
        encode_query(league),
        cat.api_type
    )
}

/// Percent-encoding for a path segment.
pub fn encode_path(s: &str) -> String {
    encode_query(s)
}

/// Minimal percent-encoding for a query value (league names contain spaces).
fn encode_query(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_per_game() {
        for g in GameId::ALL {
            let mut ids: Vec<_> = categories(g).iter().map(|c| c.id).collect();
            let n = ids.len();
            ids.sort();
            ids.dedup();
            assert_eq!(ids.len(), n, "{g}");
        }
    }

    #[test]
    fn poe2_unique_categories_use_the_stash_endpoint_with_plural_types() {
        let items: Vec<_> = categories(GameId::Poe2).iter().filter(|c| c.endpoint == Endpoint::Item).collect();
        assert_eq!(items.len(), 7);
        assert!(items.iter().all(|c| c.id.starts_with("unique-") && c.api_type.ends_with('s')));
        let jewels = find(GameId::Poe2, "unique-jewels").unwrap();
        assert!(overview_url(GameId::Poe2, "Forbidden Rites", jewels).ends_with("/poe2/api/economy/stash/current/item/overview?league=Forbidden%20Rites&type=UniqueJewels"));
    }

    #[test]
    fn builds_urls_with_encoded_league() {
        let cat = find(GameId::Poe2, "currency").unwrap();
        assert_eq!(
            overview_url(GameId::Poe2, "Runes of Aldur", cat),
            "https://poe.ninja/poe2/api/economy/exchange/current/overview?league=Runes%20of%20Aldur&type=Currency"
        );
        let maps = find(GameId::Poe1, "maps").unwrap();
        assert!(overview_url(GameId::Poe1, "Standard", maps).contains("/poe1/api/economy/stash/current/item/overview?league=Standard&type=Map"));
        assert_eq!(encode_query("a&b=c"), "a%26b%3Dc");
    }
}
