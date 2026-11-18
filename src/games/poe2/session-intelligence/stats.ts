/**
 * Session analytics computed from recorded session summaries. Pure functions,
 * no I/O. Map figures only use sessions whose Client.txt was read
 * (`logTracked`); a session without the log has unknown maps, not zero.
 * Spec: docs/modules/session-intelligence.md
 */
import type { AreaKind, SessionSummary } from "@/core/ipc/commands";

/** Fewer sessions than this: trends and comparisons show an honest empty state. */
export const MIN_SESSIONS_FOR_TRENDS = 2;

export const KIND_LABEL: Record<AreaKind, string> = {
  map: "Maps",
  hideout: "Hideout",
  town: "Town",
  campaign: "Campaign",
  content: "League content",
  unknown: "Other areas",
};

/** Downtime = time in hideout and town (between maps, trading, crafting). */
export const downtimeSecs = (s: Pick<SessionSummary, "hideoutSecs" | "townSecs">) => s.hideoutSecs + s.townSecs;

export function perHour(count: number, secs: number): number | null {
  return secs >= 60 ? count / (secs / 3600) : null;
}

export function avgMapSecs(s: Pick<SessionSummary, "mapSecs" | "mapsEntered">): number | null {
  return s.mapsEntered > 0 ? s.mapSecs / s.mapsEntered : null;
}

export function kindBreakdown(s: SessionSummary): { kind: AreaKind; secs: number }[] {
  const rows: { kind: AreaKind; secs: number }[] = [
    { kind: "map", secs: s.mapSecs },
    { kind: "hideout", secs: s.hideoutSecs },
    { kind: "town", secs: s.townSecs },
    { kind: "campaign", secs: s.campaignSecs },
    { kind: "content", secs: s.contentSecs },
    { kind: "unknown", secs: s.unknownSecs },
  ];
  return rows.filter((r) => r.secs > 0).sort((a, b) => b.secs - a.secs);
}

export interface Totals {
  sessions: number;
  /** Sessions with Client.txt data (maps known). */
  tracked: number;
  durationSecs: number;
  trackedSecs: number;
  maps: number;
  mapSecs: number;
  downtimeSecs: number;
  afkSecs: number;
  deaths: number;
  mapsPerHour: number | null;
  avgMapSecs: number | null;
  /** Share of tracked time spent in hideout/town (0–1). */
  downtimeShare: number | null;
}

export function totals(sessions: readonly SessionSummary[]): Totals {
  const tracked = sessions.filter((s) => s.logTracked);
  const sum = (xs: readonly SessionSummary[], f: (s: SessionSummary) => number) => xs.reduce((a, s) => a + f(s), 0);
  const trackedSecs = sum(tracked, (s) => s.durationSecs);
  const maps = sum(tracked, (s) => s.mapsEntered);
  const mapSecs = sum(tracked, (s) => s.mapSecs);
  const down = sum(tracked, downtimeSecs);
  return {
    sessions: sessions.length,
    tracked: tracked.length,
    durationSecs: sum(sessions, (s) => s.durationSecs),
    trackedSecs,
    maps,
    mapSecs,
    downtimeSecs: down,
    afkSecs: sum(tracked, (s) => s.afkSecs),
    deaths: sum(tracked, (s) => s.deaths),
    mapsPerHour: tracked.length ? perHour(maps, trackedSecs) : null,
    avgMapSecs: maps > 0 ? mapSecs / maps : null,
    downtimeShare: trackedSecs > 0 ? down / trackedSecs : null,
  };
}

// ---------- calendar buckets (local time) ----------

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday 00:00 local of the week containing `ms`. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

const addDays = (ms: number, n: number) => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

const endOf = (s: SessionSummary) => (s.endedAt ?? s.lastActivityAt) * 1000;

/** Seconds of `s` that fall inside [fromMs, toMs). Sessions spanning midnight are split. */
export function overlapSecs(s: SessionSummary, fromMs: number, toMs: number): number {
  const a = Math.max(s.startedAt * 1000, fromMs);
  const b = Math.min(endOf(s), toMs);
  return b > a ? (b - a) / 1000 : 0;
}

export interface Bucket {
  key: string;
  label: string;
  startMs: number;
  playedSecs: number;
  /** Maps of tracked sessions that started in this bucket. */
  maps: number;
  sessions: number;
}

function bucketize(sessions: readonly SessionSummary[], starts: number[], next: (ms: number) => number, label: (ms: number) => string): Bucket[] {
  return starts.map((start) => {
    const end = next(start);
    const started = sessions.filter((s) => s.startedAt * 1000 >= start && s.startedAt * 1000 < end);
    return {
      key: dayKey(new Date(start)),
      label: label(start),
      startMs: start,
      playedSecs: sessions.reduce((a, s) => a + overlapSecs(s, start, end), 0),
      maps: started.filter((s) => s.logTracked).reduce((a, s) => a + s.mapsEntered, 0),
      sessions: started.length,
    };
  });
}

const shortDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { month: "short", day: "numeric" });

/** The last `days` calendar days ending today (oldest first). */
export function byDay(sessions: readonly SessionSummary[], days: number, nowMs: number): Bucket[] {
  const today = startOfDay(nowMs);
  const starts = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  return bucketize(sessions, starts, (ms) => addDays(ms, 1), shortDate);
}

