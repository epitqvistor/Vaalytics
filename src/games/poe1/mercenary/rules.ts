/**
 * Family-specific value rules (PoE 1, 3.30 · Covens). Rules never turn into prices: a price
 * always comes from comparable listings. Rules decide (a) which skill group carries the value
 * and is searched bound to its supports, (b) which other skills must match or be excluded in the
 * comparable search, and (c) which explanations and premium conditions apply.
 *
 * Every rule cites evidence. Survey numbers (n, top-share, medians) are from the PoEMercPricer
 * 3.30 survey of official Trade asks (2026-11-18, league day 5, MIT, docs/market-3.30.md) —
 * asking prices, not sales. "Observation" evidence is from Vaalytics' own live searches.
 * Negative rules carry a reason, observations, confidence, patch and review date; an old rule
 * that a newer measurement contradicts is kept as `contradicted` (shown, never applied).
 * Spec: docs/mercenary-intelligence/SCORING_EVIDENCE.md
 */

export const RULES_VERSION = "3.30-r1";
export const RULES_PATCH = "3.30.0";
export const RULES_REVIEW_BY = "2026-12-10";

export type EvidenceKind = "survey" | "observation" | "patch-note" | "mechanic" | "opinion";

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  source: string;
  url?: string;
  date: string;
  /** Sample size behind the claim (asks), when there is one. */
  n?: number;
  text: string;
}

export interface SupportGate {
  support: string;
  /** Lowest tier that counts. */
  minTier: 1 | 2 | 3;
}

export interface ValuePackage {
  skill: string;
  /** Supports on that skill that carry value; searched bound to the skill. */
  gates: SupportGate[];
  evidence: string[];
}

export type RuleStatus = "active" | "unverified" | "contradicted";

export interface SkillRule {
  id: string;
  skill: string;
  effect: "positive" | "negative";
  status: RuleStatus;
  /** Only meaningful next to this skill (e.g. Spectral Helix beside Frost Blades). */
  context?: string;
  reason: string;
  /** "market" (measured in asks) or "mechanical" (how the skill behaves). */
  basis: "market" | "mechanical";
  confidence: "high" | "medium" | "low";
  evidence: string[];
  patch: string;
  reviewBy: string;
}

export interface PremiumRule {
  /** Every condition must hold, and the comparable evidence must back it, for "Premium". */
  package: ValuePackage;
  partners: string[];
  withoutNegatives: boolean;
  evidence: string[];
}

export type FamilyTier = "premium" | "high" | "mid" | "floor" | "no-data";

export interface FamilyRules {
  family: string;
  tier: FamilyTier;
  tierEvidence: string;
  /** Ordered: the first package present on the warrant is the value carrier. */
  packages: ValuePackage[];
  skills: SkillRule[];
  premium: PremiumRule | null;
  note?: string;
}

const PMP = "PoEMercPricer 3.30 market survey (asks, Covens day 5)";
const PMP_URL = "https://github.com/Lisood/PoEMercPricer/blob/main/docs/market-3.30.md";
const S = (id: string, text: string, n?: number): Evidence => ({ id, kind: "survey", source: PMP, url: PMP_URL, date: "2026-11-18", n, text });

