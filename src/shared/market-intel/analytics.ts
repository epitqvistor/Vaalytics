/**
 * Market Intelligence analytics. Pure functions over poe.ninja snapshots the
 * Market engine already caches — no new sources, nothing estimated is shown
 * as a price. Spec: docs/modules/market-intelligence.md
 */
import type { MarketItemRow, MarketSnapshot } from "@/core/ipc/commands";

/**
 * Liquidity of one item: traded value (exchange categories) or listing count
 * (item categories). They are different measures and are never mixed in one ranking.
 */
export type LiquidityKind = "traded" | "listings";
export function liquidityOf(row: MarketItemRow): { kind: LiquidityKind; value: number } | null {
  if (row.volumeValue != null && row.volumeValue > 0) return { kind: "traded", value: row.volumeValue };
  if (row.listings != null && row.listings > 0) return { kind: "listings", value: row.listings };
  return null;
}

/** Median of values weighted by weights (robust against a few huge % changes). */
export function weightedMedian(values: readonly number[], weights: readonly number[]): number | null {
  const pairs = values.map((v, i) => [v, Math.max(0, weights[i] ?? 0)] as const).filter(([v, w]) => Number.isFinite(v) && w > 0);
  if (!pairs.length) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (const [v, w] of pairs) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return pairs[pairs.length - 1]![0];
}

export interface CategoryStats {
  category: string;
  label: string;
  /** Rows in the snapshot (variants included). */
  items: number;
  liquidityKind: LiquidityKind | null;
  /** Sum of traded value (base unit) or of listings, by `liquidityKind`. */
  liquidity: number | null;
  /** Liquidity-weighted median 7-day change. */
  change7d: number | null;
  risers: number;
  fallers: number;
  /** Most liquid item. */
  leader: MarketItemRow | null;
  fetchedAt: number | null;
  lastError: string | null;
}

/** A 7-day change within ±0.5 % counts as flat. */
const FLAT = 0.005;

export function categoryStats(category: string, label: string, snap: MarketSnapshot): CategoryStats {
  const rows = snap.items;
  const liq = rows.map(liquidityOf);
  const kind: LiquidityKind | null = liq.some((l) => l?.kind === "traded") ? "traded" : liq.some((l) => l?.kind === "listings") ? "listings" : null;
  const weight = (l: ReturnType<typeof liquidityOf>) => (l && l.kind === kind ? l.value : 0);
  const withChange = rows.map((r, i) => ({ r, w: weight(liq[i]!) })).filter(({ r }) => r.change7d != null && Number.isFinite(r.change7d));
  let leader: MarketItemRow | null = null;
  let best = 0;
  rows.forEach((r, i) => {
    const w = weight(liq[i]!);
    if (w > best) {
      best = w;
      leader = r;
    }
  });
  return {
    category,
    label,
    items: rows.length,
    liquidityKind: kind,
    liquidity: kind ? liq.reduce((s, l) => s + weight(l), 0) : null,
    // Items without liquidity still count, with a tiny weight, so small categories get a value.
    change7d: weightedMedian(
      withChange.map(({ r }) => r.change7d!),
      withChange.map(({ w }) => w || 1e-9),
    ),
    risers: withChange.filter(({ r }) => r.change7d! > FLAT).length,
    fallers: withChange.filter(({ r }) => r.change7d! < -FLAT).length,
    leader,
    fetchedAt: snap.fetchedAt,
    lastError: snap.lastError,
  };
}

export interface CategorizedRow {
  category: string;
  row: MarketItemRow;
}

export interface MoverFilter {
  direction: "up" | "down" | "both";
  /** Keep only the more liquid half of each category (by its own measure). */
  liquidOnly: boolean;
  /** Minimum price in the base unit. */
  minValue: number;
  limit: number;
}

/** Rows at or above their category's median liquidity. */
export function liquidHalf(rows: readonly CategorizedRow[]): Set<CategorizedRow> {
  const keep = new Set<CategorizedRow>();
  const byCat = new Map<string, CategorizedRow[]>();
  for (const r of rows) byCat.set(r.category, [...(byCat.get(r.category) ?? []), r]);
  for (const list of byCat.values()) {
    const vals = list.map((r) => liquidityOf(r.row)?.value ?? 0).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)] ?? 0;
    for (const r of list) {
      const v = liquidityOf(r.row)?.value ?? 0;
      if (v > 0 && v >= median) keep.add(r);
    }
  }
  return keep;
}

/** Biggest 7-day movers across the given rows. */
export function movers(rows: readonly CategorizedRow[], f: MoverFilter): CategorizedRow[] {
  const liquid = f.liquidOnly ? liquidHalf(rows) : null;
  const key =
    f.direction === "down"
      ? (r: CategorizedRow) => r.row.change7d!
      : f.direction === "up"
        ? (r: CategorizedRow) => -r.row.change7d!
        : (r: CategorizedRow) => -Math.abs(r.row.change7d!);
  return rows
    .filter((r) => r.row.change7d != null && Number.isFinite(r.row.change7d))
    .filter((r) => r.row.value >= f.minValue)
    .filter((r) => !liquid || liquid.has(r))
    .filter((r) => (f.direction === "up" ? r.row.change7d! > 0 : f.direction === "down" ? r.row.change7d! < 0 : true))
    .sort((a, b) => key(a) - key(b))
    .slice(0, f.limit);
}

export interface LiquidityRow extends CategorizedRow {
  kind: LiquidityKind;
  value: number;
  /** Share of the category's total of the same measure (0..1). */
  share: number;
}

/** Most liquid items of one category (its own measure), with their share of the category. */
export function liquidityRanking(category: string, snap: MarketSnapshot, limit: number): LiquidityRow[] {
  const rows = snap.items
    .map((row) => ({ row, l: liquidityOf(row) }))
    .filter(
      (
        x,
      ): x is {
        row: MarketItemRow;
        l: NonNullable<ReturnType<typeof liquidityOf>>;
      } => x.l !== null,
    );
  const kind: LiquidityKind = rows.some((x) => x.l.kind === "traded") ? "traded" : "listings";
  const same = rows.filter((x) => x.l.kind === kind);
  const total = same.reduce((s, x) => s + x.l.value, 0);
  return same
    .sort((a, b) => b.l.value - a.l.value)
    .slice(0, limit)
    .map((x) => ({
      category,
      row: x.row,
      kind,
      value: x.l.value,
      share: total > 0 ? x.l.value / total : 0,
    }));
}
