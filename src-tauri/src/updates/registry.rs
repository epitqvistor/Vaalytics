//! Static registries: data providers (sources), datasets and module data dependencies.
//!
//! A module declares what it reads in `MODULES`; which modules a change affects is derived
//! from these registrations, never guessed. Adding a module = one entry here (see
//! docs/modules/update-center.md → "Registering a module").

use super::model::{ChangeType, Reliability};
use crate::game::GameId;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderMeta {
    pub id: &'static str,
    pub name: &'static str,
    pub reliability: Reliability,
    pub games: &'static [GameId],
    pub categories: &'static [&'static str],
    /// Human-facing website of the source.
    pub website: &'static str,
    /// What is requested, in plain words (exact URLs are in code and docs).
    pub endpoints: &'static [&'static str],
    pub auth: &'static str,
    pub rate_limit: &'static str,
    pub cache_policy: &'static str,
    pub terms: &'static str,
    /// Fetched through an existing Vaalytics service instead of the Update Center fetcher.
    pub via: Option<&'static str>,
}

const BOTH: &[GameId] = &[GameId::Poe1, GameId::Poe2];
const POE1: &[GameId] = &[GameId::Poe1];

pub const PROVIDERS: &[ProviderMeta] = &[
    ProviderMeta {
        id: "repoe-poe1",
        name: "RePoE (PoE 1 game files)",
        reliability: Reliability::Structured,
        games: POE1,
        categories: &["divination-cards", "crafting-data"],
        website: "https://repoe-fork.github.io/",
        endpoints: &["https://repoe-fork.github.io/base_items.min.json"],
        auth: "None",
        rate_limit: "No published limit (GitHub Pages). One conditional request (ETag) per check.",
        cache_policy: "ETag / If-None-Match; unchanged data costs a 304.",
        terms: "Community export of data extracted from the game files. Cached locally only, never redistributed.",
        via: None,
    },
    ProviderMeta {
        id: "poe-ninja",
        name: "poe.ninja",
        reliability: Reliability::Structured,
        games: BOTH,
        categories: &["leagues", "market-prices"],
        website: "https://poe.ninja/",
        endpoints: &["League index (economy leagues)", "Currency and item overviews per league (Market engine)"],
        auth: "None",
        rate_limit: "Market engine: request starts ≥ 500 ms apart, ≤ 3 in flight, Retry-After honoured.",
        cache_policy: "Cache-Control max-age and ETag (Market engine).",
        terms: "Public API used with a Vaalytics User-Agent; data cached locally.",
        via: Some("Market engine"),
    },
    ProviderMeta {
        id: "ggg-patch-notes",
        name: "Official patch notes (pathofexile.com forum)",
        reliability: Reliability::Official,
        games: BOTH,
        categories: &["patch-notes"],
        website: "https://www.pathofexile.com/forum/view-forum/patch-notes",
        endpoints: &[
            "https://www.pathofexile.com/forum/view-forum/patch-notes (PoE 1)",
            "https://www.pathofexile.com/forum/view-forum/2212 (PoE 2 Early Access patch notes)",
            "First page of each new thread (only threads not processed before)",
        ],
        auth: "None",
        rate_limit: "No published limit. One request at a time, ≥ 2 s apart, at most 3 new threads per forum per check.",
        cache_policy: "Processed threads are never fetched again unless you ask.",
        terms: "Public pages allowed by robots.txt. Only classified lines are kept locally, always linked to the original post.",
        via: None,
    },
    ProviderMeta {
        id: "ggg-news",
        name: "Official news feed (pathofexile.com)",
        reliability: Reliability::Official,
        games: BOTH,
        categories: &["announcements"],
        website: "https://www.pathofexile.com/news",
        endpoints: &["https://www.pathofexile.com/news/rss"],
        auth: "None",
        rate_limit: "No published limit. One request per check.",
        cache_policy: "Articles already seen are skipped.",
        terms: "Public RSS feed; titles and links only.",
        via: None,
    },
];

pub fn provider(id: &str) -> Option<&'static ProviderMeta> {
    PROVIDERS.iter().find(|p| p.id == id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DatasetKind {
    /// Stored, diffed, validated and versioned by the Update Center.
    Versioned,
    /// Kept by an existing engine with its own cache (prices, crafting data); the Update
    /// Center shows its state and can ask that engine to refresh, nothing more.
    Managed,
    /// Ships with the app (no verified structured source). Changes need an app release.
    Bundled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Policy {
    /// Applied automatically when validation passes and nothing needs review.
    Auto,
    /// Always waits for the user.
    Review,
}

/// Refresh groups (each has its own schedule).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Group {
    GameData,
    Leagues,
    PatchNotes,
    Market,
    Bundled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetDef {
    pub id: &'static str,
    pub game: GameId,
    pub label: &'static str,
    pub category: &'static str,
    pub provider_id: &'static str,
    pub kind: DatasetKind,
    pub policy: Policy,
    pub group: Group,
    /// Bump when the normalized entry shape changes; versions of another format can't be restored.
    pub format: u32,
    pub min_entries: usize,
    pub required_fields: &'static [&'static str],
    /// Field → change type; unlisted fields are `metadata_updated`.
    #[serde(skip)]
    pub field_rules: &'static [(&'static str, ChangeType)],
    /// Boolean field that marks an entry as deprecated (e.g. legacy cards).
    #[serde(skip)]
    pub deprecated_flag: Option<&'static str>,
    /// An entry missing from the source means it ended (leagues), not that it was deleted.
    #[serde(skip)]
    pub removal_is_deprecation: bool,
    pub description: &'static str,
}

