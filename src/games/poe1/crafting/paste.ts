/** Pasted item text (Ctrl+C in game) → crafting item spec. */
import type { ParsedItem } from "@/shared/item-parser/types";
import { parsePoe1Item } from "../parser";
import { itemTags, spawnWeight, type CraftingIndex } from "./pool";
import type { EmuItem } from "./emulator";
import { recognise } from "./recognise";
import type { BaseDef, Influence, ItemSpec, ModDef } from "./types";
import { INFLUENCES } from "./types";

export type MatchHint = { name?: string; gen?: "prefix" | "suffix"; tags?: Set<string>; only?: (m: ModDef) => boolean };

const NUM = String.raw`([+-]?\d+(?:\.\d+)?)`;

interface Template {
  re: RegExp;
  /** Per captured number: allowed range. */
  ranges: [number, number][];
}

const templateCache = new Map<string, Template>();

/** "+(3-9) to maximum Life" → regex capturing the rolled number and its range. */
export function template(text: string): Template {
  const hit = templateCache.get(text);
  if (hit) return hit;
  const ranges: [number, number][] = [];
  let src = "";
  const rx = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;
  let last = 0;
  for (let m = rx.exec(text); m; m = rx.exec(text)) {
    src += escape(text.slice(last, m.index)) + NUM;
    ranges.push([Number(m[1]), Number(m[2])]);
    last = m.index + m[0].length;
  }
  src += escape(text.slice(last));
  const t = { re: new RegExp(`^${src}$`), ranges };
  templateCache.set(text, t);
  return t;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\n/g, "\\n");

/** Finds the mod (and so the tier) a rolled line belongs to. */
export function matchMod(idx: CraftingIndex, line: string, hint?: MatchHint): ModDef | null {
  let best: ModDef | null = null;
  // Prefer mods that can roll on this item; fall back to any mod with this text.
  if (hint?.tags) {
    const tags = hint.tags;
    const onItem = matchMod(idx, line, { ...hint, tags: undefined, only: (m) => !m.essenceOnly && spawnWeight(m, tags) > 0 });
    if (onItem) return onItem;
  }
  const only = hint?.only;
  for (const m of idx.data.mods) {
    if (only && !only(m)) continue;
    if (hint?.gen && m.gen !== hint.gen) continue;
    if (hint?.name && m.name !== hint.name) continue;
    const t = template(m.text);
    const r = t.re.exec(line);
    if (!r) continue;
    const inRange = t.ranges.every(([a, b], i) => {
      const v = Number(r[i + 1]);
      return v >= Math.min(a, b) && v <= Math.max(a, b);
    });
    if (inRange && (!best || m.level > best.level)) best = m;
  }
  return best;
}

export interface PasteResult {
  spec: ItemSpec;
  item: ParsedItem;
  warnings: string[];
}

export function specFromText(idx: CraftingIndex, text: string): PasteResult | { error: string } {
  const parsed = parsePoe1Item(text);
  if (!parsed.ok) return { error: parsed.error };
  const item = parsed.item;
  if (!["Normal", "Magic", "Rare"].includes(item.rarity)) return { error: `${item.rarity} items can't be crafted here.` };
  const cls = idx.data.classes.find((c) => c.name === item.itemClass || c.id === item.itemClass);
  if (!cls) return { error: `“${item.itemClass}” isn't supported by the crafting calculator yet.` };

  const candidates = idx.data.bases.filter((b) => b.itemClass === cls.id && item.baseType.includes(b.name));
  const longest = Math.max(0, ...candidates.map((b) => b.name.length));
  let bases = candidates.filter((b) => b.name.length === longest);
  if (bases.length > 1) {
    const implicits = item.mods.filter((m) => m.kind === "implicit").map((m) => m.text);
    const byImplicit = bases.filter((b) => b.implicits.every((t) => implicits.some((line) => template(t).re.test(line))));
    if (byImplicit.length) bases = byImplicit;
  }
  const base: BaseDef | undefined = bases[0];
  if (!base) return { error: `Unknown base type “${item.baseType}”.` };

  const warnings: string[] = [];
  const influences = item.influences.filter((i): i is Influence => (INFLUENCES as readonly string[]).includes(i));
  const eldritch = item.influences.filter((i) => !influences.includes(i as Influence));
  if (eldritch.length) warnings.push(`${eldritch.join(" / ")} implicits aren't modelled yet; they don't change explicit mod odds.`);
  if (item.corrupted) warnings.push("The item is corrupted — it can't be modified in game.");
  if (item.mirrored) warnings.push("The item is mirrored — it can't be modified in game.");
  if (item.synthesised) warnings.push("Synthesised implicits aren't modelled.");

  const tags = itemTags(base, cls, influences);
  const rec = recognise(idx, tags, item.mods.filter((m) => m.kind === "fractured"));
  const fixed: ModDef[] = rec.mods.filter((m) => m.fractured && !m.mod.id.startsWith("unknown:")).map((m) => m.mod);
  for (const t of [...rec.dropped, ...rec.unknown]) warnings.push(`Couldn't identify the fractured mod “${t}”; it is ignored by the odds.`);
  if (!item.itemLevel) warnings.push("No item level in the text; using 86.");
  return { spec: { base, ilvl: item.itemLevel ?? 86, influences: influences.slice(0, 2), fixed }, item, warnings };
}

/** Emulator start state from a pasted item: fractured, explicit and crafted mods with their rolled text. */
export function emuFromPaste(idx: CraftingIndex, spec: ItemSpec, item: ParsedItem): { item: EmuItem; dropped: string[]; unknown: string[] } {
  const tags = itemTags(spec.base, idx.classById.get(spec.base.itemClass), spec.influences);
  const rec = recognise(idx, tags, item.mods);
  const rarity = item.rarity === "Rare" ? "rare" : item.rarity === "Magic" ? "magic" : "normal";
  return { item: { rarity, mods: rec.mods }, dropped: rec.dropped, unknown: rec.unknown };
}

/** Path of Building text for an emulated item. */
export function pobTextFor(spec: ItemSpec, item: EmuItem, implicits: readonly string[] | null): string {
  const lines = [`Rarity: ${item.rarity.toUpperCase()}`];
  if (item.rarity === "rare") lines.push("Crafted Item");
  lines.push(spec.base.name, `Item Level: ${spec.ilvl}`);
  for (const inf of spec.influences) lines.push(`${inf} Item`);
  const impl = implicits ?? spec.base.implicits.flatMap((t) => t.split("\n").map((l) => (/\(/.test(l) ? `{range:0.5}${l}` : l)));
  lines.push(`Implicits: ${impl.length}`, ...impl);
  for (const m of item.mods) lines.push(...m.text.split("\n").map((l) => (m.fractured ? `{fractured}${l}` : l)));
  return lines.join("\n");
}

/** Item text for Path of Building (Items → Create custom / paste). */
export function pobText(spec: ItemSpec, pasted: ParsedItem | null): string {
  if (pasted) return pasted.raw.trim();
  const lines = ["Rarity: RARE", "Crafted Item", spec.base.name, `Item Level: ${spec.ilvl}`];
  for (const inf of spec.influences) lines.push(`${inf} Item`);
  lines.push(`Implicits: ${spec.base.implicits.length}`);
  for (const t of spec.base.implicits) lines.push(...t.split("\n").map((l) => (/\(/.test(l) ? `{range:0.5}${l}` : l)));
  for (const m of spec.fixed) lines.push(...m.text.split("\n").map((l) => `{fractured}${/\(/.test(l) ? "{range:0.5}" : ""}${l}`));
  return lines.join("\n");
}
