/**
 * Market valuation from real Trade listings — transparent by design.
 *
 * Every fetched listing gets a verdict (used / outlier / no price) so the UI can show why it
 * counts or not. The estimate is a match-weighted median of the comparable cluster after
 * removing outliers on a log scale (prices are multiplicative: 5c vs 10c is as far as 50c vs 100c).
 * Confidence considers how the search was made (base type only never gets a confidence grade),
 * how many listings survived, how tight their prices are, how well they match, and their age.
 *
 * Note: Trade sorts by price, so the fetched listings are the cheapest N of `total`. The estimate is
 * therefore "what comparable items are listed for at the cheap end of the market", which is what a
 * buyer pays and a seller competes with — the UI says so.
 */

export type Basis =
  /** Identity search: unique by name, gem, currency, card, map, corpse… */
  | "exact"
  /** Searched with the item's own modifiers / pseudo totals. */
  | "stats"
  /** Only the base type of an item whose value depends on its modifiers (rare/magic). */
  | "base";

export type Verdict = "used" | "low-outlier" | "high-outlier" | "no-price";

export type Confidence = "high" | "medium" | "low" | "insufficient" | "base-only" | "unpriced";

export interface ValuationListing {
  id: string;
  amountBase: number | null;
  /** ISO timestamp of the listing. */
  indexed?: string | null;
  /** 0–1: share of the searched modifiers found on the listing (null when nothing to compare). */
  match?: number | null;
}

export interface Valuation {
  basis: Basis;
  confidence: Confidence;
  /** Match-weighted median of used listings; null when there is no defensible number. */
  estimate: number | null;
  /** Cheapest used listing (not an outlier). */
  lowest: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  used: number;
  lowOutliers: number;
  highOutliers: number;
  /** Listings whose price could not be converted (unknown currency / no rates). */
  noPrice: number;
  fetched: number;
  total: number;
  verdicts: Map<string, Verdict>;
  /** Plain-language reasons behind the confidence grade. */
  reasons: string[];
}

export interface ValuationInput {
  listings: readonly ValuationListing[];
  /** Matching listings reported by Trade (may exceed the fetched sample). */
  total: number;
  basis: Basis;
  /** Item modifiers that could not be searched (they may matter for the value). */
  unsearchedMods?: number;
  /** For listing age; defaults to Date.now(). */
  now?: number;
}

const quantile = (sorted: readonly number[], q: number): number => {
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
};

/** Median where each value counts `weight` times (ties resolved to the lower middle). */
export function weightedMedian(values: readonly { v: number; w: number }[]): number {
  const s = [...values].sort((a, b) => a.v - b.v);
  const total = s.reduce((t, x) => t + x.w, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= total / 2) return x.v;
  }
  return s[s.length - 1]!.v;
}

/**
 * Outlier fences. With ≥5 prices: Tukey fences (1.5 × IQR) on log prices. With 3–4: a plain
 * ratio rule around the median (below 35 % or above 3×). Fewer: nothing is called an outlier.
 */
export function outlierFences(prices: readonly number[]): { low: number; high: number } {
  const sorted = [...prices].sort((a, b) => a - b);
  if (sorted.length < 3) return { low: 0, high: Infinity };
  if (sorted.length < 5) {
    const med = quantile(sorted, 0.5);
    return { low: med * 0.35, high: med * 3 };
  }
  const logs = sorted.map(Math.log);
  const q1 = quantile(logs, 0.25);
  const q3 = quantile(logs, 0.75);
  // A floor on the spread keeps a tight cluster (e.g. 9, 10, 10, 10, 11) from flagging normal prices.
  const iqr = Math.max(q3 - q1, Math.log(1.25));
  // Prices are listed in whole base units (1 c, 2 c…): at the cheap end that rounding is larger than
  // any real difference, so an outlier must also lie more than one base unit outside the cluster
  // (1 c among 2–3 c is a normal price; 1 alch among 2–3 c is still bait).
  const lowQ = Math.exp(q1);
  const highQ = Math.exp(q3);
  return { low: Math.min(Math.exp(q1 - 1.5 * iqr), lowQ - 1), high: Math.max(Math.exp(q3 + 1.5 * iqr), highQ + 1) };
}

