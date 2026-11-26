/**
 * Market Intelligence: category-wide trends, biggest movers, liquidity and
 * price alerts — all from poe.ninja data the Market engine already caches.
 * Spec: docs/modules/market-intelligence.md
 */
import { useMemo, useState } from "react";
import type { GameConfig } from "@/core/game-context/config";
import { useActiveGame } from "@/core/game-context/GameContext";
import type { SectionProps } from "@/core/game-context/sections";
import type { MarketCategory, MarketItemRow, MarketSnapshot } from "@/core/ipc/commands";
import { useDisplayCurrency, useMoney } from "@/core/market/DisplayCurrency";
import { useFavorites, useMarketCategories, useMarketOverviews, useNow } from "@/core/market/hooks";
import { useLeague } from "@/core/market/LeagueContext";
import { favoriteKey } from "@/core/market/derive";
import { useGameSetting } from "@/core/settings/useGameSetting";
import {
  Badge,
  Button,
  ChangeText,
  Checkbox,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Panel,
  ProvenanceTag,
  SegmentedControl,
  Select,
  Skeleton,
} from "@/shared/components";
import { Sparkline } from "@/shared/charts/Sparkline";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { formatAmount, formatCompact, formatRelative } from "@/shared/utilities/format";
import { Price } from "@/shared/views/common";
import { DisplayCurrencySelect, ItemIcon, LeagueSelect } from "@/shared/views/market-ui";
import { addAlert, evaluateAlert, isAlertList, type AlertRule, type AlertState } from "./alerts";
import { categoryStats, liquidityRanking, movers, type CategorizedRow, type CategoryStats, type LiquidityKind } from "./analytics";

type Tab = "overview" | "movers" | "liquidity" | "alerts";
const NO_ALERTS: AlertRule[] = [];
const hasData = (s: MarketSnapshot | undefined): s is MarketSnapshot => !!s && s.fetchedAt !== null;
const spark = (r: MarketItemRow) => r.sparkline.filter((v): v is number => v != null);

export function MarketIntelligenceView({ config }: SectionProps & { config: GameConfig }) {
  const game = useActiveGame();
  const { league, error: leagueError } = useLeague();
  const categories = useMarketCategories(game);
  const ids = useMemo(() => categories.map((c) => c.id), [categories]);
  const snaps = useMarketOverviews(game, league, ids);
  const [tab, setTab] = useState<Tab>("overview");
  const [focus, setFocus] = useState<string>("all");
  const [alerts, setAlerts] = useGameSetting<AlertRule[]>(game, "market.alerts", NO_ALERTS, isAlertList);
  const [alertFor, setAlertFor] = useState<CategorizedRow | null>(null);
  const dc = useDisplayCurrency();
  const toUnit = (base: number, unit: string) => (unit === config.baseUnit.id ? base : (dc?.toCurrency(base, unit) ?? null));

  // A snapshot without a fetch time is an empty placeholder while the engine fetches it.
  const loaded = categories.filter((c) => hasData(snaps[c.id]));
  const failed = categories.filter((c) => !hasData(snaps[c.id]) && snaps[c.id]?.lastError);
  const rows: CategorizedRow[] = useMemo(() => loaded.flatMap((c) => snaps[c.id]!.items.map((row) => ({ category: c.id, row }))), [loaded, snaps]);
  const find = (cat: string, itemId: string) => snaps[cat]?.items.find((r) => r.itemId === itemId);
  const states = alerts.map((a) => ({
    rule: a,
    state: evaluateAlert(a, find(a.category, a.itemId), toUnit),
  }));
  const triggered = states.filter((s) => s.state.status === "triggered").length;

  const oldest = loaded.reduce<number | null>((m, c) => {
    const t = snaps[c.id]!.fetchedAt;
    return t === null ? m : m === null ? t : Math.min(m, t);
  }, null);
  const labelOf = (id: string) => categories.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="mx-auto max-w-page">
      <PageHeader
        title="Market Intelligence"
        description="Trends, movers and liquidity across every market category — from data Vaalytics already caches."
        actions={
          <>
            <DisplayCurrencySelect />
            <LeagueSelect />
          </>
        }
      />

      {leagueError ? (
        <Panel>
          <EmptyState icon="error" title="Market data unavailable" body={leagueError} />
        </Panel>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="View"
              value={tab}
              onChange={setTab}
              segments={[
                { value: "overview", label: "Overview" },
                { value: "movers", label: "Movers" },
                { value: "liquidity", label: "Liquidity" },
                {
                  value: "alerts",
                  label: triggered ? `Alerts · ${triggered}` : `Alerts${alerts.length ? ` · ${alerts.length}` : ""}`,
                },
              ]}
            />
            <div className="flex items-center gap-3 text-xs text-fg-muted">
              <ProvenanceTag
                provenance={{
                  kind: "market",
                  source: "poe.ninja",
                  at: oldest ? oldest * 1000 : null,
                  league: league ?? undefined,
                }}
              />
              <span>
                {loaded.length} of {categories.length || "…"} categories loaded
                {failed.length > 0 && <span className="text-warning"> · {failed.length} failed</span>}
                {oldest && <span className="text-fg-subtle"> · oldest update {formatRelative(oldest * 1000)}</span>}
              </span>
            </div>
          </div>

          {tab === "overview" && (
            <OverviewTab
              categories={categories}
              snaps={snaps}
              onOpen={(id) => {
                setFocus(id);
                setTab("movers");
              }}
            />
          )}
          {tab === "movers" && (
            <MoversTab
              rows={rows}
              categories={loaded}
              focus={focus}
              setFocus={setFocus}
              config={config}
              labelOf={labelOf}
              onAlert={setAlertFor}
              loading={loaded.length < categories.length}
            />
          )}
          {tab === "liquidity" && (
            <LiquidityTab categories={loaded} snaps={snaps} focus={focus} setFocus={setFocus} config={config} onAlert={setAlertFor} />
          )}
          {tab === "alerts" && (
            <AlertsTab
              states={states}
              labelOf={labelOf}
              config={config}
              onRemove={(id) => setAlerts(alerts.filter((a) => a.id !== id))}
              onAdd={() => setTab("movers")}
            />
          )}
        </>
      )}

      <AlertModal
        target={alertFor}
        config={config}
        onClose={() => setAlertFor(null)}
        onSave={(rule) => {
          setAlerts(addAlert(alerts, rule));
          setAlertFor(null);
        }}
      />
    </div>
  );
}

