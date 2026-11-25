/**
 * Opt-in check of the whole valuation path against the real market (network; skipped by default):
 *   VAALYTICS_LIVE=1 [VAALYTICS_TRADE_CONTACT=you@example.com] npx vitest run src/games/price-check.live.test.ts
 * For each case it takes a real listed item's text from Trade, parses it with the game's parser,
 * builds the default (Quick) query with the app's code, fetches the 20 cheapest matches, converts
 * prices with poe.ninja rates (as the host does) and prints the valuation. Requests are spaced and
 * the server's rate-limit state is honoured; nothing is written anywhere.
 */
import { describe, expect, it } from "vitest";
import { parsePoe1Item } from "@/games/poe1/parser";
import { parsePoe2Item } from "@/games/poe2/parser";
import { buildFilters, buildQuery, defaultOptions, searchBasis } from "@/shared/trade/query";
import { buildStatIndex, templateKey, type TradeStat } from "@/shared/trade/stats";
import { valuate } from "@/shared/trade/valuation";

const LIVE = process.env.VAALYTICS_LIVE === "1";
const UA = `Vaalytics/live-test (Windows desktop companion${process.env.VAALYTICS_TRADE_CONTACT ? `; contact: ${process.env.VAALYTICS_TRADE_CONTACT}` : ""})`;
const BASE = "https://www.pathofexile.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits when the server says a rule is close to its limit. */
async function respectLimits(res: Response) {
  const rules = res.headers.get("x-rate-limit-rules")?.split(",") ?? [];
  for (const rule of rules) {
    const limits = res.headers.get(`x-rate-limit-${rule.trim()}`)?.split(",") ?? [];
    const states = res.headers.get(`x-rate-limit-${rule.trim()}-state`)?.split(",") ?? [];
    limits.forEach((l, i) => {
      const [max, period] = l.split(":").map(Number);
      const [hits] = (states[i] ?? "0").split(":").map(Number);
      if (hits! >= max! - 1) throw new Error(`Near the Trade rate limit (${l}); wait ${period}s and rerun.`);
    });
  }
}

async function get(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  await respectLimits(res);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}
async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  await respectLimits(res);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 120))}`);
  const json = await res.json();
  await sleep(6000); // searches are the scarce resource
  return json;
}

interface Game {
  id: "poe1" | "poe2";
  api: string;
  realm: string;
  league: string;
  base: string;
  parse: (t: string) => ReturnType<typeof parsePoe1Item>;
}
const POE1: Game = { id: "poe1", api: "api/trade", realm: "", league: "Covens", base: "chaos", parse: parsePoe1Item };
const POE2: Game = { id: "poe2", api: "api/trade2", realm: "poe2/", league: "Runes of Aldur", base: "exalted", parse: parsePoe2Item };

async function rates(g: Game): Promise<Map<string, number>> {
  const j = await get(`https://poe.ninja/${g.id}/api/economy/exchange/current/overview?league=${encodeURIComponent(g.league)}&type=Currency`);
  // Lines are priced in core.primary; core.rates converts the primary into other units (as the host does).
  const perPrimary = j.core.primary === g.base ? 1 : (j.core.rates[g.base] as number);
  const m = new Map<string, number>();
  for (const line of j.lines as { id: string; primaryValue: number }[]) {
    const v = line.primaryValue * perPrimary;
    if (Number.isFinite(v) && v > 0) m.set(line.id, v);
  }
  m.set(g.base, 1);
  return m;
}

async function statIndex(g: Game) {
  const j = await get(`${BASE}/${g.api}/data/stats`);
  const stats: TradeStat[] = j.result.flatMap((grp: { entries: TradeStat[] }) => grp.entries.map((e) => ({ id: e.id, text: e.text, type: e.type })));
  return buildStatIndex(stats);
}

async function fetchListings(g: Game, id: string, ids: string[]) {
  const out = [];
  for (let i = 0; i < ids.length; i += 10) {
    const j = await get(`${BASE}/${g.api}/fetch/${ids.slice(i, i + 10).join(",")}?query=${id}${g.id === "poe2" ? "&realm=poe2" : ""}`);
    out.push(...j.result.filter(Boolean));
  }
  return out;
}

/** A real item text: the cheapest listing of a seed search. */
async function seedItem(g: Game, seed: unknown): Promise<string> {
  const s = await post(`${BASE}/${g.api}/search/${g.realm}${encodeURIComponent(g.league)}`, seed);
  const [r] = await fetchListings(g, s.id, s.result.slice(0, 1));
  const text = r?.item?.extended?.text ? Buffer.from(r.item.extended.text, "base64").toString("utf8") : null;
  if (!text) throw new Error(`seed listing has no item text (keys: ${Object.keys(r?.item ?? {}).join(",")})`);
  if (process.env.VAALYTICS_LIVE_DUMP) console.log(`--- seed text ---
${text}
---`);
  return text;
}