const DAY = 86_400_000;

export function valuate({ listings, total, basis, unsearchedMods = 0, now = Date.now() }: ValuationInput): Valuation {
  const verdicts = new Map<string, Verdict>();
  const priced = listings.filter((l) => l.amountBase != null && Number.isFinite(l.amountBase) && l.amountBase > 0);
  for (const l of listings) if (!priced.includes(l)) verdicts.set(l.id, "no-price");

  const fences = outlierFences(priced.map((l) => l.amountBase!));
  const used: ValuationListing[] = [];
  let lowOutliers = 0;
  let highOutliers = 0;
  for (const l of priced) {
    const p = l.amountBase!;
    if (p < fences.low) {
      verdicts.set(l.id, "low-outlier");
      lowOutliers++;
    } else if (p > fences.high) {
      verdicts.set(l.id, "high-outlier");
      highOutliers++;
    } else {
      verdicts.set(l.id, "used");
      used.push(l);
    }
  }

  const prices = used.map((l) => l.amountBase!).sort((a, b) => a - b);
  const base: Valuation = {
    basis,
    confidence: "unpriced",
    estimate: null,
    lowest: prices[0] ?? null,
    median: prices.length ? quantile(prices, 0.5) : null,
    p25: prices.length ? quantile(prices, 0.25) : null,
    p75: prices.length ? quantile(prices, 0.75) : null,
    used: used.length,
    lowOutliers,
    highOutliers,
    noPrice: listings.length - priced.length,
    fetched: listings.length,
    total,
    verdicts,
    reasons: [],
  };

  if (total === 0 || listings.length === 0) return { ...base, reasons: ["No listings match this search."] };
  if (priced.length === 0) return { ...base, reasons: ["None of the fetched listings has a price that could be converted."] };

  // Weight: listings that match more of the searched modifiers count more (never zero).
  const estimate = weightedMedian(used.map((l) => ({ v: l.amountBase!, w: 0.5 + 0.5 * (l.match ?? 1) })));

  if (basis === "base") {
    return {
      ...base,
      confidence: "base-only",
      estimate,
      reasons: ["Searched by base type only — the item's modifiers were not part of the search, so this is not a valuation of this item."],
    };
  }
  if (used.length < 3) {
    return {
      ...base,
      confidence: "insufficient",
      reasons: [`Only ${used.length} comparable listing${used.length === 1 ? "" : "s"} with a usable price — not enough for an estimate.`],
    };
  }

  const reasons: string[] = [];
  const spread = base.p25! > 0 ? base.p75! / base.p25! : Infinity;
  let grade: "high" | "medium" | "low" = used.length >= 8 && spread <= 1.6 ? "high" : used.length >= 5 && spread <= 3 ? "medium" : "low";
  reasons.push(`${used.length} comparable listing${used.length === 1 ? "" : "s"}, middle half within ×${spread === Infinity ? "∞" : spread.toFixed(1)}.`);

  const cap = (to: "medium" | "low", why: string) => {
    reasons.push(why);
    if (to === "low" || grade === "high") grade = to;
  };
  const outlierShare = (lowOutliers + highOutliers) / priced.length;
  if (outlierShare > 0.3) cap("medium", `${lowOutliers + highOutliers} of ${priced.length} prices are outliers — the market is noisy.`);
  if (basis === "stats") {
    const matches = used.map((l) => l.match).filter((m): m is number => m != null);
    const avg = matches.length ? matches.reduce((a, b) => a + b, 0) / matches.length : 1;
    if (avg < 0.8) cap("medium", `Listings match ${Math.round(avg * 100)} % of the searched modifiers on average.`);
    if (unsearchedMods > 0) cap("medium", `${unsearchedMods} modifier${unsearchedMods === 1 ? " was" : "s were"} not searchable and may change the value.`);
  }
  const ages = used.map((l) => (l.indexed ? now - Date.parse(l.indexed) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
  if (ages.length && quantile(ages, 0.5) > 7 * DAY) cap("medium", "Most comparable listings are over a week old — they may be stale.");
  if (total < 5) cap("low", `Only ${total} listing${total === 1 ? "" : "s"} on the market.`);

  return { ...base, confidence: grade, estimate, reasons };
}
