/** Analytics over captured items and map records. Captured items only — never total loot or profit. */
import { useMemo, useState } from "react";
import type { LootItem } from "@/core/ipc/commands";
import { useDisplayCurrency, useMoney } from "@/core/market/DisplayCurrency";
import { AreaChart } from "@/shared/charts/AreaChart";
import { BarChart } from "@/shared/charts/BarChart";
import { ChangeText, EmptyState, Panel, SegmentedControl } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { formatAmount } from "@/shared/utilities/format";
import { Price } from "@/shared/views/common";
import { POE2_CONFIG } from "../config";
import { useSessionHistory } from "../session-intelligence/hooks";
import { useLootMaps } from "./hooks";
import { MapTable } from "./OverviewTab";
import { byCategory, bySession, categoryLabel, currencyDistribution, dailyCaptures, displayName, isValued, lootTotals, mapName, mapStats, quantityOf, weekComparison } from "./stats";
import { fmtDateTime, fmtDuration, ItemIcon, Metric, MetricStrip } from "./ui";

const unit = POE2_CONFIG.baseUnit;
const RANGES = [
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;

export function AnalyticsTab({ items, onOpen }: { items: LootItem[]; onOpen: (id: number) => void }) {
  const [range, setRange] = useState<"14" | "30" | "90">("30");
  const [now] = useState(() => Date.now());
  const fmtMoney = useMoney();
  const money = (v: number) => fmtMoney(v, { unit });
  const display = useDisplayCurrency();
  const tick = (v: number) => formatAmount(v);
  const inDisplay = (v: number) => (display ? display.toUnit(v) : v);
  const sessions = useSessionHistory("poe2", { sort: "newest", limit: 1000 });
  const maps = useLootMaps(null, 1000);
  const t = useMemo(() => lootTotals(items), [items]);
  const days = useMemo(() => dailyCaptures(items, Number(range), now), [items, range, now]);
  const cumulative = useMemo(() => {
    let run = 0;
    return days.map((d) => (run += d.value));
  }, [days]);
  const cumulativeShown = cumulative.map(inDisplay);
  const cats = useMemo(() => byCategory(items), [items]);
  const currencies = useMemo(() => currencyDistribution(items, 10), [items]);
  const reports = useMemo(() => bySession(items, sessions.data ?? []), [items, sessions.data]);
  const top = useMemo(() => items.filter(isValued).sort((a, b) => b.valueTotal! - a.valueTotal!).slice(0, 8), [items]);
  const ms = useMemo(() => mapStats(maps.data ?? []), [maps.data]);
  const week = useMemo(() => weekComparison(items, now), [items, now]);
  const recentSessions = reports.slice(0, 12).reverse();

  if (items.length === 0 && (maps.data?.length ?? 0) === 0)
    return (
      <Panel>
        <EmptyState icon="chart" title="Nothing to analyse yet" body="Analytics appear once you've copied items in Path of Exile 2 or played maps while Session Intelligence tracks the game." />
      </Panel>
    );

  const maxCat = Math.max(1, ...cats.map((c) => c.count));
  const maxCur = Math.max(1e-9, ...currencies.map((c) => c.value));
  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 rounded-md border border-line bg-bg-2 px-3 py-2 text-xs text-fg-muted">
        <Icon name="info" size={14} className="mt-px shrink-0 text-accent-2" />
        Values describe items you copied (Ctrl+C) — not everything you picked up, and not profit. Profit would need what you actually sold, which Vaalytics doesn't know.
      </p>

      <MetricStrip className="grid-cols-2 sm:grid-cols-3 min-[1500px]:grid-cols-6">
        <Metric label="Captured value" value={<Price amount={t.value} unit={unit} />} caption={`${t.items} items · ${t.unpriced} unpriced`} />
        <Metric
          label="This week"
          value={<Price amount={week.current.value} unit={unit} />}
          caption={
            <span className="flex items-center gap-1.5">
              {week.valueChange !== null ? <ChangeText change={week.valueChange} /> : null}
              <span>vs {money(week.previous.value)} last week</span>
            </span>
          }
        />
        <Metric label="Average per map" value={ms.averageValue !== null ? <Price amount={ms.averageValue} unit={unit} /> : "—"} caption={`${ms.counted} finished map${ms.counted === 1 ? "" : "s"} ≥ 1 min`} />
        <Metric label="Value per map hour" value={ms.valuePerHour !== null ? <Price amount={ms.valuePerHour} unit={unit} /> : "—"} caption="captured value ÷ time in maps" />
        <Metric label="Average map time" value={ms.averageSecs !== null ? fmtDuration(ms.averageSecs) : "—"} caption="inside the instance" />
        <Metric label="Maps tracked" value={ms.maps} caption="auto + manual records" />
      </MetricStrip>

      <div className="flex items-center justify-between">
        <SegmentedControl label="Period" value={range} onChange={setRange} segments={RANGES} size="sm" />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Captured value over time" actions={<span>cumulative · priced items</span>}>
          <AreaChart
            values={cumulativeShown}
            labels={days.map((d) => d.label)}
            formatValue={(v) => `${formatAmount(v)} ${display?.unit.short ?? unit.short}`}
            formatTick={tick}
            title={`Cumulative captured value in ${display?.unit.name ?? unit.name}`}
          />
        </Panel>
        <Panel title="Items captured per day">
          <BarChart values={days.map((d) => d.count)} labels={days.map((d) => d.label)} formatValue={(v) => `${v} item${v === 1 ? "" : "s"}`} formatTick={(v) => (Number.isInteger(v) ? String(v) : "")} title="Items captured per day" />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Items per session" actions={<span>{recentSessions.length === 1 ? "the session" : `last ${recentSessions.length} sessions`} with captures</span>}>
          {recentSessions.length === 0 ? (
            <EmptyState icon="clock" title="No captures during tracked sessions" className="py-8" />
          ) : (
            <BarChart
              values={recentSessions.map((r) => r.items)}
              labels={recentSessions.map((r) => (r.session ? `#${r.sessionId} · ${fmtDateTime(r.session.startedAt)}` : `#${r.sessionId}`))}
              formatValue={(v) => `${v} item${v === 1 ? "" : "s"}`}
              formatTick={(v) => (Number.isInteger(v) ? String(v) : "")}
              title="Captured items per session"
            />
          )}
        </Panel>
        <Panel title="Categories">
          <ul className="flex flex-col gap-2">
            {cats.map((c) => (
              <li key={c.category} className="grid grid-cols-[130px_minmax(0,1fr)_44px_96px] items-center gap-3 text-xs">
                <span className="truncate text-fg-muted">{categoryLabel(c.category)}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                  <span className="block h-full rounded-full bg-accent/70" style={{ width: `${Math.max(2, (c.count / maxCat) * 100)}%` }} />
                </span>
                <span className="tabular text-right text-fg">{c.count}</span>
                <span className="text-right">{c.value > 0 ? <Price amount={c.value} unit={unit} /> : <span className="text-fg-subtle">—</span>}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Currency distribution" flush actions={<span>stackables by captured value</span>}>
          {currencies.length === 0 ? (
            <EmptyState icon="currency" title="No stackable captures yet" className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {currencies.map((c) => (
                <li key={c.name} className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,0.8fr)_64px_96px] items-center gap-3 px-4 py-2 text-xs">
                  <ItemIcon item={{ icon: c.icon, category: "currency", rarity: "Currency" }} size={28} />
                  <span className="truncate text-sm text-fg">{c.name}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                    <span className="block h-full rounded-full bg-accent/70" style={{ width: `${Math.max(c.value > 0 ? 2 : 0, (c.value / maxCur) * 100)}%` }} />
                  </span>
                  <span className="tabular text-right text-fg-muted">×{c.quantity.toLocaleString("en-GB")}</span>
                  <span className="text-right">{c.value > 0 ? <Price amount={c.value} unit={unit} /> : <span className="text-fg-subtle">unpriced</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Most valuable captures" flush>
          {top.length === 0 ? (
            <EmptyState icon="journal" title="No priced captures yet" className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {top.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onOpen(i.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors duration-150 hover:bg-white/[0.025]">
                    <ItemIcon item={i} size={28} />
                    <span className="min-w-0 flex-1 truncate text-fg">
                      {displayName(i)}
                      {quantityOf(i) > 1 && <span className="text-fg-muted"> ×{quantityOf(i)}</span>}
                    </span>
                    <span className="text-2xs text-fg-subtle">{fmtDateTime(i.capturedAt)}</span>
                    <Price amount={i.valueTotal!} unit={unit} strong />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Maps"
        flush
        actions={
          ms.best ? (
            <span>
              best: {mapName(ms.best)} {money(ms.best.value)}
              {ms.worst && ` · lowest: ${mapName(ms.worst)} ${money(ms.worst.value)}`}
            </span>
          ) : undefined
        }
      >
        <MapTable maps={maps.data ? maps.data.slice(0, 30) : null} error={maps.error} nowMs={now} onOpenItem={onOpen} />
      </Panel>

      <Panel title="Session loot reports" flush actions={<span>captured items per session</span>}>
        {reports.length === 0 ? (
          <EmptyState icon="clock" title="No captures during tracked sessions" body="Items copied while Session Intelligence tracks a session are grouped here." className="py-8" />
        ) : (
          <div role="table" className="text-sm">
            <div role="row" className="well grid h-8 grid-cols-[minmax(0,1.2fr)_90px_70px_110px_110px_70px_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 text-2xs text-fg-subtle">
              <span>Session</span>
              <span className="text-right">Duration</span>
              <span className="text-right">Items</span>
              <span className="text-right">Captured value</span>
              <span className="text-right">Value / hour</span>
              <span className="text-right">Unpriced</span>
              <span>Most valuable capture</span>
            </div>
            {reports.slice(0, 50).map((r) => (
              <div key={r.sessionId} role="row" className="grid min-h-10 grid-cols-[minmax(0,1.2fr)_90px_70px_110px_110px_70px_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 last:border-b-0">
                <span className="truncate text-fg">
                  #{r.sessionId}
                  {r.session && <span className="text-fg-muted"> · {fmtDateTime(r.session.startedAt)}</span>}
                </span>
                <span className="tabular text-right text-fg-muted">{r.session ? fmtDuration(r.session.durationSecs) : "—"}</span>
                <span className="tabular text-right text-fg">{r.items}</span>
                <span className="text-right">{r.value > 0 ? <Price amount={r.value} unit={unit} /> : <span className="text-fg-subtle">—</span>}</span>
                <span className="text-right">{r.valuePerHour !== null && r.value > 0 ? <Price amount={r.valuePerHour} unit={unit} /> : <span className="text-fg-subtle">—</span>}</span>
                <span className="tabular text-right text-fg-muted">{r.unpriced}</span>
                <span className="truncate text-xs text-fg-muted">{r.mostValuable ? displayName(r.mostValuable) : "—"}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
