/**
 * Method cost comparison. Costs are in chaos, from live poe.ninja prices;
 * a method whose components have no price is listed without a cost.
 */
import { magicChance, reforgeChance, taggedReforgeChance, triesFor } from "./engine";
import { HARVEST_REFORGES } from "./harvest";
import { CraftingIndex, ESSENCE_CLASS, fossilAllowed, type Pool } from "./pool";
import type { EssenceDef, FossilDef, Goal, ItemSpec, ModDef } from "./types";

/** Item name → price in chaos (poe.ninja, PoE 1 base unit). */
export type PriceTable = Record<string, number>;

export const RESONATORS = ["Primitive Chaotic Resonator", "Potent Chaotic Resonator", "Powerful Chaotic Resonator", "Prime Chaotic Resonator"];
/** Essence tiers that can reforge a rare item. */
const RARE_ESSENCE_TIERS = /^(Shrieking|Deafening) Essence of /;
const MAX_FOSSILS = 3;
const FOSSIL_CANDIDATES = 8;

export interface Component {
  name: string;
  qty: number;
  price: number | null;
}

export interface MethodResult {
  id: string;
  kind: "chaos" | "alt" | "essence" | "fossil" | "harvest";
  label: string;
  detail?: string;
  /** Chance one try reaches the goal (for Alt/Regal: chance per Alteration, all steps included). */
  chance: number;
  /** Chaos per try; null when a price is missing. */
  costPerTry: number | null;
  /** Expected chaos to reach the goal. */
  avgCost: number | null;
  /** Expected tries. */
  avgTries: number;
  /** Chaos needed for a 50 / 63 / 90 % chance of success. */
  costAt: { p50: number; p63: number; p90: number } | null;
  components: Component[];
  notes: string[];
  missingPrices: string[];
}

const price = (prices: PriceTable, name: string): number | null => (name === "Chaos Orb" ? 1 : (prices[name] ?? null));

function finish(
  base: Omit<MethodResult, "costPerTry" | "avgCost" | "avgTries" | "costAt" | "missingPrices">,
  prices: PriceTable,
): MethodResult {
  const comps = base.components.map((c) => ({ ...c, price: price(prices, c.name) }));
  const missing = comps.filter((c) => c.price === null).map((c) => c.name);
  const per = missing.length ? null : comps.reduce((s, c) => s + c.qty * c.price!, 0);
  const avgTries = base.chance > 0 ? 1 / base.chance : Infinity;
  const at = (q: number) => (per === null ? NaN : triesFor(base.chance, q) * per);
  return {
    ...base,
    components: comps,
    costPerTry: per,
    avgTries,
    avgCost: per === null || base.chance <= 0 ? null : per / base.chance,
    costAt: per === null || base.chance <= 0 ? null : { p50: at(0.5), p63: at(0.63), p90: at(0.9) },
    missingPrices: missing,
  };
}

export interface CompareInput {
  spec: ItemSpec;
  goal: Goal;
  prices: PriceTable;
}

export function compareMethods(idx: CraftingIndex, { spec, goal, prices }: CompareInput): MethodResult[] {
  if (!goal.targets.length) return [];
  const pool = idx.pool(spec);
  const tierOf = (p: Pool) => (m: ModDef) => idx.tierForMod(p, m);
  const out: MethodResult[] = [];

  // 1. Chaos spam
  const chaos = reforgeChance(pool, goal, tierOf(pool));
  out.push(finish({ id: "chaos", kind: "chaos", label: "Chaos spam", chance: chaos, components: [{ name: "Chaos Orb", qty: 1, price: null }], notes: [] }, prices));

  // 2. Alteration / Augmentation (/ Regal)
  if (!spec.fixed.length) out.push(...altMethods(pool, goal, prices));

  // 3. Essences
  for (const e of idx.data.essences) {
    const r = essenceMethod(idx, pool, goal, e, prices);
    if (r) out.push(r);
  }

  // 4. Fossils
  out.push(...fossilMethods(idx, spec, goal, prices, chaos));

  // 5. Harvest reforges with a guaranteed tag (best three)
  out.push(...rank(harvestMethods(pool, goal, tierOf(pool), prices, chaos)).slice(0, 3));

  return rank(out);
}

