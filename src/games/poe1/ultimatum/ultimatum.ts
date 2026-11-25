/**
 * Ultimatum Checker logic (PoE 1): your modifier ratings, the risk verdict,
 * the reward/sacrifice valuation and the Trade search. Pure functions.
 * Spec: docs/modules/ultimatum-checker.md
 */
import type { MarketItemRow, MarketSnapshot } from "@/core/ipc/commands";
import type { Ultimatum } from "./parse";

// ---------- ratings (user data) ----------

/** How a modifier family affects *your* build. Unrated families are absent. */
export type Rating = "ok" | "danger" | "forbidden";
export type Ratings = Record<string, Rating>;

export const RATING_LABEL: Record<Rating, string> = {
  ok: "Fine",
  danger: "Dangerous",
  forbidden: "Build-breaking",
};

export const isRatings = (v: unknown): v is Ratings =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length <= 200 &&
  Object.values(v).every((r) => r === "ok" || r === "danger" || r === "forbidden");

/** Cycles unrated → Fine → Dangerous → Build-breaking → unrated. */
export function nextRating(r: Rating | undefined): Rating | undefined {
  return r === undefined ? "ok" : r === "ok" ? "danger" : r === "danger" ? "forbidden" : undefined;
}

export function setRating(ratings: Ratings, family: string, r: Rating | undefined): Ratings {
  const next = { ...ratings };
  if (r) next[family] = r;
  else delete next[family];
  return next;
}

export type Verdict = "skip" | "careful" | "ok" | "unrated";

export interface RiskAssessment {
  verdict: Verdict;
  forbidden: string[];
  danger: string[];
  /** Penalty modifiers you have not rated yet (unknown names included). */
  unrated: string[];
}

/** Families of the given modifiers; bonus/boss modifiers never count against a run. */
export function assessRisk(mods: { name: string; family: string | null; kind: string | null }[], ratings: Ratings): RiskAssessment {
  const forbidden: string[] = [];
  const danger: string[] = [];
  const unrated: string[] = [];
  for (const m of mods) {
    if (m.kind === "bonus" || m.kind === "boss") continue;
    const r = m.family ? ratings[m.family] : undefined;
    if (r === "forbidden") forbidden.push(m.name);
    else if (r === "danger") danger.push(m.name);
    else if (r === undefined) unrated.push(m.name);
  }
  const verdict: Verdict = forbidden.length ? "skip" : danger.length ? "careful" : unrated.length ? "unrated" : "ok";
  return { verdict, forbidden, danger, unrated };
}

// ---------- valuation ----------

/** Categories a sacrificed currency stack can come from (poe.ninja exchange categories). */
export const CURRENCY_CATEGORIES = ["currency", "fragments", "essences", "fossils", "resonators", "oils", "delirium-orbs", "omens", "artifacts"];
export const CARD_CATEGORIES = ["divination"];
export const UNIQUE_PRICE_CATEGORIES = ["unique-weapons", "unique-armours", "unique-accessories", "unique-jewels", "unique-flasks", "unique-maps"];

export function categoriesFor(u: Ultimatum): string[] {
  switch (u.rewardKind) {
    case "DoubleCurrency":
      return CURRENCY_CATEGORIES;
    case "DoubleDivCards":
      return CARD_CATEGORIES;
    case "ExchangeUnique":
      return UNIQUE_PRICE_CATEGORIES;
    default:
      return [];
  }
}

export interface PriceHit {
  category: string;
  row: MarketItemRow;
}

/** Exact-name lookup. Stackables: the plain row. Uniques: every row of that name (variants differ). */
export function findPrices(name: string, snaps: Record<string, MarketSnapshot>, categories: readonly string[]): PriceHit[] {
  const key = name.trim().toLowerCase();
  const hits: PriceHit[] = [];
  for (const category of categories) {
    for (const row of snaps[category]?.items ?? []) if (row.name.toLowerCase() === key) hits.push({ category, row });
  }
  return hits;
}

export interface Range {
  low: number;
  high: number;
}

export type Valuation =
  | {
      ok: true;
      /** What you put at risk (lost when the trial fails). */
      stake: Range;
      /** Net gain when the trial is completed (reward minus what you gave up). */
      win: Range;
      /** Net result when the trial fails (stake and purchase price lost). */
      lose: Range;
      /**
       * Success rate at which running it breaks even (0..1), using the midpoints;
       * null when the run cannot pay off. Not a prediction of your success rate.
       */
      breakEven: number | null;
      /** Unique prices are by name: variants/rolls are not considered. */
      byName: boolean;
      categories: string[];
    }
  | { ok: false; reason: string };