// ---------- overview ----------

function OverviewTab({
  categories,
  snaps,
  onOpen,
}: {
  categories: MarketCategory[];
  snaps: Record<string, MarketSnapshot>;
  onOpen: (id: string) => void;
}) {
  const stats = useMemo(() => categories.map((c) => (hasData(snaps[c.id]) ? categoryStats(c.id, c.label, snaps[c.id]!) : null)), [categories, snaps]);
  const now = useNow();
  if (!categories.length) return <Skeleton className="h-64 rounded-lg" />;
  return (
    <Panel flush title="Categories" actions={<span>Click a category for its movers</span>}>
      <div role="table" aria-label="Market categories" className="text-sm">
        <div role="row" className={cn(OV_GRID, "h-9 border-b border-line bg-bg-2/95 text-xs text-fg-subtle")}>
          <span className="pl-4">Category</span>
          <span className="text-right">Items</span>
          <span className="text-right" title="Sum of poe.ninja traded value (exchange categories) or listings (item categories)">
            Liquidity
          </span>
          <span className="text-right" title="Liquidity-weighted median 7-day change">
            Median 7d
          </span>
          <span className="pl-3">Risers / fallers</span>
          <span>Most liquid</span>
          <span className="pr-4 text-right">Updated</span>
        </div>
        {categories.map((c, i) => {
          const s = stats[i];
          return (
            <button
              key={c.id}
              type="button"
              role="row"
              onClick={() => onOpen(c.id)}
              className={cn(OV_GRID, "h-10 w-full border-b border-line text-left transition-colors last:border-b-0 hover:bg-glass")}
            >
              <span className="truncate pl-4 text-fg">{c.label}</span>
              {s ? (
                <OverviewCells s={s} now={now} />
              ) : snaps[c.id]?.lastError ? (
                <span className="col-span-6 pr-4 text-right text-xs text-warning" title={snaps[c.id]!.lastError!}>
                  Couldn't load from poe.ninja
                </span>
              ) : (
                <LoadingCells />
              )}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

const OV_GRID = "grid grid-cols-[minmax(150px,1.2fr)_70px_110px_90px_minmax(140px,1fr)_minmax(160px,1.3fr)_100px] items-center gap-3";

function OverviewCells({ s, now }: { s: CategoryStats; now: number }) {
  const money = useMoney();
  const total = s.risers + s.fallers || 1;
  return (
    <>
      <span className="tabular text-right text-fg-muted">{s.items.toLocaleString("en-US")}</span>
      <span className="tabular text-right text-fg">
        {s.liquidity === null ? "—" : s.liquidityKind === "traded" ? money(s.liquidity, { compact: true }) : `${formatCompact(s.liquidity)} listed`}
      </span>
      <span className="text-right">{s.change7d === null ? <span className="text-fg-subtle">—</span> : <ChangeText change={s.change7d} />}</span>
      <span className="flex items-center gap-2 pl-3" title={`${s.risers} up · ${s.fallers} down (±0.5 % counts as flat)`}>
        <span className="flex h-1.5 w-20 overflow-hidden rounded-xs bg-glass-strong">
          <span className="bg-success/80" style={{ width: `${(s.risers / total) * 100}%` }} />
          <span className="bg-danger/80" style={{ width: `${(s.fallers / total) * 100}%` }} />
        </span>
        <span className="tabular text-xs text-fg-subtle">
          {s.risers}/{s.fallers}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {s.leader && (
          <>
            <ItemIcon src={s.leader.icon} name={s.leader.name} size={20} />
            <span className="truncate text-fg-muted">{s.leader.name}</span>
          </>
        )}
      </span>
      <span className={cn("pr-4 text-right text-xs", s.lastError ? "text-warning" : "text-fg-subtle")} title={s.lastError ?? undefined}>
        {s.lastError ? "stale" : s.fetchedAt ? formatRelative(s.fetchedAt * 1000, now) : "—"}
      </span>
    </>
  );
}

function LoadingCells() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i === 5 ? "pr-4" : undefined}>
          <Skeleton className="ml-auto h-3 w-12 rounded" />
        </span>
      ))}
    </>
  );
}

