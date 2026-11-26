/**
 * Deck Intelligence analytics (pure). Every number here is an estimate from market prices — never a
 * sale price — and every function keeps "unknown" apart from zero:
 * - a card without a price is counted as unpriced, never as 0 c;
 * - a session without an acquisition cost has no profit and no ROI;
 * - only confirmed cards count (review / unrecognized entries are reported separately).
 * Spec: docs/modules/deck-intelligence.md
 */
import type { DeckAcquisition, DeckCardTotal, DeckSessionSummary } from "@/core/ipc/commands";

/** Market (poe.ninja) and manual prices for one league, chaos per card. */
export interface PriceBook {
  league: string | null;
  market: ReadonlyMap<string, number>;
  manual: ReadonlyMap<string, number>;
  /** Unix ms of the market prices; null if never fetched. */
  at: number | null;
}

export type PriceSource = "market" | "manual" | "historical";

export function unitPrice(book: PriceBook | null, card: string): { value: number; source: PriceSource } | null {
  if (!book) return null;
  const manual = book.manual.get(card);
  if (manual !== undefined) return { value: manual, source: "manual" };
  const market = book.market.get(card);
  return market !== undefined ? { value: market, source: "market" } : null;
}

export type Outcome = "profit" | "loss" | "even";

export interface SessionView {
  summary: DeckSessionSummary;
  id: number;
  name: string;
  league: string | null;
  /** Unix seconds of the session start (opening date if given). */
  at: number;
  /** One Stacked Deck gives one card: confirmed cards = decks seen opened. */
  cards: number;
  /** Decks the user said they opened (planned), else the confirmed cards. */
  decks: number;
  review: number;
  unrecognized: number;
  /** Value used for results: original valuation when finished, live estimate otherwise. */
  value: number;
  valueKind: "original" | "live";
  /** Today's prices for the same cards (finished sessions; null while running = same as value). */
  currentValue: number | null;
  pricedCards: number;
  unpricedCards: number;
  cost: number | null;
  profit: number | null;
  /** Percent; null when the cost is unknown or zero. */
  roi: number | null;
  valuePerDeck: number | null;
  costPerDeck: number | null;
  valuePerMinute: number | null;
  outcome: Outcome | null;
  acquisition: DeckAcquisition;
}

/** Break-even band: within ±1 % of the cost (or ±1 c for tiny costs). */
export function outcomeOf(profit: number | null, cost: number | null): Outcome | null {
  if (profit === null || cost === null) return null;
  const band = Math.max(1, Math.abs(cost) * 0.01);
  return profit > band ? "profit" : profit < -band ? "loss" : "even";
}

export function roiOf(profit: number | null, cost: number | null): number | null {
  return profit !== null && cost !== null && cost > 0 ? (profit / cost) * 100 : null;
}

/** Live value of card counts at today's prices. */
export function valueCards(counts: Iterable<{ card: string; qty: number }>, book: PriceBook | null) {
  let value = 0;
  let priced = 0;
  let unpriced = 0;
  for (const { card, qty } of counts) {
    const p = unitPrice(book, card);
    if (p) {
      value += p.value * qty;
      priced += qty;
    } else unpriced += qty;
  }
  return { value, priced, unpriced };
}

export function openedOnSeconds(s: { openedOn: string | null; startedAt: number }): number {
  if (s.openedOn && /^\d{4}-\d{2}-\d{2}$/.test(s.openedOn)) {
    const t = Date.parse(`${s.openedOn}T12:00:00`);
    if (Number.isFinite(t)) return Math.floor(t / 1000);
  }
  return s.startedAt;
}

