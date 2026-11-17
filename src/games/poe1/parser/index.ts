/**
 * Path of Exile 1 item text rules (English client). Markers verified against the
 * game's client strings as used by Awakened PoE Trade (studied, not copied).
 */
import { parseWith, type ParserRules } from "@/shared/item-parser/core";
import type { ParsedItem, ParseResult } from "@/shared/item-parser/types";

const INFLUENCES = ["Shaper", "Elder", "Crusader", "Hunter", "Redeemer", "Warlord", "Searing Exarch", "Eater of Worlds"];

const flags: ParserRules["flags"] = {
  Corrupted: (i) => (i.corrupted = true),
  Mirrored: (i) => (i.mirrored = true),
  Unidentified: (i) => (i.unidentified = true),
  Split: (i) => i.properties.push({ name: "Split", value: "Yes" }),
  "Synthesised Item": (i) => (i.synthesised = true),
  "Fractured Item": (i) => (i.fractured = true),
  "Foulborn Item": (i) => (i.foulborn = true),
  ...Object.fromEntries(INFLUENCES.map((inf) => [`${inf} Item`, (i: ParsedItem) => i.influences.push(inf)])),
};

export const POE1_RULES: ParserRules = {
  game: "poe1",
  lineMarkers: {
    " (implicit)": "implicit",
    " (crafted)": "crafted",
    " (fractured)": "fractured",
    " (enchant)": "enchant",
    " (scourge)": "scourge",
  },
  flags,
  sections: [],
};

export function parsePoe1Item(text: string): ParseResult {
  return parseWith(POE1_RULES, text);
}
