/**
 * Live calibration (network, opt-in, skipped by default). Runs the module's own search plans for
 * real warrants against the official Trade site, values them with the module's engine, runs the
 * controlled with/without comparisons for the re-verified rules, and writes a JSON report.
 *
 *   set MERC_LIVE=1
 *   set MERC_UA=YourTool/1.0 (contact: you@example.com)
 *   set MERC_OUT=C:\path\to\calibration.json
 *   npx vitest run src/games/poe1/mercenary/calibration.live.test.ts
 *
 * Paced for the published limits (search 30 per 5 min, fetch 50 per 5 min): one search every
 * 15 s, waits when the server's state header says a window is nearly full, stops on 429.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MercListing, MercSearchOutcome } from "@/core/ipc/commands";
import { catalogIndex } from "./catalog";
import { parseWarrant } from "./parse";
import { planSearches, type Level } from "./query";
import { stats, value } from "./valuation";
import fixtures from "./fixtures/warrants-3.30.json";

const LIVE = !!process.env.MERC_LIVE;
const UA = process.env.MERC_UA ?? "";
const LEAGUE = "Covens";
const BASE = "https://www.pathofexile.com/api/trade";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let rates: Record<string, number> = { chaos: 1 };

async function loadRates() {
  const r = await fetch(`https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${LEAGUE}&type=Currency`, { headers: { "User-Agent": UA } });
  const d = (await r.json()) as { lines: { id: string; primaryValue: number }[] };
  for (const l of d.lines) rates[l.id] = l.primaryValue;
}

async function pace(res: Response) {
  const state = res.headers.get("x-rate-limit-ip-state") ?? "";
  const limits = res.headers.get("x-rate-limit-ip") ?? "";
  const s = state.split(",").map((x) => x.split(":").map(Number));
  const l = limits.split(",").map((x) => x.split(":").map(Number));
  for (let i = 0; i < s.length; i++) {
    const [hits = 0, period = 0] = s[i] ?? [];
    const [max = 0] = l[i] ?? [];
    if (max && hits >= max - 2) {
      console.log(`rate window ${period}s nearly full (${hits}/${max}); waiting ${period}s`);
      await sleep(period * 1000);
    }
  }
}

function toListing(v: Record<string, unknown>): MercListing | null {
  const item = v.item as Record<string, unknown> | undefined;
  const listing = v.listing as Record<string, unknown> | undefined;
  const skills = item?.mercenarySkills as { hash: number; name: string; supports?: { hash: number; name: string; tier: number }[] }[] | undefined;
  if (!item || !listing || !skills) return null;
  const props = (item.properties as { name: string; values: [string, number][] }[]) ?? [];
  const prop = (n: string) => props.find((p) => p.name === n)?.values?.[0]?.[0] ?? null;
  const price = listing.price as { amount?: number; currency?: string; type?: string } | undefined;
  const amount = price?.amount ?? null;
  const currency = price?.currency ?? null;
  const rate = currency ? rates[currency] : undefined;
  return {
    id: String(v.id),
    amount,
    currency,
    priceType: price?.type ?? null,
    amountChaos: amount != null && rate != null ? amount * rate : null,
    indexed: (listing.indexed as string) ?? null,
    instantBuyout: listing.fee != null,
    build: prop("Build"),
    level: Number(prop("Mercenary Level")) || null,
    skills: skills.map((s) => ({
      stat: `mercenary.skill_${s.hash}`,
      name: s.name,
      supports: (s.supports ?? []).map((p) => ({ stat: `mercenary.support_${p.hash}`, name: p.name, tier: p.tier })),
    })),
  };
}

let stopped = false;
async function search(query: unknown, level: Level, label: string): Promise<MercSearchOutcome> {
  const base: MercSearchOutcome = {
    snapshotId: null,
    status: "error",
    error: null,
    league: LEAGUE,
    queryHash: "",
    level,
    label,
    searchId: null,
    total: null,
    complexity: null,
    tradeUrl: null,
    fetchedAt: Math.floor(Date.now() / 1000),
    cached: false,
    stale: false,
    skippedListings: 0,
    ratesAvailable: true,
    rates: { ...rates },
    listings: [],
    gameVersion: "3.30.0",
    catalogVersion: "live",
  };
  if (stopped) return { ...base, error: "stopped after a 429" };
  await sleep(15_000);
  const res = await fetch(`${BASE}/search/${LEAGUE}`, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/json" }, body: JSON.stringify(query) });
  const body = (await res.json()) as { id?: string; result?: string[]; total?: number; complexity?: number; error?: { message: string } };
  if (res.status === 429) stopped = true;
  if (!res.ok || !body.id) return { ...base, error: body.error?.message ?? `HTTP ${res.status}` };
  await pace(res);
  const ids = (body.result ?? []).slice(0, 20);
  const listings: MercListing[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    await sleep(1500);
    const f = await fetch(`${BASE}/fetch/${ids.slice(i, i + 10).join(",")}?query=${body.id}`, { headers: { "User-Agent": UA } });
    if (f.status === 429) {
      stopped = true;
      break;
    }
    await pace(f);
    const fd = (await f.json()) as { result: (Record<string, unknown> | null)[] };
    for (const r of fd.result) {
      const l = r && toListing(r);
      if (l) listings.push(l);
    }
  }
  return { ...base, status: "ok", searchId: body.id, total: body.total ?? 0, complexity: body.complexity ?? null, tradeUrl: `https://www.pathofexile.com/trade/search/${LEAGUE}/${body.id}`, listings };
}

const WARRANTS = (process.env.MERC_WARRANTS ?? "kineticist,kineticist.infamous,combatant,manyshot,chaplain_of_the_well,sniper,reanimator").split(",");

describe.skipIf(!LIVE)("live calibration (Covens)", () => {
  it(
    "values real warrants and re-verifies rules",
    async () => {
      expect(UA.length).toBeGreaterThan(8);
      await loadRates();
      const report: Record<string, unknown> = { at: new Date().toISOString(), league: LEAGUE, divine: rates.divine, warrants: {}, comparisons: {} };
      const real = fixtures.warrants as Record<string, string>;
      for (const id of WARRANTS) {
        const w = parseWarrant(real[id] ?? "");
        if (!w) continue;
        const { plans } = planSearches(w);
        const outcomes: Partial<Record<Level, MercSearchOutcome>> = {};
        for (const p of plans) outcomes[p.level] = await search(p.request.query, p.level, p.label);
        const v = value(w, outcomes, Date.now() / 1000);
        (report.warrants as Record<string, unknown>)[id] = {
          plans: plans.map((p) => ({ level: p.level, constraints: p.constraints, dropped: p.dropped, complexity: p.complexity, serverComplexity: outcomes[p.level]?.complexity, total: outcomes[p.level]?.total, error: outcomes[p.level]?.error, url: outcomes[p.level]?.tradeUrl })),
          levels: v.levels.map((l) => ({ level: l.level, kept: l.stats?.count ?? 0, excluded: l.filtered?.excluded.map((e) => e.reason) ?? [], raw: l.raw, filtered: l.stats, matches: l.filtered?.kept.map((k) => k.match) })),
          chosen: v.chosen?.level ?? null,
          confidence: v.confidence,
          category: v.category,
          suggested: v.suggested,
          askingRange: v.askingRange,
          quickSale: v.quickSale,
          reasons: [...v.confidenceReasons, ...v.categoryReasons],
        };
        console.log(id, v.category, v.confidence, v.suggested && rates.divine ? `${(v.suggested / rates.divine).toFixed(2)} div` : "-");
      }
      // Controlled with/without comparisons for the rules being re-verified.
      const idx = catalogIndex();
      const cmp: [string, string, string, [string, number][], string][] = [
        ["kineticist", "MiscScionWandAttacks", "kinetic_blast_of_clustering", [["return", 3], ["multiple_projectiles", 3]], "kinetic_bolt"],
        ["combatant", "MeleeAOEStrikeDuelistRangeStrikes", "frost_blades", [["return", 3]], "spectral_helix"],
        ["manyshot", "EleBowRangerClones", "vaal_ice_shot", [["return", 3]], "icicle_rain"],
      ];
      for (const [fid, type, skill, gates, other] of process.env.MERC_SKIP_CMP ? [] : cmp) {
        const fam = idx.familyById.get(fid)!;
        const bound = [{ id: idx.skillStat(fam, null, skill)! }, ...gates.map(([s, t]) => ({ id: idx.supportStat(fam, null, skill, s, t)! }))];
        const q = (kind: "and" | "not") => ({
          query: { status: { option: "securable" }, type: { option: type, discriminator: "mercenary_warrant" }, stats: [{ type: "mercenary", filters: bound }, { type: kind, filters: [{ id: idx.skillStat(fam, null, other)! }] }], filters: { misc_filters: { filters: { ilvl: { min: 83 } } } } },
          sort: { price: "asc" },
        });
        const withO = await search(q("and"), 2, `${fid} with ${other}`);
        const withoutO = await search(q("not"), 2, `${fid} without ${other}`);
        const asks = (o: MercSearchOutcome) => o.listings.filter((l) => l.amountChaos != null && l.currency !== "mirror").map((l) => l.amountChaos!);
        (report.comparisons as Record<string, unknown>)[`${fid}:${other}`] = {
          package: `${skill} + ${gates.map(([s, t]) => `${s} T${t}`).join(" + ")}`,
          with: { total: withO.total, lowest: stats(asks(withO)), error: withO.error, url: withO.tradeUrl },
          without: { total: withoutO.total, lowest: stats(asks(withoutO)), error: withoutO.error, url: withoutO.tradeUrl },
        };
        console.log(fid, other, "with", withO.total, stats(asks(withO))?.median, "without", withoutO.total, stats(asks(withoutO))?.median);
      }
      if (process.env.MERC_OUT) writeFileSync(process.env.MERC_OUT, JSON.stringify(report, null, 1));
    },
    40 * 60_000,
  );
});