export const EVIDENCE: Evidence[] = [
  S("pmp-tier", "Family tier from the median of each warrant type's 50 dearest asks: premium ≥ 50 div, high 15–50, mid 5–15, floor < 5."),
  S("pmp-kin-kboc", "Kineticist: KBoC present 200 div median of top asks (top-share 0.93) vs absent 3c (0.31).", 108),
  S("pmp-kin-pack", "Kineticist: KBoC with Return T3 + GMP T3: median 200 div, top-share 1.00.", 22),
  S("pmp-kin-bolt", "Kineticist: KBoC + Kinetic Bolt: 150 div median, top-share 0.79 — undecided, below the 0.85 bar.", 19),
  S("pmp-kin-gkb", "Kineticist: with / without Greater Kinetic Blast both 200 div, n = 7 each — too thin.", 14),
  S("pmp-many-vis", "Manyshot: Vaal Ice Shot present 200 div (0.97) vs absent 5c (0.38).", 140),
  S("pmp-many-pack", "Manyshot: VIS with Return + Mirror Arrow: 200 div median, top-share 1.00.", 40),
  S("pmp-many-icicle", "Manyshot: VIS + Icicle Rain 175 div, top-share 0.88 — the old −40 penalty is contradicted.", 16),
  S("pmp-comb-core", "Combatant: Frost Blades + Static Strike without Spectral Helix: 100 div, top-share 1.00.", 51),
  S("pmp-comb-pack", "Combatant: FB with Return T3 + Chain T2+ + EDWA: 150 div, top-share 1.00.", 12),
  S("pmp-comb-helix", "Combatant: Spectral Helix beside Frost Blades 5c (0.47), beside Wild Strike 3c (0.25).", 37),
  S("pmp-comb-wild", "Combatant: Frost Blades + Wild Strike 100 div (0.87) — old penalty contradicted.", 23),
  S("pmp-chap", "Chaplain of the Well: Abyssal Spray with Return + Faster Casting: 300 div median, top-share 0.94; GMP on Abyssal Spray not priced (0.68).", 18),
  S("pmp-cruel", "Cruel Mistress: Soulrend of Reaping with GMP + Return: 50 div, top-share 1.00.", 20),
  S("pmp-thunder", "Thunderquiver: Return on Lightning Arrow 100 div (0.86); Wrath 0.92; Galvanic Arrow undecided (0.64).", 70),
  S("pmp-sniper", "Sniper: Arrow Nova on Tornado Shot 50 div, top-share 0.97; Brutality on TS 0.74 (undecided).", 64),
  S("pmp-stormhand", "Stormhand: Arc + Ball Lightning of Static 10 div, top-share 1.00; Lucky Lightning Damage on Arc 0.93.", 28),
  S("pmp-swift", "Swiftblade: Rallying Cry with CDR + More Duration 30 div, top-share 1.00.", 33),
  S("pmp-smoulder", "Smoulderstrike: Infernal Cry with AoE + More Duration (screen kept from 3.29).", 25),
  S("pmp-bastion", "Bastion: Impenetrable Bastion 10c (0.32, brick); Prismplate 10.5 div (0.96).", 97),
  S("pmp-reverend", "Fallen Reverend: Frostblink 40c (0.47) against 7.5 div — brick; Battlemage's Cry 0.62 (undecided).", 40),
  S("pmp-bladeamb", "Blade Ambusher: Bear Trap with Trigger Radius (money skill 15 div, 0.75).", 53),
  S("pmp-generic", "No skill or support separates the top asks from the bottom ones in this family (generic, no screen)."),
  {
    id: "obs-kin-bolt-count",
    kind: "observation",
    source: "Vaalytics live Trade searches (Covens, securable)",
    url: "https://www.pathofexile.com/trade/search/Covens",
    date: "2026-11-26",
    n: 309,
    text: "KBoC + Return T3 + GMP T3 (normal Kineticist): 309 listings; 221 without Kinetic Bolt, so 88 carry it. The two cheapest (100c, 120c) both carry Kinetic Bolt.",
  },
  {
    id: "obs-kin-bolt-cmp",
    kind: "observation",
    source: "Vaalytics controlled comparison (Covens, securable, level 83+)",
    url: "https://www.pathofexile.com/trade/search/Covens",
    date: "2026-11-26",
    n: 40,
    text: "KBoC + Return T3 + GMP T3 (normal): with Kinetic Bolt 97 listings, lowest 20 asks median 1 div; without it 209 listings, median 10 div (p25 10 div).",
  },
  {
    id: "obs-many-icicle-cmp",
    kind: "observation",
    source: "Vaalytics controlled comparison (Covens, securable, level 83+)",
    url: "https://www.pathofexile.com/trade/search/Covens",
    date: "2026-11-26",
    n: 40,
    text: "Vaal Ice Shot + Return T3 (normal): with Icicle Rain 925 listings, lowest 20 asks median 12c; without it 664 listings, median 5 div. Conflicts with the survey's dearest-asks view.",
  },
  {
    id: "obs-comb-helix-cmp",
    kind: "observation",
    source: "Vaalytics controlled comparison (Covens, securable, level 83+)",
    url: "https://www.pathofexile.com/trade/search/Covens",
    date: "2026-11-26",
    n: 40,
    text: "Frost Blades + Return T3 (normal): with Spectral Helix 455 listings, lowest 20 asks median 6c; without 1,320 listings, median 10c — both ends cheap; supports the downside weakly.",
  },
  {
    id: "patch-330-merc",
    kind: "patch-note",
    source: "Path of Exile 3.30.0 patch notes",
    url: "https://www.pathofexile.com/forum/view-thread/4013680",
    date: "2026-11-11",
    text: "Hired mercenaries: up to 20% less attack damage at level 83, lower damage reduction scaling, more life; −30% / −60% resistances in 46–67 / 68+ areas. Kinetic Blast: 150% Arcane Might. KBoC secondary radius bug fixed.",
  },
  {
    id: "op-aoeah-329",
    kind: "opinion",
    source: "aoeah.com 3.29 mercenary tier list (community opinion, 3.29 — outdated)",
    url: "https://www.aoeah.com/news/4710--poe-329-best-mercenary-tier-list-locations--how-to-farm",
    date: "2026-07-27",
    text: "Calls Kinetic Bolt on Kineticist a downside (AI behaviour), Icicle Rain on Manyshot bad. Opinion, not price.",
  },
];

