/**
 * Probability model for reforging a rare (Chaos, Fossil, Essence) and for
 * Alteration/Augmentation/Regal on a magic item.
 *
 * Model (the same one community calculators use):
 * - a reforge rolls N explicit mods in total, N ∈ {4, 5, 6} with RARE_MOD_COUNT
 *   odds; fixed mods (fractured, essence) count toward N;
 * - mods are drawn one at a time, proportional to weight, from every mod whose
 *   side (max 3 prefixes / 3 suffixes) has room and whose group is not on the item.
 *
 * Mods relevant to the goal are tracked exactly. All other mods are merged per
 * side; drawing one removes its group's weight, estimated with a size-biased
 * mean-field update. `simulate.ts` samples the exact process and the tests
 * check that both agree.
 */
import type { Pool } from "./pool";
import type { Gen, Goal, ModDef } from "./types";

/**
 * Odds of 4/5/6 explicit mods on a reforged rare. Not published by GGG; this is
 * the widely used community figure (8/12, 3/12, 1/12), consistent with recorded
 * Chaos Orb samples.
 */
export const RARE_MOD_COUNT: readonly [mods: number, chance: number][] = [
  [4, 8 / 12],
  [5, 3 / 12],
  [6, 1 / 12],
];
export const MAX_PER_SIDE = 3;

interface Klass {
  gen: Gen;
  weight: number;
  hit: number;
  block: number;
}

export interface Prepared {
  classes: Klass[];
  /** Expected remaining weight of unrelated mods after k of them were drawn, per side. */
  other: Record<Gen, number[]>;
  nTargets: number;
  need: number;
  /** Groups of each target family (used to tell which mods block a target). */
  targetGroups: Set<string>[];
}

const popcount = (x: number) => {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
};

/** Size-biased mean-field: expected weight left after k group draws. */
function remainingAfterDraws(groupWeights: number[], maxK: number): number[] {
  const surv = groupWeights.map(() => 1);
  const out: number[] = [];
  for (let k = 0; k <= maxK; k++) {
    const total = groupWeights.reduce((s, w, i) => s + w * surv[i]!, 0);
    out.push(total);
    if (total <= 0) {
      for (let j = k + 1; j <= maxK; j++) out.push(0);
      break;
    }
    groupWeights.forEach((w, i) => (surv[i]! *= 1 - w / total));
  }
  return out;
}

export function targetMasks(mod: ModDef, tier: number, goal: Goal, targetGroups: Set<string>[]) {
  let hit = 0;
  let block = 0;
  goal.targets.forEach((t, i) => {
    if (mod.family === t.family && mod.gen === t.gen && tier <= t.maxTier) hit |= 1 << i;
    if (mod.groups.some((g) => targetGroups[i]!.has(g))) block |= 1 << i;
  });
  return { hit, block: block | hit };
}

/** Groups a target can occupy: the groups of every mod of its family. */
export function groupsOfTargets(pool: Pool, goal: Goal, extra: readonly ModDef[] = []): Set<string>[] {
  return goal.targets.map((t) => {
    const s = new Set<string>();
    for (const pm of pool.mods) if (pm.mod.family === t.family) pm.mod.groups.forEach((g) => s.add(g));
    for (const m of extra) if (m.family === t.family) m.groups.forEach((g) => s.add(g));
    return s;
  });
}

export function prepare(pool: Pool, goal: Goal, extraFixed: readonly ModDef[] = []): Prepared {
  const targetGroups = groupsOfTargets(pool, goal, [...pool.spec.fixed, ...extraFixed]);
  const extraGroups = new Set(extraFixed.flatMap((m) => m.groups));
  const byKey = new Map<string, Klass>();
  const other: Record<Gen, Map<string, number>> = { prefix: new Map(), suffix: new Map() };
  for (const pm of pool.mods) {
    if (pm.mod.groups.some((g) => extraGroups.has(g))) continue;
    const { hit, block } = targetMasks(pm.mod, pm.tier, goal, targetGroups);
    if (block === 0) {
      const g = pm.mod.groups.join("|") || pm.mod.id;
      other[pm.mod.gen].set(g, (other[pm.mod.gen].get(g) ?? 0) + pm.weight);
      continue;
    }
    const key = `${pm.mod.gen}:${hit}:${block}`;
    const k = byKey.get(key);
    if (k) k.weight += pm.weight;
    else byKey.set(key, { gen: pm.mod.gen, weight: pm.weight, hit, block });
  }
  return {
    classes: [...byKey.values()],
    other: { prefix: remainingAfterDraws([...other.prefix.values()], 6), suffix: remainingAfterDraws([...other.suffix.values()], 6) },
    nTargets: goal.targets.length,
    need: Math.min(goal.need, goal.targets.length),
    targetGroups,
  };
}