// ---------- movers ----------

function MoversTab({
  rows,
  categories,
  focus,
  setFocus,
  config,
  labelOf,
  onAlert,
  loading,
}: {
  rows: CategorizedRow[];
  categories: MarketCategory[];
  focus: string;
  setFocus: (id: string) => void;
  config: GameConfig;
  labelOf: (id: string) => string;
  onAlert: (r: CategorizedRow) => void;
  loading: boolean;
}) {
  const [direction, setDirection] = useState<"both" | "up" | "down">("both");
  const [liquidOnly, setLiquidOnly] = useState(true);
  const [minValue, setMinValue] = useState(1);
  const scoped = focus === "all" ? rows : rows.filter((r) => r.category === focus);
  const list = useMemo(() => movers(scoped, { direction, liquidOnly, minValue, limit: 60 }), [scoped, direction, liquidOnly, minValue]);
  return (
    <Panel flush>
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <CategoryPicker categories={categories} value={focus} onChange={setFocus} />
        <SegmentedControl
          label="Direction"
          size="sm"
          value={direction}
          onChange={setDirection}
          segments={[
            { value: "both", label: "Largest" },
            { value: "up", label: "Risers" },
            { value: "down", label: "Fallers" },
          ]}
        />
        <Input
          size="sm"
          type="number"
          min={0}
          label={`Min value (${config.baseUnit.short})`}
          value={minValue}
          onChange={(e) => setMinValue(Math.max(0, Number(e.target.value) || 0))}
          containerClassName="w-32"
        />
        <Checkbox
          checked={liquidOnly}
          onChange={setLiquidOnly}
          label={<span className="text-xs text-fg-muted">More liquid half of each category only</span>}
          className="mb-1.5"
        />
        <span className="mb-1.5 ml-auto text-2xs text-fg-subtle">
          7-day change from poe.ninja
          {loading ? " · still loading categories" : ""}
        </span>
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon={loading ? "refresh" : "search"}
          loading={loading}
          title={loading ? "Loading categories…" : "No movers match these filters"}
        />
      ) : (
        <ItemTable rows={list} config={config} labelOf={labelOf} onAlert={onAlert} showCategory={focus === "all"} />
      )}
    </Panel>
  );
}

function CategoryPicker({ categories, value, onChange }: { categories: MarketCategory[]; value: string; onChange: (id: string) => void }) {
  return (
    <Select
      label="Category"
      size="sm"
      value={value}
      onChange={onChange}
      options={[{ value: "all", label: "All loaded categories" }, ...categories.map((c) => ({ value: c.id, label: c.label }))]}
      className="w-52"
    />
  );
}