const CARD_RULES: &[(&str, ChangeType)] = &[
    ("reward", ChangeType::DescriptionUpdated),
    ("rewardKind", ChangeType::Reclassified),
    ("stackSize", ChangeType::MetadataUpdated),
    ("dropLevel", ChangeType::MetadataUpdated),
];
const LEAGUE_RULES: &[(&str, ChangeType)] = &[("hardcore", ChangeType::Reclassified), ("indexed", ChangeType::MetadataUpdated)];

const fn versioned(
    id: &'static str,
    game: GameId,
    label: &'static str,
    category: &'static str,
    provider_id: &'static str,
    group: Group,
    min_entries: usize,
    required_fields: &'static [&'static str],
    field_rules: &'static [(&'static str, ChangeType)],
    description: &'static str,
) -> DatasetDef {
    DatasetDef {
        id,
        game,
        label,
        category,
        provider_id,
        kind: DatasetKind::Versioned,
        policy: Policy::Auto,
        group,
        format: 1,
        min_entries,
        required_fields,
        field_rules,
        deprecated_flag: None,
        removal_is_deprecation: false,
        description,
    }
}

const fn other(
    id: &'static str,
    game: GameId,
    label: &'static str,
    category: &'static str,
    provider_id: &'static str,
    kind: DatasetKind,
    group: Group,
    description: &'static str,
) -> DatasetDef {
    DatasetDef {
        id,
        game,
        label,
        category,
        provider_id,
        kind,
        policy: Policy::Review,
        group,
        format: 0,
        min_entries: 0,
        required_fields: &[],
        field_rules: &[],
        deprecated_flag: None,
        removal_is_deprecation: false,
        description,
    }
}

pub const DATASETS: &[DatasetDef] = &[
    DatasetDef {
        deprecated_flag: Some("legacy"),
        ..versioned(
            "poe1.divination-cards",
            GameId::Poe1,
            "Divination Cards",
            "divination-cards",
            "repoe-poe1",
            Group::GameData,
            300,
            &["reward", "rewardKind", "legacy"],
            CARD_RULES,
            "Card names, stack sizes and rewards from the game files (RePoE base_items).",
        )
    },
    DatasetDef {
        removal_is_deprecation: true,
        ..versioned("poe1.leagues", GameId::Poe1, "Leagues", "leagues", "poe-ninja", Group::Leagues, 1, &["hardcore", "indexed"], LEAGUE_RULES, "Economy leagues in the poe.ninja league index.")
    },
    DatasetDef {
        removal_is_deprecation: true,
        ..versioned("poe2.leagues", GameId::Poe2, "Leagues", "leagues", "poe-ninja", Group::Leagues, 1, &["hardcore", "indexed"], LEAGUE_RULES, "Economy leagues in the poe.ninja league index.")
    },
    other("poe1.market-prices", GameId::Poe1, "Market prices", "market-prices", "poe-ninja", DatasetKind::Managed, Group::Market, "Live prices per league and category, refreshed by the Market engine while a view needs them."),
    other("poe2.market-prices", GameId::Poe2, "Market prices", "market-prices", "poe-ninja", DatasetKind::Managed, Group::Market, "Live prices per league and category, refreshed by the Market engine while a view needs them."),
    other("poe1.crafting-data", GameId::Poe1, "Crafting data", "crafting-data", "repoe-poe1", DatasetKind::Managed, Group::GameData, "Modifiers, bases, fossils, essences and bench crafts (RePoE), kept by the Crafting service."),
    other("poe1.ultimatum-modifiers", GameId::Poe1, "Ultimatum modifiers", "ultimatum-modifiers", "bundled", DatasetKind::Bundled, Group::Bundled, "Names and tiers of the UltimatumModifiers table (poedb, game files). RePoE doesn't export it, so it ships with the app."),
    other("poe1.campaign", GameId::Poe1, "Campaign (Acts 1–10)", "campaign", "bundled", DatasetKind::Bundled, Group::Bundled, "Areas, connections, waypoints and quest rewards, verified by hand and shipped with the app."),
    other("poe2.campaign", GameId::Poe2, "Campaign (0.5.5)", "campaign", "bundled", DatasetKind::Bundled, Group::Bundled, "Areas, objectives and permanent rewards for 0.5.5, verified by hand and shipped with the app."),
];

