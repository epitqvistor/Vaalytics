/**
 * Display model for an item. The M5 parsers (one per game) produce a richer
 * structure; this is the subset the renderer needs. Unknown lines are kept in
 * `unparsed` so nothing is silently dropped.
 */
export type ItemRarity = "normal" | "magic" | "rare" | "unique" | "gem" | "currency";

export type ModKind = "implicit" | "explicit" | "crafted" | "fractured" | "enchant" | "rune" | "pseudo";

export interface ItemMod {
  id: string;
  text: string;
  kind: ModKind;
  /** Numeric roll used for filtering, when the mod has one. */
  value?: number;
  /** Mod tier (lower is better in PoE 1 advanced copy), when known. */
  tier?: number;
}

export interface ItemProperty {
  label: string;
  value: string;
  /** Highlight values augmented by quality/mods. */
  augmented?: boolean;
}

export interface DisplayItem {
  rarity: ItemRarity;
  name?: string;
  baseType: string;
  itemClass: string;
  itemLevel?: number;
  quality?: number;
  properties: ItemProperty[];
  requirements?: string;
  sockets?: string;
  mods: ItemMod[];
  influences?: string[];
  corrupted?: boolean;
  unparsed?: string[];
}