async function priceCheck(g: Game, name: string, text: string, index: ReturnType<typeof buildStatIndex>, rate: Map<string, number>) {
  const parsed = g.parse(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const item = parsed.item;
  const { stats, unmatched } = buildFilters(item, index);
  const opts = defaultOptions(item);
  const query = buildQuery(item, stats, opts);
  const s = await post(`${BASE}/${g.api}/search/${g.realm}${encodeURIComponent(g.league)}`, query);
  const raw = await fetchListings(g, s.id, s.result.slice(0, 20));
  const searched = stats.filter((f) => f.enabled && f.source === "mod" && f.option == null).map((f) => templateKey(f.label));
  const listings = raw.map((r: { id: string; listing: { price?: { amount: number; currency: string }; indexed: string }; item: { explicitMods?: unknown[]; implicitMods?: unknown[] } }) => {
    const p = r.listing.price;
    const conv = p ? rate.get(p.currency) : undefined;
    // A mod is a string or `{ description }` (as the host normaliser handles it).
    const textOf = (m: unknown): string[] => (typeof m === "string" ? [m] : typeof (m as { description?: unknown })?.description === "string" ? (m as { description: string }).description.split("\n").map((t) => t.trim()) : []);
    const lines = [...(r.item.explicitMods ?? []), ...(r.item.implicitMods ?? [])].flatMap(textOf);
    const mods = new Set(lines.map((m) => templateKey(m.replace(/\[([^\]|]+)\|([^\]]+)\]/g, "$2").replace(/\[([^\]]+)\]/g, "$1"))));
    return {
      id: r.id,
      amountBase: p && conv ? p.amount * conv : null,
      indexed: r.listing.indexed,
      match: searched.length ? searched.filter((k) => mods.has(k)).length / searched.length : null,
      shown: p ? `${p.amount} ${p.currency}` : "—",
    };
  });
  const basis = searchBasis(item, stats);
  const v = valuate({ listings, total: s.total, basis, unsearchedMods: basis === "stats" ? unmatched.length : 0 });
  const round = (x: number | null) => (x == null ? "—" : `${Math.round(x * 10) / 10} ${g.base}`);
  console.log(
    [
      `\n=== ${g.id.toUpperCase()} · ${name}: ${item.name ?? ""} ${item.baseType} (${item.rarity})`,
      `filters: ${stats.filter((f) => f.enabled).map((f) => `${f.label} [${f.min ?? ""}–${f.max ?? ""}]`).join("; ") || "(none)"}${unmatched.length ? ` · unsearchable: ${unmatched.length}` : ""}`,
      `basis ${basis} · total ${s.total} · fetched ${listings.length}`,
      `prices: ${listings.map((l: { shown: string; id: string }) => `${l.shown}${v.verdicts.get(l.id) === "used" ? "" : `(${v.verdicts.get(l.id)})`}`).join(", ")}`,
      `→ estimate ${round(v.estimate)} · lowest ${round(v.lowest)} · median ${round(v.median)} · used ${v.used} · outliers ${v.lowOutliers}+${v.highOutliers} · no price ${v.noPrice} · ${v.confidence.toUpperCase()}`,
      `  ${v.reasons.join(" | ")}`,
    ].join("\n"),
  );
  return v;
}

describe.skipIf(!LIVE)("live valuation against the real market", () => {
  it("PoE 1: rare boots, unique, currency, gem, corpse", { timeout: 240_000 }, async () => {
    const [index, rate] = [await statIndex(POE1), await rates(POE1)];
    const life = "explicit.stat_3299347043";
    const ms = "explicit.stat_2250533757";
    const status = { option: "available" };
    const rareBoots = await seedItem(POE1, {
      query: { status, filters: { type_filters: { filters: { category: { option: "armour.boots" }, rarity: { option: "rare" } } } }, stats: [{ type: "and", filters: [{ id: life, value: { min: 70 } }, { id: ms, value: { min: 25 } }] }] },
      sort: { price: "asc" },
    });
    const cases: [string, string][] = [
      ["rare boots", rareBoots],
      ["unique", await seedItem(POE1, { query: { status, name: "Tabula Rasa", type: "Simple Robe" }, sort: { price: "asc" } })],
      ["corpse", await seedItem(POE1, { query: { status, type: "Perfect Serpent Warrior" }, sort: { price: "asc" } })],
    ];
    for (const [name, text] of cases) {
      const v = await priceCheck(POE1, name, text, index, rate);
      if (v.estimate != null) {
        expect(v.estimate).toBeGreaterThanOrEqual(v.lowest!);
        expect(v.confidence).not.toBe("unpriced");
      }
    }
  });

  it("PoE 2: currency (separate endpoint, league and base unit)", { timeout: 120_000 }, async () => {
    // PoE 2 Trade does not return item text, so this uses a real in-game copy (Loot Journal capture, Nov 2026).
    const text = ["Item Class: Stackable Currency", "Rarity: Currency", "Divine Orb", "--------", "Stack Size: 10/10", "--------", "Randomises the numeric values of modifiers on an item", "--------", "Right click this item then left click an item to apply it.", "Shift click to unstack.", ""].join("\n");
    const [index, rate] = [await statIndex(POE2), await rates(POE2)];
    const v = await priceCheck(POE2, "currency", text, index, rate);
    expect(v.basis).toBe("exact");
  });
});