const range = (values: number[]): Range | null => (values.length ? { low: Math.min(...values), high: Math.max(...values) } : null);
const mid = (r: Range) => (r.low + r.high) / 2;

/**
 * Values the deal in the game's base unit (chaos).
 * `paid` = what you paid for the Inscribed Ultimatum itself (0 if it dropped).
 */
export function valuate(u: Ultimatum, snaps: Record<string, MarketSnapshot>, paid = 0, baseUnitName = "Chaos Orb"): Valuation {
  if (!u.sacrifice) return { ok: false, reason: "The item has no “Requires Sacrifice” line." };
  const sac = u.sacrifice;
  switch (u.rewardKind) {
    case "DoubleCurrency":
    case "DoubleDivCards": {
      const cats = categoriesFor(u);
      const hits = findPrices(sac.name, snaps, cats).filter((h) => h.row.variant === null);
      // The base unit itself (Chaos Orb) is worth 1 by definition; poe.ninja has no row for it.
      const isBase = sac.name.toLowerCase() === baseUnitName.toLowerCase();
      const unit = isBase ? { low: 1, high: 1 } : range(hits.map((h) => h.row.value));
      if (!unit)
        return {
          ok: false,
          reason: `No poe.ninja price for “${sac.name}” in this league.`,
        };
      // Completing gives back twice the sacrifice: net +1× stake. Failing loses it.
      const stake = { low: unit.low * sac.count, high: unit.high * sac.count };
      return finish(stake, { low: stake.low - paid, high: stake.high - paid }, false, cats);
    }
    case "ExchangeUnique": {
      if (!u.rewardItem)
        return {
          ok: false,
          reason: "The reward unique is not named on the item.",
        };
      const sHits = findPrices(sac.name, snaps, UNIQUE_PRICE_CATEGORIES);
      const rHits = findPrices(u.rewardItem, snaps, UNIQUE_PRICE_CATEGORIES);
      const s = range(sHits.map((h) => h.row.value));
      const r = range(rHits.map((h) => h.row.value));
      if (!s)
        return {
          ok: false,
          reason: `No poe.ninja price for the sacrificed unique “${sac.name}”.`,
        };
      if (!r)
        return {
          ok: false,
          reason: `No poe.ninja price for the reward unique “${u.rewardItem}”.`,
        };
      const stake = { low: s.low * sac.count, high: s.high * sac.count };
      const win = {
        low: r.low - stake.high - paid,
        high: r.high - stake.low - paid,
      };
      return finish(stake, win, true, UNIQUE_PRICE_CATEGORIES);
    }
    case "MirrorRare":
      return {
        ok: false,
        reason: "A mirrored rare can't be priced from its name — check it on Trade.",
      };
    default:
      return { ok: false, reason: "Unrecognised reward." };
  }

  function finish(stake: Range, win: Range, byName: boolean, categories: string[]): Valuation {
    const lose = { low: -(stake.high + paid), high: -(stake.low + paid) };
    // p·win + (1−p)·lose = 0  →  p = −lose / (win − lose)
    const w = mid(win);
    const l = mid(lose);
    const breakEven = w > 0 && w - l > 0 ? -l / (w - l) : null;
    return { ok: true, stake, win, lose, breakEven, byName, categories };
  }
}

// ---------- official Trade ----------

/**
 * Search for Inscribed Ultimatums like this one. Filter ids from
 * /api/trade/data/filters (`ultimatum_filters`); the sacrifice/reward item
 * options are the item names (the site's "knownItem" fields).
 */
export function ultimatumTradeQuery(u: Ultimatum): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  if (u.challengeId) filters.ultimatum_challenge = { option: u.challengeId };
  if (u.rewardKind) filters.ultimatum_reward = { option: u.rewardKind };
  if (u.sacrifice) filters.ultimatum_input = { option: u.sacrifice.name };
  if (u.rewardKind === "ExchangeUnique" && u.rewardItem) filters.ultimatum_output = { option: u.rewardItem };
  return {
    query: {
      status: { option: "online" },
      type: "Inscribed Ultimatum",
      stats: [{ type: "and", filters: [] }],
      filters: { ultimatum_filters: { filters } },
    },
    sort: { price: "asc" },
  };
}
