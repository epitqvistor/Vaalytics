/**
 * Currency emulator: applies PoE 1 currency to an item state, rolling mods
 * with the game's weights. Rules per currency are listed in docs/modules/crafting.md.
 *
 * Assumptions (not published by GGG):
 * - Transmutation/Alteration roll 1 or 2 mods with equal odds;
 * - side-restricted rerolls (locked side, Eldritch Chaos) roll up to the usual 4–6 mods in total.
 * Metamods ("… cannot be changed", "Cannot roll …") are respected by Chaos, Scouring,
 * Annulment, Harvest and the add-a-mod currencies; essences and fossils ignore them.
 */
import { MAX_PER_SIDE } from "./engine";
import { harvestByTag } from "./harvest";
import type { CraftingIndex } from "./pool";
import { ESSENCE_CLASS } from "./pool";
import { FastPool, fill, reforge } from "./sampler";
import type { BenchDef, EssenceDef, FossilDef, Gen, ItemSpec, ModDef } from "./types";
import { RESONATORS } from "./methods";

export type Rarity = "normal" | "magic" | "rare";

export interface EmuMod {
  mod: ModDef;
  /** Text with rolled values. */
  text: string;
  fractured?: boolean;
  crafted?: boolean;
}

export interface EmuItem {
  rarity: Rarity;
  mods: EmuMod[];
}

export type SimpleCurrency = "transmute" | "alteration" | "augmentation" | "regal" | "alchemy" | "chaos" | "exalted" | "annulment" | "scouring";
export type EldritchCurrency = "eldritchChaos" | "eldritchExalt" | "eldritchAnnul";

export type EmuAction =
  | { kind: SimpleCurrency }
  | { kind: EldritchCurrency }
  | { kind: "essence"; essence: EssenceDef }
  | { kind: "fossil"; fossils: FossilDef[] }
  | { kind: "harvest"; tag: string }
  | { kind: "bench"; craft: BenchDef }
  | { kind: "removeCrafted" };

export const CURRENCY: Record<SimpleCurrency, { name: string; short: string; hint: string }> = {
  transmute: { name: "Orb of Transmutation", short: "Transmute", hint: "Normal → magic with 1–2 mods" },
  alteration: { name: "Orb of Alteration", short: "Alteration", hint: "Rerolls a magic item" },
  augmentation: { name: "Orb of Augmentation", short: "Augment", hint: "Adds a mod to a magic item with one mod" },
  regal: { name: "Regal Orb", short: "Regal", hint: "Magic → rare, adds a mod" },
  alchemy: { name: "Orb of Alchemy", short: "Alchemy", hint: "Normal → rare with 4–6 mods" },
  chaos: { name: "Chaos Orb", short: "Chaos", hint: "Rerolls a rare item (respects “cannot be changed”)" },
  exalted: { name: "Exalted Orb", short: "Exalt", hint: "Adds a mod to a rare item" },
  annulment: { name: "Orb of Annulment", short: "Annul", hint: "Removes a random mod (respects “cannot be changed”)" },
  scouring: { name: "Orb of Scouring", short: "Scour", hint: "Removes all mods (fractured and locked mods stay)" },
};

export const ELDRITCH: Record<EldritchCurrency, { name: string; short: string; hint: string }> = {
  eldritchChaos: { name: "Eldritch Chaos Orb", short: "E. Chaos", hint: "Rerolls the dominant side (Exarch → prefixes, Eater → suffixes)" },
  eldritchExalt: { name: "Eldritch Exalted Orb", short: "E. Exalt", hint: "Adds a mod to the dominant side" },
  eldritchAnnul: { name: "Eldritch Orb of Annulment", short: "E. Annul", hint: "Removes a random mod from the dominant side" },
};

/** Bench metamod families the emulator understands. */
export const META = {
  lockPrefixes: "ItemGenerationCannotChangePrefixes",
  lockSuffixes: "ItemGenerationCannotChangeSuffixes",
  noAttack: "ItemGenerationCannotRollAttackAffixes",
  noCaster: "ItemGenerationCannotRollCasterAffixes",
} as const;
const META_FAMILIES = new Set<string>(Object.values(META));
/** Other "ItemGeneration…" metamods (1/2 locked mods, multimod) aren't modelled. */
export const isSupportedBenchMod = (m: ModDef) => !m.family.startsWith("ItemGeneration") || META_FAMILIES.has(m.family);