export function rank(list: MethodResult[]): MethodResult[] {
  return [...list]
    .filter((m) => m.chance > 0)
    .sort((a, b) => (a.avgCost ?? Infinity) - (b.avgCost ?? Infinity) || b.chance - a.chance);
}

function altMethods(pool: Pool, goal: Goal, prices: PriceTable): MethodResult[] {
  const out: MethodResult[] = [];
  const { magic, regal } = magicChance(pool, goal);
  const note = "Assumes an Augmentation after every Alteration (upper bound: Augmentations are only needed when one mod rolls).";
  if (magic > 0) {
    out.push(
      finish(
        {
          id: "alt",
          kind: "alt",
          label: "Alteration + Augmentation",
          detail: "Magic item, then Regal",
          chance: magic,
          components: [
            { name: "Orb of Alteration", qty: 1, price: null },
            { name: "Orb of Augmentation", qty: 1, price: null },
          ],
          notes: [note, "The final Regal Orb (one) is not included in the cost."],
        },
        prices,
      ),
    );
  }
  if (regal && regal.regalSuccess > 0) {
    // Loop: alt+aug until promising, regal; on failure scour and start over.
    const alt = price(prices, "Orb of Alteration");
    const aug = price(prices, "Orb of Augmentation");
    const reg = price(prices, "Regal Orb");
    const scour = price(prices, "Orb of Scouring");
    const trans = price(prices, "Orb of Transmutation");
    const sc = scour === null || trans === null ? null : scour + trans;
    const comps = [
      { name: "Orb of Alteration", qty: 1, price: alt },
      { name: "Orb of Augmentation", qty: 1, price: aug },
      { name: "Regal Orb", qty: 1, price: reg },
      { name: "Orb of Scouring", qty: 1, price: scour },
      { name: "Orb of Transmutation", qty: 1, price: trans },
    ];
    const missing = comps.filter((c) => c.price === null).map((c) => c.name);
    const q = regal.promising;
    const r = regal.regalSuccess;
    // Chance per Alteration that this attempt ends in success.
    const chance = q * r;
    let avgCost: number | null = null;
    let per: number | null = null;
    if (!missing.length) {
      per = alt! + aug!;
      avgCost = (per / q + reg! + sc!) / r - sc!;
    }
    const at = (c: number) => (avgCost === null ? NaN : (avgCost * -Math.log(1 - c)));
    out.push({
      id: "alt-regal",
      kind: "alt",
      label: "Alteration + Augmentation + Regal",
      detail: `Regal when ${goal.need - 1} of ${goal.need} are on the magic item`,
      chance,
      costPerTry: per,
      avgCost,
      avgTries: chance > 0 ? 1 / chance : Infinity,
      costAt: avgCost === null ? null : { p50: at(0.5), p63: at(0.63), p90: at(0.9) },
      components: comps,
      notes: [note, "After a failed Regal: Scouring + Transmutation, then roll again. Cost spread is approximated."],
      missingPrices: missing,
    });
  }
  return out;
}

