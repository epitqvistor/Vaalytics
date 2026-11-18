/**
 * Map Lab (PoE 1): reads a pasted map, groups its modifiers by the user's own
 * risk rules and lists the map's reward properties exactly as the game shows
 * them. Nothing is estimated. Spec: docs/modules/map-lab.md
 */
import type { ParsedItem } from "@/shared/item-parser/types";

export type Severity = "breaking" | "danger" | "ok";
export const SEVERITY_LABEL: Record<Severity, string> = { breaking: "Can't run", danger: "Dangerous", ok: "Fine" };

/** User rules: mod key → severity. A type alias so it's storable as a JSON setting. */
export type Rules = { [key: string]: Severity };

/** Rolls don't change what a mod does: "Monsters reflect 18% of Physical Damage" → "Monsters reflect #% of Physical Damage". */
export function modKey(text: string): string {
  return text
    .replace(/[+-]?\d+(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Starting suggestions for mods that commonly stop or endanger builds. They
 * are only defaults: any rule the user sets wins, and the UI marks them as such.
 */
export const DEFAULT_RULES: { pattern: RegExp; severity: Severity; why: string }[] = [
  { pattern: /^Monsters reflect #% of (Physical|Elemental) Damage$/, severity: "breaking", why: "Reflect" },
  { pattern: /^Players cannot Regenerate Life, Mana or Energy Shield$/, severity: "breaking", why: "No regeneration" },
  { pattern: /^Cannot Leech (Life|Mana)? ?(from Monsters)?/, severity: "breaking", why: "No leech" },
  { pattern: /less Recovery Rate of Life and Energy Shield$/, severity: "danger", why: "Less recovery" },
  { pattern: /^Players have #% to all maximum Resistances$/, severity: "danger", why: "Lower maximum resistances" },
  { pattern: /^Players are Cursed with /, severity: "danger", why: "Player curse" },
  { pattern: /extra Physical Damage as (Fire|Cold|Lightning)$/, severity: "danger", why: "Extra damage" },
];

export interface ClassifiedMod {
  text: string;
  key: string;
  severity: Severity;
  /** Where the severity comes from. */
  source: "rule" | "default" | "none";
  why?: string;
  generation?: "prefix" | "suffix";
}

export interface MapReport {
  name: string | null;
  base: string;
  tier: number | null;
  corrupted: boolean;
  /** Reward-related properties as listed on the map (quantity, rarity, pack size, "More …"). */
  rewards: { name: string; value: string }[];
  mods: ClassifiedMod[];
  verdict: Severity;
  counts: Record<Severity, number>;
}

/** Properties that describe what the map gives (shown verbatim, not interpreted). */
const REWARD = /^(Item Quantity|Atlas Drops|Item Rarity|Monster Pack Size|More |Quality)/;

export const isMap = (item: ParsedItem) => /\bMaps?\b/.test(item.itemClass) || item.mapTier != null;

export function classify(text: string, rules: Rules): ClassifiedMod {
  const key = modKey(text);
  const rule = rules[key];
  if (rule) return { text, key, severity: rule, source: "rule" };
  const d = DEFAULT_RULES.find((r) => r.pattern.test(key));
  if (d) return { text, key, severity: d.severity, source: "default", why: d.why };
  return { text, key, severity: "ok", source: "none" };
}

export function mapReport(item: ParsedItem, rules: Rules): MapReport {
  const mods = item.mods
    .filter((m) => m.kind === "explicit" || m.kind === "implicit" || m.kind === "enchant")
    .map((m) => ({ ...classify(m.text, rules), generation: m.generation }));
  const counts = { breaking: 0, danger: 0, ok: 0 };
  for (const m of mods) counts[m.severity]++;
  return {
    name: item.name ?? null,
    base: item.baseType,
    tier: item.mapTier ?? null,
    corrupted: item.corrupted,
    rewards: item.properties.filter((p) => REWARD.test(p.name)).map((p) => ({ name: p.name, value: p.value })),
    mods: [...mods].sort((a, b) => order[a.severity] - order[b.severity]),
    verdict: counts.breaking ? "breaking" : counts.danger ? "danger" : "ok",
    counts,
  };
}
const order: Record<Severity, number> = { breaking: 0, danger: 1, ok: 2 };

const MAX_RULES = 300;
export function isRules(v: unknown): v is Rules {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const e = Object.entries(v as Record<string, unknown>);
  return e.length <= MAX_RULES && e.every(([k, s]) => k.length <= 200 && (s === "breaking" || s === "danger" || s === "ok"));
}

/** Sets a rule; "ok" for a mod that has no default is the same as no rule, so it is removed. */
export function setRule(rules: Rules, key: string, severity: Severity): Rules {
  const next = { ...rules };
  const hasDefault = DEFAULT_RULES.some((r) => r.pattern.test(key));
  if (severity === "ok" && !hasDefault) delete next[key];
  else next[key] = severity;
  return next;
}