export const REMOVE_CRAFTED_COST: [string, number][] = [["Orb of Scouring", 1]];

/** Currency used by an action (for the session cost). */
export function actionCost(a: EmuAction): [string, number][] {
  switch (a.kind) {
    case "essence":
      return [[a.essence.name, 1]];
    case "fossil":
      return [...a.fossils.map((f): [string, number] => [f.name, 1]), [RESONATORS[a.fossils.length - 1]!, 1]];
    case "harvest":
      return harvestByTag(a.tag)?.cost ?? [];
    case "bench":
      return a.craft.cost;
    case "removeCrafted":
      return REMOVE_CRAFTED_COST;
    case "eldritchChaos":
    case "eldritchExalt":
    case "eldritchAnnul":
      return [[ELDRITCH[a.kind].name, 1]];
    default:
      return [[CURRENCY[a.kind].name, 1]];
  }
}

// ---------- value rolls ----------

const RANGE = /\((-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\)/g;

export function rollText(text: string, r: () => number): string {
  return text.replace(RANGE, (_, a: string, b: string) => {
    const lo = Math.min(Number(a), Number(b));
    const hi = Math.max(Number(a), Number(b));
    const decimals = Math.max(a.split(".")[1]?.length ?? 0, b.split(".")[1]?.length ?? 0);
    const step = 10 ** -decimals;
    const steps = Math.round((hi - lo) / step);
    return (lo + Math.floor(r() * (steps + 1)) * step).toFixed(decimals);
  });
}

// ---------- item helpers ----------

const has = (item: EmuItem, family: string) => item.mods.some((m) => m.crafted && m.mod.family === family);

/** Side protected by a "… cannot be changed" metamod, if any. */
export function lockedSide(item: EmuItem): Gen | null {
  if (has(item, META.lockPrefixes)) return "prefix";
  if (has(item, META.lockSuffixes)) return "suffix";
  return null;
}

/** Tags blocked by "Cannot roll Attack/Caster Modifiers". */
export function blockedTags(item: EmuItem): string[] {
  const out: string[] = [];
  if (has(item, META.noAttack)) out.push("attack");
  if (has(item, META.noCaster)) out.push("caster");
  return out;
}

const sideIdx = (g: Gen): 0 | 1 => (g === "prefix" ? 0 : 1);
const other = (g: Gen): Gen => (g === "prefix" ? "suffix" : "prefix");

// ---------- engine ----------

export class Emulator {
  private pools = new Map<string, FastPool>();
  private plainPool;
  constructor(
    readonly idx: CraftingIndex,
    readonly spec: ItemSpec,
    /** Eldritch dominance: Searing Exarch → prefix, Eater of Worlds → suffix. */
    readonly dominance: Gen | null = null,
  ) {
    this.plainPool = idx.pool({ ...spec, fixed: [] });
  }

  /** Pool without fixed-mod exclusions; the sampler tracks groups on the item. */
  pool(fossils: readonly FossilDef[] = [], blocked: readonly string[] = []): FastPool {
    const key = fossils.map((f) => f.id).join("+") + "|" + blocked.join(",");
    let fp = this.pools.get(key);
    if (!fp) {
      fp = new FastPool(this.idx.pool({ ...this.spec, fixed: [] }, fossils, blocked));
      this.pools.set(key, fp);
    }
    return fp;
  }

  tierOf = (m: ModDef) => this.idx.tierForMod(this.plainPool, m);

  essenceMod(e: EssenceDef): ModDef | null {
    const cls = this.spec.base.itemClass;
    const id = e.mods[cls] ?? e.mods[ESSENCE_CLASS[cls] ?? ""];
    return (id && this.idx.modById.get(id)) || null;
  }

  /** Bench crafts for this item class (unsupported metamods left out). */
  benchCrafts(): BenchDef[] {
    const cls = this.spec.base.itemClass;
    return this.idx.data.bench.filter((b) => {
      const m = this.idx.modById.get(b.modId);
      return b.itemClasses.includes(cls) && m && isSupportedBenchMod(m) && m.level <= Math.max(this.spec.ilvl, 1);
    });
  }

  /** Returns the new item, or an error explaining why the currency can't be used. */
  apply(item: EmuItem, a: EmuAction, r: () => number): EmuItem | { error: string } {
    const fractured = item.mods.filter((m) => m.fractured);
    const lock = lockedSide(item);
    // Kept through a reroll that respects metamods: fractured + the locked side.
    const keptState = item.mods.filter((m) => m.fractured || (lock !== null && m.mod.gen === lock));
    const kept = keptState.map((m) => m.mod);
    const out = (rarity: Rarity, mods: ModDef[], keepState: EmuMod[] = keptState): EmuItem => {
      const old = new Map(keepState.map((m) => [m.mod.id, m]));
      return { rarity, mods: mods.map((m) => old.get(m.id) ?? { mod: m, text: rollText(m.text, r) }) };
    };
    const restricted = this.pool([], blockedTags(item));
    const n12 = () => (r() < 0.5 ? 1 : 2);
    const lockOpt = lock === null ? {} : { lock: sideIdx(lock) };

    switch (a.kind) {
      case "transmute":
        if (item.rarity !== "normal") return { error: "Transmutation needs a normal item." };
        return out("magic", fill(restricted, r, [...kept], kept.length + n12(), 1));
      case "alteration":
        if (item.rarity !== "magic") return { error: "Alteration needs a magic item." };
        return out("magic", fill(restricted, r, [...kept], Math.max(kept.length, n12()), 1));
      case "augmentation": {
        if (item.rarity !== "magic") return { error: "Augmentation needs a magic item." };
        if (item.mods.length >= 2) return { error: "The magic item already has a prefix and a suffix." };
        return out("magic", fill(restricted, r, item.mods.map((m) => m.mod), item.mods.length + 1, 1), item.mods);
      }
      case "regal":
        if (item.rarity !== "magic") return { error: "Regal Orb needs a magic item." };
        return out("rare", fill(restricted, r, item.mods.map((m) => m.mod), item.mods.length + 1), item.mods);
      case "alchemy":
        if (item.rarity !== "normal") return { error: "Alchemy needs a normal item." };
        return out("rare", reforge(restricted, r, kept));
      case "chaos":
        if (item.rarity !== "rare") return { error: "Chaos Orb needs a rare item." };
        return out("rare", reforge(restricted, r, kept, lockOpt));
      case "harvest": {
        if (item.rarity !== "rare") return { error: "Harvest reforges need a rare item." };
        const h = harvestByTag(a.tag);
        if (!h) return { error: "Unknown Harvest reforge." };
        const mods = reforge(restricted, r, kept, { ...lockOpt, tag: a.tag });
        if (!mods.slice(kept.length).some((m) => m.tags.includes(a.tag))) return { error: `No ${h.label} modifier can roll on this item.` };
        return out("rare", mods);
      }
      case "exalted": {
        if (item.rarity !== "rare") return { error: "Exalted Orb needs a rare item." };
        const next = fill(restricted, r, item.mods.map((m) => m.mod), item.mods.length + 1);
        if (next.length === item.mods.length) return { error: "No open prefix or suffix (or nothing left that can roll)." };
        return out("rare", next, item.mods);
      }
      case "annulment": {
        const removable = item.mods.filter((m) => !m.fractured && (lock === null || m.mod.gen !== lock));
        if (item.rarity === "normal" || !removable.length) return { error: "Nothing to remove (fractured and locked mods can't be annulled)." };
        const victim = removable[Math.floor(r() * removable.length)]!;
        return { rarity: item.rarity, mods: item.mods.filter((m) => m !== victim) };
      }
      case "scouring":
        if (item.rarity === "normal") return { error: "The item is already normal." };
        // Items that keep mods (fractured / locked side) keep their rarity.
        return { rarity: keptState.length ? item.rarity : "normal", mods: keptState };
      case "essence": {
        const mod = this.essenceMod(a.essence);
        if (!mod) return { error: "This essence can't be used on this item class." };
        if (a.essence.itemLevelRestriction !== null && this.spec.ilvl > a.essence.itemLevelRestriction)
          return { error: `${a.essence.name} works on items up to level ${a.essence.itemLevelRestriction}.` };
        if (item.rarity === "magic") return { error: "Essences need a normal item (Shrieking / Deafening also reforge rares)." };
        if (item.rarity === "rare" && !/^(Shrieking|Deafening) /.test(a.essence.name)) return { error: "Only Shrieking and Deafening essences reforge rare items." };
        const frac = fractured.map((m) => m.mod);
        if (frac.some((k) => k.groups.some((g) => mod.groups.includes(g)))) return { error: "A fractured mod blocks the essence's modifier." };
        // Essences ignore metamods: everything but fractured mods is replaced.
        return out("rare", reforge(this.pool(), r, [...frac, mod]), fractured);
      }
      case "fossil": {
        if (!a.fossils.length || a.fossils.length > 4) return { error: "Pick 1–4 fossils." };
        if (item.rarity === "magic") return { error: "Resonators need a normal or rare item." };
        return out("rare", reforge(this.pool(a.fossils), r, fractured.map((m) => m.mod)), fractured);
      }
      case "eldritchChaos":
      case "eldritchExalt":
      case "eldritchAnnul": {
        const d = this.dominance;
        if (!d) return { error: "Needs a dominant Eldritch implicit (set the Exarch / Eater tiers; equal tiers have no dominance)." };
        if (item.rarity !== "rare") return { error: `${ELDRITCH[a.kind].name} needs a rare item.` };
        if (a.kind === "eldritchAnnul") {
          const removable = item.mods.filter((m) => !m.fractured && m.mod.gen === d);
          if (!removable.length) return { error: `No removable ${d} on the item.` };
          const victim = removable[Math.floor(r() * removable.length)]!;
          return { rarity: "rare", mods: item.mods.filter((m) => m !== victim) };
        }
        if (a.kind === "eldritchExalt") {
          const next = fill(restricted, r, item.mods.map((m) => m.mod), item.mods.length + 1, MAX_PER_SIDE, sideIdx(d));
          if (next.length === item.mods.length) return { error: `No open ${d} (or nothing left that can roll there).` };
          return out("rare", next, item.mods);
        }
        // Eldritch Chaos: keep the other side and fractured mods, reroll the dominant side.
        const keepE = item.mods.filter((m) => m.fractured || m.mod.gen === other(d));
        return out("rare", reforge(restricted, r, keepE.map((m) => m.mod), { lock: sideIdx(other(d)) }), keepE);
      }
      case "bench": {
        const mod = this.idx.modById.get(a.craft.modId);
        if (!mod) return { error: "Unknown bench craft." };
        if (item.rarity === "normal") return { error: "Bench crafts need a magic or rare item." };
        if (item.mods.some((m) => m.crafted)) return { error: "The item already has a crafted modifier (multi-mod isn't modelled)." };
        const max = item.rarity === "magic" ? 1 : MAX_PER_SIDE;
        if (item.mods.filter((m) => m.mod.gen === mod.gen).length >= max) return { error: `No open ${mod.gen} for this craft.` };
        if (item.mods.some((m) => m.mod.groups.some((g) => mod.groups.includes(g)))) return { error: "The item already has a modifier of this type." };
        return { rarity: item.rarity, mods: [...item.mods, { mod, text: rollText(mod.text, r), crafted: true }] };
      }
      case "removeCrafted":
        if (!item.mods.some((m) => m.crafted)) return { error: "No crafted modifier to remove." };
        return { rarity: item.rarity, mods: item.mods.filter((m) => !m.crafted) };
    }
  }
}

/** Max affixes for the rarity. */
export const maxPerSide = (rarity: Rarity) => (rarity === "magic" ? 1 : rarity === "rare" ? MAX_PER_SIDE : 0);
