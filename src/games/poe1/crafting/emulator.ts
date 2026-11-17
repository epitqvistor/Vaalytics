/**
 * Currency emulator: applies PoE 1 currency to an item state, rolling mods
 * with the game's weights. Rules per currency are listed in docs/modules/crafting.md.
 *
 * Assumption (not published by GGG): Transmutation/Alteration roll 1 or 2 mods
 * with equal odds.
 */
import { MAX_PER_SIDE } from "./engine";
import type { CraftingIndex } from "./pool";
import { FastPool, fill, reforge } from "./sampler";
import type { EssenceDef, FossilDef, ItemSpec, ModDef } from "./types";
import { ESSENCE_CLASS } from "./pool";
import { RESONATORS } from "./methods";

export type Rarity = "normal" | "magic" | "rare";

export interface EmuMod {
  mod: ModDef;
  /** Text with rolled values. */
  text: string;
  fractured?: boolean;
}

export interface EmuItem {
  rarity: Rarity;
  mods: EmuMod[];
}

export type SimpleCurrency = "transmute" | "alteration" | "augmentation" | "regal" | "alchemy" | "chaos" | "exalted" | "annulment" | "scouring";

export type EmuAction = { kind: SimpleCurrency } | { kind: "essence"; essence: EssenceDef } | { kind: "fossil"; fossils: FossilDef[] };

export const CURRENCY: Record<SimpleCurrency, { name: string; short: string; hint: string }> = {
  transmute: { name: "Orb of Transmutation", short: "Transmute", hint: "Normal → magic with 1–2 mods" },
  alteration: { name: "Orb of Alteration", short: "Alteration", hint: "Rerolls a magic item" },
  augmentation: { name: "Orb of Augmentation", short: "Augment", hint: "Adds a mod to a magic item with one mod" },
  regal: { name: "Regal Orb", short: "Regal", hint: "Magic → rare, adds a mod" },
  alchemy: { name: "Orb of Alchemy", short: "Alchemy", hint: "Normal → rare with 4–6 mods" },
  chaos: { name: "Chaos Orb", short: "Chaos", hint: "Rerolls a rare item" },
  exalted: { name: "Exalted Orb", short: "Exalt", hint: "Adds a mod to a rare item" },
  annulment: { name: "Orb of Annulment", short: "Annul", hint: "Removes a random mod" },
  scouring: { name: "Orb of Scouring", short: "Scour", hint: "Removes all mods (fractured mods stay)" },
};

