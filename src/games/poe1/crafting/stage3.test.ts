import { describe, expect, it } from "vitest";
import { addChance, reforgeChance, taggedReforgeChance } from "./engine";
import { Emulator, lockedSide, META, type EmuItem } from "./emulator";
import fixture from "./fixtures/poe1-subset.json";
import { compareMethods } from "./methods";
import { benchCraftFor, nextSteps } from "./nextsteps";
import { CraftingIndex, families, type Pool } from "./pool";
import { FastPool, fill, reforge, targetsHit } from "./sampler";
import { rng } from "./simulate";
import type { CraftingData, Goal, ItemSpec, ModDef } from "./types";

const data = fixture as unknown as CraftingData;
const idx = new CraftingIndex(data);
const circlet = data.bases.find((b) => b.name === "Hubris Circlet")!;
const spec: ItemSpec = { base: circlet, ilvl: 86, influences: [], fixed: [] };
const pool = idx.pool(spec);
const tierOf = (m: ModDef) => idx.tierForMod(pool, m);
const fam = (p: Pool, re: RegExp, gen: "prefix" | "suffix") => families(p).find((f) => f.gen === gen && re.test(f.best.mod.text))!;
const life = fam(pool, /^\+\(\d+-\d+\) to maximum Life$/, "prefix");
const es = fam(pool, /^\+\(\d+-\d+\) to maximum Energy Shield$/, "prefix");
const fire = fam(pool, /^\+\(\d+-\d+\)% to Fire Resistance$/, "suffix");
const cold = fam(pool, /^\+\(\d+-\d+\)% to Cold Resistance$/, "suffix");
const goal: Goal = {
  targets: [
    { family: life.family, gen: "prefix", maxTier: 4 },
    { family: fire.family, gen: "suffix", maxTier: 4 },
    { family: cold.family, gen: "suffix", maxTier: 4 },
  ],
  need: 3,
};

function sim(n: number, f: (r: () => number) => ModDef[], seed = 11) {
  const r = rng(seed);
  let hits = 0;
  for (let i = 0; i < n; i++) if (targetsHit(f(r), goal, tierOf) >= 3) hits++;
  return hits / n;
}
function close(model: number, simulated: number, n: number) {
  const se = Math.sqrt(Math.max(simulated * (1 - simulated), 1e-4) / n);
  expect(Math.abs(model - simulated)).toBeLessThanOrEqual(4 * se + 0.05 * simulated);
}

describe("stage 3 model vs exact simulation", () => {
  const fp = new FastPool(pool);
  const N = 40_000;
  const keptLife = [life.best.mod];

  it("locked prefixes: reroll suffixes only", () => {
    const model = reforgeChance(pool, goal, tierOf, keptLife, { lock: "prefix" });
    close(model, sim(N, (r) => reforge(fp, r, keptLife, { lock: 0 })), N);
  });

  it("Harvest reforge with a guaranteed tag (with and without a lock)", () => {
    close(taggedReforgeChance(pool, goal, tierOf, "cold"), sim(N, (r) => reforge(fp, r, [], { tag: "cold" })), N);
    close(
      taggedReforgeChance(pool, goal, tierOf, "fire", keptLife, { lock: "prefix" }),
      sim(N, (r) => reforge(fp, r, keptLife, { lock: 0, tag: "fire" })),
      N,
    );
  });

  it("single added mod (Exalt / Eldritch Exalt)", () => {
    const current = [life.best.mod, fire.best.mod, es.best.mod];
    close(addChance(pool, goal, tierOf, current), sim(N, (r) => fill(fp, r, [...current], 4)), N);
    close(addChance(pool, goal, tierOf, current, "suffix"), sim(N, (r) => fill(fp, r, [...current], 4, 3, 1)), N);
    expect(addChance(pool, goal, tierOf, current, "prefix")).toBe(0);
  });
});