export const evidenceById = new Map(EVIDENCE.map((e) => [e.id, e]));

const P = (skill: string, gates: [string, 1 | 2 | 3][], evidence: string[]): ValuePackage => ({ skill, gates: gates.map(([support, minTier]) => ({ support, minTier })), evidence });
const NEG = (id: string, skill: string, status: RuleStatus, reason: string, evidence: string[], confidence: SkillRule["confidence"], context?: string): SkillRule => ({
  id,
  skill,
  effect: "negative",
  status,
  context,
  reason,
  basis: "market",
  confidence,
  evidence,
  patch: RULES_PATCH,
  reviewBy: RULES_REVIEW_BY,
});
const POS = (id: string, skill: string, reason: string, evidence: string[], confidence: SkillRule["confidence"]): SkillRule => ({
  id,
  skill,
  effect: "positive",
  status: "active",
  reason,
  basis: "market",
  confidence,
  evidence,
  patch: RULES_PATCH,
  reviewBy: RULES_REVIEW_BY,
});

const generic = (family: string, tier: FamilyTier, packages: ValuePackage[] = []): FamilyRules => ({
  family,
  tier,
  tierEvidence: "pmp-tier",
  packages,
  skills: [],
  premium: null,
  ...(packages.length ? {} : { note: "Generic family: no measured value package. Valued from the family baseline and similar warrants only." }),
});

