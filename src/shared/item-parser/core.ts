/**
 * Game-agnostic parsing engine for PoE item text. Each game supplies a
 * `ParserRules` object describing its markers and section handlers; this core
 * does the section splitting, nameplate, modifier grouping and bookkeeping of
 * unrecognised lines. English client text only (other languages: future work).
 */
import type { GameId } from "@/core/game-context/games";
import type { ItemRarity, ModKind, ParsedItem, ParsedMod, ParseResult } from "./types";

export const ITEM_CLASS = "Item Class: ";

export interface ParserRules {
  game: GameId;
  /** Trailing markers on stat lines, e.g. " (implicit)". Checked longest-first. */
  lineMarkers: Record<string, ModKind>;
  /** Single-line flags (whole section is one of these). */
  flags: Record<string, (item: ParsedItem) => void>;
  /**
   * Game-specific section handlers, tried in order before generic handling.
   * Return true when the section was fully consumed.
   */
  sections: ((section: string[], item: ParsedItem) => boolean)[];
}

/** True if the text looks like an English PoE item copy. */
export function isItemText(text: string): boolean {
  return text.replace(/^﻿/, "").startsWith(ITEM_CLASS);
}

export function splitSections(text: string): string[][] {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n?-{8}\n?/)
    .map((s) =>
      s
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    )
    .filter((s) => s.length > 0);
}

/** Removes trade-site markup like "[Fire]" or "[Attack|Attacks]" (keeps the display part). */
export function stripMarkup(line: string): string {
  return line.replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2").replace(/\[([^\]]+)\]/g, "$1");
}

const RANGE_AFTER_NUMBER = /(\d)\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;
const NUMBER = /-?\d+(?:\.\d+)?/g;

/**
 * Splits an advanced-copy stat line into display text and roll ranges:
 * "+68(60-69) to maximum Life" → { text: "+68 to maximum Life", ranges: [[60, 69]] }.
 */
export function extractRanges(line: string): { text: string; ranges: ([number, number] | null)[] } {
  const ranges: ([number, number] | null)[] = [];
  let sawRange = false;
  // Walk numbers in order so ranges stay aligned with values.
  const text = line.replace(RANGE_AFTER_NUMBER, (_m, d: string, a: string, b: string) => {
    sawRange = true;
    return `${d}\u0000${a}|${b}\u0000`;
  });
  const out: string[] = [];
  let i = 0;
  const parts = text.split("\u0000");
  for (const part of parts) {
    if (i % 2 === 1) {
      const [a, b] = part.split("|").map(Number);
      ranges[ranges.length - 1] = [a!, b!];
    } else {
      out.push(part);
      for (const _ of part.match(NUMBER) ?? []) ranges.push(null);
    }
    i++;
  }
  return { text: out.join(""), ranges: sawRange ? ranges : [] };
}

export function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map(Number);
}

