import { describe, expect, it } from "vitest";
import { magicChance, reforgeChance, triesFor } from "./engine";
import fixture from "./fixtures/poe1-subset.json";
import { CraftingIndex, families, type Pool } from "./pool";
import { meetsGoal, rng, rollRare } from "./simulate";
import type { CraftingData, Goal, ItemSpec, ModDef } from "./types";

const data = fixture as unknown as CraftingData;
const idx = new CraftingIndex(data);
const base = (name: string) => data.bases.find((b) => b.name === name)!;
const spec = (name: string, extra: Partial<ItemSpec> = {}): ItemSpec => ({ base: base(name), ilvl: 86, influences: [], fixed: [], ...extra });
const fossil = (name: string) => data.fossils.find((f) => f.name === name)!;
const tierOf = (pool: Pool) => (m: ModDef) => idx.tierForMod(pool, m);

function simulate(pool: Pool, goal: Goal, n: number, extra: ModDef[] = [], seed = 7) {
  const r = rng(seed);
  const t = tierOf(pool);
  let hits = 0;
  for (let i = 0; i < n; i++) if (meetsGoal(rollRare(pool, r, extra), goal, t)) hits++;
  return hits / n;
}

/** Simulation tolerance: 4 standard errors plus 5 % model slack. */
function expectClose(model: number, sim: number, n: number) {
  const se = Math.sqrt(Math.max(sim * (1 - sim), 1e-4) / n);
  expect(Math.abs(model - sim)).toBeLessThanOrEqual(4 * se + 0.05 * sim);
}

const fam = (pool: Pool, text: RegExp, gen: "prefix" | "suffix") => {
  const row = families(pool).find((f) => f.gen === gen && text.test(f.best.mod.text));
  if (!row) throw new Error(`no family ${text}`);
  return row;
};

describe("crafting pool", () => {
  it("applies item level, spawn tags and tiers", () => {
    const pool = idx.pool(spec("Two-Stone Ring"));
    const life = fam(pool, /^\+\(\d+-\d+\) to maximum Life$/, "prefix");
    expect(life.best.tier).toBe(1);
    expect(life.tiers.every((t) => t.mod.level <= 86)).toBe(true);
    const low = idx.pool(spec("Two-Stone Ring", { ilvl: 30 }));
    expect(fam(low, /^\+\(\d+-\d+\) to maximum Life$/, "prefix").best.tier).toBeGreaterThan(1);
    // No weapon-only mods on a ring.
    expect(pool.mods.some((m) => /Physical Damage$/.test(m.mod.text) && m.mod.text.includes("increased"))).toBe(false);
  });

  it("adds influenced mods only with the influence", () => {
    const plain = idx.pool(spec("Two-Stone Ring"));
    const shaper = idx.pool(spec("Two-Stone Ring", { influences: ["Shaper"] }));
    expect(shaper.mods.length).toBeGreaterThan(plain.mods.length);
    expect(plain.mods.some((m) => m.mod.spawn.some(([t]) => t === "ring_shaper"))).toBe(false);
  });

  it("fossils reweight by tag and block", () => {
    const plain = idx.pool(spec("Hubris Circlet"));
    const pristine = idx.pool(spec("Hubris Circlet"), [fossil("Pristine Fossil")]);
    const lifeW = (p: Pool) => p.mods.filter((m) => m.mod.tags.includes("life") && !m.mod.tags.includes("defences")).reduce((s, m) => s + m.weight, 0);
    expect(lifeW(pristine)).toBe(lifeW(plain) * 10);
    expect(pristine.mods.some((m) => m.mod.tags.includes("defences"))).toBe(false);
  });
});