export const FAMILY_RULES: FamilyRules[] = [
  {
    family: "kineticist",
    tier: "premium",
    tierEvidence: "pmp-tier",
    packages: [P("kinetic_blast_of_clustering", [["return", 3], ["multiple_projectiles", 3]], ["pmp-kin-kboc", "pmp-kin-pack"])],
    skills: [
      NEG(
        "kineticist.kinetic_bolt",
        "kinetic_bolt",
        "active",
        "With the same KBoC package, Kinetic Bolt warrants ask about a tenth (1 div vs 10 div, lowest asks, n = 20 each). The survey leaned the same way (0.79); community opinion blames AI skill choice.",
        ["obs-kin-bolt-cmp", "pmp-kin-bolt", "obs-kin-bolt-count", "op-aoeah-329"],
        "medium",
        "kinetic_blast_of_clustering",
      ),
      POS("kineticist.greater_kinetic_blast", "greater_kinetic_blast", "Part of the 3.29 jackpot gate; 3.30 data too thin to confirm (n = 7 each way).", ["pmp-kin-gkb"], "low"),
    ],
    premium: { package: P("kinetic_blast_of_clustering", [["return", 3], ["multiple_projectiles", 3]], ["pmp-kin-pack"]), partners: [], withoutNegatives: true, evidence: ["pmp-kin-pack"] },
  },
  {
    family: "manyshot",
    tier: "premium",
    tierEvidence: "pmp-tier",
    packages: [P("vaal_ice_shot", [["return", 2]], ["pmp-many-vis", "pmp-many-pack"])],
    skills: [
      POS("manyshot.mirror_arrow", "mirror_arrow", "Vaal Ice Shot + Mirror Arrow with Return on VIS is the measured top package.", ["pmp-many-pack"], "medium"),
      NEG(
        "manyshot.icicle_rain",
        "icicle_rain",
        "unverified",
        "Conflicting evidence: the survey's dearest asks (175 div, 0.88) say no penalty, but with the same VIS + Return package the cheapest asks are 12c with Icicle Rain vs 5 div without. Matched in searches; not used to block Premium.",
        ["obs-many-icicle-cmp", "pmp-many-icicle", "op-aoeah-329"],
        "low",
        "vaal_ice_shot",
      ),
    ],
    premium: { package: P("vaal_ice_shot", [["return", 2]], ["pmp-many-pack"]), partners: ["mirror_arrow"], withoutNegatives: true, evidence: ["pmp-many-pack"] },
  },
  {
    family: "combatant",
    tier: "premium",
    tierEvidence: "pmp-tier",
    packages: [P("frost_blades", [["return", 3], ["chain", 2], ["elemental_damage_with_attacks", 2]], ["pmp-comb-core", "pmp-comb-pack"])],
    skills: [
      POS("combatant.static_strike", "static_strike", "Frost Blades + Static Strike is the measured core (100 div, top-share 1.00).", ["pmp-comb-core"], "medium"),
      NEG("combatant.spectral_helix", "spectral_helix", "active", "Spectral Helix beside Frost Blades or Wild Strike sits at the bottom of the book (5c / 3c).", ["pmp-comb-helix", "obs-comb-helix-cmp"], "medium"),
      NEG("combatant.wild_strike", "wild_strike", "contradicted", "The 3.29 penalty for Wild Strike beside Frost Blades is contradicted (100 div, 0.87). Not applied.", ["pmp-comb-wild"], "low", "frost_blades"),
    ],
    premium: { package: P("frost_blades", [["return", 3], ["chain", 2], ["elemental_damage_with_attacks", 2]], ["pmp-comb-pack"]), partners: ["static_strike"], withoutNegatives: true, evidence: ["pmp-comb-pack"] },
  },
  {
    family: "chaplain_of_the_well",
    tier: "premium",
    tierEvidence: "pmp-tier",
    packages: [P("abyssal_spray", [["return", 2], ["faster_casting", 2]], ["pmp-chap"])],
    skills: [],
    premium: null,
    note: "Return + Faster Casting on Abyssal Spray reaches top-share 0.94 (below the 0.95 jackpot bar). Every Chaplain has the three Abyssal skills, so they carry no signal alone.",
  },
  {
    family: "cruel_mistress",
    tier: "premium",
    tierEvidence: "pmp-tier",
    packages: [P("soulrend_of_reaping", [["multiple_projectiles", 2], ["return", 2]], ["pmp-cruel"])],
    skills: [],
    premium: { package: P("soulrend_of_reaping", [["multiple_projectiles", 2], ["return", 2]], ["pmp-cruel"]), partners: [], withoutNegatives: true, evidence: ["pmp-cruel"] },
  },
  {
    family: "thunderquiver",
    tier: "premium",
    tierEvidence: "pmp-tier",
    packages: [P("lightning_arrow", [["return", 2]], ["pmp-thunder"])],
    skills: [
      POS("thunderquiver.wrath", "wrath", "Wrath beside Lightning Arrow sits in the top asks (0.92).", ["pmp-thunder"], "low"),
      NEG("thunderquiver.galvanic_arrow", "galvanic_arrow", "unverified", "Kept from 3.29; 3.30 survey undecided (0.64, 75 div).", ["pmp-thunder"], "low"),
    ],
    premium: null,
  },
  {
    family: "sniper",
    tier: "premium",
    tierEvidence: "pmp-tier",
    packages: [P("tornado_shot", [["arrow_nova", 3]], ["pmp-sniper"])],
    skills: [],
    premium: null,
    note: "Brutality on Tornado Shot: undecided (0.74); no penalty applied until re-measured.",
  },
  {
    family: "stormhand",
    tier: "mid",
    tierEvidence: "pmp-tier",
    packages: [P("arc", [["chain", 2]], ["pmp-stormhand"])],
    skills: [POS("stormhand.ball_lightning", "ball_lightning_of_static", "Arc + Ball Lightning of Static: top-share 1.00 at 10 div.", ["pmp-stormhand"], "low")],
    premium: null,
  },
  { ...generic("swiftblade", "high", [P("rallying_cry", [["cooldown_recovery", 2], ["more_duration", 2]], ["pmp-swift"])]) },
  { ...generic("smoulderstrike", "high", [P("infernal_cry", [["increased_area_of_effect", 2], ["more_duration", 2]], ["pmp-smoulder"])]) },
  { ...generic("blade_ambusher", "high", [P("bear_trap", [["trigger_radius", 2]], ["pmp-bladeamb"])]) },
  {
    ...generic("bastion", "mid", [P("prismplate", [], ["pmp-bastion"])]),
    skills: [NEG("bastion.impenetrable_bastion", "impenetrable_bastion", "active", "Impenetrable Bastion warrants sit at the bottom of the book (10c, top-share 0.32).", ["pmp-bastion"], "medium")],
  },
  {
    ...generic("fallen_reverend", "mid"),
    skills: [NEG("fallen_reverend.frostblink", "frostblink", "active", "Frostblink warrants ask ~40c against a 7.5 div family median (top-share 0.47).", ["pmp-reverend"], "medium")],
  },
  generic("withertouch", "high"),
  generic("bladebitter", "high"),
  generic("warpriest", "high"),
  generic("striker", "mid"),
  generic("toxicologist", "mid"),
  generic("shattersword", "mid"),
  generic("cardinal", "mid"),
  generic("shock_ambusher", "mid"),
  generic("bladecaster", "mid"),
  generic("bloodletter", "mid"),
  generic("flamequiver", "mid"),
  generic("flamehand", "mid"),
  generic("winter_deacon", "mid"),
  generic("storming_zealot", "mid"),
  generic("frosthand", "mid"),
  generic("frost_ambusher", "mid"),
  generic("sanguimancer", "mid"),
  generic("ripper", "mid"),
  generic("earthshaker", "floor"),
  generic("eruptor", "floor"),
  generic("flaming_charlatan", "floor"),
  generic("reanimator", "floor"),
  generic("mysterious_diver", "no-data"),
  generic("warpriest_of_the_ruckus", "no-data"),
];

