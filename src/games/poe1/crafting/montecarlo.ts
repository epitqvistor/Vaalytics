/**
 * Monte Carlo for one method: simulates attempts with the exact sampler to
 * measure the success rate and the cost of failed / successful attempts, then
 * samples many complete crafts (geometric number of attempts) for the spread.
 */
import type { MethodResult, PriceTable } from "./methods";
import { ESSENCE_CLASS, type CraftingIndex } from "./pool";
import { FastPool, magicPair, fill, needOf, reforge, targetsHit } from "./sampler";
import { rng } from "./simulate";
import type { Goal, ItemSpec, ModDef } from "./types";

export interface McInput {
  spec: ItemSpec;
  goal: Goal;
  method: MethodResult;
  prices: PriceTable;
  /** Wall-clock budget for attempts. */
  budgetMs?: number;
  maxAttempts?: number;
  crafts?: number;
  seed?: number;
}

export interface McResult {
  attempts: number;
  hits: number;
  /** Measured chance per attempt. */
  chance: number;
  /** No hits were seen: the spread below uses the model chance instead. */
  usedModel: boolean;
  modelChance: number;
  /** Chaos; null when a price is missing. */
  cost: { mean: number; p25: number; p50: number; p75: number; p90: number } | null;
  tries: { p25: number; p50: number; p75: number; p90: number };
  histogram: { from: number; to: number; count: number }[];
  crafts: number;
}

type Attempt = (r: () => number) => { ok: boolean; spent: string[] };

/** Builds the attempt function for a method id produced by methods.ts. */
export function attemptFor(idx: CraftingIndex, spec: ItemSpec, goal: Goal, method: MethodResult): Attempt {
  const need = needOf(goal);
  const plain = idx.pool(spec);
  const tierOf = (m: ModDef) => idx.tierForMod(plain, m);
  const hit = (mods: ModDef[]) => targetsHit(mods, goal, tierOf) >= need;
  const names = method.components.map((c) => c.name);

  if (method.id === "chaos") {
    const fp = new FastPool(plain);
    return (r) => ({ ok: hit(reforge(fp, r, spec.fixed)), spent: names });
  }
  if (method.id.startsWith("fossil:")) {
    const ids = method.id.slice(7).split("+");
    const fossils = idx.data.fossils.filter((f) => ids.includes(f.id));
    const fp = new FastPool(idx.pool(spec, fossils));
    return (r) => ({ ok: hit(reforge(fp, r, spec.fixed)), spent: names });
  }
  if (method.id.startsWith("essence:")) {
    const e = idx.data.essences.find((x) => x.id === method.id.slice(8))!;
    const mod = idx.modById.get(e.mods[spec.base.itemClass] ?? e.mods[ESSENCE_CLASS[spec.base.itemClass] ?? ""]!)!;
    const fp = new FastPool(plain);
    return (r) => ({ ok: hit(reforge(fp, r, [...spec.fixed, mod])), spent: names });
  }
  const fp = new FastPool(plain);
  if (method.id === "alt") {
    return (r) => ({ ok: hit(magicPair(fp, r)), spent: ["Orb of Alteration", "Orb of Augmentation"] });
  }
  if (method.id === "alt-regal") {
    return (r) => {
      const mods = magicPair(fp, r);
      const n = targetsHit(mods, goal, tierOf);
      if (n < need - 1) return { ok: false, spent: ["Orb of Alteration", "Orb of Augmentation"] };
      const ok = targetsHit(fill(fp, r, mods, mods.length + 1), goal, tierOf) >= need;
      const spent = ["Orb of Alteration", "Orb of Augmentation", "Regal Orb"];
      return { ok, spent: ok ? spent : [...spent, "Orb of Scouring", "Orb of Transmutation"] };
    };
  }
  throw new Error(`Monte Carlo isn't available for ${method.label}.`);
}

const pct = (sorted: Float64Array, q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

export async function runMonteCarlo(
  idx: CraftingIndex,
  input: McInput,
  onProgress: (p: { fraction: number; attempts: number; hits: number }) => void,
  cancelled: () => boolean,
): Promise<McResult | null> {
  const { spec, goal, method, prices, budgetMs = 2500, maxAttempts = 2_000_000, crafts = 10_000, seed = Date.now() } = input;
  const attempt = attemptFor(idx, spec, goal, method);
  const r = rng(seed);
  const price = (n: string): number | null => (n === "Chaos Orb" ? 1 : (prices[n] ?? null));
  const costOf = (names: string[]) => names.reduce<number | null>((s, n) => (s === null || price(n) === null ? null : s + price(n)!), 0);

  let attempts = 0;
  let hits = 0;
  let failCost = 0;
  let okCost = 0;
  let priced = true;
  const start = performance.now();
  while (attempts < maxAttempts) {
    const chunkEnd = Math.min(maxAttempts, attempts + 2000);
    for (; attempts < chunkEnd; ) {
      const a = attempt(r);
      attempts++;
      const c = costOf(a.spent);
      if (c === null) priced = false;
      if (a.ok) {
        hits++;
        okCost += c ?? 0;
      } else failCost += c ?? 0;
    }
    const elapsed = performance.now() - start;
    onProgress({ fraction: Math.min(1, Math.max(elapsed / budgetMs, attempts / maxAttempts)), attempts, hits });
    if (cancelled()) return null;
    if (elapsed >= budgetMs) break;
    await new Promise((res) => setTimeout(res, 0));
  }

  const modelChance = method.chance;
  const usedModel = hits === 0;
  const chance = usedModel ? modelChance : hits / attempts;
  // Mean costs per attempt; when nothing hit, a success costs the same as a failure.
  const cFail = attempts - hits > 0 ? failCost / (attempts - hits) : okCost / Math.max(hits, 1);
  const cOk = hits > 0 ? okCost / hits : cFail;

  const triesArr = new Float64Array(crafts);
  for (let i = 0; i < crafts; i++) {
    triesArr[i] = chance >= 1 ? 1 : chance <= 0 ? Infinity : Math.max(1, Math.ceil(Math.log(1 - r()) / Math.log(1 - chance)));
  }
  triesArr.sort();
  const costs = triesArr.map((n) => (n - 1) * cFail + cOk);
  const tries = { p25: pct(triesArr, 0.25), p50: pct(triesArr, 0.5), p75: pct(triesArr, 0.75), p90: pct(triesArr, 0.9) };
  const values = priced ? costs : triesArr;
  const top = pct(values, 0.98);
  const bins = 24;
  const width = top / bins || 1;
  const histogram = Array.from({ length: bins }, (_, i) => ({ from: i * width, to: (i + 1) * width, count: 0 }));
  for (const v of values) if (Number.isFinite(v)) histogram[Math.min(bins - 1, Math.floor(v / width))]!.count++;

  return {
    attempts,
    hits,
    chance,
    usedModel,
    modelChance,
    crafts,
    tries,
    histogram,
    cost: priced
      ? { mean: cFail * (1 / chance - 1) + cOk, p25: pct(costs, 0.25), p50: pct(costs, 0.5), p75: pct(costs, 0.75), p90: pct(costs, 0.9) }
      : null,
  };
}
