import type { GameId } from "@/core/game-context/games";

/**
 * Structured representation of an item copied from the game (Ctrl+C text).
 * Produced by the per-game parsers in src/games/<id>/parser. Nothing is
 * silently dropped: lines that were not understood are kept in `unparsed`.
 */
export type ItemRarity = "Normal" | "Magic" | "Rare" | "Unique" | "Gem" | "Currency" | "Divination Card" | "Quest" | "Other";

export type ModKind = "implicit" | "explicit" | "crafted" | "fractured" | "enchant" | "rune" | "desecrated" | "scourge";

export interface ParsedMod {
  /** Stable id within this item (index-based). */
  id: string;
  kind: ModKind;
  /** Display text without markers and roll ranges, e.g. "+68 to maximum Life". */
  text: string;
  /** Numbers appearing in `text`, in order. */
  values: number[];
  /** Roll ranges from advanced copy, parallel to `values` where present. */
  ranges?: ([number, number] | null)[];
  /** From the advanced header line, when present. */
  tier?: number;
  generation?: "prefix" | "suffix";
  modName?: string;
  tags?: string[];
  /** The line(s) exactly as copied. */
  raw: string;
}

export interface ItemProperty {
  name: string;
  value: string;
  augmented?: boolean;
}

export interface ParsedItem {
  game: GameId;
  itemClass: string;
  rarity: ItemRarity;
  /** Unique/rare name; absent for normal/magic/currency. */
  name?: string;
  /** Base type as shown (magic items keep their full name here). */
  baseType: string;
  itemLevel?: number;
  quality?: number;
  stackSize?: { current: number; max?: number };
  gemLevel?: number;
  mapTier?: number;
  sockets?: string;
  /** Largest linked group (PoE 1). */
  links?: number;
  requirements?: { level?: number; str?: number; dex?: number; int?: number };
  properties: ItemProperty[];
  mods: ParsedMod[];
  influences: string[];
  corrupted: boolean;
  mirrored: boolean;
  unidentified: boolean;
  /** Set when any fractured modifier is present or the item says so. */
  fractured: boolean;
  synthesised: boolean;
  foulborn: boolean;
  note?: string;
  /** Descriptive text (flavour, usage help). Preserved, not used for pricing. */
  description: string[];
  /** Lines the parser did not recognise. Shown to the user, never used for pricing. */
  unparsed: string[];
  raw: string;
}

export type ParseResult = { ok: true; item: ParsedItem } | { ok: false; error: string };
