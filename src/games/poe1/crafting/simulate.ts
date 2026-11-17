/**
 * Exact sampler of the reforge process (every mod and group tracked). Used by
 * the tests to validate engine.ts and by the Monte Carlo runner.
 */
import { MAX_PER_SIDE, RARE_MOD_COUNT } from "./engine";
import type { Pool } from "./pool";
import type { Goal, ModDef } from "./types";

/** Small fast deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickModCount(r: () => number): number {
  let x = r();
  for (const [n, odds] of RARE_MOD_COUNT) {
    if (x < odds) return n;
    x -= odds;
  }
  return RARE_MOD_COUNT[RARE_MOD_COUNT.length - 1]![0];
}

/** One reforge: returns the rolled mods (fixed first). */
export function rollRare(pool: Pool, r: () => number, extraFixed: readonly ModDef[] = []): ModDef[] {
  const fixed = [...pool.spec.fixed, ...extraFixed];
  const used = new Set(fixed.flatMap((m) => m.groups));
  let p = fixed.filter((m) => m.gen === "prefix").length;
  let s = fixed.length - p;
  const out = [...fixed];
  const n = pickModCount(r);
  while (out.length < n) {
    let total = 0;
    for (const pm of pool.mods) if (available(pm.mod, used, p, s)) total += pm.weight;
    if (total <= 0) break;
    let x = r() * total;
    for (const pm of pool.mods) {
      if (!available(pm.mod, used, p, s)) continue;
      x -= pm.weight;
      if (x < 0) {
        out.push(pm.mod);
        pm.mod.groups.forEach((g) => used.add(g));
        if (pm.mod.gen === "prefix") p++;
        else s++;
        break;
      }
    }
  }
  return out;
}

function available(m: ModDef, used: Set<string>, p: number, s: number) {
  if (m.gen === "prefix" ? p >= MAX_PER_SIDE : s >= MAX_PER_SIDE) return false;
  return !m.groups.some((g) => used.has(g));
}

export function meetsGoal(mods: readonly ModDef[], goal: Goal, tierOf: (m: ModDef) => number): boolean {
  let n = 0;
  for (const t of goal.targets) if (mods.some((m) => m.family === t.family && m.gen === t.gen && tierOf(m) <= t.maxTier)) n++;
  return n >= Math.min(goal.need, goal.targets.length);
}
