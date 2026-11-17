import type { ParsedItem } from "@/shared/item-parser/types";
import type { DisplayItem, ItemRarity, ModKind } from "./types";

const RARITY: Record<string, ItemRarity> = {
  Normal: "normal",
  Magic: "magic",
  Rare: "rare",
  Unique: "unique",
  Gem: "gem",
  Currency: "currency",
  "Divination Card": "currency",
};

const KIND: Record<string, ModKind> = {
  implicit: "implicit",
  explicit: "explicit",
  crafted: "crafted",
  fractured: "fractured",
  enchant: "enchant",
  rune: "rune",
  desecrated: "explicit",
  scourge: "enchant",
};

/** Maps a parsed item to the renderer's display model. */
export function toDisplayItem(item: ParsedItem): DisplayItem {
  const r = item.requirements;
  const req = r && [r.level && `Level ${r.level}`, r.str && `${r.str} Str`, r.dex && `${r.dex} Dex`, r.int && `${r.int} Int`].filter(Boolean).join(", ");
  return {
    rarity: RARITY[item.rarity] ?? "normal",
    name: item.name,
    baseType: item.baseType,
    itemClass: item.itemClass,
    itemLevel: item.itemLevel,
    quality: item.quality,
    properties: item.properties
      .filter((p) => !["Level", "Str", "Dex", "Int"].includes(p.name))
      .map((p) => ({ label: p.name, value: p.value, augmented: p.augmented })),
    requirements: req ? `Requires ${req}` : undefined,
    sockets: item.sockets,
    mods: item.mods.map((m) => ({
      id: m.id,
      text: m.text,
      kind: KIND[m.kind] ?? "explicit",
      value: m.values[0],
      tier: m.tier,
    })),
    influences: item.influences.map((i) => `${i} Item`),
    corrupted: item.corrupted,
    unparsed: item.unparsed,
  };
}