describe("reforge chance vs exact simulation", () => {
  const N = 40_000;
  it("one prefix, any tier ≤ 2 (ring)", () => {
    const pool = idx.pool(spec("Two-Stone Ring"));
    const life = fam(pool, /^\+\(\d+-\d+\) to maximum Life$/, "prefix");
    const goal: Goal = { targets: [{ family: life.family, gen: "prefix", maxTier: 2 }], need: 1 };
    expectClose(reforgeChance(pool, goal, tierOf(pool)), simulate(pool, goal, N), N);
  });

  it("prefix + suffix AND (ring)", () => {
    const pool = idx.pool(spec("Two-Stone Ring"));
    const life = fam(pool, /^\+\(\d+-\d+\) to maximum Life$/, "prefix");
    const res = fam(pool, /^\+\(\d+-\d+\)% to Fire Resistance$/, "suffix");
    const goal: Goal = {
      targets: [
        { family: life.family, gen: "prefix", maxTier: 4 },
        { family: res.family, gen: "suffix", maxTier: 3 },
      ],
      need: 2,
    };
    expectClose(reforgeChance(pool, goal, tierOf(pool)), simulate(pool, goal, N), N);
  });

  it("2 of 3 suffixes with fossils (circlet)", () => {
    const pool = idx.pool(spec("Hubris Circlet"), [fossil("Prismatic Fossil")]);
    const ids = [/Fire Resistance$/, /Cold Resistance$/, /Lightning Resistance$/].map((re) => fam(pool, new RegExp(`^\\+\\(\\d+-\\d+\\)% to ${re.source}`), "suffix"));
    const goal: Goal = { targets: ids.map((f) => ({ family: f.family, gen: "suffix" as const, maxTier: 3 })), need: 2 };
    expectClose(reforgeChance(pool, goal, tierOf(pool)), simulate(pool, goal, N), N);
  });

  it("essence-guaranteed mod plus a fractured mod (foil)", () => {
    const pool0 = idx.pool(spec("Jewelled Foil"));
    const crit = fam(pool0, /Critical Strike Chance$/, "suffix");
    const pool = idx.pool(spec("Jewelled Foil", { fixed: [crit.best.mod] }));
    const ess = data.essences.find((e) => e.name === "Deafening Essence of Contempt")!;
    const essMod = idx.modById.get(ess.mods["One Hand Sword"]!)!;
    const speed = fam(pool, /Attack Speed$/, "suffix");
    const goal: Goal = {
      targets: [
        { family: essMod.family, gen: essMod.gen, maxTier: 99 },
        { family: speed.family, gen: "suffix", maxTier: 3 },
      ],
      need: 2,
    };
    const model = reforgeChance(pool, goal, tierOf(pool), [essMod]);
    expectClose(model, simulate(pool, goal, N, [essMod]), N);
    expect(model).toBeGreaterThan(0);
  });
});

describe("magic chance", () => {
  it("matches independent prefix × suffix draws", () => {
    const pool = idx.pool(spec("Two-Stone Ring"));
    const life = fam(pool, /^\+\(\d+-\d+\) to maximum Life$/, "prefix");
    const res = fam(pool, /^\+\(\d+-\d+\)% to Fire Resistance$/, "suffix");
    const goal: Goal = {
      targets: [
        { family: life.family, gen: "prefix", maxTier: 3 },
        { family: res.family, gen: "suffix", maxTier: 2 },
      ],
      need: 2,
    };
    const w = (gen: string, f?: string, t = 99) =>
      pool.mods.filter((m) => m.mod.gen === gen && (!f || (m.mod.family === f && m.tier <= t))).reduce((s, m) => s + m.weight, 0);
    const exact = (w("prefix", life.family, 3) / w("prefix")) * (w("suffix", res.family, 2) / w("suffix"));
    expect(magicChance(pool, goal).magic).toBeCloseTo(exact, 10);
  });
});

it("tries for a confidence level", () => {
  expect(triesFor(0.5, 0.5)).toBe(1);
  expect(triesFor(0.01, 0.63)).toBe(99);
  expect(triesFor(0, 0.9)).toBe(Infinity);
});