/** Initial item state from fixed mods (fractured + e.g. an essence mod). */
export function fixedState(goal: Goal, fixed: readonly ModDef[], tierOf: (m: ModDef) => number, targetGroups: Set<string>[]) {
  let sat = 0;
  let blk = 0;
  let p = 0;
  let s = 0;
  for (const m of fixed) {
    const { hit, block } = targetMasks(m, tierOf(m), goal, targetGroups);
    sat |= hit;
    blk |= block;
    if (m.gen === "prefix") p++;
    else s++;
  }
  return { sat, blk, p, s };
}

export interface DrawState {
  p: number;
  s: number;
  sat: number;
  blk: number;
  kp: number;
  ks: number;
}

/** Probability that `draws` more random mods reach the goal from `st`. */
export function successFrom(prep: Prepared, st: DrawState, draws: number, memo = new Map<string, number>()): number {
  const rec = (p: number, s: number, sat: number, blk: number, kp: number, ks: number, left: number): number => {
    const have = popcount(sat);
    if (have >= prep.need) return 1;
    const full = (1 << prep.nTargets) - 1;
    if (have + popcount(full & ~blk) < prep.need) return 0;
    if (left <= 0 || (p >= MAX_PER_SIDE && s >= MAX_PER_SIDE)) return 0;
    const key = `${p}${s}${sat}.${blk}.${kp}${ks}${left}`;
    const hitMemo = memo.get(key);
    if (hitMemo !== undefined) return hitMemo;

    const openP = p < MAX_PER_SIDE;
    const openS = s < MAX_PER_SIDE;
    let total = 0;
    let acc = 0;
    for (const c of prep.classes) {
      if ((c.block & blk) !== 0 || (c.gen === "prefix" ? !openP : !openS)) continue;
      total += c.weight;
      acc += c.weight * rec(p + (c.gen === "prefix" ? 1 : 0), s + (c.gen === "suffix" ? 1 : 0), sat | c.hit, blk | c.block, kp, ks, left - 1);
    }
    const op = openP ? (prep.other.prefix[kp] ?? 0) : 0;
    const os = openS ? (prep.other.suffix[ks] ?? 0) : 0;
    if (op > 0) {
      total += op;
      acc += op * rec(p + 1, s, sat, blk, kp + 1, ks, left - 1);
    }
    if (os > 0) {
      total += os;
      acc += os * rec(p, s + 1, sat, blk, kp, ks + 1, left - 1);
    }
    const r = total > 0 ? acc / total : 0;
    memo.set(key, r);
    return r;
  };
  return rec(st.p, st.s, st.sat, st.blk, st.kp, st.ks, draws);
}

/**
 * Chance that one reforge (Chaos / Fossil / Essence) meets the goal.
 * `extraFixed` are mods the method guarantees (an essence mod).
 */
export function reforgeChance(
  pool: Pool,
  goal: Goal,
  tierOf: (m: ModDef) => number,
  extraFixed: readonly ModDef[] = [],
  opts: { lock?: Gen } = {},
): number {
  if (!goal.targets.length) return 0;
  const prep = prepare(pool, goal, extraFixed);
  const fixed = [...pool.spec.fixed, ...extraFixed];
  const st0 = fixedState(goal, fixed, tierOf, prep.targetGroups);
  if (st0.p > MAX_PER_SIDE || st0.s > MAX_PER_SIDE) return 0;
  // A locked side ("cannot be changed", Eldritch dominance) gets no new mods.
  if (opts.lock === "prefix") st0.p = MAX_PER_SIDE;
  if (opts.lock === "suffix") st0.s = MAX_PER_SIDE;
  const memo = new Map<string, number>();
  let chance = 0;
  for (const [n, odds] of RARE_MOD_COUNT) {
    chance += odds * successFrom(prep, { ...st0, kp: 0, ks: 0 }, Math.max(0, n - fixed.length), memo);
  }
  return chance;
}

export interface MagicOutcome {
  /** Chance the magic item (1 prefix + 1 suffix after Augmentation) meets the goal. */
  magic: number;
  /** Chance that Alt/Aug then one Regal meets the goal, regalling only promising items. */
  regal: { promising: number; regalSuccess: number } | null;
}

/**
 * Alteration (+ Augmentation if only one mod rolled): the final prefix is
 * weight-proportional among prefixes and the suffix among suffixes, whatever
 * the 1-or-2 split of the Alteration roll.
 */
