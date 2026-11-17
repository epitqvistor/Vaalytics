import type { MarketItemRow, MarketLeague } from "@/core/ipc/commands";

/**
 * Default league when the user has not chosen one: the first indexed softcore
 * challenge league, else the first softcore league, else whatever exists.
 */
export function defaultLeague(leagues: readonly MarketLeague[]): string | null {
  const softcore = leagues.filter((l) => !l.hardcore);
  return (
    softcore.find((l) => l.indexed && l.name !== "Standard")?.name ??
    softcore[0]?.name ??
    leagues[0]?.name ??
    null
  );
}

/**
 * Reconstructs approximate daily values from poe.ninja's 7-day sparkline, which
 * reports each day as % change relative to 7 days ago. The last point equals the
 * current value. Unknown days are dropped. Returns [] if the series is unusable.
 */
export function trendValues(item: Pick<MarketItemRow, "value" | "sparkline">): { daysAgo: number; value: number }[] {
  const data = item.sparkline;
  const n = data.length;
  if (n < 2) return [];
  const last = data[n - 1];
  if (last == null || !Number.isFinite(last) || last <= -100) return [];
  const start = item.value / (1 + last / 100);
  const out: { daysAgo: number; value: number }[] = [];
  data.forEach((pct, i) => {
    if (pct != null && Number.isFinite(pct) && pct > -100) out.push({ daysAgo: n - 1 - i, value: start * (1 + pct / 100) });
  });
  return out.length >= 2 ? out : [];
}

export function favoriteKey(category: string, itemId: string): string {
  return `${category}:${itemId}`;
}

export function parseFavoriteKey(key: string): { category: string; itemId: string } | null {
  const i = key.indexOf(":");
  if (i <= 0 || i === key.length - 1) return null;
  return { category: key.slice(0, i), itemId: key.slice(i + 1) };
}

/** Movers worth showing: liquid items (top half by traded volume) with the largest absolute change. */
export function biggestMovers(items: readonly MarketItemRow[], limit: number): MarketItemRow[] {
  const withChange = items.filter((i) => i.change7d != null && Number.isFinite(i.change7d));
  const volumes = withChange.map((i) => i.volumeValue ?? i.listings ?? 0).sort((a, b) => a - b);
  const median = volumes[Math.floor(volumes.length / 2)] ?? 0;
  return withChange
    .filter((i) => (i.volumeValue ?? i.listings ?? 0) >= median)
    .sort((a, b) => Math.abs(b.change7d!) - Math.abs(a.change7d!))
    .slice(0, limit);
}

/** "12 min ago" style freshness from unix seconds. */
export function secondsUntil(unixSecs: number | null, nowMs: number): number | null {
  return unixSecs == null ? null : Math.round(unixSecs - nowMs / 1000);
}
