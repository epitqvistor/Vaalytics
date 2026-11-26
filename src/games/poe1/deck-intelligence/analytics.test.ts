import { describe, expect, it } from "vitest";
import type { DeckCardTotal, DeckSessionSummary } from "@/core/ipc/commands";
import {
  applyFilter,
  cardRows,
  cumulative,
  DEFAULT_FILTER,
  distribution,
  isBuckets,
  groupByLeague,
  outcomeOf,
  type PriceBook,
  roiOf,
  sessionsCsv,
  sessionView,
  topDrops,
  topShare,
  totals,
  volume,
} from "./analytics";

const DAY = 86_400;
const NOW = 1_780_000_000;

function summary(p: Partial<DeckSessionSummary> & { id: number }): DeckSessionSummary {
  return {
    name: `S${p.id}`,
    league: "Covens",
    createdAt: NOW,
    openedOn: null,
    status: "finished",
    origin: "live",
    startedAt: NOW - p.id * DAY,
    endedAt: NOW,
    activeSecs: 600,
    resumedAt: null,
    plannedDecks: null,
    openedDecks: null,
    acquisition: "bulk",
    costTotal: null,
    notes: null,
    confirmed: 0,
    review: 0,
    unrecognized: 0,
    firstCardAt: null,
    lastCardAt: null,
    valuation: null,
    ...p,
  };
}

const book: PriceBook = {
  league: "Covens",
  market: new Map([
    ["The Lover", 2],
    ["The Doctor", 900],
    ["Rain of Chaos", 0.5],
  ]),
  manual: new Map([["Rain of Chaos", 1]]),
  at: NOW * 1000,
};

const totalsFor = (sessionId: number, cards: [string, number][]): DeckCardTotal[] => cards.map(([card, qty]) => ({ sessionId, card, qty, firstAt: NOW, lastAt: NOW }));

describe("profit and ROI", () => {
  it("computes profit and ROI from the original valuation", () => {
    const s = summary({
      id: 1,
      confirmed: 10,
      costTotal: 30,
      valuation: { valuedAt: NOW, league: "Covens", pricesAt: NOW, totalValue: 45, pricedCards: 10, unpricedCards: 0, lines: [{ card: "The Lover", qty: 10, unit: 4.5, source: "market" }] },
    });
    const v = sessionView(s, totalsFor(1, [["The Lover", 10]]), book);
    expect(v.value).toBe(45);
    expect(v.valueKind).toBe("original");
    expect(v.currentValue).toBe(20); // today's price 2 c × 10 — original is kept separately
    expect(v.profit).toBe(15);
    expect(v.roi).toBe(50);
    expect(v.outcome).toBe("profit");
    expect(v.valuePerDeck).toBe(4.5);
    expect(v.costPerDeck).toBe(3);
  });

  it("has no profit or ROI without a cost, and no ROI for a zero cost", () => {
    const v = sessionView(summary({ id: 2, confirmed: 1, status: "running" }), totalsFor(2, [["The Lover", 1]]), book);
    expect(v.profit).toBeNull();
    expect(v.roi).toBeNull();
    expect(v.outcome).toBeNull();
    expect(roiOf(5, 0)).toBeNull();
    expect(outcomeOf(0.5, 100)).toBe("even");
    expect(outcomeOf(-5, 100)).toBe("loss");
  });

  it("values running sessions live and keeps unpriced cards out of the total", () => {
    const v = sessionView(summary({ id: 3, status: "running", confirmed: 4, costTotal: 2 }), totalsFor(3, [["Rain of Chaos", 3], ["Unknown Card", 1]]), book);
    expect(v.valueKind).toBe("live");
    expect(v.value).toBe(3); // manual 1 c beats market 0.5 c
    expect(v.unpricedCards).toBe(1);
    expect(v.pricedCards).toBe(3);
  });

  it("has an unknown value (no profit) when no card of the session has a price", () => {
    const v = sessionView(summary({ id: 9, status: "running", confirmed: 3, costTotal: 50 }), totalsFor(9, [["No Price Card", 3]]), book);
    expect(v.valueKnown).toBe(false);
    expect(v.profit).toBeNull();
    expect(v.roi).toBeNull();
    expect(v.outcome).toBeNull();
  });

  it("counts planned decks when more decks were opened than cards confirmed", () => {
    const v = sessionView(summary({ id: 4, confirmed: 8, plannedDecks: 10, costTotal: 20 }), [], book);
    expect(v.decks).toBe(10);
    expect(v.costPerDeck).toBe(2);
    expect(v.cost).toBe(20);
  });

  it("uses the decks you opened for the cost while a session runs", () => {
    // 2472 bought, none opened yet: no loss yet (was −100 %).
    const empty = sessionView(summary({ id: 5, status: "running", confirmed: 0, plannedDecks: 2472, costTotal: 8034 }), [], book);
    expect(empty.decks).toBe(0);
    expect(empty.cost).toBe(0);
    expect(empty.roi).toBeNull();
    expect(empty.costPerDeck).toBeCloseTo(3.25, 2);
    // 100 opened (entered), 90 cards read: cost of 100 decks.
    const s = summary({ id: 6, status: "running", confirmed: 90, plannedDecks: 200, openedDecks: 100, costTotal: 600 });
    const v = sessionView(s, totalsFor(6, [["The Lover", 90]]), book);
    expect(v.decks).toBe(100);
    expect(v.cost).toBe(300);
    expect(v.profit).toBe(180 - 300);
    // An entered count lower than the confirmed cards is raised to the cards (one deck = one card).
    expect(sessionView(summary({ id: 7, confirmed: 5, openedDecks: 3 }), [], book).decks).toBe(5);
    // Finished with fewer opened than bought: only the opened share is spent.
    expect(sessionView(summary({ id: 8, confirmed: 50, plannedDecks: 100, openedDecks: 50, costTotal: 300 }), [], book).cost).toBe(150);
  });
});

