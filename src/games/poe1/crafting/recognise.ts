/**
 * Recognises the modifier lines of a pasted item.
 *
 * - Multi-line mods ("(8-10)% increased Area of Effect" + "+1 to Level of Socketed
 *   AoE Gems") claim all their lines; they are tried before single-line mods.
 * - Lines RePoE has no text for ("Socketed Gems are Supported by Level 25 Less
 *   Duration", "Grants Level 20 … Skill") match the mod's display keys.
 * - Crafted lines are matched against bench mods, others against item mods,
 *   including zero-weight ones (Elevated / legacy) that never roll.
 * - Mods that can roll on the item win over others with the same text.
 * - Lines still unknown keep their slot when an advanced copy (Ctrl+Alt+C)
 *   says whether they are a prefix or a suffix.
 */
import type { ParsedMod } from "@/shared/item-parser/types";
import type { EmuMod } from "./emulator";
import { template } from "./paste";
import { spawnWeight, type CraftingIndex } from "./pool";
import type { Gen, ModDef } from "./types";

type Kind = "explicit" | "crafted" | "fractured";

interface Line {
  text: string;
  kind: Kind;
  gen?: Gen;
  name?: string;
  header?: number;
  used: boolean;
}

export interface Recognised {
  mods: EmuMod[];
  /** Lines that could not be placed (no matching mod and no prefix/suffix info). */
  dropped: string[];
  /** Lines kept as unknown mods (slot known from the advanced copy). */
  unknown: string[];
}

const SUPPORT = /^Socketed Gems are Supported by Level \d+ (.+)$/i;
const GRANT = /^Grants Level \d+ (.+?)(?: Skill)?$/i;
const SYNONYMS: Record<string, string> = { less: "reduced", more: "increased" };
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SYNONYMS[w] ?? w);

/** Does a pasted line show this display key ("support:reduced duration")? */
export function lineMatchesKey(line: string, key: string): boolean {
  const [kind, name] = key.split(":") as [string, string];
  const m = (kind === "support" ? SUPPORT : GRANT).exec(line);
  if (!m) return false;
  const have = new Set(words(m[1]!));
  return words(name).every((w) => have.has(w));
}

function lineMatchesText(line: string, text: string): boolean {
  const t = template(text);
  const r = t.re.exec(line);
  if (!r) return false;
  return t.ranges.every(([a, b], i) => {
    const v = Number(r[i + 1]);
    return v >= Math.min(a, b) && v <= Math.max(a, b);
  });
}

type Pattern = { text?: string; key?: string };
const patternsOf = (m: ModDef): Pattern[] => [
  ...m.text
    .split("\n")
    .filter((l) => l.trim())
    .map((text) => ({ text })),
  ...(m.display ?? []).map((key) => ({ key })),
];

export function recognise(idx: CraftingIndex, tags: Set<string>, parsed: readonly ParsedMod[]): Recognised {
  const lines: Line[] = parsed
    .filter((m): m is ParsedMod & { kind: Kind } => m.kind === "explicit" || m.kind === "crafted" || m.kind === "fractured")
    .map((m) => ({ text: m.text, kind: m.kind, gen: m.generation, name: m.modName, header: m.header, used: false }));

  const itemMods = [...idx.data.mods, ...(idx.data.extraMods ?? [])];
  const craftedMods = idx.data.craftedMods ?? [];
  const usedGroups = new Set<string>();
  const out: EmuMod[] = [];

  // Candidates per kind, multi-line first; mods that roll on this item first.
  const order = (list: readonly ModDef[]) =>
    list
      .map((m) => ({ m, pats: patternsOf(m), rolls: spawnWeight(m, tags) > 0 }))
      .filter((c) => c.pats.length > 0)
      .sort((a, b) => b.pats.length - a.pats.length || Number(b.rolls) - Number(a.rolls) || b.m.level - a.m.level);
  const pools: Record<Kind, ReturnType<typeof order>> = { explicit: order(itemMods), fractured: order(itemMods), crafted: order(craftedMods) };

  const lineFits = (l: Line, kind: Kind, m: ModDef, p: Pattern) =>
    !l.used && l.kind === kind && (!l.gen || l.gen === m.gen) && (p.text ? lineMatchesText(l.text, p.text) : lineMatchesKey(l.text, p.key!));

  for (const kind of ["fractured", "crafted", "explicit"] as const) {
    if (!lines.some((l) => !l.used && l.kind === kind)) continue;
    for (const { m, pats } of pools[kind]) {
      if (m.groups.some((g) => usedGroups.has(g))) continue;
      // Try to place every pattern on a distinct unused line.
      const picked: Line[] = [];
      for (const p of pats) {
        const l = lines.find((x) => !picked.includes(x) && lineFits(x, kind, m, p));
        if (!l) break;
        picked.push(l);
      }
      if (picked.length !== pats.length) continue;
      // An advanced copy names the mod; respect it when present.
      if (picked.some((l) => l.name && m.name && l.name !== m.name)) continue;
      picked.forEach((l) => (l.used = true));
      m.groups.forEach((g) => usedGroups.add(g));
      out.push({
        mod: m,
        text: picked.map((l) => l.text).join("\n"),
        fractured: kind === "fractured" || undefined,
        crafted: kind === "crafted" || undefined,
      });
      if (!lines.some((l) => !l.used && l.kind === kind)) break;
    }
  }

  // Unknown lines: keep their slot when the advanced copy tells the side.
  const dropped: string[] = [];
  const unknown: string[] = [];
  const byHeader = new Map<string, Line[]>();
  for (const l of lines.filter((x) => !x.used)) {
    if (!l.gen) {
      dropped.push(l.text);
      continue;
    }
    const key = l.header !== undefined ? `h${l.header}` : `l${byHeader.size}`;
    byHeader.set(key, [...(byHeader.get(key) ?? []), l]);
  }
  for (const [key, group] of byHeader) {
    const first = group[0]!;
    const text = group.map((l) => l.text).join("\n");
    unknown.push(text);
    out.push({
      mod: {
        id: `unknown:${key}`,
        name: first.name ?? "",
        family: `unknown:${key}`,
        groups: [`unknown:${key}`],
        gen: first.gen!,
        level: 0,
        tags: [],
        spawn: [],
        genWeights: [],
        text,
        essenceOnly: false,
      },
      text,
      fractured: first.kind === "fractured" || undefined,
      crafted: first.kind === "crafted" || undefined,
    });
  }
  // Keep the item's line order.
  const pos = (e: EmuMod) => parsed.findIndex((p) => e.text.split("\n")[0] === p.text);
  out.sort((a, b) => pos(a) - pos(b));
  return { mods: out, dropped, unknown };
}
