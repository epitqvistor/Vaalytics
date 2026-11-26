import { AnimatePresence, motion } from "motion/react";
import { useDeferredValue, useMemo, useState } from "react";
import type { GameConfig } from "@/core/game-context/config";
import { useActiveGame } from "@/core/game-context/GameContext";
import type { SectionProps } from "@/core/game-context/sections";
import type { MarketItemRow } from "@/core/ipc/commands";
import { favoriteKey, trendValues } from "@/core/market/derive";
import { useFavorites, useMarketCategories, useMarketHistory, useMarketOverview } from "@/core/market/hooks";
import { useDisplayCurrency, useMoney } from "@/core/market/DisplayCurrency";
import { useLeague } from "@/core/market/LeagueContext";
import { Checkbox, ChangeText, EmptyState, IconButton, Input, PageHeader, Panel, SegmentedControl, Select } from "@/shared/components";
import { AreaChart } from "@/shared/charts/AreaChart";
import { Sparkline } from "@/shared/charts/Sparkline";
import { variants } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { formatAmount, formatCompact } from "@/shared/utilities/format";
import { AltPrice, Price } from "./common";
import { DisplayCurrencySelect, FreshnessBar, ItemIcon, LeagueSelect, VirtualRows } from "./market-ui";

export interface CurrencyViewProps extends SectionProps {
  config: GameConfig;
}

type SortKey = "name" | "value" | "change" | "volume";
const ROW_H = 44;
const GRID = "grid grid-cols-[40px_minmax(0,1fr)_118px_84px_84px_76px] items-center";
/** poe.ninja-style threshold: prices backed by fewer listings are unreliable. */
const MIN_LISTINGS = 5;

const sparkValues = (r: MarketItemRow) => r.sparkline.filter((v): v is number => v != null);
const volumeOf = (r: MarketItemRow) => r.volumeValue ?? r.listings ?? 0;
const isLowConfidence = (r: MarketItemRow) => r.listings != null && r.listings < MIN_LISTINGS;