describe("aggregation", () => {
  const views = [
    sessionView(summary({ id: 1, confirmed: 10, costTotal: 30, valuation: { valuedAt: 0, league: "Covens", pricesAt: 0, totalValue: 45, pricedCards: 10, unpricedCards: 0, lines: [] } }), [], book),
    sessionView(summary({ id: 2, confirmed: 5, costTotal: 20, valuation: { valuedAt: 0, league: "Covens", pricesAt: 0, totalValue: 5, pricedCards: 5, unpricedCards: 0, lines: [] } }), [], book),
    sessionView(summary({ id: 3, confirmed: 5, league: "Standard", acquisition: "farmed", valuation: { valuedAt: 0, league: "Standard", pricesAt: 0, totalValue: 10, pricedCards: 4, unpricedCards: 1, lines: [] } }), [], book),
  ];

  it("totals only use known costs for profit and ROI", () => {
    const t = totals(views);
    expect(t.sessions).toBe(3);
    expect(t.value).toBe(60);
    expect(t.cost).toBe(50);
    expect(t.sessionsWithCost).toBe(2);
    expect(t.profit).toBe(0); // +15 − 15
    expect(t.roi).toBe(0);
    expect(t.best?.id).toBe(1);
    expect(t.worst?.id).toBe(2);
    expect(t.outcomes).toEqual({ profit: 1, loss: 1, even: 0 });
    expect(t.unknownOutcome).toBe(1);
    expect(t.avgSessionRoi).toBe((50 - 75) / 2);
    expect(t.unpricedCards).toBe(1);
  });

  it("filters by league, acquisition, date and sessions", () => {
    expect(applyFilter(views, { ...DEFAULT_FILTER, league: "Standard" }, NOW).map((v) => v.id)).toEqual([3]);
    expect(applyFilter(views, { ...DEFAULT_FILTER, acquisition: "bulk" }, NOW).map((v) => v.id)).toEqual([1, 2]);
    expect(applyFilter(views, { ...DEFAULT_FILTER, range: "7d" }, NOW).length).toBe(3);
    expect(applyFilter(views, { ...DEFAULT_FILTER, sessionIds: [2] }, NOW).map((v) => v.id)).toEqual([2]);
    const old = sessionView(summary({ id: 40 }), [], book);
    expect(applyFilter([old], { ...DEFAULT_FILTER, range: "30d" }, NOW)).toEqual([]);
  });

  it("builds a cumulative profit line, oldest first, skipping unknown costs", () => {
    const c = cumulative(views);
    expect(c.map((x) => x.view.id)).toEqual([2, 1]);
    expect(c.map((x) => x.total)).toEqual([-15, 0]);
  });

  it("aggregates volume per period", () => {
    const v = volume(views, "month");
    expect(v.reduce((a, x) => a + x.decks, 0)).toBe(20);
    expect(v.every((x) => /^\d{4}-\d{2}$/.test(x.key))).toBe(true);
    expect(volume(views, "day").length).toBe(3);
  });
});

