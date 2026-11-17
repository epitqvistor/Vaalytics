/**
 * Path of Exile 2 item text rules (English client). Markers verified against the
 * client strings used by Exiled Exchange 2 (studied, not copied).
 */
import { parseWith, type ParserRules } from "@/shared/item-parser/core";
import type { ParsedItem, ParseResult } from "@/shared/item-parser/types";

const REQUIRES = /^Requires:\s*(?:Level\D*(?<level>\d+))?\D*(?:(?<str>\d+)\D*(?:Strength|Str))?\D*(?:(?<dex>\d+)\D*(?:Dexterity|Dex))?\D*(?:(?<int>\d+)\D*(?:Intelligence|Int))?/;

/** PoE 2 puts requirements on one line: "Requires: Level 52, 40 Int". */
function requiresSection(section: string[], item: ParsedItem): boolean {
  const line = section.find((l) => l.startsWith("Requires: "));
  if (!line) return false;
  const g = REQUIRES.exec(line)?.groups ?? {};
  const n = (v?: string) => (v ? Number(v) : undefined);
  item.requirements = { level: n(g.level), str: n(g.str), dex: n(g.dex), int: n(g.int) };
  for (const other of section) {
    if (other === line) continue;
    const m = /^([^:]+):\s*(.+)$/.exec(other);
    if (m) item.properties.push({ name: m[1]!.trim(), value: m[2]!.trim() });
    else item.unparsed.push(other);
  }
  return true;
}

/** PoE 2 sockets are unlinked rune sockets, e.g. "Sockets: S S". */
function socketsSection(section: string[], item: ParsedItem): boolean {
  if (section.length !== 1 || !section[0]!.startsWith("Sockets: ")) return false;
  item.sockets = section[0]!.slice(9).trim();
  return true;
}

export const POE2_RULES: ParserRules = {
  game: "poe2",
  lineMarkers: {
    " (implicit)": "implicit",
    " (enchant)": "enchant",
    " (rune)": "rune",
    " (added rune)": "rune",
    " (desecrated)": "desecrated",
    " (crafted)": "crafted",
    " (fractured)": "fractured",
  },
  flags: {
    Corrupted: (i) => (i.corrupted = true),
    "Twice Corrupted": (i) => (i.corrupted = true),
    Mirrored: (i) => (i.mirrored = true),
    Unidentified: (i) => (i.unidentified = true),
    Unmodifiable: (i) => i.properties.push({ name: "Unmodifiable", value: "Yes" }),
    Sanctified: (i) => i.properties.push({ name: "Sanctified", value: "Yes" }),
    "Fractured Item": (i) => (i.fractured = true),
  },
  sections: [requiresSection, socketsSection],
};

export function parsePoe2Item(text: string): ParseResult {
  return parseWith(POE2_RULES, text);
}