export function magicChance(pool: Pool, goal: Goal): MagicOutcome {
  const prep = prepare(pool, goal);
  type Opt = { w: number; hit: number; block: number; other: boolean };
  const side = (gen: Gen): Opt[] => {
    const opts: Opt[] = prep.classes.filter((c) => c.gen === gen).map((c) => ({ w: c.weight, hit: c.hit, block: c.block, other: false }));
    const ow = prep.other[gen][0] ?? 0;
    if (ow > 0) opts.push({ w: ow, hit: 0, block: 0, other: true });
    return opts;
  };
  const pre = side("prefix");
  const suf = side("suffix");
  const wp = pre.reduce((s, o) => s + o.w, 0);
  const ws = suf.reduce((s, o) => s + o.w, 0);
  if (!wp || !ws) return { magic: 0, regal: null };

  let magic = 0;
  let promising = 0;
  let regalWeighted = 0;
  const memo = new Map<string, number>();
  for (const a of pre) {
    for (const b of suf) {
      const pr = (a.w / wp) * (b.w / ws);
      const sat = a.hit | b.hit;
      const have = popcount(sat);
      if (have >= prep.need) {
        magic += pr;
        continue;
      }
      if (have === prep.need - 1) {
        promising += pr;
        const st: DrawState = { p: 1, s: 1, sat, blk: a.block | b.block, kp: a.other ? 1 : 0, ks: b.other ? 1 : 0 };
        regalWeighted += pr * successFrom(prep, st, 1, memo);
      }
    }
  }
  return {
    magic,
    regal: promising > 0 && prep.need <= 3 ? { promising, regalSuccess: regalWeighted / promising } : null,
  };
}

/** Number of tries for a `confidence` chance of at least one success. */
export function triesFor(chance: number, confidence: number): number {
  if (chance >= 1) return 1;
  if (chance <= 0) return Infinity;
  return Math.ceil(Math.log(1 - confidence) / Math.log(1 - chance));
}

/**
 * Harvest "Reforge … including a <tag> modifier": one mod with the tag is
 * guaranteed (weight-proportional among rollable mods with that tag), the rest
 * is rolled as a normal reforge. `kept` stay (fractured, locked side).
 */
export function taggedReforgeChance(
  pool: Pool,
  goal: Goal,
  tierOf: (m: ModDef) => number,
  tag: string,
  kept: readonly ModDef[] = [],
  opts: { lock?: Gen } = {},
): number {
  if (!goal.targets.length) return 0;
  const used = new Set([...pool.spec.fixed, ...kept].flatMap((m) => m.groups));
  const all = [...pool.spec.fixed, ...kept];
  const room = (gen: Gen) => opts.lock !== gen && all.filter((m) => m.gen === gen).length < MAX_PER_SIDE;
  const tagged = pool.mods.filter((pm) => pm.mod.tags.includes(tag) && room(pm.mod.gen) && !pm.mod.groups.some((g) => used.has(g)));
  const total = tagged.reduce((s, pm) => s + pm.weight, 0);
  if (total <= 0) return 0;
  const targetGroups = groupsOfTargets(pool, goal, all);
  // Mods with the same effect on the goal share one evaluation.
  const memo = new Map<string, number>();
  let chance = 0;
  for (const pm of tagged) {
    const { hit, block } = targetMasks(pm.mod, pm.tier, goal, targetGroups);
    const key = block === 0 ? `${pm.mod.gen}:other` : `${pm.mod.gen}:${hit}:${block}`;
    let c = memo.get(key);
    if (c === undefined) {
      c = reforgeChance(pool, goal, tierOf, [...kept, pm.mod], opts);
      memo.set(key, c);
    }
    chance += (pm.weight / total) * c;
  }
  return chance;
}

/**
 * Chance that adding one random mod (Exalted Orb, Eldritch Exalted Orb with
 * `only`) to an item with `current` mods meets the goal.
 */
export function addChance(pool: Pool, goal: Goal, tierOf: (m: ModDef) => number, current: readonly ModDef[], only?: Gen): number {
  if (!goal.targets.length) return 0;
  const prep = prepare(pool, goal, current);
  const st = fixedState(goal, [...pool.spec.fixed, ...current], tierOf, prep.targetGroups);
  if (only === "prefix") st.s = MAX_PER_SIDE;
  if (only === "suffix") st.p = MAX_PER_SIDE;
  return successFrom(prep, { ...st, kp: 0, ks: 0 }, 1);
}
