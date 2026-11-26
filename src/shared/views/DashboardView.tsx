import { useMemo } from "react";
import type { GameConfig } from "@/core/game-context/config";
import { useActiveGame } from "@/core/game-context/GameContext";
import type { SectionProps } from "@/core/game-context/sections";
import type { MarketItemRow } from "@/core/ipc/commands";
import { biggestMovers, parseFavoriteKey, trendValues } from "@/core/market/derive";
import { useFavorites, useMarketCategories, useMarketHistory, useMarketOverviews } from "@/core/market/hooks";
import { useDisplayCurrency } from "@/core/market/DisplayCurrency";
import { useLeague } from "@/core/market/LeagueContext";
import { Button, ChangeText, EmptyState, ItemCell, Kbd, PageHeader, Panel, Skeleton, Stat, Table, Td, Th, Tr } from "@/shared/components";
import { AreaChart } from "@/shared/charts/AreaChart";
import { Sparkline } from "@/shared/charts/Sparkline";
import { formatAmount, formatCompact } from "@/shared/utilities/format";
import { Price } from "./common";
import { DisplayCurrencySelect, FreshnessBar, ItemIcon, LeagueSelect } from "./market-ui";

export interface DashboardViewProps extends SectionProps {
  config: GameConfig;
}

const WATCH_LIMIT = 8;
/** Rows per side in Gainers / Decliners. */
const MOVERS_PER_SIDE = 5;
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const trendOf = (c: number | null) => ((c ?? 0) > 0 ? "up" : (c ?? 0) < 0 ? "down" : "flat");
const sparkOf = (r: MarketItemRow) => r.sparkline.filter((v): v is number => v != null);

/**
 * Dashboard: the reference screen of the design system. Reading order —
 * key prices (one strip) → premium-currency trend next to the watchlist →
 * the market's biggest movers split into gainers and decliners.
 */
