/**
 * Matches parsed modifier lines to official Trade stat ids, using the stat
 * templates the Trade API publishes (/api/trade{,2}/data/stats).
 */
import type { ModKind, ParsedItem, ParsedMod } from "@/shared/item-parser/types";

export interface TradeStat {
  id: string;
  text: string;
  type: string;
  options?: boolean;
}

export interface StatIndex {
  /** `${type}|${template}` → stats. Multi-line templates keep "\n" between lines. */
  byKey: Map<string, TradeStat[]>;
  ids: Set<string>;
}

function lineKey(line: string): string {
  return line
    .replace(/[+-]?\d+(?:\.\d+)?/g, "#")
    .replace(/[+-]#/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes a line or template so both compare equal: numbers → "#", a sign
 * directly before "#" is dropped (PoE 1 templates use "+#", PoE 2 templates "#").
 * Line breaks are preserved for multi-line stats.
 */
export function templateKey(text: string): string {
  return text.split("\n").map(lineKey).join("\n");
}

export function buildStatIndex(stats: readonly TradeStat[]): StatIndex {
  const byKey = new Map<string, TradeStat[]>();
  const ids = new Set<string>();
  for (const s of stats) {
    ids.add(s.id);
    const key = `${s.type}|${templateKey(s.text)}`;
    const list = byKey.get(key);
    if (list) list.push(s);
    else byKey.set(key, [s]);
  }
  return { byKey, ids };
}

const GROUP: Record<ModKind, string> = {
  implicit: "implicit",
  explicit: "explicit",
  crafted: "crafted",
  fractured: "fractured",
  enchant: "enchant",
  rune: "rune",
  desecrated: "desecrated",
  scourge: "scourge",
};

function groupsFor(kind: ModKind): string[] {
  // Some crafted/fractured/desecrated/rune stats only exist in the explicit group.
  return kind === "explicit" || kind === "implicit" || kind === "enchant" ? [GROUP[kind]] : [GROUP[kind], "explicit"];
}

/** Pairs whose wording flips the sign of the value. */
const INVERSIONS: [RegExp, string][] = [
  [/\breduced\b/, "increased"],
  [/\bincreased\b/, "reduced"],
  [/\bless\b/, "more"],
  [/\bmore\b/, "less"],
];

export interface StatMatch {
  stat: TradeStat;
  /** Value in the stat's own direction (inverted wording → negated). */
  value: number | null;
}

function valueOf(mod: ParsedMod, template: string): number | null {
  if (mod.values.length === 0) return null;
  // "Adds # to # …" — Trade compares the average.
  if (mod.values.length >= 2 && /# to #/.test(template)) return (mod.values[0]! + mod.values[1]!) / 2;
  return mod.values[0]!;
}

/** Properties of items whose flat defences / damage / speed mods are "local" (apply to the item itself). */
const LOCAL_PROPS = /^(Armour|Evasion Rating|Evasion|Energy Shield|Ward|Physical Damage|Elemental Damage|Attacks per Second|Chance to Block|Block chance|Critical Strike Chance|Critical Hit Chance)$/;

/**
 * Weapons and armour: Trade lists their local mods separately ("+# to Evasion Rating (Local)").
 * Searching the global stat for a local line finds nothing (seen live: a rare boot's own search
 * returned 0 results), so these items prefer the local variant when one exists.
 */
export function hasLocalStats(item: ParsedItem): boolean {
  return item.properties.some((p) => LOCAL_PROPS.test(p.name));
}

export function matchMod(mod: ParsedMod, index: StatIndex, local = false): StatMatch | null {
  const key = templateKey(mod.text);
  for (const group of groupsFor(mod.kind)) {
    if (local) {
      const own = index.byKey.get(`${group}|${key} (Local)`)?.[0];
      if (own) return { stat: own, value: valueOf(mod, key) };
    }
    const direct = index.byKey.get(`${group}|${key}`)?.[0];
    if (direct) return { stat: direct, value: valueOf(mod, key) };
    for (const [from, to] of INVERSIONS) {
      if (!from.test(key)) continue;
      const inverted = index.byKey.get(`${group}|${key.replace(from, to)}`)?.[0];
      if (inverted) {
        const v = valueOf(mod, key);
        return { stat: inverted, value: v == null ? null : -v };
      }
    }
  }
  return null;
}

/**
 * Some stats span two lines in the copied text (e.g. "…Hits and Ailments for" /
 * "each type of Elemental Ailment on Enemy"). Joins consecutive lines of the
 * same kind when the joined text is a known multi-line Trade stat.
 */
export function mergeMultiline(mods: readonly ParsedMod[], index: StatIndex): ParsedMod[] {
  const out: ParsedMod[] = [];
  for (let i = 0; i < mods.length; i++) {
    const a = mods[i]!;
    const b = mods[i + 1];
    if (b && b.kind === a.kind) {
      const joined = `${a.text}\n${b.text}`;
      const key = templateKey(joined);
      const known = groupsFor(a.kind).some((g) => index.byKey.has(`${g}|${key}`) || INVERSIONS.some(([f, t]) => f.test(key) && index.byKey.has(`${g}|${key.replace(f, t)}`)));
      if (known) {
        out.push({
          ...a,
          text: joined,
          values: [...a.values, ...b.values],
          ranges: a.ranges || b.ranges ? [...(a.ranges ?? a.values.map(() => null)), ...(b.ranges ?? b.values.map(() => null))] : undefined,
          raw: `${a.raw}\n${b.raw}`,
        });
        i++;
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

// ---------- pseudo totals ----------

interface SumRule {
  id: string;
  label: (v: number) => string;
  /** `templateKey` of every line that contributes its first number. */
  lines: string[];
  game?: "poe1" | "poe2";
}

const ATTRS = ["Strength", "Dexterity", "Intelligence"];
/** Lines adding to one attribute; hybrids use the game's order (Strength, Dexterity, Intelligence). */
const attr = (a: string) => [
  `# to ${a}`,
  `# to all Attributes`,
  ...ATTRS.filter((b) => b !== a).map((b) => (ATTRS.indexOf(a) < ATTRS.indexOf(b) ? `# to ${a} and ${b}` : `# to ${b} and ${a}`)),
];

/** Pseudo sums the Trade site computes the same way (ids exist in both games' stat data unless noted). */
export const SUM_PSEUDO_IDS: ReadonlySet<string> = new Set([
  "pseudo.pseudo_total_strength",
  "pseudo.pseudo_total_dexterity",
  "pseudo.pseudo_total_intelligence",
  "pseudo.pseudo_total_mana",
  "pseudo.pseudo_total_energy_shield",
  "pseudo.pseudo_total_cast_speed",
  "pseudo.pseudo_increased_movement_speed",
  "pseudo.pseudo_global_critical_strike_multiplier",
  "pseudo.pseudo_increased_spell_damage",
]);

const SUM_RULES: SumRule[] = [
  { id: "pseudo.pseudo_total_strength", label: (v) => `+${v} total to Strength`, lines: attr("Strength") },
  { id: "pseudo.pseudo_total_dexterity", label: (v) => `+${v} total to Dexterity`, lines: attr("Dexterity") },
  { id: "pseudo.pseudo_total_intelligence", label: (v) => `+${v} total to Intelligence`, lines: attr("Intelligence") },
  { id: "pseudo.pseudo_total_mana", label: (v) => `+${v} total maximum Mana`, lines: ["# to maximum Mana"] },
  { id: "pseudo.pseudo_total_energy_shield", label: (v) => `+${v} total maximum Energy Shield`, lines: ["# to maximum Energy Shield"] },
  { id: "pseudo.pseudo_total_cast_speed", label: (v) => `+${v}% total Cast Speed`, lines: ["#% increased Cast Speed"] },
  { id: "pseudo.pseudo_increased_movement_speed", label: (v) => `${v}% increased Movement Speed`, lines: ["#% increased Movement Speed"] },
  { id: "pseudo.pseudo_global_critical_strike_multiplier", label: (v) => `+${v}% Global Critical Strike Multiplier`, lines: ["#% to Global Critical Strike Multiplier"], game: "poe1" },
  { id: "pseudo.pseudo_increased_spell_damage", label: (v) => `${v}% increased Spell Damage`, lines: ["#% increased Spell Damage"] },
];

const ELEMENTS = ["fire", "cold", "lightning", "chaos"] as const;
type Element = (typeof ELEMENTS)[number];
const RESIST = /^([+-]?\d+(?:\.\d+)?)% to (.+?) Resistances?$/i;

export interface PseudoTotal {
  id: string;
  label: string;
  value: number;
  /** Mod ids that contributed to this total. */
  from: string[];
}

/** Items priced by name/base: pseudo totals only add noise there. */
const NO_PSEUDO = new Set(["Unique", "Gem", "Currency", "Divination Card"]);

/**
 * Pseudo totals the Trade site understands, computed like the site does.
 * Rules (so "+X% to all Elemental Resistances" stays one number):
 * - all-res mods → `total to all Elemental Resistances` only;
 * - per-element totals appear only for elements that have their own
 *   single/dual-element mod (their value includes all-res, as on the site);
 * - total elemental/total resistance appear only when the item mixes sources.
 * Only ids present in the game's stat data are returned.
 */
export function pseudoTotals(item: ParsedItem, index: StatIndex): PseudoTotal[] {
  if (NO_PSEUDO.has(item.rarity)) return [];

  const specific: Record<Element, { v: number; from: string[] }> = {
    fire: { v: 0, from: [] },
    cold: { v: 0, from: [] },
    lightning: { v: 0, from: [] },
    chaos: { v: 0, from: [] },
  };
  const allRes = { v: 0, from: [] as string[] };
  const life = { v: 0, from: [] as string[] };

  for (const mod of item.mods) {
    const m = RESIST.exec(mod.text);
    if (m) {
      const value = Number(m[1]);
      const what = m[2]!.toLowerCase();
      if (what.includes("all elemental")) {
        allRes.v += value;
        allRes.from.push(mod.id);
      } else {
        for (const e of ELEMENTS.filter((e) => what.split(/\s+and\s+|,\s*/).some((p) => p.trim() === e))) {
          specific[e].v += value;
          specific[e].from.push(mod.id);
        }
      }
      continue;
    }
    if (/^[+-]?\d+ to maximum Life$/.test(mod.text)) {
      life.v += mod.values[0]!;
      life.from.push(mod.id);
    } else if (item.game === "poe1") {
      // PoE 1: every 10 Strength grants 5 maximum Life.
      const str = /^\+(\d+) to (?:Strength|all Attributes|Strength and (?:Dexterity|Intelligence))$/.exec(mod.text);
      if (str) {
        life.v += Math.floor(Number(str[1]) / 2);
        life.from.push(mod.id);
      }
    }
  }

  const out: PseudoTotal[] = [];
  const push = (id: string, label: string, v: number, from: string[]) => {
    if (from.length && v !== 0 && index.ids.has(id)) out.push({ id, label, value: v, from: [...new Set(from)] });
  };
  const eleSpecific = (["fire", "cold", "lightning"] as const).filter((e) => specific[e].from.length > 0);

  push("pseudo.pseudo_total_all_elemental_resistances", `+${allRes.v}% total to all Elemental Resistances`, allRes.v, allRes.from);
  if (eleSpecific.length > 0) {
    const ele = eleSpecific.reduce((sum, e) => sum + specific[e].v, 0) + allRes.v * 3;
    push("pseudo.pseudo_total_elemental_resistance", `+${ele}% total Elemental Resistance`, ele, [...eleSpecific.flatMap((e) => specific[e].from), ...allRes.from]);
    for (const e of eleSpecific) {
      const v = specific[e].v + allRes.v;
      push(`pseudo.pseudo_total_${e}_resistance`, `+${v}% total ${e[0]!.toUpperCase()}${e.slice(1)} Resistance`, v, [...specific[e].from, ...allRes.from]);
    }
    if (specific.chaos.from.length) {
      push("pseudo.pseudo_total_resistance", `+${ele + specific.chaos.v}% total Resistance`, ele + specific.chaos.v, [
        ...eleSpecific.flatMap((e) => specific[e].from),
        ...allRes.from,
        ...specific.chaos.from,
      ]);
    }
  }
  // Further sums (attributes, mana, ES, speeds, crit, spell damage) — offered only when two or more
  // lines add up, since a single line is already its own filter. Local weapon/armour stats are not
  // included (they are part of the item's own numbers, not of a pseudo total).
  for (const rule of SUM_RULES) {
    if (rule.game && rule.game !== item.game) continue;
    // Flat ES on armour is local (part of the item's own Energy Shield), not a pseudo total.
    if (rule.id === "pseudo.pseudo_total_energy_shield" && hasLocalStats(item)) continue;
    let v = 0;
    const from: string[] = [];
    for (const mod of item.mods) {
      const key = templateKey(mod.text);
      if (rule.lines.includes(key) && mod.values.length) {
        v += mod.values[0]!;
        from.push(mod.id);
      }
    }
    if (from.length >= 2) push(rule.id, rule.label(v), v, from);
  }
  push("pseudo.pseudo_total_chaos_resistance", `+${specific.chaos.v}% total Chaos Resistance`, specific.chaos.v, specific.chaos.from);
  push("pseudo.pseudo_total_life", `+${life.v} total maximum Life`, life.v, life.from);
  return out;
}
