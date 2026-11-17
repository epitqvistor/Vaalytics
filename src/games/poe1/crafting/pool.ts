/**
 * Modifier pool for an item: which explicit mods can roll, with what weight
 * and tier. Weight rules (from the game data via RePoE):
 * - the first tag in a mod's spawn list that the item has decides its weight;
 * - `genWeights` (first matching tag) multiply it, in percent;
 * - fossils multiply by every matching mod tag, in percent (0 blocks);
 * - mods above the item level or marked essence-only never roll.
 */
import type { BaseDef, ClassDef, CraftingData, FossilDef, Gen, Influence, ItemSpec, ModDef, TagWeights } from "./types";
import { INFLUENCES } from "./types";

export interface PoolMod {
  mod: ModDef;
  weight: number;
  /** 1 = best tier of this family on this base. */
  tier: number;
}

/** Essence keys use the parent class for a few item classes. */
export const ESSENCE_CLASS: Record<string, string> = { "Rune Dagger": "Dagger", Warstaff: "Staff" };

export function itemTags(base: BaseDef, cls: ClassDef | undefined, influences: readonly Influence[]): Set<string> {
  const tags = new Set(base.tags);
  for (const inf of influences) {
    const t = cls?.influenceTags[INFLUENCES.indexOf(inf)];
    if (t) tags.add(t);
  }
  return tags;
}

const firstMatch = (list: TagWeights, tags: Set<string>): number | null => {
  for (const [tag, w] of list) if (tags.has(tag)) return w;
  return null;
};

/** Base spawn weight of a mod on an item with `tags` (before item level). */
export function spawnWeight(mod: ModDef, tags: Set<string>): number {
  const w = firstMatch(mod.spawn, tags) ?? 0;
  if (w <= 0) return 0;
  const g = firstMatch(mod.genWeights, tags);
  return g === null ? w : Math.floor((w * g) / 100);
}

/** Combined fossil multiplier for a mod (product over fossils and matching tags). */
export function fossilMultiplier(mod: ModDef, fossils: readonly FossilDef[]): number {
  let m = 1;
  for (const f of fossils) for (const [tag, pct] of f.weights) if (mod.tags.includes(tag)) m *= pct / 100;
  return m;
}

export function fossilAllowed(f: FossilDef, tags: Set<string>): boolean {
  if (f.allowedTags.length && !f.allowedTags.some((t) => tags.has(t))) return false;
  return !f.forbiddenTags.some((t) => tags.has(t));
}

export interface Pool {
  spec: ItemSpec;
  tags: Set<string>;
  mods: PoolMod[];
  /** Tier of every mod that can spawn on this base (any item level), by mod id. */
  tierOf: Map<string, number>;
  /** Number of tiers per family on this base. */
  familyTiers: Map<string, number>;
}

export class CraftingIndex {
  readonly modById = new Map<string, ModDef>();
  readonly classById = new Map<string, ClassDef>();
  constructor(readonly data: CraftingData) {
    for (const m of data.mods) this.modById.set(m.id, m);
    for (const c of data.classes) this.classById.set(c.id, c);
  }

  /** Builds the pool. Fossils reweight; mods blocked by `spec.fixed` groups are excluded. */
  pool(spec: ItemSpec, fossils: readonly FossilDef[] = []): Pool {
    const tags = itemTags(spec.base, this.classById.get(spec.base.itemClass), spec.influences);
    const byFamily = new Map<string, ModDef[]>();
    const baseWeight = new Map<string, number>();
    for (const m of this.data.mods) {
      if (m.essenceOnly) continue;
      const w = spawnWeight(m, tags);
      if (w <= 0) continue;
      baseWeight.set(m.id, w);
      const list = byFamily.get(m.family) ?? [];
      list.push(m);
      byFamily.set(m.family, list);
    }
    const tierOf = new Map<string, number>();
    const familyTiers = new Map<string, number>();
    for (const [fam, list] of byFamily) {
      list.sort((a, b) => b.level - a.level || a.id.localeCompare(b.id));
      list.forEach((m, i) => tierOf.set(m.id, i + 1));
      familyTiers.set(fam, list.length);
    }
    const blocked = new Set(spec.fixed.flatMap((m) => m.groups));
    const mods: PoolMod[] = [];
    for (const m of this.data.mods) {
      const w0 = baseWeight.get(m.id);
      if (!w0 || m.level > spec.ilvl || m.groups.some((g) => blocked.has(g))) continue;
      const weight = fossils.length ? Math.floor(w0 * fossilMultiplier(m, fossils)) : w0;
      if (weight > 0) mods.push({ mod: m, weight, tier: tierOf.get(m.id)! });
    }
    return { spec, tags, mods, tierOf, familyTiers };
  }

  /** Tier of an essence-only or out-of-pool mod relative to its family on this base. */
  tierForMod(pool: Pool, mod: ModDef): number {
    const t = pool.tierOf.get(mod.id);
    if (t !== undefined) return t;
    // Essence-only mods: rank by level among the family's spawnable tiers.
    let rank = 1;
    for (const [id, tier] of pool.tierOf) {
      const other = this.modById.get(id);
      if (other && other.family === mod.family && other.level > mod.level) rank = Math.max(rank, tier + 1);
    }
    return rank;
  }
}

export interface FamilyRow {
  family: string;
  gen: Gen;
  /** Best currently rollable mod (lowest tier number). */
  best: PoolMod;
  tiers: PoolMod[];
  weight: number;
}

/** Pool grouped by family, heaviest first, for the mod list. */
export function families(pool: Pool): FamilyRow[] {
  const map = new Map<string, FamilyRow>();
  for (const pm of pool.mods) {
    const key = `${pm.mod.gen}:${pm.mod.family}`;
    const row = map.get(key);
    if (!row) map.set(key, { family: pm.mod.family, gen: pm.mod.gen, best: pm, tiers: [pm], weight: pm.weight });
    else {
      row.tiers.push(pm);
      row.weight += pm.weight;
      if (pm.tier < row.best.tier) row.best = pm;
    }
  }
  for (const r of map.values()) r.tiers.sort((a, b) => a.tier - b.tier);
  return [...map.values()].sort((a, b) => b.weight - a.weight);
}