export function DashboardView({ config, onNavigate }: DashboardViewProps) {
  const dc = useDisplayCurrency();
  const game = useActiveGame();
  const { league, error: leagueError } = useLeague();
  const { list: favoriteKeys } = useFavorites(game);
  const catalog = useMarketCategories(game);

  const favorites = useMemo(() => favoriteKeys.map(parseFavoriteKey).filter((f) => f != null), [favoriteKeys]);
  const categories = useMemo(() => [...new Set(["currency", ...favorites.map((f) => f.category)])], [favorites]);
  const snaps = useMarketOverviews(game, league, categories);
  const currency = snaps.currency ?? null;
  const byId = useMemo(() => new Map((currency?.items ?? []).map((i) => [i.itemId, i])), [currency]);

  const divine = byId.get("divine");
  const keyItems = config.keyCurrencies.map((id) => byId.get(id)).filter((i) => i != null);
  // Most-moved items among the more liquid half; split by direction.
  const movers = useMemo(() => {
    const all = biggestMovers(currency?.items ?? [], 40);
    return {
      up: all.filter((m) => (m.change7d ?? 0) > 0).slice(0, MOVERS_PER_SIDE),
      down: all.filter((m) => (m.change7d ?? 0) < 0).slice(0, MOVERS_PER_SIDE),
    };
  }, [currency]);
  const watch = favorites
    .map((f) => ({ ...f, item: snaps[f.category]?.items.find((i) => i.itemId === f.itemId) }))
    .filter((w): w is typeof w & { item: MarketItemRow } => w.item != null)
    .slice(0, WATCH_LIMIT);

  // Locally recorded history once there is enough of it; otherwise poe.ninja's 7-day trend.
  const history = useMarketHistory(game, league, "currency", divine ? "divine" : null, 30);
  const chart = useMemo(() => {
    if (history.length >= 12) {
      return {
        values: history.map((p) => p.value),
        labels: history.map((p) => dateFmt.format(p.ts * 1000)),
        source: "Recorded by Vaalytics",
        period: `since ${dateFmt.format(history[0]!.ts * 1000)}`,
      };
    }
    const t = divine ? trendValues(divine) : [];
    return {
      values: t.map((p) => p.value),
      labels: t.map((p) => (p.daysAgo === 0 ? "Now" : `${p.daysAgo}d ago`)),
      source: "poe.ninja 7-day trend",
      period: "over 7 days",
    };
  }, [history, divine]);
  const range = useMemo(() => {
    const v = chart.values;
    if (v.length < 2) return null;
    const first = v[0]!;
    const last = v[v.length - 1]!;
    return { low: Math.min(...v), high: Math.max(...v), change: first > 0 ? (last - first) / first : null };
  }, [chart.values]);

  const catLabel = (id: string) => catalog.find((c) => c.id === id)?.label ?? id;
  const base = config.baseUnit.short;

  /** In the chosen display currency; in base mode large values read better in the premium unit. */
  const display = (item: MarketItemRow) => {
    const fixed = config.keyCurrencyUnits?.[item.itemId];
    if (fixed === "base") return { value: formatAmount(item.value), unit: config.baseUnit.short };
    if (fixed === "premium") {
      const p = dc?.toCurrency(item.value, config.premiumUnit.id) ?? item.divineValue;
      if (p != null) return { value: formatAmount(p), unit: config.premiumUnit.short };
    }
    if (dc?.converting) return { value: formatAmount(dc.toUnit(item.value)), unit: dc.unit.short };
    return item.divineValue != null && item.divineValue >= 10 && item.itemId !== config.premiumUnit.id
      ? { value: formatAmount(item.divineValue), unit: config.premiumUnit.short }
      : { value: formatAmount(item.value), unit: config.baseUnit.short };
  };

  return (
    <div className="mx-auto max-w-page">
      <PageHeader
        title="Dashboard"
        description={league ? `${league} · prices from poe.ninja` : "Loading leagues…"}
        actions={
          <>
            <DisplayCurrencySelect />
            <LeagueSelect />
            <Button variant="primary" icon="priceCheck" onClick={() => onNavigate("price-checker")}>
              Price check <Kbd>Ctrl D</Kbd>
            </Button>
          </>
        }
      />

      {leagueError ? (
        <Panel>
          <EmptyState icon="error" title="Market data unavailable" body={leagueError} />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          <FreshnessBar snapshot={currency} />

          {/* Key prices: one strip of related figures, not a row of separate cards. */}
          <section aria-label="Key prices" className="panel-raised led-edge grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] divide-x divide-line overflow-hidden rounded-lg">
            {keyItems.length > 0
              ? keyItems.map((item) => {
                  const d = display(item);
                  return (
                    <Stat
                      key={item.itemId}
                      icon={<ItemIcon src={item.icon} name={item.name} size={18} />}
                      label={item.name}
                      value={d.value}
                      unit={d.unit}
                      change={item.change7d ?? undefined}
                      caption="7 days"
                    />
                  );
                })
              : config.keyCurrencies.map((id) => (
                  <div key={id} className="px-4 py-3">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="mt-2.5 h-7 w-20" />
                    <Skeleton className="mt-2 h-3 w-16" />
                  </div>
                ))}
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Panel className="xl:col-span-8" title={`${config.premiumUnit.name} price`} meta={`${chart.source} · in ${config.baseUnit.name}s`}>
              {chart.values.length >= 2 ? (
                <>
                  {range && (
                    <dl className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs">
                      <div className="flex items-baseline gap-1.5">
                        <dt className="text-fg-subtle">Change {chart.period}</dt>
                        <dd>{range.change != null ? <ChangeText change={range.change} /> : "—"}</dd>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <dt className="text-fg-subtle">Low</dt>
                        <dd className="tabular text-fg">
                          {formatAmount(range.low)} <span className="text-fg-muted">{base}</span>
                        </dd>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <dt className="text-fg-subtle">High</dt>
                        <dd className="tabular text-fg">
                          {formatAmount(range.high)} <span className="text-fg-muted">{base}</span>
                        </dd>
                      </div>
                    </dl>
                  )}
                  <AreaChart
                    height={248}
                    values={chart.values}
                    labels={chart.labels}
                    title={`${config.premiumUnit.name} price in ${config.baseUnit.name}s, ${chart.source}`}
                    formatValue={(v) => `${formatAmount(v)} ${base}`}
                    formatTick={(v) => `${formatCompact(v)} ${base}`}
                  />
                </>
              ) : (
                <div className="flex h-[278px]">
                  <EmptyState icon="refresh" title={currency ? "No trend data yet" : "Loading from poe.ninja…"} loading={!currency} />
                </div>
              )}
            </Panel>

            <Panel
              className="flex flex-col xl:col-span-4"
              title="Watchlist"
              meta={favorites.length > 0 ? `${favorites.length} ${favorites.length === 1 ? "item" : "items"}` : undefined}
              flush
              actions={
                <Button size="sm" variant="ghost" iconRight="chevronRight" onClick={() => onNavigate("currency")}>
                  Currency Tracker
                </Button>
              }
            >
              {watch.length === 0 ? (
                <div className="flex h-[278px]">
                  <EmptyState
                    icon="star"
                    title={favorites.length ? "Loading watchlist…" : "Nothing watched yet"}
                    body={favorites.length ? undefined : "Star items in the Currency Tracker to follow them here."}
                    loading={favorites.length > 0}
                  />
                </div>
              ) : (
                <Table>
                  <tbody>
                    {watch.map(({ item, category }) => (
                      <Tr key={`${category}:${item.itemId}`}>
                        <Td className="w-full max-w-0" title={item.name}>
                          <ItemCell icon={<ItemIcon src={item.icon} name={item.name} size={22} />} sub={catLabel(category)}>
                            {item.name}
                          </ItemCell>
                        </Td>
                        <Td numeric>
                          <Price amount={item.value} unit={config.baseUnit} />
                        </Td>
                        <Td numeric className="w-16">
                          {item.change7d != null ? <ChangeText change={item.change7d} className="text-xs" /> : <span className="text-fg-subtle">—</span>}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <MoversTable title="Gainers" rows={movers.up} loading={!currency} baseUnit={config.baseUnit} />
            <MoversTable title="Decliners" rows={movers.down} loading={!currency} baseUnit={config.baseUnit} />
          </div>
          <p className="-mt-2 text-xs text-fg-subtle">
            {catLabel("currency")} · 7-day change · the more liquid half of items by traded value.
          </p>
        </div>
      )}
    </div>
  );
}

function MoversTable({ title, rows, loading, baseUnit }: { title: string; rows: MarketItemRow[]; loading: boolean; baseUnit: GameConfig["baseUnit"] }) {
  return (
    <Panel title={title} meta="7 days" flush>
      {rows.length === 0 ? (
        <EmptyState icon="info" title={loading ? "Loading…" : "No movement in this direction"} loading={loading} className="py-10" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th numeric>Value</Th>
              <Th className="w-24">Trend</Th>
              <Th numeric className="w-20">Change</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <Tr key={m.itemId}>
                <Td className="w-full max-w-0" title={m.name}>
                  <ItemCell icon={<ItemIcon src={m.icon} name={m.name} size={20} />}>{m.name}</ItemCell>
                </Td>
                <Td numeric>
                  <Price amount={m.value} unit={baseUnit} />
                </Td>
                <Td>
                  <Sparkline values={sparkOf(m)} width={72} height={20} trend={trendOf(m.change7d)} />
                </Td>
                <Td numeric>{m.change7d != null && <ChangeText change={m.change7d} />}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
