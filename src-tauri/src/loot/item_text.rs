//! Recognition and header parsing of Path of Exile 2 item text (Ctrl+C copy).
//!
//! The full parser lives in the frontend (`src/games/poe2/parser`, used by the
//! Price Checker and by Loot Journal's detail view, always re-run on the stored
//! raw text). This module only does what the background capture needs without
//! the UI: decide whether clipboard text is an item at all, read the header
//! (class, rarity, name, base type, item level, stack size, quality, flags),
//! assign a category and compute a fingerprint.
//!
//! Format (English client): line 1 `Item Class: <class>`, line 2
//! `Rarity: <Normal|Magic|Rare|Unique|Currency|Gem>`, then the name lines, then
//! sections separated by `--------`. Item classes follow the PoE 2 strings
//! listed by the open-source Exile UI client table (studied, not copied).

use serde::Serialize;

/// Larger text is not an item copy.
pub const MAX_ITEM_BYTES: usize = 16 * 1024;
const MAX_LINES: usize = 400;
const SEPARATOR: &str = "--------";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub item_class: String,
    pub rarity: String,
    /// Unique/rare name; None for items whose only name line is the base type.
    pub name: Option<String>,
    pub base_type: String,
    pub category: &'static str,
    pub item_level: Option<i64>,
    pub stack_size: Option<i64>,
    pub stack_max: Option<i64>,
    pub quality: Option<i64>,
    pub corrupted: bool,
    pub unidentified: bool,
    pub mirrored: bool,
    /// high = class, rarity and base type read and the class is known;
    /// medium = identity read but the class is unknown or a field is odd; low = identity incomplete.
    pub confidence: &'static str,
    pub warnings: Vec<String>,
}

const RARITIES: &[&str] = &["Normal", "Magic", "Rare", "Unique", "Currency", "Gem"];

/// Item classes → category. Unknown classes stay `other` (and lower confidence).
fn class_category(class: &str) -> Option<&'static str> {
    const WEAPONS: &[&str] = &[
        "Claws", "Daggers", "Wands", "One Hand Swords", "One Hand Axes", "One Hand Maces", "Sceptres", "Spears", "Flails", "Bows", "Staves",
        "Two Hand Swords", "Two Hand Axes", "Two Hand Maces", "Quarterstaves", "Crossbows", "Traps",
    ];
    const ARMOUR: &[&str] = &["Gloves", "Boots", "Body Armours", "Helmets", "Shields", "Bucklers", "Foci", "Quivers"];
    const ACCESSORIES: &[&str] = &["Amulets", "Rings", "Belts"];
    const FLASKS: &[&str] = &["Life Flasks", "Mana Flasks", "Charms"];
    Some(match class {
        c if WEAPONS.contains(&c) => "weapon",
        c if ARMOUR.contains(&c) => "armour",
        c if ACCESSORIES.contains(&c) => "accessory",
        c if FLASKS.contains(&c) => "flask",
        "Jewels" => "jewel",
        "Socketable" => "socketable",
        "Relics" => "relic",
        "Support Gems" => "support_gem",
        "Skill Gems" => "skill_gem",
        "Stackable Currency" => "currency",
        c if c.contains("Waystone") => "waystone",
        c if c.contains("Tablet") => "tablet",
        c if c.contains("Omen") => "omen",
        c if c.contains("Gem") => "skill_gem",
        c if c.contains("Currency") => "currency",
        c if c.contains("Fragment") || c.contains("Splinter") => "fragment",
        _ => return None,
    })
}

/// Quick rejection without allocating: must start like an item copy.
pub fn looks_like_item(text: &str) -> bool {
    let t = text.trim_start_matches('\u{feff}');
    t.len() <= MAX_ITEM_BYTES && t.starts_with("Item Class: ") && t.contains("\nRarity: ")
}

fn num(s: &str) -> Option<i64> {
    let digits: String = s.chars().filter(|c| !matches!(c, ',' | '.' | ' ' | '\u{a0}')).collect();
    (!digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())).then(|| digits.parse().ok()).flatten()
}

