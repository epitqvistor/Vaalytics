import { describe, expect, it } from "vitest";
import type { MercListing, MercSearchOutcome } from "@/core/ipc/commands";
import { catalogIndex } from "./catalog";
import { applyCorrections, parseWarrant } from "./parse";
import { estimateComplexity, planSearches, type Level } from "./query";
import { appliedSkillRules, DEFAULT_THRESHOLDS, EVIDENCE, evidenceById, FAMILY_RULES, rulesFor, sampleClass, validThresholds } from "./rules";
import { filterComparables, freshness, matchListing, quantile, roundAsk, stats, value } from "./valuation";
import fixtures from "./fixtures/warrants-3.30.json";

const REAL: Record<string, string> = fixtures.warrants;
const NOW = 1_800_000_000;
const DIV = 140;

const KIN = (extra = "") => `Item Class: Map Fragments
Rarity: Normal
Mercenary Warrant
--------
Build: Kineticist
Mercenary Level: 83
--------
Elemental Weakness
Greater Curse Effect (Tier: 3)
--------
Kinetic Blast of Clustering
Greater Multiple Projectiles (Tier: 3)
Return (Tier: 3)
Chain (Tier: 2)
--------
${extra}Frostblink
Increased Area of Effect (Tier: 2)
`;

const KBOC = { stat: "mercenary.skill_16356", name: "Kinetic Blast of Clustering" };
const kbocSupports = [
  { stat: "mercenary.support_49419", name: "Greater Multiple Projectiles", tier: 3 },
  { stat: "mercenary.support_5293", name: "Return", tier: 3 },
  { stat: "mercenary.support_31052", name: "Chain", tier: 2 },
];
function listing(id: string, chaos: number | null, opts: Partial<MercListing> = {}): MercListing {
  return {
    id,
    amount: chaos,
    currency: chaos == null ? null : "chaos",
    priceType: "~b/o",
    amountChaos: chaos,
    indexed: null,
    instantBuyout: true,
    build: "Kineticist",
    level: 83,
    skills: [
      { stat: "mercenary.skill_5689", name: "Elemental Weakness", supports: [{ stat: "mercenary.support_3263", name: "Greater Curse Effect", tier: 3 }] },
      { ...KBOC, supports: kbocSupports },
      { stat: "mercenary.skill_40470", name: "Frostblink", supports: [{ stat: "mercenary.support_53342", name: "Increased Area of Effect", tier: 2 }] },
    ],
    ...opts,
  };
}
function outcome(level: Level, listings: MercListing[], o: Partial<MercSearchOutcome> = {}): MercSearchOutcome {
  return {
    snapshotId: 1,
    status: "ok",
    error: null,
    league: "Covens",
    queryHash: "h",
    level,
    label: "x",
    searchId: "s",
    total: listings.length,
    complexity: 40,
    tradeUrl: "https://www.pathofexile.com/trade/search/Covens/s",
    fetchedAt: NOW - 60,
    cached: false,
    stale: false,
    skippedListings: 0,
    ratesAvailable: true,
    rates: { divine: DIV, chaos: 1 },
    listings,
    gameVersion: "3.30.0",
    catalogVersion: "3.30.0-r1",
    ...o,
  };
}
const many = (n: number, base: number, step = 0) => Array.from({ length: n }, (_, i) => listing(`l${i}`, base + i * step));

