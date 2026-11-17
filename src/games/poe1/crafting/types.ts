/** Crafting dataset (mirrors src-tauri/src/crafting.rs). PoE 1 only. */

export type TagWeights = [tag: string, weight: number][];
export type Gen = "prefix" | "suffix";

export interface ModDef {
  id: string;
  name: string;
  /** Tier family (RePoE `type`). */
  family: string;
  groups: string[];
  gen: Gen;
  level: number;
  /** Tags fossils / harvest act on. */
  tags: string[];
  spawn: TagWeights;
  /** Percent multipliers, first matching tag. */
  genWeights: TagWeights;
  text: string;
  essenceOnly: boolean;
}

export interface BaseDef {
  id: string;
  name: string;
  itemClass: string;
  tags: string[];
  implicits: string[];
  dropLevel: number;
}

export interface ClassDef {
  id: string;
  name: string;
  /** crusader, elder, hunter, redeemer, shaper, warlord */
  influenceTags: string[];
}

export interface FossilDef {
  id: string;
  name: string;
  /** Percent multipliers per mod tag (1000 = ×10, 0 = blocked). */
  weights: TagWeights;
  allowedTags: string[];
  forbiddenTags: string[];
}

export interface EssenceDef {
  id: string;
  name: string;
  level: number;
  itemLevelRestriction: number | null;
  /** Item class → guaranteed mod id. */
  mods: Record<string, string>;
}

export interface BenchDef {
  modId: string;
  itemClasses: string[];
  /** Currency name → amount. */
  cost: [name: string, qty: number][];
  tier: number;
}

export interface CraftingData {
  format: number;
  game: "poe1";
  source: string;
  checkedAt: number;
  sourceModified: string | null;
  classes: ClassDef[];
  bases: BaseDef[];
  mods: ModDef[];
  fossils: FossilDef[];
  essences: EssenceDef[];
  bench: BenchDef[];
  craftedMods: ModDef[];
}

export interface CraftingDataResponse {
  data: CraftingData;
  staleError: string | null;
}

export const INFLUENCES = ["Crusader", "Elder", "Hunter", "Redeemer", "Shaper", "Warlord"] as const;
export type Influence = (typeof INFLUENCES)[number];

/** The item being crafted. `fixed` mods stay through a reforge (fractured). */
export interface ItemSpec {
  base: BaseDef;
  ilvl: number;
  influences: Influence[];
  fixed: ModDef[];
}

/** Wanted: a mod of `family` at tier `maxTier` or better (T1 = best). */
export interface Target {
  family: string;
  gen: Gen;
  maxTier: number;
}

export interface Goal {
  targets: Target[];
  /** How many targets must be hit: targets.length = all (AND), 1 = any (OR). */
  need: number;
}