export function CurrencyView({ config }: CurrencyViewProps) {
  const display = useDisplayCurrency();
  const game = useActiveGame();
  const { league, error: leagueError } = useLeague();
  const categories = useMarketCategories(game);
  const [category, setCategory] = useState("currency");
  const { snapshot, error, refresh } = useMarketOverview(game, league, category);
  const { favorites, toggle } = useFavorites(game);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "value", desc: true });
  const [favOnly, setFavOnly] = useState<"all" | "fav">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showLowConfidence, setShowLowConfidence] = useState(false);

  const rows = useMemo(() => {
    const items = snapshot?.items ?? [];
    const q = deferredQuery.trim().toLowerCase();
    const out = items.filter(
      (i) =>
        (showLowConfidence || !isLowConfidence(i)) &&
        (favOnly === "all" || favorites.has(favoriteKey(category, i.itemId))) &&
        (!q || i.name.toLowerCase().includes(q)),
    );
    const dir = sort.desc ? -1 : 1;
    const key = (r: MarketItemRow): number =>
      sort.key === "value" ? r.value : sort.key === "change" ? (r.change7d ?? -Infinity) : volumeOf(r);
    out.sort((a, b) => (sort.key === "name" ? a.name.localeCompare(b.name) : key(a) - key(b)) * dir);
    return out;
  }, [snapshot, deferredQuery, favOnly, favorites, category, sort, showLowConfidence]);
  const hiddenLowConfidence = showLowConfidence ? 0 : (snapshot?.items.filter(isLowConfidence).length ?? 0);

  const selected = selectedId ? snapshot?.items.find((i) => i.itemId === selectedId) : undefined;
  const isItemCategory = categories.find((c) => c.id === category)?.endpoint === "item";

  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  return (
    <div className="mx-auto flex h-[calc(100vh-var(--spacing-titlebar)-56px)] max-w-page flex-col">
      <PageHeader
        title="Currency Tracker"
        description={`Prices in ${display?.converting ? display.unit.name : config.baseUnit.name}s from poe.ninja`}
        actions={
          <>
            <DisplayCurrencySelect />
            <LeagueSelect />
          </>
        }
      />

      <div className="mb-3 flex items-center gap-3">
        <Select
          label="Category"
          hideLabel
          value={category}
          onChange={(c) => {
            setCategory(c);
            setSelectedId(null);
          }}
          options={categories.map((c) => ({ value: c.id, label: c.label }))}
          className="w-52"
        />
        <Input icon="search" placeholder="Search items" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search items" containerClassName="w-64" />
        <div className="flex-1" />
        <SegmentedControl
          size="sm"
          label="Favourites filter"
          value={favOnly}
          onChange={setFavOnly}
          segments={[
            { value: "all", label: "All items" },
            { value: "fav", label: "Favourites" },
          ]}
        />
      </div>

      <div className="mb-3">
        <FreshnessBar
          snapshot={snapshot}
          onRefresh={refresh}
          extra={
            snapshot && (
              <span className="flex items-center gap-3 text-fg-subtle">
                · {snapshot.items.length} items
                {(hiddenLowConfidence > 0 || showLowConfidence) && (
                  <Checkbox
                    checked={showLowConfidence}
                    onChange={setShowLowConfidence}
                    label={<span className="text-xs text-fg-muted">Show {hiddenLowConfidence || ""} low-confidence (&lt; {MIN_LISTINGS} listings)</span>}
                  />
                )}
              </span>
            )
          }
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-5">
        <Panel flush className="flex min-w-0 flex-1 flex-col [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col">
          {leagueError || error ? (
            <EmptyState icon="error" title="Market data unavailable" body={leagueError ?? error ?? ""} />
          ) : !snapshot || (snapshot.items.length === 0 && snapshot.refreshing) ? (
            <EmptyState icon="refresh" title="Loading from poe.ninja…" loading />
          ) : snapshot.items.length === 0 ? (
            <EmptyState
              icon={snapshot.lastError ? "warning" : "info"}
              title={snapshot.lastError ? "No data available yet" : "No items in this category"}
              body={snapshot.lastError ?? "poe.ninja has no listings for this category in the selected league."}
            />
          ) : rows.length === 0 ? (
            <EmptyState icon="search" title="No matches" body="No items match your search or favourites filter." />
          ) : (
            <VirtualRows
              className="flex-1"
              rows={rows}
              rowHeight={ROW_H}
              getKey={(r) => r.itemId}
              header={
                <div role="row" className={cn(GRID, "h-9 border-b border-line bg-bg-2/95 text-xs text-fg-subtle")}>
                  <span />
                  <SortHeader label="Item" k="name" sort={sort} onSort={onSort} />
                  <SortHeader label="Value" k="value" sort={sort} onSort={onSort} align="right" />
                  <span className="px-3">7 days</span>
                  <SortHeader label="Change" k="change" sort={sort} onSort={onSort} align="right" />
                  <SortHeader label={isItemCategory ? "Listings" : "Volume"} k="volume" sort={sort} onSort={onSort} align="right" />
                </div>
              }
              renderRow={(r) => (
                <Row
                  row={r}
                  config={config}
                  selected={r.itemId === selectedId}
                  favorite={favorites.has(favoriteKey(category, r.itemId))}
                  onSelect={() => setSelectedId(r.itemId === selectedId ? null : r.itemId)}
                  onToggleFavorite={() => toggle(favoriteKey(category, r.itemId))}
                />
              )}
            />
          )}
        </Panel>

        <AnimatePresence initial={false}>
          {selected && league && (
            <motion.div key="detail" variants={variants.rise} initial="hidden" animate="visible" exit="exit" className="w-80 shrink-0 overflow-y-auto">
              <ItemDetail item={selected} category={category} league={league} config={config} onClose={() => setSelectedId(null)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Row({
  row: r,
  config,
  selected,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  row: MarketItemRow;
  config: GameConfig;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  const spark = sparkValues(r);
  const trend = r.change7d == null ? "flat" : r.change7d > 0 ? "up" : r.change7d < 0 ? "down" : "flat";
  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(GRID, "h-full border-b border-line text-sm transition-colors", selected ? "bg-accent-soft shadow-[inset_2px_0_0_var(--color-accent)]" : "hover:bg-white/[0.025]")}
    >
      <span className="pl-2" onClick={(e) => e.stopPropagation()}>
        <IconButton
          icon="star"
          size="sm"
          label={favorite ? `Remove ${r.name} from favourites` : `Add ${r.name} to favourites`}
          onClick={onToggleFavorite}
          className={favorite ? "text-accent-2! hover:text-accent! [&_svg]:fill-current" : "text-fg-subtle!"}
        />
      </span>
      <span className="flex min-w-0 items-center gap-2.5 px-3">
        <ItemIcon src={r.icon} name={r.name} size={26} />
        <span className="min-w-0">
          <span className="block truncate text-fg">{r.name}</span>
          {r.variant && <span className="block truncate text-2xs text-fg-subtle">{r.variant}</span>}
        </span>
      </span>
      <span className="px-3 text-right leading-tight">
        <span className="inline-flex items-center gap-1">
          {isLowConfidence(r) && <Icon name="warning" size={12} className="text-warning" label={`Only ${r.listings} listing${r.listings === 1 ? "" : "s"} — low confidence`} />}
          <Price amount={r.value} unit={config.baseUnit} className={isLowConfidence(r) ? "opacity-70" : undefined} />
        </span>
        <AltPrice amount={r.value} unit={config.baseUnit} premium={config.premiumUnit} itemId={r.itemId} />
      </span>
      <span className="px-3">{spark.length >= 2 ? <Sparkline values={spark} trend={trend} /> : <span className="text-xs text-fg-subtle">—</span>}</span>
      <span className="px-3 text-right">{r.change7d != null ? <ChangeText change={r.change7d} /> : <span className="text-fg-subtle">—</span>}</span>
      <span className="tabular px-3 pr-4 text-right text-fg-muted">
        {r.listings != null ? formatCompact(r.listings) : r.volumeValue != null ? formatCompact(r.volumeValue) : "—"}
      </span>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (k: SortKey) => void;
  align?: "right";
}) {
  const active = sort.key === k;
  return (
    <span role="columnheader" aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"} className={cn("px-3", align === "right" && "text-right")}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 font-medium hover:text-fg", active && "text-fg-muted")}>
        {label}
        {active && <Icon name={sort.desc ? "chevronDown" : "chevronUp"} size={12} />}
      </button>
    </span>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function ItemDetail({
  item,
  category,
  league,
  config,
  onClose,
}: {
  item: MarketItemRow;
  category: string;
  league: string;
  config: GameConfig;
  onClose: () => void;
}) {
  const money = useMoney();
  const game = useActiveGame();
  const history = useMarketHistory(game, league, category, item.itemId, 30);
  const [range, setRange] = useState<"source" | "local">("source");
  const trend = useMemo(() => trendValues(item), [item]);
  const useLocal = range === "local" && history.length >= 2;

  const chart = useLocal
    ? { values: history.map((p) => p.value), labels: history.map((p) => dateFmt.format(p.ts * 1000)) }
    : { values: trend.map((p) => p.value), labels: trend.map((p) => (p.daysAgo === 0 ? "Now" : `${p.daysAgo}d ago`)) };

  return (
    <Panel
      title={
        <span className="flex min-w-0 items-center gap-2">
          <ItemIcon src={item.icon} name={item.name} size={22} />
          <span className="truncate">{item.name}</span>
        </span>
      }
      actions={<IconButton icon="close" label="Close details" size="sm" onClick={onClose} />}
    >
      <div className="flex items-baseline justify-between">
        <Price amount={item.value} unit={config.baseUnit} strong className="text-xl" />
        {item.change7d != null && <ChangeText change={item.change7d} />}
      </div>
      <AltPrice amount={item.value} unit={config.baseUnit} premium={config.premiumUnit} itemId={item.itemId} className="mt-0.5 text-xs!" />

      <div className="mt-4">
        <SegmentedControl
          size="sm"
          label="Chart source"
          value={range}
          onChange={setRange}
          segments={[
            { value: "source", label: "7 days" },
            { value: "local", label: "Recorded" },
          ]}
        />
      </div>
      <div className="mt-2 -mx-1">
        {chart.values.length >= 2 ? (
          <AreaChart
            values={chart.values}
            labels={chart.labels}
            height={170}
            title={`${item.name} price, ${useLocal ? "recorded by Vaalytics" : "last 7 days from poe.ninja"}`}
            formatValue={(v) => `${formatAmount(v)} ${config.baseUnit.short}`}
            formatTick={(v) => `${formatCompact(v)} ${config.baseUnit.short}`}
          />
        ) : (
          <p className="flex h-[170px] items-center justify-center px-4 text-center text-xs text-fg-muted">
            {range === "local"
              ? `Vaalytics records at most one price point per hour while this category is being viewed. ${history.length} recorded so far.`
              : "poe.ninja has no 7-day trend for this item yet."}
          </p>
        )}
      </div>
      <p className="mt-1 text-2xs text-fg-subtle">
        {useLocal ? `${history.length} points recorded locally` : "Daily values derived from poe.ninja's 7-day change data"}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-xs">
        {item.volumeValue != null && (
          <>
            <dt className="text-fg-muted">Traded value</dt>
            <dd className="tabular text-right text-fg">
              {money(item.volumeValue, { compact: true, unit: config.baseUnit })}
            </dd>
          </>
        )}
        {item.listings != null && (
          <>
            <dt className="text-fg-muted">Listings</dt>
            <dd className="tabular text-right text-fg">{item.listings.toLocaleString("en-US")}</dd>
          </>
        )}
        <dt className="text-fg-muted">League</dt>
        <dd className="truncate text-right text-fg">{league}</dd>
      </dl>
    </Panel>
  );
}
