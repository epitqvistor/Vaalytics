import { useMemo } from "react";
import type { GameConfig } from "@/core/game-context/config";
import { useActiveGame } from "@/core/game-context/GameContext";
import type { SectionProps } from "@/core/game-context/sections";
import type { MarketItemRow } from "@/core/ipc/commands";
import { biggestMovers, parseFavoriteKey, trendValues } from "@/core/market/derive";
import { useFavorites, useMarketCategories, useMarketHistory, useMarketOverviews } from "@/core/market/hooks";
import { useLeague } from "@/core/market/LeagueContext";
import { Button, ChangeText, EmptyState, Kbd, PageHeader, Panel, StatTile } from "@/shared/components";
import { AreaChart } from "@/shared/charts/AreaChart";
import { Sparkline } from "@/shared/charts/Sparkline";
import { formatAmount, formatCompact } from "@/shared/utilities/format";
import { Price } from "./common";
import { FreshnessBar, ItemIcon, LeagueSelect } from "./market-ui";

export interface DashboardViewProps extends SectionProps {
  config: GameConfig;
}

const WATCH_LIMIT = 8;
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const trendOf = (c: number | null) => ((c ?? 0) > 0 ? "up" : (c ?? 0) < 0 ? "down" : "flat");
const sparkOf = (r: MarketItemRow) => r.sparkline.filter((v): v is number => v != null);

export function DashboardView({ config, onNavigate }: DashboardViewProps) {
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
  const movers = useMemo(() => biggestMovers(currency?.items ?? [], 6), [currency]);
  const watch = favorites
    .map((f) => ({ ...f, item: snaps[f.category]?.items.find((i) => i.itemId === f.itemId) }))
    .filter((w): w is typeof w & { item: MarketItemRow } => w.item != null)
    .slice(0, WATCH_LIMIT);

  // Locally recorded history once there is enough of it; otherwise poe.ninja's 7-day trend.
  const history = useMarketHistory(game, league, "currency", divine ? "divine" : null, 30);
  const chart = useMemo(() => {
    if (history.length >= 12) {
      return { values: history.map((p) => p.value), labels: history.map((p) => dateFmt.format(p.ts * 1000)), source: "Recorded by Vaalytics" };
    }
    const t = divine ? trendValues(divine) : [];
    return { values: t.map((p) => p.value), labels: t.map((p) => (p.daysAgo === 0 ? "Now" : `${p.daysAgo}d ago`)), source: "poe.ninja 7-day trend" };
  }, [history, divine]);

  const catLabel = (id: string) => catalog.find((c) => c.id === id)?.label ?? id;

  /** Large values read better in divines. */
  const display = (item: MarketItemRow) =>
    item.divineValue != null && item.divineValue >= 10 && item.itemId !== "divine"
      ? { value: formatAmount(item.divineValue), unit: config.premiumUnit.short }
      : { value: formatAmount(item.value), unit: config.baseUnit.short };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Dashboard"
        description={league ? `${league} · prices from poe.ninja` : "Loading leagues…"}
        actions={
          <>
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
        <>
          <div className="mb-4">
            <FreshnessBar snapshot={currency} />
          </div>

          <div className="grid grid-cols-4 gap-4">
            {keyItems.length > 0
              ? keyItems.map((item) => {
                  const d = display(item);
                  return <StatTile key={item.itemId} label={item.name} value={d.value} unit={d.unit} change={item.change7d ?? undefined} caption="7 days" />;
                })
              : Array.from({ length: 3 }, (_, i) => <div key={i} className="panel h-[98px] rounded-lg" aria-hidden />)}
            <StatTile label="Watchlist" value={favorites.length} unit={favorites.length === 1 ? "item" : "items"} caption="Starred in Currency Tracker" />
          </div>

          <div className="mt-5 grid grid-cols-3 gap-5">
            <Panel
              className="col-span-2"
              title={`${config.premiumUnit.name} price`}
              actions={<span className="text-xs text-fg-subtle">{chart.source} · in {config.baseUnit.name}s</span>}
            >
              {chart.values.length >= 2 ? (
                <AreaChart
                  height={258}
                  values={chart.values}
                  labels={chart.labels}
                  title={`${config.premiumUnit.name} price in ${config.baseUnit.name}s, ${chart.source}`}
                  formatValue={(v) => `${formatAmount(v)} ${config.baseUnit.short}`}
                  formatTick={(v) => `${formatCompact(v)} ${config.baseUnit.short}`}
                />
              ) : (
                <div className="flex h-[258px]">
                  <EmptyState icon="refresh" title={currency ? "No trend data yet" : "Loading from poe.ninja…"} loading={!currency} />
                </div>
              )}
            </Panel>

            <Panel title="Watchlist" flush actions={<Button size="sm" variant="ghost" onClick={() => onNavigate("currency")}>Open tracker</Button>}>
              {watch.length === 0 ? (
                <div className="flex h-[290px]">
                  <EmptyState
                    icon="star"
                    title={favorites.length ? "Loading watchlist…" : "Nothing watched yet"}
                    body={favorites.length ? undefined : "Star items in the Currency Tracker to follow them here."}
                  />
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {watch.map(({ item, category }) => (
                    <li key={`${category}:${item.itemId}`} className="flex items-center gap-3 px-4 py-2.5">
                      <ItemIcon src={item.icon} name={item.name} size={26} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-fg">{item.name}</div>
                        <Price amount={item.value} unit={config.baseUnit} className="text-xs" />
                      </div>
                      {sparkOf(item).length >= 2 && <Sparkline values={sparkOf(item)} width={56} trend={trendOf(item.change7d)} />}
                      {item.change7d != null && <ChangeText change={item.change7d} className="w-14 justify-end text-xs" />}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel
            className="mt-5"
            title={`Biggest movers · ${catLabel("currency")} · 7 days`}
            actions={<span className="text-xs text-fg-subtle">More liquid half of items by traded value</span>}
            flush
          >
            {movers.length === 0 ? (
              <EmptyState icon="info" title={currency ? "No movement data" : "Loading…"} loading={!currency} />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-fg-subtle">
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                    <th className="px-4 py-2 font-medium">Trend</th>
                    <th className="px-4 py-2 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {movers.map((m) => (
                    <tr key={m.itemId} className="transition-colors hover:bg-glass">
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2.5">
                          <ItemIcon src={m.icon} name={m.name} size={24} />
                          {m.name}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Price amount={m.value} unit={config.baseUnit} />
                      </td>
                      <td className="px-4 py-2">
                        <Sparkline values={sparkOf(m)} trend={trendOf(m.change7d)} />
                      </td>
                      <td className="px-4 py-2 text-right">{m.change7d != null && <ChangeText change={m.change7d} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