describe("history groups", () => {
  it("groups by league: selected league first, then newest, no league last", () => {
    const vs = [
      sessionView(summary({ id: 1, league: "Standard", startedAt: NOW - 1 * DAY }), [], book),
      sessionView(summary({ id: 2, league: "Covens", startedAt: NOW - 5 * DAY }), [], book),
      sessionView(summary({ id: 3, league: null, startedAt: NOW }), [], book),
      sessionView(summary({ id: 4, league: "Mercenaries", startedAt: NOW - 2 * DAY }), [], book),
      sessionView(summary({ id: 5, league: "Covens", startedAt: NOW - 3 * DAY }), [], book),
    ];
    const g = groupByLeague(vs, "Covens");
    expect(g.map((x) => x.league)).toEqual(["Covens", "Standard", "Mercenaries", null]);
    expect(g[0]!.views.map((v) => v.id)).toEqual([2, 5]); // order inside a group is kept
    expect(g[0]!.latest).toBe(NOW - 3 * DAY);
    expect(groupByLeague(vs, null).map((x) => x.league)).toEqual(["Standard", "Mercenaries", "Covens", null]);
    expect(groupByLeague([], "Covens")).toEqual([]);
  });
});

describe("cards", () => {
  const s1 = summary({
    id: 1,
    confirmed: 3,
    valuation: { valuedAt: 0, league: "Covens", pricesAt: 0, totalValue: 1000, pricedCards: 2, unpricedCards: 1, lines: [{ card: "The Doctor", qty: 1, unit: 1000, source: "market" }, { card: "Mystery", qty: 1, unit: null, source: null }, { card: "The Lover", qty: 1, unit: 3, source: "market" }] },
  });
  const s2 = summary({ id: 2, status: "running", confirmed: 2 });
  const all = [...totalsFor(1, [["The Doctor", 1], ["Mystery", 1], ["The Lover", 1]]), ...totalsFor(2, [["The Lover", 2]])];
  const views = [sessionView(s1, all, book), sessionView(s2, all, book)];

  it("collects cards across sessions with historical and live values", () => {
    const rows = cardRows(views, all, book);
    const lover = rows.find((r) => r.card === "The Lover")!;
    expect(lover.qty).toBe(3);
    expect(lover.sessions).toBe(2);
    expect(lover.value).toBe(3 + 2 * 2); // original 3 c in session 1, today 2 c in running session 2
    expect(lover.share).toBeCloseTo(3 / 5);
    const mystery = rows.find((r) => r.card === "Mystery")!;
    expect(mystery.unpriced).toBe(1);
    expect(mystery.value).toBe(0);
    expect(topShare(rows, 1)).toBeCloseTo(1000 / 1007);
  });

  it("ranks the most valuable drops by unit value", () => {
    const d = topDrops(views, all, book, 2);
    expect(d.map((x) => x.card)).toEqual(["The Doctor", "The Lover"]);
    expect(d[0]!.source).toBe("historical");
  });

  it("puts unpriced cards in their own bucket", () => {
    const { buckets, unpriced } = distribution(
      [
        { qty: 2, unit: 0.5 },
        { qty: 1, unit: 5 },
        { qty: 1, unit: 150 },
        { qty: 3, unit: null },
      ],
      [1, 5, 20, 100],
    );
    expect(buckets.map((b) => b.cards)).toEqual([2, 0, 1, 0, 1]);
    expect(buckets.map((b) => b.label)).toEqual(["< 1c", "1–5c", "5–20c", "20–100c", "100c+"]);
    expect(unpriced).toBe(3);
    expect(isBuckets([1, 5])).toBe(true);
    expect(isBuckets([5, 1])).toBe(false);
    expect(isBuckets([])).toBe(false);
  });

  it("exports CSV with escaped names and empty unknowns", () => {
    const csv = sessionsCsv([sessionView(summary({ id: 9, name: 'Big, "lucky" night' }), [], book)]);
    const [head, row] = csv.split("\n");
    expect(head!.startsWith("id,name,league")).toBe(true);
    expect(row).toContain('"Big, ""lucky"" night"');
    expect(row).toMatch(/,,,bulk$/); // cost, profit, ROI unknown
  });
});