function ItemTable({
  rows,
  config,
  labelOf,
  onAlert,
  showCategory,
  extra,
}: {
  rows: CategorizedRow[];
  config: GameConfig;
  labelOf: (id: string) => string;
  onAlert: (r: CategorizedRow) => void;
  showCategory: boolean;
  extra?: (r: CategorizedRow) => React.ReactNode;
}) {
  const game = useActiveGame();
  const { favorites, toggle } = useFavorites(game);
  const money = useMoney();
  return (
    <div role="table" className="text-sm">
      <div role="row" className={cn(IT_GRID, "h-9 border-b border-line bg-bg-2/95 text-xs text-fg-subtle")}>
        <span />
        <span>Item</span>
        <span className="text-right">Value</span>
        <span className="pl-3">7 days</span>
        <span className="text-right">Change</span>
        <span className="text-right">{extra ? "Share" : "Liquidity"}</span>
        <span />
      </div>
      {rows.map((r) => {
        const key = favoriteKey(r.category, r.row.itemId);
        const fav = favorites.has(key);
        const s = spark(r.row);
        return (
          <div key={key} role="row" className={cn(IT_GRID, "h-10 border-b border-line transition-colors last:border-b-0 hover:bg-glass")}>
            <span className="pl-2">
              <IconButton
                icon="star"
                size="sm"
                label={fav ? `Remove ${r.row.name} from favourites` : `Add ${r.row.name} to favourites`}
                onClick={() => toggle(key)}
                className={fav ? "text-accent-2! [&_svg]:fill-current" : "text-fg-subtle!"}
              />
            </span>
            <span className="flex min-w-0 items-center gap-2.5">
              <ItemIcon src={r.row.icon} name={r.row.name} size={24} />
              <span className="min-w-0">
                <span className="block truncate text-fg">{r.row.name}</span>
                <span className="block truncate text-2xs text-fg-subtle">
                  {[r.row.variant, showCategory ? labelOf(r.category) : null].filter(Boolean).join(" · ")}
                </span>
              </span>
            </span>
            <span className="text-right">
              <Price amount={r.row.value} unit={config.baseUnit} />
            </span>
            <span className="pl-3">
              {s.length >= 2 ? (
                <Sparkline values={s} width={64} trend={(r.row.change7d ?? 0) > 0 ? "up" : (r.row.change7d ?? 0) < 0 ? "down" : "flat"} />
              ) : (
                <span className="text-fg-subtle">—</span>
              )}
            </span>
            <span className="text-right">
              {r.row.change7d != null ? <ChangeText change={r.row.change7d} /> : <span className="text-fg-subtle">—</span>}
            </span>
            <span className="tabular text-right text-fg-muted">
              {extra
                ? extra(r)
                : r.row.volumeValue
                  ? money(r.row.volumeValue, { compact: true })
                  : r.row.listings
                    ? `${formatCompact(r.row.listings)} listed`
                    : "—"}
            </span>
            <span className="pr-2 text-right">
              <IconButton icon="plus" size="sm" label={`Add a price alert for ${r.row.name}`} title="Price alert" onClick={() => onAlert(r)} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

const IT_GRID = "grid grid-cols-[40px_minmax(200px,1fr)_120px_90px_90px_110px_44px] items-center gap-3";

// ---------- liquidity ----------

function LiquidityTab({
  categories,
  snaps,
  focus,
  setFocus,
  config,
  onAlert,
}: {
  categories: MarketCategory[];
  snaps: Record<string, MarketSnapshot>;
  focus: string;
  setFocus: (id: string) => void;
  config: GameConfig;
  onAlert: (r: CategorizedRow) => void;
}) {
  const cat = focus !== "all" && snaps[focus] ? focus : (categories[0]?.id ?? "");
  const ranking = useMemo(() => (snaps[cat] ? liquidityRanking(cat, snaps[cat]!, 50) : []), [cat, snaps]);
  const kind: LiquidityKind | undefined = ranking[0]?.kind;
  return (
    <Panel flush>
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <Select
          label="Category"
          size="sm"
          value={cat}
          onChange={setFocus}
          options={categories.map((c) => ({ value: c.id, label: c.label }))}
          className="w-52"
        />
        <p className="mb-1.5 text-xs text-fg-muted">
          {kind === "traded"
            ? "Ranked by poe.ninja traded value; share = part of the category's total traded value."
            : kind === "listings"
              ? "Ranked by number of listings; share = part of all listings in the category."
              : "No liquidity data for this category."}
        </p>
      </div>
      {ranking.length === 0 ? (
        <EmptyState icon="search" title={categories.length ? "No liquidity data" : "Loading categories…"} loading={!categories.length} />
      ) : (
        <ItemTable
          rows={ranking}
          config={config}
          labelOf={() => ""}
          onAlert={onAlert}
          showCategory={false}
          extra={(r) => {
            const lr = ranking.find((x) => x === r)!;
            return (
              <span title={lr.kind === "traded" ? `Traded value ${formatAmount(lr.value)} ${config.baseUnit.short}` : `${lr.value} listings`}>
                {(lr.share * 100).toFixed(lr.share >= 0.1 ? 0 : 1)}%
              </span>
            );
          }}
        />
      )}
    </Panel>
  );
}

// ---------- alerts ----------

function AlertsTab({
  states,
  labelOf,
  config,
  onRemove,
  onAdd,
}: {
  states: { rule: AlertRule; state: AlertState }[];
  labelOf: (id: string) => string;
  config: GameConfig;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  const dc = useDisplayCurrency();
  const unitShort = (id: string) => dc?.options.find((o) => o.id === id)?.short ?? (id === config.baseUnit.id ? config.baseUnit.short : id);
  if (!states.length) {
    return (
      <Panel>
        <EmptyState
          icon="info"
          title="No price alerts yet"
          body="Add one with + on any item in Movers or Liquidity. Alerts are checked whenever market data loads or refreshes while Vaalytics is open."
          action={<Button onClick={onAdd}>Go to movers</Button>}
        />
      </Panel>
    );
  }
  const order = { triggered: 0, waiting: 1, "no-rate": 2, missing: 3 } as const;
  return (
    <Panel flush title="Price alerts" actions={<span>Checked when data loads or refreshes · no Windows notifications yet</span>}>
      <ul className="divide-y divide-line">
        {[...states]
          .sort((a, b) => order[a.state.status] - order[b.state.status])
          .map(({ rule, state }) => (
            <li key={rule.id} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", state.status === "triggered" && "bg-accent-soft/60")}>
              <Icon
                name={state.status === "triggered" ? "success" : state.status === "waiting" ? "refresh" : "warning"}
                size={16}
                className={state.status === "triggered" ? "text-accent-2" : "text-fg-subtle"}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-fg">
                  {rule.name} {rule.op === "above" ? "≥" : "≤"}{" "}
                  <span className="tabular">
                    {formatAmount(rule.threshold)} {unitShort(rule.unit)}
                  </span>
                </span>
                <span className="block text-2xs text-fg-subtle">{labelOf(rule.category)}</span>
              </span>
              <span className="text-right text-xs">
                {state.status === "triggered" || state.status === "waiting" ? (
                  <>
                    <Badge tone={state.status === "triggered" ? "accent" : "neutral"}>{state.status === "triggered" ? "Triggered" : "Waiting"}</Badge>
                    <span className="tabular ml-2 text-fg-muted">
                      now {formatAmount(state.current)} {unitShort(rule.unit)}
                    </span>
                  </>
                ) : (
                  <span className="text-warning">{state.status === "missing" ? "Not in loaded data" : "No rate for this currency"}</span>
                )}
              </span>
              <IconButton icon="close" size="sm" label={`Delete alert for ${rule.name}`} onClick={() => onRemove(rule.id)} />
            </li>
          ))}
      </ul>
    </Panel>
  );
}

function AlertModal({
  target,
  config,
  onClose,
  onSave,
}: {
  target: CategorizedRow | null;
  config: GameConfig;
  onClose: () => void;
  onSave: (r: Omit<AlertRule, "id" | "createdAt">) => void;
}) {
  const dc = useDisplayCurrency();
  const unit = dc?.unit ?? config.baseUnit;
  const current = target ? (unit.id === config.baseUnit.id ? target.row.value : (dc?.toCurrency(target.row.value, unit.id) ?? target.row.value)) : 0;
  const [op, setOp] = useState<"above" | "below">("above");
  const [value, setValue] = useState("");
  const threshold = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(threshold) && threshold >= 0;
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target ? `Price alert · ${target.row.name}` : "Price alert"}
      description={target ? `Now ${formatAmount(current)} ${unit.short} (poe.ninja). Change the unit with “Prices in”.` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              if (!target) return;
              onSave({
                category: target.category,
                itemId: target.row.itemId,
                name: target.row.name,
                op,
                threshold,
                unit: unit.id,
              });
              setValue("");
            }}
          >
            Save alert
          </Button>
        </>
      }
    >
      <div className="flex items-end gap-3">
        <SegmentedControl
          label="Condition"
          value={op}
          onChange={setOp}
          segments={[
            { value: "above", label: "At or above" },
            { value: "below", label: "At or below" },
          ]}
        />
        <Input
          label="Price"
          type="number"
          min={0}
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          suffix={unit.short}
          containerClassName="flex-1"
          autoFocus
        />
      </div>
    </Modal>
  );
}
