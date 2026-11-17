/**
 * Fast exact sampler: every mod and group tracked, arrays instead of objects.
 * Shared by the currency emulator and the Monte Carlo runner. Same rules as
 * simulate.ts (the slower reference used to validate engine.ts).
 */
import { MAX_PER_SIDE } from "./engine";
import type { Pool } from "./pool";
import { pickModCount } from "./simulate";
import type { Goal, ModDef } from "./types";

export class FastPool {
  readonly mods: ModDef[];
  readonly weight: Float64Array;
  /** 0 = prefix, 1 = suffix */
  readonly side: Uint8Array;
  readonly groups: Uint16Array[];
  readonly groupId = new Map<string, number>();

  constructor(readonly pool: Pool) {
    const n = pool.mods.length;
    this.mods = pool.mods.map((m) => m.mod);
    this.weight = new Float64Array(n);
    this.side = new Uint8Array(n);
    this.groups = [];
    pool.mods.forEach((pm, i) => {
      this.weight[i] = pm.weight;
      this.side[i] = pm.mod.gen === "prefix" ? 0 : 1;
      this.groups.push(Uint16Array.from(pm.mod.groups.map((g) => this.gid(g))));
    });
  }

  gid(g: string): number {
    let id = this.groupId.get(g);
    if (id === undefined) {
      id = this.groupId.size;
      this.groupId.set(g, id);
    }
    return id;
  }

  /** Tracks which groups are on an item. */
  usedFor(mods: readonly ModDef[]): Uint8Array {
    const ids = mods.flatMap((m) => m.groups.map((g) => this.gid(g)));
    const used = new Uint8Array(this.groupId.size);
    for (const id of ids) used[id] = 1;
    return used;
  }

  private open(i: number, used: Uint8Array, p: number, s: number, max: number): boolean {
    if (this.side[i] === 0 ? p >= max : s >= max) return false;
    const gs = this.groups[i]!;
    for (let k = 0; k < gs.length; k++) if (used[gs[k]!]) return false;
    return true;
  }

  /**
   * Draws one mod for an item with `p` prefixes and `s` suffixes, `max` per side.
   * `only` restricts to one side. Returns the index, or -1 if nothing can roll.
   */
  draw(r: () => number, used: Uint8Array, p: number, s: number, max: number, only?: 0 | 1): number {
    const n = this.weight.length;
    let total = 0;
    for (let i = 0; i < n; i++) if ((only === undefined || this.side[i] === only) && this.open(i, used, p, s, max)) total += this.weight[i]!;
    if (total <= 0) return -1;
    let x = r() * total;
    let last = -1;
    for (let i = 0; i < n; i++) {
      if ((only !== undefined && this.side[i] !== only) || !this.open(i, used, p, s, max)) continue;
      last = i;
      x -= this.weight[i]!;
      if (x < 0) return i;
    }
    return last;
  }

  take(i: number, used: Uint8Array): ModDef {
    for (const g of this.groups[i]!) used[g] = 1;
    return this.mods[i]!;
  }
}

const count = (mods: readonly ModDef[], gen: "prefix" | "suffix") => mods.reduce((c, m) => c + (m.gen === gen ? 1 : 0), 0);

/** Adds random mods until `target` mods are on the item (or nothing fits). */
export function fill(fp: FastPool, r: () => number, mods: ModDef[], target: number, max = MAX_PER_SIDE): ModDef[] {
  const used = fp.usedFor(mods);
  let p = count(mods, "prefix");
  let s = mods.length - p;
  while (mods.length < target) {
    const i = fp.draw(r, used, p, s, max);
    if (i < 0) break;
    mods.push(fp.take(i, used));
    if (fp.side[i] === 0) p++;
    else s++;
  }
  return mods;
}

/** One reforge to rare: kept mods + random up to 4–6. */
export function reforge(fp: FastPool, r: () => number, kept: readonly ModDef[]): ModDef[] {
  return fill(fp, r, [...kept], pickModCount(r));
}

/** Magic item after Alteration + Augmentation: one prefix and one suffix (weight-proportional per side). */
export function magicPair(fp: FastPool, r: () => number): ModDef[] {
  const used = fp.usedFor([]);
  const out: ModDef[] = [];
  const a = fp.draw(r, used, 0, 0, 1, 0);
  if (a >= 0) out.push(fp.take(a, used));
  const b = fp.draw(r, used, 0, 0, 1, 1);
  if (b >= 0) out.push(fp.take(b, used));
  return out;
}

/** Counts targets met by `mods`. */
export function targetsHit(mods: readonly ModDef[], goal: Goal, tierOf: (m: ModDef) => number): number {
  let n = 0;
  for (const t of goal.targets) if (mods.some((m) => m.family === t.family && m.gen === t.gen && tierOf(m) <= t.maxTier)) n++;
  return n;
}

export const needOf = (goal: Goal) => Math.min(goal.need, goal.targets.length);