export function sessionView(summary: DeckSessionSummary, totals: readonly DeckCardTotal[], book: PriceBook | null): SessionView {
  const counts = totals.filter((t) => t.sessionId === summary.id);
  const live = valueCards(counts, book);
  const v = summary.valuation;
  const finished = summary.status === "finished" && v !== null;
  const value = finished ? v!.totalValue : live.value;
  const cost = summary.costTotal;
  const profit = cost !== null ? value - cost : null;
  const cards = summary.confirmed;
  const decks = summary.plannedDecks && summary.plannedDecks > 0 ? Math.max(summary.plannedDecks, cards) : cards;
  return {
    summary,
    id: summary.id,
    name: summary.name,
    league: summary.league,
    at: openedOnSeconds(summary),
    cards,
    decks,
    review: summary.review,
    unrecognized: summary.unrecognized,
    value,
    valueKind: finished ? "original" : "live",
    currentValue: finished ? live.value : null,
    pricedCards: finished ? v!.pricedCards : live.priced,
    unpricedCards: finished ? v!.unpricedCards : live.unpriced,
    cost,
    profit,
    roi: roiOf(profit, cost),
    valuePerDeck: cards > 0 ? value / cards : null,
    costPerDeck: cost !== null && decks > 0 ? cost / decks : null,
    valuePerMinute: summary.activeSecs >= 60 && summary.origin === "live" ? value / (summary.activeSecs / 60) : null,
    outcome: outcomeOf(profit, cost),
    acquisition: summary.acquisition,
  };
}

// ---------- filters ----------

export type RangePreset = "7d" | "30d" | "90d" | "all" | "custom";

export interface StatsFilter {
  /** "all" or a league name. */
  league: string;
  range: RangePreset;
  /** YYYY-MM-DD, used with range "custom". */
  from?: string;
  to?: string;
  acquisition: DeckAcquisition | "all";
  /** Restrict to these sessions (empty = all). */
  sessionIds: readonly number[];
}

export const DEFAULT_FILTER: StatsFilter = { league: "all", range: "all", acquisition: "all", sessionIds: [] };

export function rangeBounds(f: StatsFilter, nowSec: number): { from: number | null; to: number | null } {
  const day = 86_400;
  switch (f.range) {
    case "7d":
      return { from: nowSec - 7 * day, to: null };
    case "30d":
      return { from: nowSec - 30 * day, to: null };
    case "90d":
      return { from: nowSec - 90 * day, to: null };
    case "custom": {
      const parse = (d: string | undefined, end: boolean) => {
        if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
        const t = Date.parse(`${d}T${end ? "23:59:59" : "00:00:00"}`);
        return Number.isFinite(t) ? Math.floor(t / 1000) : null;
      };
      return { from: parse(f.from, false), to: parse(f.to, true) };
    }
    default:
      return { from: null, to: null };
  }
}

export function applyFilter(views: readonly SessionView[], f: StatsFilter, nowSec: number): SessionView[] {
  const { from, to } = rangeBounds(f, nowSec);
  const ids = new Set(f.sessionIds);
  return views.filter(
    (v) =>
      (f.league === "all" || v.league === f.league) &&
      (f.acquisition === "all" || v.acquisition === f.acquisition) &&
      (from === null || v.at >= from) &&
      (to === null || v.at <= to) &&
      (ids.size === 0 || ids.has(v.id)),
  );
}

// ---------- totals ----------

export interface Totals {
  sessions: number;
  decks: number;
  cards: number;
  review: number;
  unrecognized: number;
  value: number;
  unpricedCards: number;
  /** Sum of known costs. */
  cost: number;
  sessionsWithCost: number;
  /** Over sessions with a known cost only. */
  profit: number | null;
  roi: number | null;
  avgValuePerDeck: number | null;
  avgCostPerDeck: number | null;
  avgCardValue: number | null;
  avgSessionRoi: number | null;
  best: SessionView | null;
  worst: SessionView | null;
  outcomes: Record<Outcome, number>;
  /** Sessions without a cost (no outcome). */
  unknownOutcome: number;
  valuePerMinute: number | null;
}