/// Parses the header of an item copy. `None` = not a PoE item copy.
pub fn parse_header(text: &str) -> Option<Header> {
    if !looks_like_item(text) {
        return None;
    }
    let lines: Vec<&str> = text.trim_start_matches('\u{feff}').lines().map(|l| l.trim_end_matches('\r').trim()).collect();
    if lines.len() > MAX_LINES || lines.len() < 3 {
        return None;
    }
    let item_class = lines[0].strip_prefix("Item Class: ")?.trim().to_string();
    let rarity = lines.get(1)?.strip_prefix("Rarity: ")?.trim().to_string();
    if item_class.is_empty() || rarity.is_empty() || item_class.len() > 64 || rarity.len() > 32 {
        return None;
    }
    let mut warnings = Vec::new();
    // Name lines: after Rarity, up to the first separator (1 = base only, 2 = name + base).
    let name_lines: Vec<&str> = lines[2..].iter().take_while(|l| **l != SEPARATOR).copied().filter(|l| !l.is_empty()).collect();
    if !lines.contains(&SEPARATOR) {
        warnings.push("No section separators — the copy may be incomplete.".to_string());
    }
    let (name, base_type) = match name_lines.as_slice() {
        [base] => (None, base.to_string()),
        [name, base] => (Some(name.to_string()), base.to_string()),
        [] => return None,
        [first, .., last] => {
            warnings.push(format!("{} name lines; the last one is used as the base type.", name_lines.len()));
            (Some(first.to_string()), last.to_string())
        }
    };
    if base_type.len() > 120 {
        return None;
    }
    let mut h = Header {
        category: "other",
        item_level: None,
        stack_size: None,
        stack_max: None,
        quality: None,
        corrupted: false,
        unidentified: false,
        mirrored: false,
        confidence: "high",
        warnings,
        item_class,
        rarity,
        name,
        base_type,
    };
    for l in &lines[2..] {
        if let Some(v) = l.strip_prefix("Item Level: ") {
            h.item_level = num(v);
        } else if let Some(v) = l.strip_prefix("Stack Size: ") {
            let (a, b) = v.split_once('/').map(|(a, b)| (a, Some(b))).unwrap_or((v, None));
            h.stack_size = num(a);
            h.stack_max = b.and_then(num);
            if h.stack_size.is_none() {
                h.warnings.push(format!("Unreadable stack size: {v}"));
            }
        } else if let Some(v) = l.strip_prefix("Quality: ") {
            let digits: String = v.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
            h.quality = digits.parse().ok();
        } else {
            match *l {
                "Corrupted" | "Twice Corrupted" => h.corrupted = true,
                "Unidentified" => h.unidentified = true,
                "Mirrored" => h.mirrored = true,
                _ => {}
            }
        }
    }
    let known_rarity = RARITIES.contains(&h.rarity.as_str());
    h.category = match (class_category(&h.item_class), h.rarity.as_str()) {
        (Some("skill_gem"), _) if h.item_class.contains("Support") => "support_gem",
        (Some(c), "Unique") if matches!(c, "weapon" | "armour" | "accessory" | "flask" | "jewel" | "relic" | "tablet") => "unique",
        (Some(c), _) => c,
        (None, "Gem") => "skill_gem",
        (None, "Currency") => "currency",
        (None, "Unique") => "unique",
        (None, _) => "other",
    };
    if class_category(&h.item_class).is_none() {
        h.confidence = "medium";
        h.warnings.push(format!("Unknown item class \"{}\".", h.item_class));
    }
    if !known_rarity {
        h.confidence = "medium";
        h.warnings.push(format!("Unknown rarity \"{}\".", h.rarity));
    }
    if matches!(h.rarity.as_str(), "Rare" | "Unique") && h.name.is_none() && !h.unidentified {
        h.confidence = "low";
        h.warnings.push("A rare/unique item without a name line.".to_string());
    }
    Some(h)
}

/// Text normalised for fingerprinting: no BOM/CR, trimmed lines, no trailing
/// blank lines and no `Note:` lines (a price note doesn't make a different item).
pub fn normalize(text: &str) -> String {
    let mut lines: Vec<&str> = text.trim_start_matches('\u{feff}').lines().map(|l| l.trim_end_matches('\r').trim()).filter(|l| !l.starts_with("Note: ")).collect();
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    lines.join("\n")
}

/// Stable fingerprint of the full normalised text: identical copies match,
/// any differing property (a mod roll, stack size, quality…) gives a new one.
pub fn fingerprint(text: &str) -> String {
    let n = normalize(text);
    let mut h: u64 = 0xcbf29ce484222325;
    for b in n.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}-{:x}", n.len())
}

