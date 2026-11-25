/**
 * Ultimatum trial modifiers (PoE 1) — names and tiers of the game's
 * `UltimatumModifiers` table, as listed by poedb.tw (extracted from the game
 * files). RePoE does not export this table. Only names and tiers are stored;
 * descriptions come from the game itself (the text of an Inscribed Ultimatum).
 *
 * `kind` groups modifiers by what the game text says they do:
 * - "penalty": makes the trial harder (the ones you rate for your build),
 * - "bonus":   benefits the player or the loot (Harsh Lessons, Splintershot…),
 * - "boss":    The Trialmaster encounter.
 *
 * Spec: docs/modules/ultimatum-checker.md
 */
export type ModifierKind = "penalty" | "bonus" | "boss";

export interface ModifierFamily {
  /** Family name = tier 1 name without a roman suffix, e.g. "Ruin". */
  family: string;
  kind: ModifierKind;
  /** Display names by tier (index 0 = tier 1), exactly as in the game. */
  tiers: string[];
}

export const MODIFIER_SOURCE = {
  source: "poedb.tw (UltimatumModifiers, game files)",
  read: "2026-11-25",
  count: 104,
} as const;

const p = (family: string, tiers: string[] = [family]): ModifierFamily => ({
  family,
  kind: "penalty",
  tiers,
});
const b = (family: string, tiers: string[]): ModifierFamily => ({
  family,
  kind: "bonus",
  tiers,
});
const roman = (base: string, n: number, firstPlain = true) =>
  ["I", "II", "III", "IV"].slice(0, n).map((r, i) => (i === 0 && firstPlain ? base : `${base} ${r}`));

export const MODIFIER_FAMILIES: ModifierFamily[] = [
  // Hazards with four tiers
  p("Choking Miasma", roman("Choking Miasma", 4)),
  p("Stormcaller Runes", roman("Stormcaller Runes", 4)),
  p("Raging Dead", roman("Raging Dead", 4)),
  p("Blistering Cold", roman("Blistering Cold", 4)),
  // Two variants in the game (Zombies / Phantasms) share these display names.
  p("Restless Ground", roman("Restless Ground", 4)),
  p("Stalking Ruin", roman("Stalking Ruin", 4)),
  p("Razor Dance", roman("Razor Dance", 4)),
  p("Quicksand", roman("Quicksand", 4, false)),
  p("Ruin", roman("Ruin", 4)),
  p("Blood Altar", roman("Blood Altar", 2)),
  p("Reduced Recovery", roman("Reduced Recovery", 2)),
  // Single-tier
  p("Totem of Costly Might"),
  p("Totem of Costly Potency"),
  p("Limited Arena"),
  p("Lessened Reach"),
  p("Buffs Expire Faster"),
  p("Less Cooldown Recovery"),
  p("Escalating Damage Taken"),
  p("Escalating Monster Speed"),
  p("Profane Monsters"),
  p("Unlucky Criticals"),
  p("Hindering Flasks"),
  p("Drought"),
  p("Ailment and Curse Reflection"),
  p("Lightning Damage from Mana Costs"),
  p("Random Projectiles"),
  p("Treacherous Auras"),
  p("Occasional Impotence"),
  p("Siphoned Charges"),
  p("Impurity"),
  p("Waning Spirit"),
  p("Shattered Shield"),
  p("Unstoppable Monsters"),
  p("Lethal Rare Monsters"),
  p("Shielding Monsters"),
  p("Precise Monsters"),
  p("Overwhelming Monsters"),
  p("Deadly Monsters"),
  p("Prismatic Monsters"),
  p("Resistant Monsters"),
  p("Dexterous Monsters"),
  p("Siphoning Monsters"),
  p("Putrid Monsters"),
  p("Impenetrable Monsters"),
  // Bonuses
  b("Harsh Lessons", roman("Harsh Lessons", 4, false)),
  b("Glint of Blood", roman("Glint of Blood", 4, false)),
  b("Full Pockets", roman("Full Pockets", 4, false)),
  b("Divined Destiny", roman("Divined Destiny", 2, false)),
  b("Catalysed Combat", roman("Catalysed Combat", 2, false)),
  b("Fountainous Wealth", roman("Fountainous Wealth", 2, false)),
  b("Sluggish Foes", roman("Sluggish Foes", 2, false)),
  b("Weakened Foes", roman("Weakened Foes", 4, false)),
  b("Splintershot", ["Splintershot"]),
  b("Expansive Reach", ["Expansive Reach"]),
  b("Rapid Reactions", ["Rapid Reactions"]),
  b("Refracting Assault", ["Refracting Assault"]),
  b("Cranial Thievery", ["Cranial Thievery"]),
  b("Protective Barrier", ["Protective Barrier"]),
  // Boss
  { family: "The Trialmaster", kind: "boss", tiers: ["The Trialmaster"] },
];

export interface ModifierRef {
  family: ModifierFamily;
  /** 1-based tier. */
  tier: number;
  name: string;
}

const BY_NAME = new Map<string, ModifierRef>(
  MODIFIER_FAMILIES.flatMap((family) => family.tiers.map((name, i) => [name.toLowerCase(), { family, tier: i + 1, name }] as const)),
);

/** Looks a modifier up by its display name (case-insensitive). */
export function findModifier(name: string): ModifierRef | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/** Every modifier name (for pickers), grouped by family order. */
export const ALL_MODIFIERS: ModifierRef[] = [...BY_NAME.values()];