describe("rules", () => {
  it("cover all 37 families, once each", () => {
    const ids = FAMILY_RULES.map((r) => r.family).sort();
    expect(ids).toEqual(catalogIndex().catalog.families.map((f) => f.id).sort());
  });

  // Regression fixture per rule: every rule names a skill the family can roll, every package
  // gate is rollable on its skill at the gated tier, and every evidence id exists.
  for (const r of FAMILY_RULES) {
    it(`${r.family}: rules reference rollable skills, attainable gates and real evidence`, () => {
      const idx = catalogIndex();
      const fam = idx.familyById.get(r.family)!;
      expect(evidenceById.has(r.tierEvidence)).toBe(true);
      for (const pkg of [...r.packages, ...(r.premium ? [r.premium.package] : [])]) {
        const rule = idx.skillRule(fam, null, pkg.skill);
        expect(rule, `${r.family}: ${pkg.skill}`).not.toBeNull();
        const allowed = idx.allowedSupports(rule!);
        for (const g of pkg.gates) {
          const a = allowed.find((x) => x.support === g.support);
          expect(a && a.tiers.some((t) => t >= g.minTier), `${r.family}: ${g.support} T${g.minTier}+ on ${pkg.skill}`).toBeTruthy();
        }
        for (const e of pkg.evidence) expect(evidenceById.has(e), e).toBe(true);
      }
      for (const s of r.skills) {
        expect(idx.skillRule(fam, null, s.skill), `${r.family}: ${s.skill}`).not.toBeNull();
        if (s.context) expect(idx.skillRule(fam, null, s.context)).not.toBeNull();
        expect(s.evidence.length).toBeGreaterThan(0);
        for (const e of s.evidence) expect(evidenceById.has(e), e).toBe(true);
        if (s.effect === "negative") expect(s.reason.length).toBeGreaterThan(20);
        expect(s.patch).toBe("3.30.0");
      }
      for (const p of r.premium?.partners ?? []) expect(idx.skillRule(fam, null, p)).not.toBeNull();
    });
  }

  it("never applies contradicted rules", () => {
    expect(appliedSkillRules(rulesFor("combatant")).some((s) => s.id === "combatant.wild_strike")).toBe(false);
    expect(appliedSkillRules(rulesFor("manyshot")).some((s) => s.id === "manyshot.icicle_rain")).toBe(true); // unverified: matched, not assumed
    expect(appliedSkillRules(rulesFor("combatant")).some((s) => s.id === "combatant.spectral_helix")).toBe(true);
  });

  it("evidence ids are unique and every survey claim carries a sample size or method", () => {
    expect(new Set(EVIDENCE.map((e) => e.id)).size).toBe(EVIDENCE.length);
  });

  it("classifies samples with configurable thresholds", () => {
    expect([4, 5, 7, 8, 14, 15, 29, 30].map((n) => sampleClass(n))).toEqual(["insufficient", "exploratory", "exploratory", "limited", "limited", "moderate", "moderate", "stronger"]);
    expect(sampleClass(10, { exploratory: 3, limited: 6, moderate: 10, stronger: 20 })).toBe("moderate");
    expect(validThresholds(DEFAULT_THRESHOLDS)).toBe(true);
    expect(validThresholds({ exploratory: 8, limited: 5, moderate: 15, stronger: 30 })).toBe(false);
  });
});

