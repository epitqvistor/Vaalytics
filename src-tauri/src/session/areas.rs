//! Conservative area classification from the internal area id in
//! `Generating level … area "<id>"`. Rules come from the ids seen in a real
//! PoE 2 log (see docs/modules/session-intelligence.md); anything that doesn't
//! match a rule is `Unknown`, never guessed. Only `Map*` areas count as maps.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AreaKind {
    Hideout,
    Town,
    Map,
    Campaign,
    /// League-mechanic areas outside maps (Abyss depths, Expedition logbooks,
    /// Ritual/Breach/Incursion/Sanctum/Delirium encounters…).
    Content,
    Unknown,
}

impl AreaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            AreaKind::Hideout => "hideout",
            AreaKind::Town => "town",
            AreaKind::Map => "map",
            AreaKind::Campaign => "campaign",
            AreaKind::Content => "content",
            AreaKind::Unknown => "unknown",
        }
    }
}

const CONTENT_PREFIXES: &[&str] = &[
    "Abyss_", "Expedition", "Ritual", "Breach", "Incursion", "Sanctum_", "Delirium_", "Chayula", "Trial",
];

/// `G1_4`, `G3_10_Airlock`, `P2_1` — campaign acts (G) and interludes (P).
fn is_campaign(id: &str) -> bool {
    let b = id.as_bytes();
    if b.len() < 3 || !(b[0] == b'G' || b[0] == b'P') {
        return false;
    }
    let digits = b[1..].iter().take_while(|c| c.is_ascii_digit()).count();
    digits > 0 && b.get(1 + digits) == Some(&b'_')
}

pub fn classify(area_id: &str) -> AreaKind {
    if area_id.starts_with("Hideout") {
        return AreaKind::Hideout;
    }
    // G1_town … G4_town, P1_Town … P3_Town, G_Endgame_Town (the Ziggurat Refuge).
    if area_id.to_ascii_lowercase().ends_with("_town") {
        return AreaKind::Town;
    }
    if area_id.starts_with("Map") && area_id.len() > 3 {
        return AreaKind::Map;
    }
    if is_campaign(area_id) {
        return AreaKind::Campaign;
    }
    if CONTENT_PREFIXES.iter().any(|p| area_id.starts_with(p)) {
        return AreaKind::Content;
    }
    AreaKind::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_ids_seen_in_real_logs() {
        for id in ["HideoutShrine", "HideoutLimestone", "HideoutArenaKulemak"] {
            assert_eq!(classify(id), AreaKind::Hideout, "{id}");
        }
        for id in ["G1_town", "G2_town", "G4_town", "P1_Town", "P3_Town", "G_Endgame_Town"] {
            assert_eq!(classify(id), AreaKind::Town, "{id}");
        }
        for id in ["MapRazedFields", "MapVaalFactory", "MapUberBoss_Ritual"] {
            assert_eq!(classify(id), AreaKind::Map, "{id}");
        }
        for id in ["G1_4", "G3_10_Airlock", "G4_11_1b", "P2_1", "G2_3a"] {
            assert_eq!(classify(id), AreaKind::Campaign, "{id}");
        }
        for id in ["Abyss_Depths1", "ExpeditionLogBook_Wastes", "RitualLeagueBoss", "BreachDomain_01", "IncursionTemple", "Sanctum_4_Foyer_1", "Delirium_Act1Town", "ChayulaLeague"] {
            assert_eq!(classify(id), AreaKind::Content, "{id}");
        }
    }

    #[test]
    fn town_and_hideout_are_never_maps_and_unknown_stays_unknown() {
        assert_eq!(classify("Delirium_Act1Town"), AreaKind::Content, "not a real town");
        assert_eq!(classify("Map"), AreaKind::Unknown);
        assert_eq!(classify("SomethingNew"), AreaKind::Unknown);
        assert_eq!(classify("G_Something"), AreaKind::Unknown);
    }
}