export function totals(views: readonly SessionView[]): Totals {
  let decks = 0,
    cards = 0,
    review = 0,
    unrecognized = 0,
    value = 0,
    unpriced = 0,
    priced = 0,
    cost = 0,
    withCost = 0,
    profit = 0,
    decksWithCost = 0,
    liveValue = 0,
    liveSecs = 0;
  const rois: number[] = [];
  const outcomes: Record<Outcome, number> = { profit: 0, loss: 0, even: 0 };
  let unknownOutcome = 0;
  let best: SessionView | null = null;
  let worst: SessionView | null = null;
  for (const v of views) {
    decks += v.decks;
    cards += v.cards;
    review += v.review;
    unrecognized += v.unrecognized;
    value += v.value;
    unpriced += v.unpricedCards;
    priced += v.pricedCards;
    if (v.valuePerMinute !== null) {
      liveValue += v.value;
      liveSecs += v.summary.activeSecs;
    }
    if (v.cost !== null && v.profit !== null) {
      cost += v.cost;
      withCost += 1;
      profit += v.profit;
      decksWithCost += v.decks;
      if (!best || v.profit > best.profit!) best = v;
      if (!worst || v.profit < worst.profit!) worst = v;
    }
    if (v.roi !== null) rois.push(v.roi);
    if (v.outcome) outcomes[v.outcome] += 1;
    else unknownOutcome += 1;
  }
  return {
    sessions: views.length,
    decks,
    cards,
    review,
    unrecognized,
    value,
    unpricedCards: unpriced,
    cost,
    sessionsWithCost: withCost,
    profit: withCost > 0 ? profit : null,
    roi: withCost > 0 && cost > 0 ? (profit / cost) * 100 : null,
    avgValuePerDeck: cards > 0 ? value / cards : null,
    avgCostPerDeck: decksWithCost > 0 ? cost / decksWithCost : null,
    avgCardValue: priced > 0 ? value / priced : null,
    avgSessionRoi: rois.length > 0 ? rois.reduce((a, b) => a + b, 0) / rois.length : null,
    best,
    worst,
    outcomes,
    unknownOutcome,
    valuePerMinute: liveSecs >= 60 ? liveValue / (liveSecs / 60) : null,
  };
}

/** Sessions oldest first with the running total of profit (sessions without cost are skipped). */
export function cumulative(views: readonly SessionView[]): { view: SessionView; profit: number; total: number }[] {
  let total = 0;
  return [...views]
    .filter((v) => v.profit !== null)
    .sort((a, b) => a.at - b.at || a.id - b.id)
    .map((view) => {
      total += view.profit!;
      return { view, profit: view.profit!, total };
    });
}

// ---------- cards ----------

export interface CardRow {
  card: string;
  qty: number;
  sessions: number;
  sessionIds: number[];
  lastAt: number;
  /** Today's unit price, null = unknown. */
  unit: number | null;
  unitSource: PriceSource | null;
  /** Value at the prices of each session (original for finished, today for running). */
  value: number;
  unpriced: number;
  /** Share of all confirmed cards in the selection, 0–1 (observed, not a drop rate). */
  share: number;
}

/** Unit value of a card in a session: its original valuation line, else today's price. */
export function sessionUnit(view: SessionView | undefined, card: string, book: PriceBook | null): { value: number; source: PriceSource } | null {
  const line = view?.valueKind === "original" ? view.summary.valuation?.lines.find((l) => l.card === card) : undefined;
  if (line) return line.unit !== null ? { value: line.unit, source: "historical" } : null;
  return unitPrice(book, card);
}

export function cardRows(views: readonly SessionView[], all: readonly DeckCardTotal[], book: PriceBook | null): CardRow[] {
  const byId = new Map(views.map((v) => [v.id, v]));
  const rows = new Map<string, CardRow>();
  let total = 0;
  for (const t of all) {
    const view = byId.get(t.sessionId);
    if (!view) continue;
    total += t.qty;
    let r = rows.get(t.card);
    if (!r) {
      const p = unitPrice(book, t.card);
      r = { card: t.card, qty: 0, sessions: 0, sessionIds: [], lastAt: 0, unit: p?.value ?? null, unitSource: p?.source ?? null, value: 0, unpriced: 0, share: 0 };
      rows.set(t.card, r);
    }
    r.qty += t.qty;
    r.sessions += 1;
    r.sessionIds.push(t.sessionId);
    r.lastAt = Math.max(r.lastAt, t.lastAt);
    const u = sessionUnit(view, t.card, book);
    if (u) r.value += u.value * t.qty;
    else r.unpriced += t.qty;
  }
  for (const r of rows.values()) r.share = total > 0 ? r.qty / total : 0;
  return [...rows.values()];
}

export interface Drop {
  card: string;
  sessionId: number;
  sessionName: string;
  qty: number;
  unit: number;
  total: number;
  source: PriceSource;
}

/** Most valuable (card, session) pairs by unit value. */
export function topDrops(views: readonly SessionView[], all: readonly DeckCardTotal[], book: PriceBook | null, limit = 10): Drop[] {
  const byId = new Map(views.map((v) => [v.id, v]));
  const out: Drop[] = [];
  for (const t of all) {
    const view = byId.get(t.sessionId);
    if (!view) continue;
    const u = sessionUnit(view, t.card, book);
    if (!u) continue;
    out.push({ card: t.card, sessionId: view.id, sessionName: view.name, qty: t.qty, unit: u.value, total: u.value * t.qty, source: u.source });
  }
  return out.sort((a, b) => b.unit - a.unit || b.total - a.total).slice(0, limit);
}