/** The last `weeks` ISO weeks (Monday start) ending with the current one. */
export function byWeek(sessions: readonly SessionSummary[], weeks: number, nowMs: number): Bucket[] {
  const cur = startOfWeek(nowMs);
  const starts = Array.from({ length: weeks }, (_, i) => addDays(cur, (i - weeks + 1) * 7));
  return bucketize(sessions, starts, (ms) => addDays(ms, 7), (ms) => `Week of ${shortDate(ms)}`);
}

// ---------- comparisons ----------

export interface Metric {
  id: string;
  label: string;
  a: number | null;
  b: number | null;
  /** "time" = seconds, "count", "rate" = per hour. */
  unit: "time" | "count" | "rate";
  /** Whether a higher value is better (colours the change); null = neutral. */
  higherIsBetter: boolean | null;
}

/** Side-by-side metrics of two sessions (a = newer/selected, b = baseline). */
export function compareSessions(a: SessionSummary, b: SessionSummary): Metric[] {
  const maps = (s: SessionSummary) => (s.logTracked ? s.mapsEntered : null);
  const mph = (s: SessionSummary) => (s.logTracked ? perHour(s.mapsEntered, s.durationSecs) : null);
  const avg = (s: SessionSummary) => (s.logTracked ? avgMapSecs(s) : null);
  const down = (s: SessionSummary) => (s.logTracked ? downtimeSecs(s) : null);
  return [
    { id: "duration", label: "Session time", a: a.durationSecs, b: b.durationSecs, unit: "time", higherIsBetter: null },
    { id: "maps", label: "Maps entered", a: maps(a), b: maps(b), unit: "count", higherIsBetter: true },
    { id: "mph", label: "Maps per hour", a: mph(a), b: mph(b), unit: "rate", higherIsBetter: true },
    { id: "avgMap", label: "Avg time in a map", a: avg(a), b: avg(b), unit: "time", higherIsBetter: null },
    { id: "downtime", label: "Hideout + town", a: down(a), b: down(b), unit: "time", higherIsBetter: false },
    { id: "afk", label: "AFK", a: a.logTracked ? a.afkSecs : null, b: b.logTracked ? b.afkSecs : null, unit: "time", higherIsBetter: false },
    { id: "deaths", label: "Deaths*", a: a.logTracked ? a.deaths : null, b: b.logTracked ? b.deaths : null, unit: "count", higherIsBetter: false },
  ];
}

/** Totals of two periods as comparable metrics (a = current, b = previous). */
export function comparePeriods(a: Totals, b: Totals): Metric[] {
  return [
    { id: "time", label: "Time played", a: a.durationSecs, b: b.durationSecs, unit: "time", higherIsBetter: null },
    { id: "sessions", label: "Sessions", a: a.sessions, b: b.sessions, unit: "count", higherIsBetter: null },
    { id: "maps", label: "Maps entered", a: a.tracked ? a.maps : null, b: b.tracked ? b.maps : null, unit: "count", higherIsBetter: true },
    { id: "mph", label: "Maps per hour", a: a.mapsPerHour, b: b.mapsPerHour, unit: "rate", higherIsBetter: true },
    { id: "avgMap", label: "Avg time in a map", a: a.avgMapSecs, b: b.avgMapSecs, unit: "time", higherIsBetter: null },
    { id: "downtime", label: "Hideout + town", a: a.tracked ? a.downtimeSecs : null, b: b.tracked ? b.downtimeSecs : null, unit: "time", higherIsBetter: false },
  ];
}

/** Relative change a vs b, or null when it can't be computed. */
export function change(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return (a - b) / b;
}

/** Sessions that overlap [fromMs, toMs). */
export const inRange = (sessions: readonly SessionSummary[], fromMs: number, toMs: number) =>
  sessions.filter((s) => s.startedAt * 1000 < toMs && endOf(s) > fromMs);

/** Sessions that started in [fromMs, toMs) — for counting sessions and maps per period. */
export const startedIn = (sessions: readonly SessionSummary[], fromMs: number, toMs: number) =>
  sessions.filter((s) => s.startedAt * 1000 >= fromMs && s.startedAt * 1000 < toMs);

export function periodTotals(sessions: readonly SessionSummary[], period: "day" | "week", nowMs: number, offset: 0 | -1): Totals {
  const start = period === "day" ? addDays(startOfDay(nowMs), offset) : addDays(startOfWeek(nowMs), offset * 7);
  const end = period === "day" ? addDays(start, 1) : addDays(start, 7);
  const t = totals(startedIn(sessions, start, end));
  // Time played counts the part of every session inside the period.
  t.durationSecs = sessions.reduce((a, s) => a + overlapSecs(s, start, end), 0);
  return t;
}

// ---------- formatting ----------

export function clock(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** "1h 05m", "12m", "45s" — compact durations for tables. */
export function dur(totalSecs: number | null): string {
  if (totalSecs === null || !Number.isFinite(totalSecs)) return "—";
  const s = Math.max(0, Math.round(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

export function formatMetric(v: number | null, unit: Metric["unit"]): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (unit === "time") return dur(v);
  if (unit === "rate") return v.toFixed(1);
  return String(Math.round(v));
}

export const fmtTime = (unixSecs: number) => new Date(unixSecs * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
export const fmtDateTime = (unixSecs: number) =>
  new Date(unixSecs * 1000).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