pub fn dataset(id: &str) -> Option<&'static DatasetDef> {
    DATASETS.iter().find(|d| d.id == id)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleRegistration {
    pub module_id: &'static str,
    pub game: GameId,
    pub required: &'static [&'static str],
    pub optional: &'static [&'static str],
    /// The module accepts validated automatic updates of its datasets.
    pub auto_update: bool,
    /// Changes to the module's data need the user's review (or a developer).
    pub manual_review: bool,
    pub note: &'static str,
}

const fn reg(
    module_id: &'static str,
    game: GameId,
    required: &'static [&'static str],
    optional: &'static [&'static str],
    auto_update: bool,
    note: &'static str,
) -> ModuleRegistration {
    ModuleRegistration { module_id, game, required, optional, auto_update, manual_review: !auto_update, note }
}

/// Real data dependencies, audited per module (docs/modules/update-center.md).
pub const MODULES: &[ModuleRegistration] = &[
    reg("deck-intelligence", GameId::Poe1, &["poe1.divination-cards"], &["poe1.market-prices"], true, "Card list from the Update Center; prices from the Market engine. Finished sessions keep their original valuation."),
    reg("currency", GameId::Poe1, &["poe1.market-prices"], &["poe1.leagues"], true, "Reads the Market engine; league from the league index."),
    reg("currency", GameId::Poe2, &["poe2.market-prices"], &["poe2.leagues"], true, "Reads the Market engine; league from the league index."),
    reg("market-intelligence", GameId::Poe1, &["poe1.market-prices"], &["poe1.leagues"], true, "Trends from cached prices and local history."),
    reg("market-intelligence", GameId::Poe2, &["poe2.market-prices"], &["poe2.leagues"], true, "Trends from cached prices and local history."),
    reg("dashboard", GameId::Poe1, &["poe1.market-prices"], &["poe1.leagues"], true, ""),
    reg("dashboard", GameId::Poe2, &["poe2.market-prices"], &["poe2.leagues"], true, ""),
    reg("price-checker", GameId::Poe1, &["poe1.market-prices"], &["poe1.leagues"], true, "Live listings come from the official Trade API, not from datasets."),
    reg("price-checker", GameId::Poe2, &["poe2.market-prices"], &["poe2.leagues"], true, "Live listings come from the official Trade API, not from datasets."),
    reg("trade", GameId::Poe1, &["poe1.leagues"], &[], true, ""),
    reg("trade", GameId::Poe2, &["poe2.leagues"], &[], true, ""),
    reg("crafting", GameId::Poe1, &["poe1.crafting-data", "poe1.market-prices"], &[], true, "Crafting service keeps its own RePoE cache; the Update Center can refresh it."),
    reg("regex", GameId::Poe1, &["poe1.crafting-data"], &[], true, ""),
    reg("loot-intelligence", GameId::Poe1, &["poe1.market-prices"], &[], true, ""),
    reg("ultimatum-checker", GameId::Poe1, &["poe1.ultimatum-modifiers"], &["poe1.market-prices"], false, "Modifier list is bundled; new or removed modifiers need an app update."),
    reg("location-atlas", GameId::Poe1, &["poe1.campaign"], &[], false, "Campaign data is bundled; changes need an app update."),
    reg("act-tracker", GameId::Poe1, &["poe1.campaign"], &[], false, "Campaign data is bundled; changes need an app update."),
    reg("campaign-intelligence", GameId::Poe2, &["poe2.campaign"], &[], false, "Campaign data is bundled; changes need an app update."),
    reg("loot-journal", GameId::Poe2, &[], &["poe2.market-prices"], true, "Captured items are valued from the Market engine."),
];

/// Modules that read a dataset (required or optional).
pub fn consumers(dataset_id: &str) -> Vec<&'static str> {
    let mut v: Vec<&'static str> = MODULES
        .iter()
        .filter(|m| m.required.contains(&dataset_id) || m.optional.contains(&dataset_id))
        .map(|m| m.module_id)
        .collect();
    v.dedup();
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registrations_reference_known_datasets_of_the_same_game() {
        for m in MODULES {
            for d in m.required.iter().chain(m.optional) {
                let def = dataset(d).unwrap_or_else(|| panic!("{} uses unknown dataset {d}", m.module_id));
                assert_eq!(def.game, m.game, "{} ({}) must not depend on {d}", m.module_id, m.game);
            }
        }
    }

    #[test]
    fn datasets_reference_known_providers_and_unique_ids() {
        let mut ids = std::collections::HashSet::new();
        for d in DATASETS {
            assert!(ids.insert(d.id), "duplicate dataset {}", d.id);
            assert!(d.id.starts_with(d.game.as_str()), "{} must be prefixed with its game", d.id);
            if d.kind != DatasetKind::Bundled {
                let p = provider(d.provider_id).unwrap_or_else(|| panic!("{} has unknown provider", d.id));
                assert!(p.games.contains(&d.game));
            }
        }
    }

    #[test]
    fn consumers_follow_registrations() {
        assert_eq!(consumers("poe1.divination-cards"), vec!["deck-intelligence"]);
        assert!(consumers("poe2.leagues").contains(&"trade"));
        assert!(!consumers("poe2.leagues").contains(&"deck-intelligence"));
    }
}