describe("metamods and Eldritch in the emulator", () => {
  const r = rng(5);
  const lockP = benchCraftFor(idx, "Helmet", META.lockPrefixes)!;
  const rare: EmuItem = {
    rarity: "rare",
    mods: [
      { mod: life.best.mod, text: "+100 to maximum Life" },
      { mod: es.best.mod, text: "+40 to maximum Energy Shield" },
      { mod: fire.best.mod, text: "+40% to Fire Resistance" },
    ],
  };
  const ok = (x: EmuItem | { error: string }) => {
    if ("error" in x) throw new Error(x.error);
    return x;
  };

  it("bench data has the metamods with Divine costs", () => {
    expect(lockP.cost.some(([n]) => n === "Divine Orb")).toBe(true);
    expect(benchCraftFor(idx, "Helmet", META.noAttack)).toBeDefined();
  });

  it("locked prefixes survive Chaos, Scour and Annul; the metamod goes with the suffixes", () => {
    const emu = new Emulator(idx, spec);
    const locked = ok(emu.apply(rare, { kind: "bench", craft: lockP }, r));
    expect(lockedSide(locked)).toBe("prefix");
    expect("error" in emu.apply(locked, { kind: "bench", craft: lockP }, r)).toBe(true); // one crafted mod
    for (let i = 0; i < 30; i++) {
      const c = ok(emu.apply(locked, { kind: "chaos" }, r));
      expect(c.mods.filter((m) => m.mod.gen === "prefix").map((m) => m.text)).toEqual(["+100 to maximum Life", "+40 to maximum Energy Shield"]);
      expect(lockedSide(c)).toBeNull();
    }
    const scoured = ok(emu.apply(locked, { kind: "scouring" }, r));
    expect(scoured.rarity).toBe("rare");
    expect(scoured.mods.map((m) => m.mod.gen)).toEqual(["prefix", "prefix"]);
    for (let i = 0; i < 20; i++) expect(ok(emu.apply(locked, { kind: "annulment" }, r)).mods.filter((m) => m.mod.gen === "prefix")).toHaveLength(2);
  });

  it("essences and fossils ignore the lock", () => {
    const emu = new Emulator(idx, spec);
    const locked = ok(emu.apply(rare, { kind: "bench", craft: lockP }, r));
    const pristine = data.fossils.find((f) => f.name === "Pristine Fossil")!;
    let changed = false;
    for (let i = 0; i < 20; i++) {
      const f = ok(emu.apply(locked, { kind: "fossil", fossils: [pristine] }, r));
      if (!f.mods.some((m) => m.text === "+100 to maximum Life")) changed = true;
    }
    expect(changed).toBe(true);
  });

  it("Eldritch currency acts on the dominant side only", () => {
    const none = new Emulator(idx, spec, null);
    expect("error" in none.apply(rare, { kind: "eldritchChaos" }, r)).toBe(true);
    const eater = new Emulator(idx, spec, "suffix");
    for (let i = 0; i < 30; i++) {
      const c = ok(eater.apply(rare, { kind: "eldritchChaos" }, r));
      expect(c.mods.filter((m) => m.mod.gen === "prefix").map((m) => m.text)).toEqual(["+100 to maximum Life", "+40 to maximum Energy Shield"]);
      const a = ok(eater.apply(rare, { kind: "eldritchAnnul" }, r));
      expect(a.mods.filter((m) => m.mod.gen === "prefix")).toHaveLength(2);
      const x = ok(eater.apply(rare, { kind: "eldritchExalt" }, r));
      expect(x.mods.filter((m) => m.mod.gen === "suffix")).toHaveLength(2);
    }
  });

  it("Harvest reforge always includes the tag", () => {
    const emu = new Emulator(idx, spec);
    for (let i = 0; i < 30; i++) expect(ok(emu.apply(rare, { kind: "harvest", tag: "cold" }, r)).mods.some((m) => m.mod.tags.includes("cold"))).toBe(true);
  });
});

describe("next steps and ranking", () => {
  // Test prices only (not market data).
  const prices = { "Exalted Orb": 2, "Divine Orb": 150, "Sacred Orb": 5, "Eldritch Chaos Orb": 3, "Eldritch Exalted Orb": 4, "Vivid Crystallised Lifeforce": 0.05 };
  const item: EmuItem = {
    rarity: "rare",
    mods: [
      { mod: life.best.mod, text: "+100 to maximum Life" },
      { mod: fire.best.mod, text: "+40% to Fire Resistance" },
    ],
  };

  it("offers Exalt, metacraft and Eldritch steps with sensible chances", () => {
    const steps = nextSteps(idx, spec, item, goal, prices, "suffix");
    const ids = steps.map((s) => s.id);
    expect(ids).toContain("exalt");
    expect(ids).toContain("eldritch-exalt");
    expect(ids).toContain("lock-chaos:prefix");
    const exalt = steps.find((s) => s.id === "exalt")!;
    const eex = steps.find((s) => s.id === "eldritch-exalt")!;
    expect(eex.chance).toBeGreaterThan(exalt.chance); // only suffixes can roll
    expect(steps.find((s) => s.id === "lock-chaos:prefix")!.repeatable).toBe(true);
  });

  it("nothing to do when the goal is met", () => {
    const done: EmuItem = { rarity: "rare", mods: [...item.mods, { mod: cold.best.mod, text: "+40% to Cold Resistance" }] };
    expect(nextSteps(idx, spec, done, goal, prices, null)).toEqual([]);
  });

  it("Harvest methods appear in the ranking", () => {
    const res = compareMethods(idx, { spec, goal, prices });
    expect(res.some((m) => m.kind === "harvest")).toBe(true);
  });
});