const HEADER_LINE = /^\{\s*(.+?)\s*\}$/;
const HEADER_MAIN = /^(?<type>[^"(]+?)(?:\s+"(?<name>[^"]*)")?(?:\s*\(Tier: (?<tier>\d+)\))?(?:\s*\(Rank: (?<rank>\d+)\))?$/;

/**
 * Resolves an advanced header's type text by keyword. Covers both games'
 * vocabularies, e.g. "Master Crafted Suffix Modifier", "Fractured Prefix
 * Modifier", "Corruption Implicit Modifier", "Enhancement", "Desecrated …".
 */
export function resolveHeaderType(type: string): { kind: ModKind; generation?: "prefix" | "suffix" } | undefined {
  const t = type.toLowerCase();
  const generation = t.includes("prefix") ? "prefix" : t.includes("suffix") ? "suffix" : undefined;
  if (t.includes("implicit")) return { kind: "implicit", generation };
  if (t.includes("enhancement") || t.includes("enchant")) return { kind: "enchant", generation };
  if (t.includes("fractured")) return { kind: "fractured", generation };
  if (t.includes("crafted")) return { kind: "crafted", generation };
  if (t.includes("desecrated")) return { kind: "desecrated", generation };
  if (t.includes("rune")) return { kind: "rune", generation };
  if (t.includes("scourge")) return { kind: "scourge", generation };
  if (generation || t.includes("unique modifier") || t === "modifier") return { kind: "explicit", generation };
  return undefined;
}

let headerSeq = 0;

/** "Attack, Melee, Strike, Duration" — capitalised words separated by commas. */
const GEM_TAGS = /^[A-Z][A-Za-z ]*(, [A-Z][A-Za-z ]*)+$/;

export function parseHeader(line: string, _rules: ParserRules) {
  const inner = HEADER_LINE.exec(line)?.[1];
  if (!inner) return null;
  const [main, ...rest] = inner.split(/\s+—\s+/);
  const m = HEADER_MAIN.exec(main!.trim());
  // Eldritch implicits carry a rank in parentheses, e.g. "(Lesser)".
  const type = (m?.groups?.type ?? main!).trim().replace(/\s*\([^)]*\)$/, "");
  const known = resolveHeaderType(type);
  return {
    kind: known?.kind,
    generation: known?.generation,
    name: m?.groups?.name || undefined,
    tier: m?.groups?.tier ? Number(m.groups.tier) : undefined,
    tags: rest.length ? rest.join(", ").split(/,\s*/).filter((t) => t && !/Increased$/.test(t)) : undefined,
    typeText: type,
    /** Distinguishes headers, so lines of one multi-line modifier can be grouped. */
    seq: ++headerSeq,
  };
}

function rarityOf(value: string): ItemRarity {
  const known: ItemRarity[] = ["Normal", "Magic", "Rare", "Unique", "Gem", "Currency", "Divination Card", "Quest"];
  return (known as string[]).includes(value) ? (value as ItemRarity) : "Other";
}

function stripMarker(line: string, rules: ParserRules): { text: string; kind?: ModKind } {
  const markers = Object.keys(rules.lineMarkers).sort((a, b) => b.length - a.length);
  for (const marker of markers) {
    if (line.endsWith(marker)) return { text: line.slice(0, -marker.length), kind: rules.lineMarkers[marker] };
  }
  return { text: line };
}

function makeMod(item: ParsedItem, rawLine: string, rules: ParserRules, header: ReturnType<typeof parseHeader>, fallbackKind: ModKind): ParsedMod {
  const marked = stripMarker(stripMarkup(rawLine), rules);
  const { text, ranges } = extractRanges(marked.text);
  const kind = marked.kind ?? header?.kind ?? fallbackKind;
  return {
    id: `m${item.mods.length}`,
    kind,
    text,
    values: numbersIn(text),
    ranges: ranges.length ? ranges : undefined,
    tier: header?.tier,
    generation: header?.generation,
    modName: header?.name,
    tags: header?.tags,
    header: header?.seq,
    raw: rawLine,
  };
}

/** A section is a modifier block if it has advanced headers or marked lines, or is free text after properties. */
function looksLikeMods(section: string[], rules: ParserRules): boolean {
  if (section.some((l) => HEADER_LINE.test(l))) return true;
  const markers = Object.keys(rules.lineMarkers);
  return section.some((l) => markers.some((m) => l.endsWith(m)));
}

const PROPERTY_LINE = /^([^:]+):\s*(.+)$/;
/** Modifier lines that contain a colon, e.g. cluster jewels' "Added Small Passive Skills also grant: +10 to Maximum Life". */
const MOD_WITH_COLON = /^Added Small Passive Skills (?:also )?grant: /;
/** "Name: value" property line (not a modifier that happens to contain a colon). */
function propertyOf(line: string): RegExpExecArray | null {
  return MOD_WITH_COLON.test(line) ? null : PROPERTY_LINE.exec(line);
}

export function parseWith(rules: ParserRules, rawText: string): ParseResult {
  const text = rawText.replace(/^﻿/, "");
  if (!isItemText(text)) return { ok: false, error: "This doesn't look like Path of Exile item text (expected it to start with “Item Class:”)." };
  const sections = splitSections(text);
  const plate = sections.shift()!;

  const item: ParsedItem = {
    game: rules.game,
    itemClass: plate[0]!.slice(ITEM_CLASS.length).trim(),
    rarity: "Other",
    baseType: "",
    properties: [],
    mods: [],
    influences: [],
    corrupted: false,
    mirrored: false,
    unidentified: false,
    fractured: false,
    synthesised: false,
    foulborn: false,
    description: [],
    unparsed: [],
    raw: text,
  };

  // Nameplate: Item Class / Rarity / [name] / base
  const rarityLine = plate.find((l) => l.startsWith("Rarity: "));
  item.rarity = rarityOf(rarityLine ? rarityLine.slice("Rarity: ".length).trim() : "Other");
  const names = plate.filter((l) => !l.startsWith(ITEM_CLASS) && !l.startsWith("Rarity: "));
  if (names.length >= 2) {
    item.name = names[0];
    item.baseType = names[1]!;
  } else {
    item.baseType = names[0] ?? item.itemClass;
  }

  let sawItemLevel = false;
  const reqBlock: Record<string, number | undefined> = {};
  for (const section of sections) {
    // 1) single-line flags (Corrupted, Mirrored, influences, …)
    if (section.length === 1 && rules.flags[section[0]!]) {
      rules.flags[section[0]!]!(item);
      continue;
    }
    if (section.every((l) => rules.flags[l])) {
      section.forEach((l) => rules.flags[l]!(item));
      continue;
    }
    // 2) game-specific sections
    if (rules.sections.some((handler) => handler(section, item))) continue;

    // 3) common simple sections
    const first = section[0]!;
    if (first.startsWith("Item Level: ")) {
      item.itemLevel = Number(first.slice(12)) || undefined;
      sawItemLevel = true;
      if (section.length > 1) item.unparsed.push(...section.slice(1));
      continue;
    }
    if (first.startsWith("Note: ")) {
      item.note = first.slice(6);
      continue;
    }
    if (first.startsWith("Stack Size: ")) {
      const m = /^Stack Size: ([\d,.\s]+)(?:\/([\d,.\s]+))?/.exec(first);
      if (m) item.stackSize = { current: Number(m[1]!.replace(/[^\d]/g, "")), max: m[2] ? Number(m[2].replace(/[^\d]/g, "")) : undefined };
      continue;
    }
    if (first.startsWith("Sockets: ")) {
      item.sockets = first.slice(9).trim();
      const groups = item.sockets.split(/\s+/).map((g) => g.split("-").length);
      item.links = groups.length ? Math.max(...groups) : undefined;
      continue;
    }

    // 4) classify the rest
    const isPropertySection = section.some((l) => propertyOf(l) != null || l === "Requirements:");
    const hasModSyntax = looksLikeMods(section, rules);
    const hasNumbers = section.some((l) => numbersIn(l).length > 0);

    if (hasModSyntax || (sawItemLevel && !isPropertySection && hasNumbers)) {
      let header: ReturnType<typeof parseHeader> = null;
      let inReminder = false;
      for (const line of section) {
        // Reminder text explains a mechanic, e.g. "(Freeze lowers Enemy Action
        // Speed to zero, …)". It can span lines; it is never a modifier.
        if (inReminder || line.startsWith("(")) {
          item.description.push(line);
          inReminder = !line.endsWith(")");
          continue;
        }
        if (HEADER_LINE.test(line)) {
          header = parseHeader(line, rules);
          if (header && !header.kind) item.unparsed.push(line);
          continue;
        }
        item.mods.push(makeMod(item, line, rules, header, "explicit"));
      }
      continue;
    }
    if (isPropertySection) {
      // "Requirements:" opens a block whose Level/Str/Dex/Int are requirements, not item properties
      // (a gem's "Level: 15" and its "Requirements: Level: 59" must not be confused).
      let inReq = false;
      for (const line of section) {
        if (line === "Requirements:") {
          inReq = true;
          continue;
        }
        const m = propertyOf(line);
        if (!m) {
          // A gem's tag line ("Attack, Melee, Strike, …") has no "name: value" form.
          if (item.rarity === "Gem" && !inReq && GEM_TAGS.test(line)) item.properties.push({ name: "Tags", value: line });
          else if (line !== "Requirements:") item.unparsed.push(line);
          continue;
        }
        const name = m[1]!.trim();
        let value = m[2]!.trim();
        const augmented = value.endsWith(" (augmented)");
        if (augmented) value = value.slice(0, -" (augmented)".length);
        if (name === "Quality") item.quality = Number(value.replace(/[^\d]/g, "")) || undefined;
        else if (name === "Level" && item.rarity === "Gem" && !inReq) item.gemLevel = Number(value.replace(/[^\d]/g, "")) || undefined;
        else if (name === "Map Tier") item.mapTier = Number(value) || undefined;
        if (inReq && ["Level", "Str", "Dex", "Int"].includes(name)) reqBlock[name] = Number(value.replace(/[^\d]/g, "")) || undefined;
        item.properties.push({ name, value, augmented: augmented || undefined });
      }
      continue;
    }
    // Text without numbers or properties: flavour text, usage hints.
    if (!hasNumbers || !sawItemLevel) {
      item.description.push(...section);
      continue;
    }
    item.unparsed.push(...section);
  }

  // Requirements (PoE 1 multi-line form): the "Requirements:" block, else loose properties (non-gems).
  if (!item.requirements && Object.values(reqBlock).some(Boolean)) {
    item.requirements = { level: reqBlock.Level, str: reqBlock.Str, dex: reqBlock.Dex, int: reqBlock.Int };
  }
  const req = (n: string) => Number(item.properties.find((p) => p.name === n)?.value.replace(/[^\d]/g, "")) || undefined;
  if (!item.requirements && (req("Level") || req("Str") || req("Dex") || req("Int")) && item.rarity !== "Gem") {
    item.requirements = { level: req("Level"), str: req("Str"), dex: req("Dex"), int: req("Int") };
  }
  if (item.mods.some((m) => m.kind === "fractured")) item.fractured = true;
  if (item.rarity === "Magic" || item.rarity === "Normal") delete item.name;
  return { ok: true, item };
}