function essenceMethod(idx: CraftingIndex, pool: Pool, goal: Goal, e: EssenceDef, prices: PriceTable): MethodResult | null {
  if (!RARE_ESSENCE_TIERS.test(e.name)) return null;
  if (e.itemLevelRestriction !== null && pool.spec.ilvl > e.itemLevelRestriction) return null;
  const cls = pool.spec.base.itemClass;
  const modId = e.mods[cls] ?? e.mods[ESSENCE_CLASS[cls] ?? ""];
  const mod = modId ? idx.modById.get(modId) : undefined;
  if (!mod) return null;
  const tier = idx.tierForMod(pool, mod);
  const helps = goal.targets.some((t) => t.family === mod.family && t.gen === mod.gen && tier <= t.maxTier);
  if (!helps) return null;
  const fixedGroups = new Set(pool.spec.fixed.flatMap((m) => m.groups));
  if (mod.groups.some((g) => fixedGroups.has(g))) return null;
  const chance = reforgeChance(pool, goal, (m) => idx.tierForMod(pool, m), [mod]);
  return finish(
    {
      id: `essence:${e.id}`,
      kind: "essence",
      label: e.name,
      detail: `Guarantees ${mod.text.replace(/\n/g, ", ")}`,
      chance,
      components: [{ name: e.name, qty: 1, price: null }],
      notes: [],
    },
    prices,
  );
}

function fossilMethods(idx: CraftingIndex, spec: ItemSpec, goal: Goal, prices: PriceTable, chaosChance: number): MethodResult[] {
  const tagsPool = idx.pool(spec);
  const usable = idx.data.fossils.filter((f) => fossilAllowed(f, tagsPool.tags));
  const chanceWith = (fs: FossilDef[]) => {
    const p = idx.pool(spec, fs);
    return reforgeChance(p, goal, (m) => idx.tierForMod(p, m));
  };
  // Single fossils that improve on Chaos, best value first.
  const singles = usable
    .map((f) => ({ f, chance: chanceWith([f]), price: price(prices, f.name) }))
    .filter((s) => s.chance > chaosChance);
  const value = (s: { chance: number; price: number | null }) => (s.price === null ? 0 : s.chance / (s.price + 1));
  const cands = singles.sort((a, b) => value(b) - value(a) || b.chance - a.chance).slice(0, FOSSIL_CANDIDATES);

  const results: MethodResult[] = [];
  const combos: FossilDef[][] = [];
  const rec = (start: number, cur: FossilDef[]) => {
    if (cur.length) combos.push(cur);
    if (cur.length === MAX_FOSSILS) return;
    for (let i = start; i < cands.length; i++) rec(i + 1, [...cur, cands[i]!.f]);
  };
  rec(0, []);
  for (const fs of combos) {
    const chance = fs.length === 1 ? singles.find((s) => s.f === fs[0])!.chance : chanceWith(fs);
    if (chance <= 0) continue;
    results.push(
      finish(
        {
          id: `fossil:${fs.map((f) => f.id).join("+")}`,
          kind: "fossil",
          label: fs.map((f) => f.name.replace(/ Fossil$/, "")).join(" + ") + (fs.length === 1 ? " Fossil" : " Fossils"),
          detail: RESONATORS[fs.length - 1],
          chance,
          components: [...fs.map((f) => ({ name: f.name, qty: 1, price: null })), { name: RESONATORS[fs.length - 1]!, qty: 1, price: null }],
          notes: fs.length > 1 ? ["Multipliers of several fossils are combined by multiplying them."] : [],
        },
        prices,
      ),
    );
  }
  // Keep the best few fossil options (cheapest with prices, otherwise most likely).
  return rank(results).slice(0, 5);
}

function harvestMethods(pool: Pool, goal: Goal, tierOf: (m: ModDef) => number, prices: PriceTable, chaosChance: number): MethodResult[] {
  const out: MethodResult[] = [];
  for (const h of HARVEST_REFORGES) {
    const chance = taggedReforgeChance(pool, goal, tierOf, h.tag);
    if (chance <= chaosChance) continue;
    out.push(
      finish(
        {
          id: `harvest:${h.tag}`,
          kind: "harvest",
          label: `Harvest reforge · ${h.label}`,
          detail: `Guarantees a ${h.label} modifier`,
          chance,
          components: h.cost.map(([name, qty]) => ({ name, qty, price: null })),
          notes: ["Harvest costs from poedb (Horticrafting). The guaranteed mod is weight-proportional among mods with the tag."],
        },
        prices,
      ),
    );
  }
  return out;
}