export const rulesFor = (family: string | null) => FAMILY_RULES.find((r) => r.family === family) ?? null;

/** Rules that affect searches and explanations (contradicted ones are only shown). */
export const appliedSkillRules = (r: FamilyRules | null) => (r?.skills ?? []).filter((s) => s.status !== "contradicted");

// ---------- sample thresholds (configurable) ----------

export interface SampleThresholds {
  exploratory: number;
  limited: number;
  moderate: number;
  stronger: number;
}

/** <5 insufficient · 5–7 exploratory · 8–14 limited · 15–29 moderate · ≥30 stronger */
export const DEFAULT_THRESHOLDS: SampleThresholds = { exploratory: 5, limited: 8, moderate: 15, stronger: 30 };

export type SampleClass = "insufficient" | "exploratory" | "limited" | "moderate" | "stronger";

export function sampleClass(n: number, t: SampleThresholds = DEFAULT_THRESHOLDS): SampleClass {
  if (n >= t.stronger) return "stronger";
  if (n >= t.moderate) return "moderate";
  if (n >= t.limited) return "limited";
  if (n >= t.exploratory) return "exploratory";
  return "insufficient";
}

export function validThresholds(t: SampleThresholds): boolean {
  return [t.exploratory, t.limited, t.moderate, t.stronger].every((v) => Number.isInteger(v) && v >= 1 && v <= 1000) && t.exploratory < t.limited && t.limited < t.moderate && t.moderate < t.stronger;
}

// ---------- user-promoted rules ----------

/**
 * Rules the user promoted from staged candidates (controlled with/without comparisons, Research
 * tab). Bundled rules are never rewritten: promoted ones are added beside them, marked as yours,
 * per league, and only take part in search planning and explanations.
 */
export interface PromotedRule {
  candidateId: number;
  family: string;
  skill: string;
  effect: "positive" | "negative";
  title: string;
  n: number;
  reviewedAt: number | null;
}

let promoted: PromotedRule[] = [];
export const setPromotedRules = (rules: PromotedRule[]) => {
  promoted = rules;
};
export const promotedRules = () => promoted;

const baseRulesFor = rulesFor;
/** Bundled rules plus the user's promoted ones for that family. */
export function effectiveRules(family: string | null): FamilyRules | null {
  const base = baseRulesFor(family);
  const mine = promoted.filter((p) => p.family === family);
  if (!base || !mine.length) return base;
  return {
    ...base,
    skills: [
      ...base.skills.filter((s) => !mine.some((m) => m.skill === s.skill)),
      ...mine.map(
        (m): SkillRule => ({
          id: `promoted.${m.candidateId}`,
          skill: m.skill,
          effect: m.effect,
          status: "active",
          reason: `Your promoted rule: ${m.title} (n = ${m.n}).`,
          basis: "market",
          confidence: m.n >= DEFAULT_THRESHOLDS.moderate ? "medium" : "low",
          evidence: [],
          patch: RULES_PATCH,
          reviewBy: RULES_REVIEW_BY,
        }),
      ),
    ],
  };
}
