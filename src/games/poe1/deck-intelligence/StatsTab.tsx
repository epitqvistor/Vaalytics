/**
 * Statistics dashboard: KPIs and charts over the filtered sessions. Every figure is an estimate from
 * market prices; observed card frequencies are never drop rates.
 */
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import type { DeckCardTotal } from "@/core/ipc/commands";
import { useLeague } from "@/core/market/LeagueContext";
import { EmptyState, Input, Panel, ProvenanceTag, SegmentedControl, Select } from "@/shared/components";
import {
  applyFilter,
  cardRows,
  cumulative,
  distribution,
  type Period,
  type PriceBook,
  type RangePreset,
  type SessionView,
  type StatsFilter,
  topDrops,
  topShare,
  totals,
  volume,
} from "./analytics";
import { ColumnChart, RankedBars, StackedBar, TipRows } from "./charts";
import type { DeckPrefs } from "./prefs";
import { ACQUISITION_LABEL, ACQUISITIONS, CardArt, dateLabel, fmtChaos, fmtPct, fmtSigned, Kpi, Money, Profit, Roi, shortDate } from "./ui";

export function FilterBar({ filter, onChange, leagues, sessions }: { filter: StatsFilter; onChange: (f: StatsFilter) => void; leagues: string[]; sessions: readonly SessionView[] }) {
  return (
    <section className="panel flex flex-wrap items-end gap-3 rounded-lg px-4 py-3">
      <Select label="League" size="sm" value={filter.league} onChange={(league) => onChange({ ...filter, league })} options={[{ value: "all", label: "All leagues" }, ...leagues.map((l) => ({ value: l, label: l }))]} className="w-44" />
      <SegmentedControl
        label="Period"
        size="sm"
        value={filter.range}
        onChange={(range: RangePreset) => onChange({ ...filter, range })}
        segments={[
          { value: "7d", label: "7 days" },
          { value: "30d", label: "30 days" },
          { value: "90d", label: "90 days" },
          { value: "all", label: "All time" },
          { value: "custom", label: "Dates" },
        ]}
      />
      {filter.range === "custom" && (
        <>
          <Input size="sm" type="date" label="From" value={filter.from ?? ""} onChange={(e) => onChange({ ...filter, from: e.target.value })} containerClassName="w-36" />
          <Input size="sm" type="date" label="To" value={filter.to ?? ""} onChange={(e) => onChange({ ...filter, to: e.target.value })} containerClassName="w-36" />
        </>
      )}
      <Select
        label="Acquisition"
        size="sm"
        value={filter.acquisition}
        onChange={(acquisition) => onChange({ ...filter, acquisition })}
        options={[{ value: "all" as const, label: "Any acquisition" }, ...ACQUISITIONS.map((a) => ({ value: a, label: ACQUISITION_LABEL[a] }))]}
        className="w-44"
      />
      <Select
        label="Session"
        size="sm"
        value={filter.sessionIds.length === 1 ? String(filter.sessionIds[0]) : "all"}
        onChange={(v) => onChange({ ...filter, sessionIds: v === "all" ? [] : [Number(v)] })}
        options={[{ value: "all", label: "All sessions" }, ...sessions.map((s) => ({ value: String(s.id), label: s.name }))]}
        className="w-52"
      />
    </section>
  );
}

type SortKey = "date" | "value" | "profit" | "decks";