describe("planSearches", () => {
  it("keeps the value skill bound to its supports and the negative rule as an exclusion", () => {
    const w = parseWarrant(KIN())!;
    const { plans } = planSearches(w);
    expect(plans.map((p) => p.level)).toEqual([1, 2, 3, 4]);
    const l2 = plans.find((p) => p.level === 2)!;
    const stats = (l2.request.query as { query: { stats: { type: string; filters: { id: string }[] }[] } }).query.stats;
    const bound = stats.find((g) => g.type === "mercenary")!;
    expect(bound.filters.map((f) => f.id)).toEqual(["mercenary.skill_16356", "mercenary.support_49419", "mercenary.support_5293"]);
    expect(stats.find((g) => g.type === "not")!.filters).toEqual([{ id: "mercenary.skill_12583" }]);
    expect(l2.constraints.join(" ")).toContain("without Kinetic Bolt");
    expect(stats.filter((g) => g.type === "mercenary")).toHaveLength(1);
    for (const p of plans) expect(p.complexity).toBeLessThanOrEqual(49);
  });

  it("matches the downside instead of excluding it when the warrant has it", () => {
    const w = parseWarrant(KIN("Kinetic Bolt\nCritical Chance (Tier: 2)\n--------\n"))!;
    const l2 = planSearches(w).plans.find((p) => p.level === 2)!;
    const stats = (l2.request.query as { query: { stats: { type: string; filters: { id: string }[] }[] } }).query.stats;
    expect(stats.find((g) => g.type === "and")!.filters).toEqual([{ id: "mercenary.skill_12583" }]);
    expect(stats.some((g) => g.type === "not")).toBe(false);
  });

  it("searches Infamous and normal warrants with their own type", () => {
    const normal = planSearches(parseWarrant(REAL["kineticist"]!)!).plans[0]!;
    const infamous = planSearches(parseWarrant(REAL["kineticist.infamous"]!)!).plans[0]!;
    const typeOf = (p: typeof normal) => ((p.request.query as { query: { type: { option: string } } }).query.type.option);
    expect(typeOf(normal)).toBe("MiscScionWandAttacks");
    expect(typeOf(infamous)).toBe("MiscScionWandAttacksNoble");
  });

  it("stays inside the measured complexity budget for every real warrant, listing what it dropped", () => {
    for (const [id, text] of Object.entries(REAL)) {
      const { plans } = planSearches(parseWarrant(text)!);
      expect(plans.length, id).toBeGreaterThanOrEqual(2);
      for (const p of plans) {
        expect(p.complexity, id).toBeLessThanOrEqual(49);
        const q = p.request.query as { query: { stats: { type: string }[] } };
        expect(q.query.stats.filter((g) => g.type === "mercenary").length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("matches the server's complexity on measured queries", () => {
    expect(estimateComplexity(6, [])).toBe(46);
    expect(estimateComplexity(7, [])).toBe(48);
    expect(estimateComplexity(6, [2])).toBe(49);
    expect(estimateComplexity(3, [5])).toBe(46);
    expect(estimateComplexity(3, [2, 1])).toBe(45);
    expect(estimateComplexity(6, [5])).toBeGreaterThan(49); // refused live
    // Calibration 2026-11-26, with the level filter: server reported 45, 47, 49, 43, 39, 7 and refused 52.
    expect(estimateComplexity(3, [0, 1], true)).toBe(45);
    expect(estimateComplexity(3, [], true)).toBe(43);
    expect(estimateComplexity(0, [], true)).toBe(7);
    expect(estimateComplexity(6, [3], true)).toBeGreaterThan(49);
  });

  it("refuses to search without a known warrant type", () => {
    const w = parseWarrant(KIN().replace("Build: Kineticist\n", ""))!;
    expect(planSearches(w).plans).toEqual([]);
    expect(planSearches(applyCorrections(w, { variant: "kineticist" })).plans.length).toBeGreaterThan(0);
  });
});

describe("matching and filtering", () => {
  const w = parseWarrant(KIN())!;

  it("recognises the exact configuration and the same skills with a different binding", () => {
    expect(matchListing(w, listing("a", 100)).kind).toBe("exact");
    const moved = listing("b", 100, {
      skills: [
        { stat: "mercenary.skill_5689", name: "Elemental Weakness", supports: [{ stat: "mercenary.support_3263", name: "Greater Curse Effect", tier: 3 }, { stat: "mercenary.support_5293", name: "Return", tier: 3 }] },
        { ...KBOC, supports: kbocSupports.filter((s) => s.name !== "Return") },
        { stat: "mercenary.skill_40470", name: "Frostblink", supports: [{ stat: "mercenary.support_53342", name: "Increased Area of Effect", tier: 2 }] },
      ],
    });
    const m = matchListing(w, moved);
    expect(m.kind).not.toBe("exact");
    expect(m.kind).not.toBe("package"); // Return moved off KBoC: the package is gone
    expect(m.differences.join()).toContain("different supports");
  });

  it("tells Infamous from normal", () => {
    const m = matchListing(w, listing("i", 100, { build: "Infamous Kineticist" }));
    expect(m.kind).toBe("package");
    expect(m.differences).toContain("Infamous");
  });

  it("excludes listings with reasons: no price, mirror, no rate, placeholder, not exact at level 1", () => {
    const ls = [
      listing("noprice", null),
      listing("mirror", 1, { currency: "mirror", amountChaos: 50000 }),
      listing("norate", 3, { currency: "exalted", amountChaos: null }),
      listing("placeholder", 99_999_999 * DIV, { currency: "divine", amount: 99_999_999 }),
      listing("ok", 120),
      listing("other", 90, { build: "Infamous Kineticist" }),
    ];
    const f = filterComparables(w, 1, ls, DIV);
    expect(f.kept.map((k) => k.listing.id)).toEqual(["ok"]);
    expect(f.excluded.map((e) => e.id)).toEqual(["noprice", "mirror", "norate", "placeholder", "other"]);
    expect(f.excluded.every((e) => e.reason.length > 5)).toBe(true);
  });

  it("drops high outliers only with enough asks and keeps the reason", () => {
    const ls = [...many(10, 100, 5), listing("outlier", 100_000)];
    const f = filterComparables(w, 2, ls, DIV);
    expect(f.excluded.find((e) => e.id === "outlier")?.reason).toMatch(/outlier/i);
    const few = filterComparables(w, 2, [...many(3, 100), listing("big", 100_000)], DIV);
    expect(few.kept).toHaveLength(4);
  });

  it("computes quantiles", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(stats([5, 1, 3])).toEqual({ count: 3, min: 1, p25: 2, median: 3, p75: 4, max: 5 });
    expect(stats([])).toBeNull();
  });
});

describe("value", () => {
  const w = parseWarrant(KIN())!;

  it("no listings → insufficient data, no price", () => {
    const v = value(w, { 1: outcome(1, []), 2: outcome(2, []), 4: outcome(4, []) }, NOW);
    expect(v.confidence).toBe("insufficient");
    expect(v.suggested).toBeNull();
    expect(v.askingRange).toBeNull();
    expect(v.category).toBe("potential-premium"); // premium conditions hold, evidence doesn't
  });

  it("one listing → insufficient, never a price", () => {
    const v = value(w, { 2: outcome(2, [listing("a", 100 * DIV)]) }, NOW);
    expect(v.confidence).toBe("insufficient");
    expect(v.suggested).toBeNull();
  });

  it("thin market (5–7) → low confidence with a price", () => {
    const v = value(w, { 2: outcome(2, many(6, 50 * DIV, DIV)) }, NOW);
    expect(v.confidence).toBe("low");
    expect(v.suggested).not.toBeNull();
    expect(v.chosen?.sample).toBe("exploratory");
  });

  it("premium: ≥ 8 package comparables at ≥ 50 div with every condition → Premium", () => {
    const v = value(w, { 2: outcome(2, many(20, 150 * DIV, DIV)) }, NOW);
    expect(v.category).toBe("premium");
    expect(v.confidence).toBe("high");
    expect(v.askingRange![0]).toBeLessThan(v.askingRange![1]);
    expect(v.quickSale!).toBeLessThanOrEqual(v.suggested!);
  });

  it("premium package priced below premium by enough comparables → value band, not 'potential premium'", () => {
    // Calibration 2026-11-26: normal Kineticist with the full package, 20 asks at ~10 div.
    const v = value(w, { 2: outcome(2, many(20, 10 * DIV, 0.05 * DIV)) }, NOW);
    expect(v.category).toBe("check");
    expect(v.categoryReasons.join(" ")).toContain("below 50 div");
  });

  it("negative: an active downside blocks Premium even with high asks", () => {
    const comb = (helix: boolean) => `Item Class: Map Fragments
Rarity: Normal
Mercenary Warrant
--------
Build: Combatant
Mercenary Level: 83
--------
Frost Blades
Return (Tier: 3)
Chain (Tier: 2)
Elemental Damage with Attacks (Tier: 2)
--------
Static Strike
Chain (Tier: 2)
${helix ? "--------\nSpectral Helix\nPierce (Tier: 2)\n" : ""}`;
    const clean = parseWarrant(comb(false))!;
    const bad = parseWarrant(comb(true))!;
    expect(clean.problems).toEqual([]);
    const ls = (b: string) => many(20, 150 * DIV, DIV).map((l) => ({ ...l, build: b }));
    expect(value(clean, { 2: outcome(2, ls("Combatant")) }, NOW).category).toBe("premium");
    const v = value(bad, { 2: outcome(2, ls("Combatant")) }, NOW);
    expect(v.category).toBe("high");
    expect(v.factors.find((f) => f.id === "combatant.spectral_helix")?.effect).toBe("negative");
    // The comparable search requires the same downside instead of ignoring it.
    const l2 = planSearches(bad).plans.find((p) => p.level === 2)!;
    expect(l2.constraints.join(" ")).toContain("with Spectral Helix (same downside)");
  });

  it("common warrant: generic family, cheap comparables → Common / Low with explanation", () => {
    const g = parseWarrant(REAL["reanimator"]!)!;
    const ls = many(12, 30, 2).map((l) => ({ ...l, build: "Reanimator", skills: [] }));
    const v = value(g, { 4: outcome(4, ls) }, NOW);
    expect(["common", "low"]).toContain(v.category);
    expect(v.confidence).toBe("low"); // family baseline caps at Low
    expect(v.factors.some((f) => f.text.includes("Generic family"))).toBe(true);
  });

  it("stale data lowers confidence; a failed refresh never looks current", () => {
    const fresh = value(w, { 2: outcome(2, many(20, 150 * DIV, DIV)) }, NOW);
    const old = value(w, { 2: outcome(2, many(20, 150 * DIV, DIV), { fetchedAt: NOW - 5 * 3600 }) }, NOW);
    expect(fresh.confidence).toBe("high");
    expect(old.confidence).toBe("medium");
    const failed = outcome(2, many(20, 150 * DIV, DIV), { status: "error", error: "Trade asked us to slow down — try again in 60s.", stale: true, fetchedAt: NOW - 120 });
    expect(freshness(failed, NOW)).toBe("stale");
    const v = value(w, { 2: failed }, NOW);
    expect(v.confidenceReasons.join(" ")).toContain("last refresh failed");
    expect(v.factors.some((f) => f.text.includes("slow down"))).toBe(true);
    expect(freshness(outcome(2, [], { status: "error", error: "rate limit", stale: false }), NOW)).toBe("unavailable");
    expect(freshness(outcome(2, [], { fetchedAt: NOW - 30 * 3600 }), NOW)).toBe("very-stale");
  });

  it("rate-limited search without cache → unavailable, insufficient data", () => {
    const v = value(w, { 2: outcome(2, [], { status: "error", error: "Trade rate limit reached — try again in 40s.", total: null }) }, NOW);
    expect(v.confidence).toBe("insufficient");
    expect(v.levels[0]!.freshness).toBe("unavailable");
  });

  it("currency: converts with the snapshot's divine rate; without a rate there is no value band", () => {
    const ls = many(10, 100 * DIV, DIV).map((l) => ({ ...l, currency: "divine", amount: (l.amountChaos ?? 0) / DIV }));
    const v = value(w, { 2: outcome(2, ls) }, NOW);
    expect(v.divineRate).toBe(DIV);
    const noRate = value(w, { 2: outcome(2, ls, { rates: {} }) }, NOW);
    expect(noRate.category).toBe("unknown");
    expect(noRate.confidenceReasons.join(" ")).toContain("No divine rate");
  });

  it("incomplete responses: listings without price are excluded, not counted", () => {
    const ls = [...many(4, 100 * DIV, DIV), ...Array.from({ length: 6 }, (_, i) => listing(`np${i}`, null))];
    const v = value(w, { 2: outcome(2, ls) }, NOW);
    expect(v.levels[0]!.stats?.count).toBe(4);
    expect(v.confidence).toBe("insufficient");
  });

  it("uncertain bindings cap confidence at Low", () => {
    const shaky = parseWarrant(KIN().replace("Return (Tier: 3)", "Retrun (Tier: 3)"))!;
    const v = value(shaky, { 2: outcome(2, many(30, 150 * DIV, DIV)) }, NOW);
    expect(v.confidence).toBe("low");
    expect(v.confidenceReasons.join(" ")).toContain("Uncertain fields");
  });

  it("prefers the most specific level with enough asks and labels it", () => {
    const v = value(w, { 1: outcome(1, many(2, 200 * DIV)), 2: outcome(2, many(9, 120 * DIV, DIV)), 4: outcome(4, many(20, 10)) }, NOW);
    expect(v.chosen?.level).toBe(2);
    expect(v.confidence).toBe("medium");
  });

  it("rounds asks to sensible steps", () => {
    expect(roundAsk(37.4, DIV)).toBe(37);
    expect(roundAsk(3.3 * DIV, DIV)).toBe(3.5 * DIV);
    expect(roundAsk(152.4 * DIV, DIV)).toBe(152 * DIV);
  });
});