/** Share of the selection's value that its `n` most valuable cards (by total) contribute, 0–1. */
export function topShare(rows: readonly CardRow[], n: number): number | null {
  const sum = rows.reduce((a, r) => a + r.value, 0);
  if (sum <= 0) return null;
  const top = [...rows].sort((a, b) => b.value - a.value).slice(0, n);
  return top.reduce((a, r) => a + r.value, 0) / sum;
}

// ---------- distributions ----------

export const DEFAULT_BUCKETS = [1, 5, 20, 100] as const;

export function isBuckets(v: unknown): v is number[] {
  return Array.isArray(v) && v.length >= 1 && v.length <= 8 && v.every((x, i) => typeof x === "number" && x > 0 && Number.isFinite(x) && (i === 0 || x > (v[i - 1] as number)));
}

export interface Bucket {
  label: string;
  /** Inclusive lower, exclusive upper (chaos); null = open. */
  min: number | null;
  max: number | null;
  cards: number;
  value: number;
}

const c = (n: number) => `${n}c`;

/** Card counts per value range; unpriced cards get their own bucket (never 0 c). */
export function distribution(rows: readonly { qty: number; unit: number | null }[], edges: readonly number[]): { buckets: Bucket[]; unpriced: number } {
  const e = isBuckets([...edges]) ? edges : DEFAULT_BUCKETS;
  const buckets: Bucket[] = [];
  buckets.push({ label: `< ${c(e[0]!)}`, min: null, max: e[0]!, cards: 0, value: 0 });
  for (let i = 0; i < e.length - 1; i++) buckets.push({ label: `${e[i]}–${c(e[i + 1]!)}`, min: e[i]!, max: e[i + 1]!, cards: 0, value: 0 });
  buckets.push({ label: `${c(e[e.length - 1]!)}+`, min: e[e.length - 1]!, max: null, cards: 0, value: 0 });
  let unpriced = 0;
  for (const r of rows) {
    if (r.unit === null) {
      unpriced += r.qty;
      continue;
    }
    const b = buckets.find((b) => (b.min === null || r.unit! >= b.min) && (b.max === null || r.unit! < b.max))!;
    b.cards += r.qty;
    b.value += r.qty * r.unit;
  }
  return { buckets, unpriced };
}

export type Period = "day" | "week" | "month";

function periodKey(sec: number, p: Period): string {
  const d = new Date(sec * 1000);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (p === "month") return `${y}-${String(m).padStart(2, "0")}`;
  if (p === "day") return `${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // ISO week start (Monday), local time
  const monday = new Date(d);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

/** Decks opened per day / week (Monday) / month, oldest first. Only periods with sessions. */
export function volume(views: readonly SessionView[], p: Period): { key: string; decks: number; sessions: number }[] {
  const m = new Map<string, { key: string; decks: number; sessions: number }>();
  for (const v of views) {
    const k = periodKey(v.at, p);
    const e = m.get(k) ?? { key: k, decks: 0, sessions: 0 };
    e.decks += v.decks;
    e.sessions += 1;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ---------- export ----------

const csvCell = (v: string | number | null) => {
  if (v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function sessionsCsv(views: readonly SessionView[]): string {
  const head = ["id", "name", "league", "date", "status", "origin", "decks", "confirmed_cards", "review", "unrecognized", "value_chaos", "value_kind", "unpriced_cards", "cost_chaos", "profit_chaos", "roi_percent", "acquisition"];
  const rows = views.map((v) =>
    [
      v.id,
      v.name,
      v.league,
      new Date(v.at * 1000).toISOString().slice(0, 10),
      v.summary.status,
      v.summary.origin,
      v.decks,
      v.cards,
      v.review,
      v.unrecognized,
      Number(v.value.toFixed(2)),
      v.valueKind,
      v.unpricedCards,
      v.cost,
      v.profit === null ? null : Number(v.profit.toFixed(2)),
      v.roi === null ? null : Number(v.roi.toFixed(2)),
      v.acquisition,
    ]
      .map(csvCell)
      .join(","),
  );
  return [head.join(","), ...rows].join("\n");
}
