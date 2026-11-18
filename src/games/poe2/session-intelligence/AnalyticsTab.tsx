/** Analytics across recorded sessions: totals, trends, day/week comparisons. */
import { useMemo, useState } from "react";
import { EmptyState, Panel, SegmentedControl, StatTile } from "@/shared/components";
import { AreaChart } from "@/shared/charts/AreaChart";
import { BarChart } from "@/shared/charts/BarChart";
import { useSessionHistory } from "./hooks";
import { byDay, byWeek, compareSessions, comparePeriods, dur, fmtDateTime, MIN_SESSIONS_FOR_TRENDS, perHour, periodTotals, totals } from "./stats";
import { MetricTable } from "./ui";

const GAME = "poe2" as const;
type Range = "7" | "30" | "90" | "all";
const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All" },
] as const;

const hours = (secs: number) => `${(secs / 3600).toFixed(secs >= 36_000 ? 0 : 1)} h`;

export function AnalyticsTab() {
  const [range, setRange] = useState<Range>("30");
  const all = useSessionHistory(GAME, { sort: "oldest", limit: 5000 });
  const [now] = useState(() => Date.now());

  const sessions = useMemo(() => {
    const list = all.data ?? [];
    if (range === "all") return list;
    const from = now / 1000 - Number(range) * 86_400;
    return list.filter((s) => s.startedAt >= from);
  }, [all.data, range, now]);
  const t = useMemo(() => totals(sessions), [sessions]);
  const days = useMemo(() => byDay(all.data ?? [], range === "7" ? 7 : range === "30" ? 30 : 30, now), [all.data, range, now]);
  const weeks = useMemo(() => byWeek(all.data ?? [], 12, now), [all.data, now]);
  const tracked = sessions.filter((s) => s.logTracked && s.durationSecs >= 300);
  const completed = (all.data ?? []).filter((s) => s.status === "completed");

  if (all.error) return <EmptyState icon="error" title="Couldn't load sessions" body={all.error} />;
  if (all.data === null) return <EmptyState icon="chart" title="Loading…" loading />;
  if (all.data.length < MIN_SESSIONS_FOR_TRENDS)
    return (
      <Panel>
        <EmptyState
          icon="chart"
          title="Not enough sessions yet"
          body={`Analytics need at least ${MIN_SESSIONS_FOR_TRENDS} recorded sessions — ${all.data.length === 0 ? "none" : "one"} so far. Play with Vaalytics running; sessions are saved automatically.`}
        />
      </Panel>
    );

  const last = completed[completed.length - 1];
  const prev = completed[completed.length - 2];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <SegmentedControl label="Period" value={range} onChange={setRange} segments={RANGES} size="sm" />
        <span className="text-2xs text-fg-subtle">
          {t.sessions} session{t.sessions === 1 ? "" : "s"} · maps from {t.tracked} with Client.txt data
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Time played" value={dur(t.durationSecs)} caption={`${t.sessions} sessions`} />
        <StatTile label="Maps entered" value={t.tracked ? t.maps : "—"} caption="distinct map instances" />
        <StatTile label="Maps per hour" value={t.mapsPerHour === null ? "—" : t.mapsPerHour.toFixed(1)} caption="over all tracked time" />
        <StatTile label="Avg time in a map" value={dur(t.avgMapSecs)} caption={t.downtimeShare === null ? undefined : `${Math.round(t.downtimeShare * 100)}% in hideout + town`} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title={`Time played per day`} actions={<span>last {days.length} days</span>}>
          <BarChart values={days.map((d) => d.playedSecs / 3600)} labels={days.map((d) => d.label)} formatValue={(v) => hours(v * 3600)} formatTick={(v) => `${v}h`} title="Hours played per day" />
        </Panel>
        <Panel title="Time played per week" actions={<span>last 12 weeks</span>}>
          <BarChart values={weeks.map((w) => w.playedSecs / 3600)} labels={weeks.map((w) => w.label)} formatValue={(v) => hours(v * 3600)} formatTick={(v) => `${v}h`} title="Hours played per week" />
        </Panel>
      </div>

      <Panel title="Maps per hour by session" actions={<span>sessions ≥ 5 min with Client.txt data</span>}>
        {tracked.length < MIN_SESSIONS_FOR_TRENDS ? (
          <EmptyState icon="chart" title="Not enough tracked sessions in this period" className="py-8" />
        ) : (
          <AreaChart
            values={tracked.map((s) => perHour(s.mapsEntered, s.durationSecs) ?? 0)}
            labels={tracked.map((s) => fmtDateTime(s.startedAt))}
            formatValue={(v) => `${v.toFixed(1)} maps/h`}
            formatTick={(v) => v.toFixed(0)}
            title="Maps per hour by session"
          />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Panel title="Today vs yesterday">
          <MetricTable metrics={comparePeriods(periodTotals(all.data, "day", now, 0), periodTotals(all.data, "day", now, -1))} aLabel="Today" bLabel="Yesterday" />
        </Panel>
        <Panel title="This week vs last week">
          <MetricTable metrics={comparePeriods(periodTotals(all.data, "week", now, 0), periodTotals(all.data, "week", now, -1))} aLabel="This week" bLabel="Last week" />
        </Panel>
        <Panel title="Last session vs the one before">
          {last && prev ? (
            <MetricTable metrics={compareSessions(last, prev)} aLabel="Last" bLabel="Before" />
          ) : (
            <EmptyState icon="chart" title="Needs two completed sessions" className="py-6" />
          )}
        </Panel>
      </div>
      <p className="text-2xs text-fg-subtle">Days and weeks use your local time; a session over midnight is split between days. Map completion and loot aren't recorded — Client.txt doesn't contain them.</p>
    </div>
  );
}
