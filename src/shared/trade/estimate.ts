/**
 * Price estimate from real listings. Always presented as an estimate, never as
 * a listing. Only listings whose price could be converted to the base unit
 * (via cached poe.ninja rates) are used.
 */
export interface EstimateInput {
  amountBase: number | null;
}

export interface Estimate {
  estimate: number;
  low: number;
  median: number;
  /** Listings used after removing suspicious outliers. */
  used: number;
  /** Listings ignored as suspiciously cheap (likely mispriced/price-fixing). */
  outliers: number;
  confidence: "high" | "medium" | "low";
}

function median(sorted: readonly number[]): number {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

export function estimatePrice(listings: readonly EstimateInput[]): Estimate | null {
  const prices = listings
    .map((l) => l.amountBase)
    .filter((p): p is number => p != null && Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) return null;

  const med = median(prices);
  // Listings far below the median are usually bait or mistakes.
  const kept = prices.length >= 4 ? prices.filter((p) => p >= med * 0.35) : prices;
  const lowest = kept.slice(0, Math.min(5, kept.length));
  const p25 = kept[Math.floor((kept.length - 1) * 0.25)]!;
  const p75 = kept[Math.floor((kept.length - 1) * 0.75)]!;
  const spread = p25 > 0 ? p75 / p25 : Infinity;

  const confidence: Estimate["confidence"] = kept.length >= 8 && spread <= 2 ? "high" : kept.length >= 4 && spread <= 4 ? "medium" : "low";
  return {
    estimate: median(lowest),
    low: kept[0]!,
    median: median(kept),
    used: kept.length,
    outliers: prices.length - kept.length,
    confidence,
  };
}
