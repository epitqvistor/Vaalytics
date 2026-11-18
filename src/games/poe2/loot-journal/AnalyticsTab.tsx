/** Analytics over captured items: activity, categories, per-session reports. Captured items only — never total loot or profit. */
import { useMemo, useState } from "react";
import type { LootItem } from "@/core/ipc/commands";
import { BarChart } from "@/shared/charts/BarChart";
import { EmptyState, Panel, SegmentedControl, StatTile } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { formatAmount } from "@/shared/utilities/format";
import { Price } from "@/shared/views/common";
import { POE2_CONFIG } from "../config";
import { useSessionHistory } from "../session-intelligence/hooks";
import { dur } from "../session-intelligence/stats";
import { byCategory, bySession, categoryLabel, dailyCaptures, displayName, isValued, lootTotals } from "./stats";
import { fmtDateTime } from "./ui";

const unit = POE2_CONFIG.baseUnit;
const RANGES = [
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
] as const;

export function AnalyticsTab({ items, onOpen }: { items: LootItem[]; onOpen: (id: number) => void }) {
  const [range, setRange] = useState<"14" | "30" | "90">("30");
  const [now] = useState(() => Date.now());
  const sessions = useSessionHistory("poe2", { sort: "newest", limit: 1000 });
  const t = useMemo(() => lootTotals(items), [items]);
  const days = useMemo(() => dailyCaptures(items, Number(range), now), [items, range, now]);
  const cats = useMemo(() => byCategory(items), [items]);
  const reports = useMemo(() => bySession(items, sessions.data ?? []), [items, sessions.data]);
  const top = useMemo(() => items.filter(isValued).sort((a, b) => b.valueTotal! - a.valueTotal!).slice(0, 8), [items]);
  const withSession = reports.filter((r) => r.session && r.session.durationSecs > 0);
  const capturedSecs = withSession.reduce((a, r) => a + r.session!.durationSecs, 0);
  const capturedInSessions = withSession.reduce((a, r) => a + r.items, 0);
  const valueInSessions = withSession.reduce((a, r) => a + r.value, 0);

  if (items.length === 0)
    return (
      <Panel>
        <EmptyState icon="chart" title="No captured items yet" body="Analytics appear once you've copied items in Path of Exile 2." />
      </Panel>
    );

  const maxCat = Math.max(1, ...cats.map((c) => c.count));
  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-fg-muted">
        <Icon name="info" size={14} className="mt-px shrink-0 text-warning" />
        These statistics describe items you copied (Ctrl+C) — not everything you picked up. They are not your session's total loot or profit.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Captured items" value={t.items} caption={`${t.uniques} uniques`} />
        <StatTile label="Captured value" value={<Price amount={t.value} unit={unit} />} caption={`${t.unpriced} unpriced`} />
        <StatTile label="Captures per hour" value={capturedSecs >= 600 ? (capturedInSessions / (capturedSecs / 3600)).toFixed(1) : "—"} caption="during tracked sessions" />
        <StatTile label="Captured value / hour" value={capturedSecs >= 600 ? <Price amount={valueInSessions / (capturedSecs / 3600)} unit={unit} /> : "—"} caption="during tracked sessions" />
      </div>

      <div className="flex items-center justify-between">
        <SegmentedControl label="Period" value={range} onChange={setRange} segments={RANGES} size="sm" />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Items captured per day">
          <BarChart values={days.map((d) => d.count)} labels={days.map((d) => d.label)} formatValue={(v) => `${v} item${v === 1 ? "" : "s"}`} formatTick={(v) => (Number.isInteger(v) ? String(v) : "")} title="Items captured per day" />
        </Panel>
        <Panel title="Captured value per day" actions={<span>priced items only</span>}>
          <BarChart values={days.map((d) => d.value)} labels={days.map((d) => d.label)} formatValue={(v) => `${formatAmount(v)} ${unit.short}`} formatTick={(v) => formatAmount(v)} title="Captured value per day in exalted" />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Categories">
          <ul className="flex flex-col gap-2">
            {cats.map((c) => (
              <li key={c.category} className="grid grid-cols-[130px_minmax(0,1fr)_44px_90px] items-center gap-3 text-xs">
                <span className="truncate text-fg-muted">{categoryLabel(c.category)}</span>
                <span className="h-2 overflow-hidden rounded-full bg-white/[0.04]">
                  <span className="block h-full rounded-full bg-accent/80" style={{ width: `${Math.max(2, (c.count / maxCat) * 100)}%` }} />
                </span>
                <span className="tabular text-right text-fg">{c.count}</span>
                <span className="text-right">{c.value > 0 ? <Price amount={c.value} unit={unit} /> : <span className="text-fg-subtle">—</span>}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Most valuable captures" flush>
          {top.length === 0 ? (
            <EmptyState icon="journal" title="No priced captures yet" className="py-8" />
          ) : (
            <ul className="divide-y divide-line">
              {top.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onOpen(i.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-white/[0.02]">
                    <span className="min-w-0 flex-1 truncate text-fg">{displayName(i)}</span>
                    <span className="text-2xs text-fg-subtle">{fmtDateTime(i.capturedAt)}</span>
                    <Price amount={i.valueTotal!} unit={unit} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Session loot reports" flush actions={<span>captured items per session</span>}>
        {reports.length === 0 ? (
          <EmptyState icon="clock" title="No captures during tracked sessions" body="Items copied while Session Intelligence tracks a session are grouped here." className="py-8" />
        ) : (
          <div role="table" className="text-sm">
            <div role="row" className="grid h-9 grid-cols-[minmax(0,1.2fr)_90px_70px_110px_70px_minmax(0,1fr)] items-center gap-3 border-b border-line bg-bg-2/95 px-4 text-xs text-fg-subtle">
              <span>Session</span>
              <span className="text-right">Duration</span>
              <span className="text-right">Items</span>
              <span className="text-right">Captured value</span>
              <span className="text-right">Unpriced</span>
              <span>Most valuable capture</span>
            </div>
            {reports.slice(0, 50).map((r) => (
              <div key={r.sessionId} role="row" className="grid min-h-10 grid-cols-[minmax(0,1.2fr)_90px_70px_110px_70px_minmax(0,1fr)] items-center gap-3 border-b border-line px-4 last:border-b-0">
                <span className="truncate text-fg">
                  #{r.sessionId}
                  {r.session && <span className="text-fg-muted"> · {fmtDateTime(r.session.startedAt)}</span>}
                </span>
                <span className="tabular text-right text-fg-muted">{r.session ? dur(r.session.durationSecs) : "—"}</span>
                <span className="tabular text-right text-fg">{r.items}</span>
                <span className="text-right">{r.value > 0 ? <Price amount={r.value} unit={unit} /> : <span className="text-fg-subtle">—</span>}</span>
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
