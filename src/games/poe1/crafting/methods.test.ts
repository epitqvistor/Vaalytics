import { describe, expect, it } from "vitest";
import fixture from "./fixtures/poe1-subset.json";
import { compareMethods, type PriceTable } from "./methods";
import { CraftingIndex, families } from "./pool";
import type { CraftingData, Goal } from "./types";

const data = fixture as unknown as CraftingData;
const idx = new CraftingIndex(data);
const circlet = data.bases.find((b) => b.name === "Hubris Circlet")!;

// Test prices only (not market data).
const prices: PriceTable = {
  "Orb of Alteration": 0.1,
  "Orb of Augmentation": 0.05,
  "Regal Orb": 0.5,
  "Orb of Scouring": 0.3,
  "Orb of Transmutation": 0.05,
  "Pristine Fossil": 2,
  "Prismatic Fossil": 3,
  "Potent Chaotic Resonator": 1,
  "Primitive Chaotic Resonator": 0.5,
  "Powerful Chaotic Resonator": 2,
};

describe("method comparison", () => {
  const spec = { base: circlet, ilvl: 86, influences: [], fixed: [] };
  const pool = idx.pool(spec);
  const fam = (re: RegExp, gen: "prefix" | "suffix") => families(pool).find((f) => f.gen === gen && re.test(f.best.mod.text))!;
  const life = fam(/^\+\(\d+-\d+\) to maximum Life$/, "prefix");
  const fire = fam(/^\+\(\d+-\d+\)% to Fire Resistance$/, "suffix");
  const goal: Goal = {
    targets: [
      { family: life.family, gen: "prefix", maxTier: 3 },
      { family: fire.family, gen: "suffix", maxTier: 3 },
    ],
    need: 2,
  };
  const res = compareMethods(idx, { spec, goal, prices });

  it("ranks by expected cost, priced methods first", () => {
    expect(res.length).toBeGreaterThan(3);
    const priced = res.filter((m) => m.avgCost !== null).map((m) => m.avgCost!);
    expect(priced).toEqual([...priced].sort((a, b) => a - b));
    const firstUnpriced = res.findIndex((m) => m.avgCost === null);
    if (firstUnpriced >= 0) expect(res.slice(firstUnpriced).every((m) => m.avgCost === null)).toBe(true);
  });

  it("finds a fossil that favours life and an elemental fossil", () => {
    const fossil = res.filter((m) => m.kind === "fossil");
    expect(fossil.length).toBeGreaterThan(0);
    expect(fossil.some((m) => m.label.includes("Pristine"))).toBe(true);
    const chaos = res.find((m) => m.kind === "chaos")!;
    expect(fossil[0]!.chance).toBeGreaterThan(chaos.chance);
  });

  it("never invents prices", () => {
    const essences = res.filter((m) => m.kind === "essence");
    expect(essences.length).toBeGreaterThan(0);
    for (const e of essences) {
      expect(e.avgCost).toBeNull();
      expect(e.missingPrices).toContain(e.label);
    }
    expect(res.find((m) => m.kind === "chaos")!.costPerTry).toBe(1);
  });

  it("alt/aug cost follows the magic chance", () => {
    const alt = res.find((m) => m.id === "alt")!;
    expect(alt.costPerTry).toBeCloseTo(0.15, 10);
    expect(alt.avgCost).toBeCloseTo(0.15 / alt.chance, 6);
  });
});