#[cfg(test)]
pub mod samples {
    //! Item copies in the PoE 2 format. The currency and rare samples follow
    //! the structure used by the Price Checker fixtures; replace with in-game
    //! captures as they become available (see docs/modules/loot-journal.md).
    pub const CURRENCY: &str = "Item Class: Stackable Currency\nRarity: Currency\nExalted Orb\n--------\nStack Size: 3/20\n--------\nAugments a Rare item with a new random modifier\n--------\nRight click this item then left click a rare item to apply it.\n";
    pub const RARE: &str = "Item Class: Rings\r\nRarity: Rare\r\nSample Coil\r\nSapphire Ring\r\n--------\r\nRequires: Level 52, 40 Int\r\n--------\r\nItem Level: 79\r\n--------\r\n+22% to Cold Resistance (implicit)\r\n--------\r\n+89 to maximum Life\r\n+24 to Intelligence\r\n--------\r\nCorrupted\r\n";
    pub const UNIQUE: &str = "Item Class: Body Armours\nRarity: Unique\nSample Mantle\nVile Robe\n--------\nQuality: +20% (augmented)\nEnergy Shield: 210 (augmented)\n--------\nRequires: Level 65, 121 Int\n--------\nItem Level: 81\n--------\n+120 to maximum Energy Shield\n--------\nFlavour text line\n";
    pub const WAYSTONE: &str = "Item Class: Waystones\nRarity: Magic\nAbundant Waystone (Tier 15)\n--------\nWaystone Tier: 15\n--------\nItem Level: 79\n--------\n+20% increased Quantity of Items found in this Area\n--------\nCan be used in a Map Device, allowing you to enter a Map.\n";
    pub const GEM: &str = "Item Class: Support Gems\nRarity: Gem\nSample Support\n--------\nLevel: 1\n--------\nRequires: Level 1\n--------\nSupports skills.\n";
    pub const RUNE: &str = "Item Class: Socketable\nRarity: Currency\nGreater Iron Rune\n--------\nStack Size: 1/10\n--------\nMartial Weapons: 20% increased Physical Damage\n";
}

#[cfg(test)]
mod tests {
    use super::samples::*;
    use super::*;

    #[test]
    fn recognises_and_categorises_item_copies() {
        let c = parse_header(CURRENCY).unwrap();
        assert_eq!((c.category, c.base_type.as_str(), c.stack_size, c.stack_max, c.confidence), ("currency", "Exalted Orb", Some(3), Some(20), "high"));
        let r = parse_header(RARE).unwrap();
        assert_eq!((r.category, r.name.as_deref(), r.base_type.as_str(), r.item_level, r.corrupted), ("accessory", Some("Sample Coil"), "Sapphire Ring", Some(79), true));
        let u = parse_header(UNIQUE).unwrap();
        assert_eq!((u.category, u.quality), ("unique", Some(20)));
        assert_eq!(parse_header(WAYSTONE).unwrap().category, "waystone");
        assert_eq!(parse_header(GEM).unwrap().category, "support_gem");
        assert_eq!(parse_header(RUNE).unwrap().category, "socketable");
    }

    #[test]
    fn rejects_unrelated_clipboard_text() {
        for t in [
            "",
            "hunter2",
            "https://pathofexile.com/trade/search/abc",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
            "Item Class: but no rarity line",
            "Some text\nItem Class: Rings\nRarity: Rare\nX\n--------\n",
            "Item Class: Rings\nRarity: Rare\n",
        ] {
            assert!(parse_header(t).is_none(), "{t:?}");
        }
        let huge = format!("Item Class: Rings\nRarity: Rare\nA\nB\n--------\n{}", "x".repeat(MAX_ITEM_BYTES));
        assert!(parse_header(&huge).is_none());
    }

    #[test]
    fn unknown_classes_and_missing_fields_are_kept_with_warnings() {
        let t = "Item Class: Brand New Things\nRarity: Normal\nOdd Trinket\n--------\nSomething unknown: 5\n";
        let h = parse_header(t).unwrap();
        assert_eq!((h.category, h.confidence), ("other", "medium"));
        assert!(h.warnings[0].contains("Unknown item class"));
        assert_eq!(h.item_level, None);
        let no_sep = "Item Class: Rings\nRarity: Magic\nSapphire Ring of Sample\n";
        assert!(parse_header(no_sep).unwrap().warnings.iter().any(|w| w.contains("separators")));
    }

    #[test]
    fn fingerprints_ignore_line_endings_and_notes_but_not_properties() {
        let crlf = CURRENCY.replace('\n', "\r\n");
        assert_eq!(fingerprint(CURRENCY), fingerprint(&crlf));
        assert_eq!(fingerprint(CURRENCY), fingerprint(&format!("{CURRENCY}Note: ~price 1 exalted\n\n")));
        assert_ne!(fingerprint(CURRENCY), fingerprint(&CURRENCY.replace("3/20", "4/20")), "different stack");
        assert_ne!(fingerprint(RARE), fingerprint(&RARE.replace("+89", "+90")), "different roll");
    }

    #[test]
    fn stack_sizes_with_separators() {
        let t = CURRENCY.replace("3/20", "1,234/5,000");
        let h = parse_header(&t).unwrap();
        assert_eq!((h.stack_size, h.stack_max), (Some(1234), Some(5000)));
    }
}