export function StatsTab({
  views,
  allTotals,
  book,
  prefs,
  filter,
  onFilter,
  onOpenSession,
}: {
  views: readonly SessionView[];
  allTotals: readonly DeckCardTotal[];
  book: PriceBook | null;
  prefs: DeckPrefs;
  filter: StatsFilter;
  onFilter: (f: StatsFilter) => void;
  onOpenSession: (id: number) => void;
}) {
  const { league } = useLeague();
  const leagues = useMemo(() => [...new Set(views.map((v) => v.league).filter((l): l is string => !!l))].sort(), [views]);
  const shown = useMemo(() => applyFilter(views, filter, Math.floor(Date.now() / 1000)), [views, filter]);
  const t = useMemo(() => totals(shown), [shown]);
  const rows = useMemo(() => cardRows(shown, allTotals, book), [shown, allTotals, book]);
  const drops = useMemo(() => topDrops(shown, allTotals, book, 8), [shown, allTotals, book]);
  const [plMode, setPlMode] = useState<"session" | "cumulative">("cumulative");
  const [sort, setSort] = useState<SortKey>("date");
  const [period, setPeriod] = useState<Period>("week");
  const animate = prefs.animateCharts;
  const chrono = useMemo(() => [...shown].sort((a, b) => a.at - b.at || a.id - b.id), [shown]);
  const cum = useMemo(() => cumulative(shown), [shown]);
  const dist = useMemo(() => distribution(rows.map((r) => ({ qty: r.qty, unit: r.unit })), prefs.buckets), [rows, prefs.buckets]);
  const vol = useMemo(() => volume(shown, period), [shown, period]);
  const top3 = topShare(rows, 3);
  const thresholdCount = (min: number) => rows.filter((r) => r.unit !== null && r.unit >= min).reduce((a, r) => a + r.qty, 0);
  const sorted = useMemo(() => {
    const s = [...shown];
    const by: Record<SortKey, (a: SessionView, b: SessionView) => number> = {
      date: (a, b) => a.at - b.at,
      value: (a, b) => b.value - a.value,
      profit: (a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity),
      decks: (a, b) => b.decks - a.decks,
    };
    return s.sort(by[sort]);
  }, [shown, sort]);

  if (views.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon="chart"
          title="No opening history yet"
          body="Statistics appear after your first session. Start one on the Session tab, or import past openings from Client.txt in Settings — nothing here is sample data."
          className="py-16"
        />
      </Panel>
    );
  }

  const sessionTip = (v: SessionView) => (
    <TipRows
      title={v.name}
      rows={[
        ["Date", dateLabel(v.at)],
        ["Decks", String(v.decks)],
        ["Card value", v.valueKind === "original" ? fmtChaos(v.value) : `${fmtChaos(v.value)} (live)`],
        ["Cost", v.cost === null ? "unknown" : fmtChaos(v.cost)],
        ["Profit", v.profit === null ? "—" : fmtSigned(v.profit)],
        ["ROI", fmtPct(v.roi)],
      ]}
    />
  );
  const period_ = filter.range === "all" ? "All time" : filter.range === "custom" ? `${filter.from || "…"} – ${filter.to || "…"}` : `Last ${filter.range.replace("d", " days")}`;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar filter={filter} onChange={onFilter} leagues={leagues} sessions={views} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span className="text-fg">{period_}</span>·<span>{filter.league === "all" ? "all leagues" : filter.league}</span>·<span>{t.sessions} sessions</span>
        <span className="ml-auto flex items-center gap-2">
          <ProvenanceTag provenance={{ kind: "estimate", source: "poe.ninja + your sessions", at: book?.at ?? null, league: league ?? undefined }} />
          <span className="text-fg-subtle">Finished sessions use their original valuation.</span>
        </span>
      </div>

      {shown.length === 0 ? (
        <Panel>
          <EmptyState icon="search" title="No sessions match these filters" className="py-12" />
        </Panel>
      ) : (
        <motion.div key={JSON.stringify(filter)} initial={animate ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Stacked Decks opened" value={t.decks.toLocaleString()} sub={`${t.sessions} sessions`} />
            <Kpi label="Confirmed cards" value={t.cards.toLocaleString()} sub={t.review + t.unrecognized > 0 ? `${t.review + t.unrecognized} not confirmed (excluded)` : "all reviewed"} />
            <Kpi label="Est. card value" tone="accent" value={<Money value={t.value} strong />} sub={t.unpricedCards ? `${t.unpricedCards} cards without a price` : "every card priced"} />
            <Kpi label="Acquisition cost" value={<Money value={t.sessionsWithCost ? t.cost : null} unknown="Not entered" />} sub={`${t.sessionsWithCost} of ${t.sessions} sessions have a cost`} />
            <Kpi label="Est. profit / loss" value={<Profit value={t.profit} />} sub={t.sessionsWithCost ? `over ${t.sessionsWithCost} sessions with a cost` : "enter costs to see profit"} />
            <Kpi label="Overall ROI" value={<Roi value={t.roi} />} sub={t.avgSessionRoi !== null ? `average session ${fmtPct(t.avgSessionRoi)}` : undefined} />
            <Kpi label="Value per deck" value={<Money value={t.avgValuePerDeck} />} sub={t.avgCostPerDeck !== null ? `cost ${t.avgCostPerDeck.toFixed(2)} c / deck` : undefined} />
            <Kpi label="Value per minute" value={<Money value={t.valuePerMinute} unknown="—" />} sub="live sessions, running time" />
          </div>

          <Panel
            title="Profit / loss over time"
            actions={
              <SegmentedControl
                size="sm"
                label="Mode"
                value={plMode}
                onChange={setPlMode}
                segments={[
                  { value: "cumulative", label: "Cumulative" },
                  { value: "session", label: "Per session" },
                ]}
              />
            }
          >
            {cum.length === 0 ? (
              <EmptyState icon="chart" title="No sessions with a cost" body="Profit needs the acquisition cost — add it to a session to see this chart." className="py-10" />
            ) : (
              <ColumnChart
                title="Estimated profit per session"
                animate={animate}
                height={260}
                columns={cum.map(({ view, profit, total }) => ({
                  key: String(view.id),
                  label: shortDate(view.at),
                  value: plMode === "session" ? profit : total,
                  tone: (plMode === "session" ? profit : total) >= 0 ? "success" : "danger",
                  tooltip: (
                    <TipRows
                      title={view.name}
                      rows={[
                        ["Date", dateLabel(view.at)],
                        ["Decks", String(view.decks)],
                        ["Profit", fmtSigned(profit)],
                        ["Cumulative", fmtSigned(total)],
                        ["ROI", fmtPct(view.roi)],
                      ]}
                    />
                  ),
                }))}
                line={plMode === "session" ? cum.map((c) => c.total) : undefined}
                formatTick={(v) => fmtSigned(v).replace(" c", "")}
                onSelect={(k) => onOpenSession(Number(k))}
              />
            )}
            <p className="mt-2 text-2xs text-fg-subtle">
              {plMode === "session" ? "Bars: each session's estimated profit. Line: running total." : "Running total of estimated profit."} Sessions without a cost are left out. Click a bar to open the session.
            </p>
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel
              title="Session value"
              actions={
                <Select
                  size="sm"
                  label="Sort"
                  hideLabel
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "date", label: "By date" },
                    { value: "value", label: "By value" },
                    { value: "profit", label: "By profit" },
                    { value: "decks", label: "By decks" },
                  ]}
                  className="w-32"
                />
              }
            >
              <ColumnChart
                title="Estimated card value per session"
                animate={animate}
                columns={sorted.map((v) => ({ key: String(v.id), label: shortDate(v.at), value: v.value, tone: v.valueKind === "live" ? "info" : "accent", tooltip: sessionTip(v) }))}
                formatTick={fmtChaos}
                onSelect={(k) => onOpenSession(Number(k))}
              />
              <p className="mt-2 text-2xs text-fg-subtle">Blue: a session still running (live prices).</p>
            </Panel>
            <Panel title="ROI per session">
              {chrono.some((v) => v.roi !== null) ? (
                <ColumnChart
                  title="ROI per session"
                  animate={animate}
                  columns={chrono
                    .filter((v) => v.roi !== null)
                    .map((v) => ({ key: String(v.id), label: shortDate(v.at), value: v.roi!, tone: v.roi! >= 0 ? "success" : "danger", tooltip: sessionTip(v) }))}
                  formatTick={(v) => `${Math.round(v)}%`}
                  onSelect={(k) => onOpenSession(Number(k))}
                />
              ) : (
                <EmptyState icon="chart" title="No ROI yet" body="ROI needs a known, non-zero acquisition cost." className="py-10" />
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Panel title="Card value distribution">
              <ColumnChart
                title="Cards per value range"
                animate={animate}
                height={200}
                columns={dist.buckets.map((b) => ({
                  key: b.label,
                  label: b.label,
                  value: b.cards,
                  tone: "accent",
                  tooltip: <TipRows title={b.label} rows={[["Cards", String(b.cards)], ["Value", fmtChaos(b.value)]]} />,
                }))}
                formatTick={(v) => String(Math.round(v))}
              />
              <p className="mt-2 text-2xs text-fg-subtle">
                {dist.unpriced > 0 ? `${dist.unpriced} cards without a price aren't in any range. ` : ""}Ranges are set in Settings. Today's unit prices.
              </p>
            </Panel>
            <Panel title="Session outcomes">
              <StackedBar
                parts={[
                  { key: "p", label: "Profitable", value: t.outcomes.profit, tone: "success" },
                  { key: "l", label: "Unprofitable", value: t.outcomes.loss, tone: "danger" },
                  { key: "e", label: "Break-even (±1 %)", value: t.outcomes.even, tone: "muted" },
                  { key: "u", label: "No cost entered", value: t.unknownOutcome, tone: "info" },
                ]}
              />
              <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs">
                <dt className="text-fg-subtle">Best session</dt>
                <dd className="truncate text-right">{t.best ? <button className="text-fg hover:text-accent" onClick={() => onOpenSession(t.best!.id)}>{t.best.name} · <Profit value={t.best.profit} /></button> : "—"}</dd>
                <dt className="text-fg-subtle">Worst session</dt>
                <dd className="truncate text-right">{t.worst ? <button className="text-fg hover:text-accent" onClick={() => onOpenSession(t.worst!.id)}>{t.worst.name} · <Profit value={t.worst.profit} /></button> : "—"}</dd>
                <dt className="text-fg-subtle">Average card</dt>
                <dd className="text-right"><Money value={t.avgCardValue} /></dd>
                <dt className="text-fg-subtle">Top 3 cards' share</dt>
                <dd className="tabular text-right text-fg">{top3 === null ? "—" : `${Math.round(top3 * 100)}% of value`}</dd>
                <dt className="text-fg-subtle">Unique / duplicate cards</dt>
                <dd className="tabular text-right text-fg">
                  {rows.length} / {Math.max(0, t.cards - rows.length)}
                </dd>
                <dt className="text-fg-subtle">Cards ≥ {prefs.buckets[prefs.buckets.length - 1]} c</dt>
                <dd className="tabular text-right text-fg">{thresholdCount(prefs.buckets[prefs.buckets.length - 1]!)}</dd>
              </dl>
            </Panel>
            <Panel
              title="Decks opened over time"
              actions={
                <SegmentedControl
                  size="sm"
                  label="Group"
                  value={period}
                  onChange={setPeriod}
                  segments={[
                    { value: "day", label: "Day" },
                    { value: "week", label: "Week" },
                    { value: "month", label: "Month" },
                  ]}
                />
              }
            >
              <ColumnChart
                title="Decks opened per period"
                animate={animate}
                height={200}
                columns={vol.map((p) => ({ key: p.key, label: p.key.slice(period === "month" ? 0 : 5), value: p.decks, tone: "accent", tooltip: <TipRows title={period === "week" ? `Week of ${p.key}` : p.key} rows={[["Decks", String(p.decks)], ["Sessions", String(p.sessions)]]} /> }))}
                formatTick={(v) => String(Math.round(v))}
              />
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Most valuable drops">
              {drops.length === 0 ? (
                <EmptyState icon="gem" title="No priced cards yet" className="py-8" />
              ) : (
                <RankedBars
                  rows={drops}
                  value={(d) => d.unit}
                  getKey={(d) => `${d.sessionId}:${d.card}`}
                  onSelect={(d) => onOpenSession(d.sessionId)}
                  render={(d) => ({
                    left: (
                      <>
                        <CardArt name={d.card} size={24} />
                        <span className="min-w-0">
                          <span className="block truncate text-fg">
                            {d.card} {d.qty > 1 && <span className="text-fg-muted">× {d.qty}</span>}
                          </span>
                          <span className="block truncate text-2xs text-fg-subtle">{d.sessionName}</span>
                        </span>
                      </>
                    ),
                    right: (
                      <span className="flex flex-col items-end">
                        <Money value={d.unit} strong />
                        {d.qty > 1 && <span className="text-2xs text-fg-subtle">{fmtChaos(d.total)} total</span>}
                      </span>
                    ),
                  })}
                />
              )}
            </Panel>
            <Panel title="Most frequent cards">
              <RankedBars
                rows={[...rows].sort((a, b) => b.qty - a.qty).slice(0, 8)}
                value={(r) => r.qty}
                getKey={(r) => r.card}
                render={(r) => ({
                  left: (
                    <>
                      <CardArt name={r.card} size={24} />
                      <span className="min-w-0">
                        <span className="block truncate text-fg">{r.card}</span>
                        <span className="block truncate text-2xs text-fg-subtle">
                          in {r.sessions} session{r.sessions === 1 ? "" : "s"}
                        </span>
                      </span>
                    </>
                  ),
                  right: (
                    <span className="flex flex-col items-end">
                      <span className="text-fg">× {r.qty}</span>
                      <span className="text-2xs text-fg-subtle">{(r.share * 100).toFixed(1)}% of your cards</span>
                    </span>
                  ),
                })}
              />
              <p className="mt-3 text-2xs text-fg-subtle">Observed in your sessions — not official drop rates.</p>
            </Panel>
          </div>
        </motion.div>
      )}
    </div>
  );
}