/** Currency used by an action (for the session cost). */
export function actionCost(a: EmuAction): string[] {
  if (a.kind === "essence") return [a.essence.name];
  if (a.kind === "fossil") return [...a.fossils.map((f) => f.name), RESONATORS[a.fossils.length - 1]!];
  return [CURRENCY[a.kind].name];
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

// ---------- engine ----------

export class Emulator {
  private pools = new Map<string, FastPool>();
  constructor(
    readonly idx: CraftingIndex,
    readonly spec: ItemSpec,
  ) {}

  /** Pool without fixed-mod exclusions; the sampler tracks groups on the item. */
  pool(fossils: readonly FossilDef[] = []): FastPool {
    const key = fossils.map((f) => f.id).join("+");
    let fp = this.pools.get(key);
    if (!fp) {
      fp = new FastPool(this.idx.pool({ ...this.spec, fixed: [] }, fossils));
      this.pools.set(key, fp);
    }
    return fp;
  }

  tierOf = (m: ModDef) => this.idx.tierForMod(this.idx.pool({ ...this.spec, fixed: [] }), m);

  essenceMod(e: EssenceDef): ModDef | null {
    const cls = this.spec.base.itemClass;
    const id = e.mods[cls] ?? e.mods[ESSENCE_CLASS[cls] ?? ""];
    return (id && this.idx.modById.get(id)) || null;
  }

  /** Returns the new item, or an error explaining why the currency can't be used. */
  apply(item: EmuItem, a: EmuAction, r: () => number): EmuItem | { error: string } {
    const fractured = item.mods.filter((m) => m.fractured);
    const keep = fractured.map((m) => m.mod);
    const out = (rarity: Rarity, mods: ModDef[], keepState: EmuMod[] = fractured): EmuItem => {
      const old = new Map(keepState.map((m) => [m.mod.id, m]));
      return { rarity, mods: mods.map((m) => old.get(m.id) ?? { mod: m, text: rollText(m.text, r) }) };
    };
    const fp = this.pool();
    const n12 = () => (r() < 0.5 ? 1 : 2);

    switch (a.kind) {
      case "transmute":
        if (item.rarity !== "normal") return { error: "Transmutation needs a normal item." };
        return out("magic", fill(fp, r, [...keep], keep.length + n12(), 1));
      case "alteration":
        if (item.rarity !== "magic") return { error: "Alteration needs a magic item." };
        return out("magic", fill(fp, r, [...keep], Math.max(keep.length, n12()), 1));
      case "augmentation": {
        if (item.rarity !== "magic") return { error: "Augmentation needs a magic item." };
        if (item.mods.length >= 2) return { error: "The magic item already has a prefix and a suffix." };
        return out("magic", fill(fp, r, item.mods.map((m) => m.mod), item.mods.length + 1, 1), item.mods);
      }
      case "regal":
        if (item.rarity !== "magic") return { error: "Regal Orb needs a magic item." };
        return out("rare", fill(fp, r, item.mods.map((m) => m.mod), item.mods.length + 1), item.mods);
      case "alchemy":
        if (item.rarity !== "normal") return { error: "Alchemy needs a normal item." };
        return out("rare", reforge(fp, r, keep));
      case "chaos":
        if (item.rarity !== "rare") return { error: "Chaos Orb needs a rare item." };
        return out("rare", reforge(fp, r, keep));
      case "exalted": {
        if (item.rarity !== "rare") return { error: "Exalted Orb needs a rare item." };
        const next = fill(fp, r, item.mods.map((m) => m.mod), item.mods.length + 1);
        if (next.length === item.mods.length) return { error: "No open prefix or suffix (or nothing left that can roll)." };
        return out("rare", next, item.mods);
      }
      case "annulment": {
        const removable = item.mods.filter((m) => !m.fractured);
        if (item.rarity === "normal" || !removable.length) return { error: "Nothing to remove (fractured mods can't be annulled)." };
        const victim = removable[Math.floor(r() * removable.length)]!;
        return { rarity: item.rarity, mods: item.mods.filter((m) => m !== victim) };
      }
      case "scouring":
        if (item.rarity === "normal") return { error: "The item is already normal." };
        // Fractured items keep their rarity; others become normal.
        return { rarity: fractured.length ? item.rarity : "normal", mods: fractured };
      case "essence": {
        const mod = this.essenceMod(a.essence);
        if (!mod) return { error: "This essence can't be used on this item class." };
        if (a.essence.itemLevelRestriction !== null && this.spec.ilvl > a.essence.itemLevelRestriction)
          return { error: `${a.essence.name} works on items up to level ${a.essence.itemLevelRestriction}.` };
        if (item.rarity === "magic") return { error: "Essences need a normal item (Shrieking / Deafening also reforge rares)." };
        if (item.rarity === "rare" && !/^(Shrieking|Deafening) /.test(a.essence.name)) return { error: "Only Shrieking and Deafening essences reforge rare items." };
        if (keep.some((k) => k.groups.some((g) => mod.groups.includes(g)))) return { error: "A fractured mod blocks the essence's modifier." };
        return out("rare", reforge(fp, r, [...keep, mod]));
      }
      case "fossil": {
        if (!a.fossils.length || a.fossils.length > 4) return { error: "Pick 1–4 fossils." };
        if (item.rarity === "magic") return { error: "Resonators need a normal or rare item." };
        return out("rare", reforge(this.pool(a.fossils), r, keep));
      }
    }
  }
}

/** Max affixes for the rarity. */
export const maxPerSide = (rarity: Rarity) => (rarity === "magic" ? 1 : rarity === "rare" ? MAX_PER_SIDE : 0);
