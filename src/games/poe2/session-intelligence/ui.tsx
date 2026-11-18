/** Building blocks shared by the Session Intelligence tabs. */
import type { ReactNode } from "react";
import type { AreaKind, SessionMapRun, SessionSummary, SessionTrackState } from "@/core/ipc/commands";
import { Badge, type BadgeTone } from "@/shared/components";
import { formatChange } from "@/shared/utilities/format";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { change, compareSessions, dur, fmtDateTime, fmtTime, formatMetric, KIND_LABEL, kindBreakdown, perHour, type Metric } from "./stats";

export const STATE_META: Record<SessionTrackState, { label: string; tone: BadgeTone }> = {
  not_detected: { label: "Game not detected", tone: "neutral" },
  detected: { label: "Game detected", tone: "accent" },
  tracking: { label: "Tracking", tone: "success" },
  reading_log: { label: "Reading Client.txt", tone: "info" },
  reconnecting: { label: "Reconnecting to the log", tone: "warning" },
  paused: { label: "Paused", tone: "neutral" },
  completed: { label: "Session completed", tone: "info" },
  error: { label: "Error", tone: "danger" },
};

export function StateBadge({ state }: { state: SessionTrackState }) {
  const m = STATE_META[state];
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

export function KindBadge({ kind }: { kind: AreaKind }) {
  const tone: BadgeTone = kind === "map" ? "accent" : kind === "unknown" ? "neutral" : kind === "content" ? "info" : "neutral";
  return <Badge tone={tone}>{KIND_LABEL[kind] === "Maps" ? "Map" : KIND_LABEL[kind]}</Badge>;
}

/** Note shown wherever completion would be expected. */
export const COMPLETION_NOTE = "Map completion isn't available: Client.txt only shows entering and leaving areas, not whether a map was finished.";
export const DEATHS_NOTE = "Client.txt names the character but not whether it's you or a party member.";

export function KeyValue({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs text-fg-subtle" title={hint}>
        {label}
      </p>
      <p className="tabular mt-0.5 truncate text-sm font-semibold text-fg">{value}</p>
    </div>
  );
}

/** Horizontal bars of time per area kind (one hue: magnitude, labelled). */
export function TimeBreakdown({ session }: { session: SessionSummary }) {
  const rows = kindBreakdown(session);
  const total = rows.reduce((a, r) => a + r.secs, 0);
  if (!session.logTracked) return <p className="text-xs text-fg-muted">Area times need Client.txt — none were recorded for this session.</p>;
  if (total === 0) return <p className="text-xs text-fg-muted">No areas recorded yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.kind} className="grid grid-cols-[110px_minmax(0,1fr)_64px] items-center gap-3 text-xs">
          <span className="text-fg-muted">{KIND_LABEL[r.kind]}</span>
          <span className="h-2 overflow-hidden rounded-full bg-white/[0.04]">
            <span className="block h-full rounded-full bg-accent/80" style={{ width: `${Math.max(2, (r.secs / total) * 100)}%` }} />
          </span>
          <span className="tabular text-right text-fg">{dur(r.secs)}</span>
        </li>
      ))}
    </ul>
  );
}

export function MetricTable({ metrics, aLabel, bLabel }: { metrics: Metric[]; aLabel: string; bLabel: string }) {
  return (
    <div role="table" className="text-sm">
      <div role="row" className="grid h-8 grid-cols-[minmax(0,1fr)_96px_96px_80px] items-center gap-3 border-b border-line text-xs text-fg-subtle">
        <span>Metric</span>
        <span className="text-right">{aLabel}</span>
        <span className="text-right">{bLabel}</span>
        <span className="text-right">Change</span>
      </div>
      {metrics.map((m) => {
        const c = change(m.a, m.b);
        return (
          <div key={m.id} role="row" className="grid min-h-9 grid-cols-[minmax(0,1fr)_96px_96px_80px] items-center gap-3 border-b border-line last:border-b-0">
            <span className="text-fg-muted" title={m.id === "deaths" ? DEATHS_NOTE : undefined}>
              {m.label}
            </span>
            <span className="tabular text-right text-fg">{formatMetric(m.a, m.unit)}</span>
            <span className="tabular text-right text-fg-muted">{formatMetric(m.b, m.unit)}</span>
            <span className="text-right text-xs">
              <ChangeCell change={c} higherIsBetter={m.higherIsBetter} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Signed change (the real direction) with an arrow; colour says whether it's good, when that is defined. */
export function ChangeCell({ change: c, higherIsBetter }: { change: number | null; higherIsBetter: boolean | null }) {
  if (c === null) return <span className="text-fg-subtle">—</span>;
  const flat = Math.abs(c) < 0.0005;
  const good = higherIsBetter === null || flat ? null : higherIsBetter ? c > 0 : c < 0;
  return (
    <span className={cn("tabular inline-flex items-center gap-0.5 font-medium", good === null ? "text-fg-muted" : good ? "text-success" : "text-danger")}>
      {!flat && <Icon name={c > 0 ? "chevronUp" : "chevronDown"} size={12} />}
      {formatChange(c)}
    </span>
  );
}

export function MapRunsTable({ runs }: { runs: SessionMapRun[] }) {
  if (runs.length === 0) return <p className="text-xs text-fg-muted">No maps entered in this session.</p>;
  return (
    <div role="table" className="text-sm">
      <div role="row" className="grid h-8 grid-cols-[minmax(0,1fr)_56px_72px_72px_92px] items-center gap-3 border-b border-line text-xs text-fg-subtle">
        <span>Map</span>
        <span className="text-right">Level</span>
        <span className="text-right">Entered</span>
        <span className="text-right">Inside</span>
        <span className="text-right" title={COMPLETION_NOTE}>
          Completed
        </span>
      </div>
      {runs.map((r, i) => (
        <div key={i} role="row" className="grid min-h-9 grid-cols-[minmax(0,1fr)_56px_72px_72px_92px] items-center gap-3 border-b border-line last:border-b-0">
          <span className="min-w-0 truncate text-fg" title={r.areaId}>
            {r.areaName ?? r.areaId}
            {r.entries > 1 && <span className="ml-1.5 text-2xs text-fg-subtle">×{r.entries} entries</span>}
          </span>
          <span className="tabular text-right text-fg-muted">{r.areaLevel ?? "—"}</span>
          <span className="tabular text-right text-fg-muted">{fmtTime(r.firstEnteredAt)}</span>
          <span className="tabular text-right text-fg">{dur(r.insideSecs)}</span>
          <span className="text-right text-2xs text-fg-subtle" title={COMPLETION_NOTE}>
            Unavailable
          </span>
        </div>
      ))}
    </div>
  );
}

/** Headline figures of one session. */
export function SessionFigures({ s, className }: { s: SessionSummary; className?: string }) {
  const tracked = s.logTracked;
  return (
    <div className={cn("grid grid-cols-2 gap-4 sm:grid-cols-4", className)}>
      <KeyValue label="Session time" value={dur(s.durationSecs)} />
      <KeyValue label="Maps entered" value={tracked ? s.mapsEntered : "—"} hint="Distinct map instances (same map re-entered counts once)" />
      <KeyValue label="Maps per hour" value={tracked ? formatMetric(perHour(s.mapsEntered, s.durationSecs), "rate") : "—"} />
      <KeyValue label="Avg time in a map" value={tracked && s.mapsEntered > 0 ? dur(s.mapSecs / s.mapsEntered) : "—"} />
      <KeyValue label="Hideout + town" value={tracked ? dur(s.hideoutSecs + s.townSecs) : "—"} />
      <KeyValue label="Loading screens" value={tracked ? dur(s.loadingSecs) : "—"} />
      <KeyValue label="AFK" value={tracked ? dur(s.afkSecs) : "—"} />
      <KeyValue label="Deaths*" value={tracked ? s.deaths : "—"} hint={DEATHS_NOTE} />
    </div>
  );
}

export function SessionHeading({ s }: { s: SessionSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      <span className="text-fg">{fmtDateTime(s.startedAt)}</span>
      <span>→ {s.endedAt ? fmtTime(s.endedAt) : "now"}</span>
      {s.status === "active" && <Badge tone="success" dot>Active</Badge>}
      {s.endReason === "recovered" && (
        <Badge tone="warning">
          <span title="Vaalytics wasn't running when the game closed; the session ends at the last recorded activity.">Recovered</span>
        </Badge>
      )}
      {!s.logTracked && <Badge tone="warning">No Client.txt data</Badge>}
    </div>
  );
}

/** Comparison of a session with the previous one. */
export function VersusPrevious({ s, previous }: { s: SessionSummary; previous: SessionSummary | null }) {
  if (!previous)
    return (
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Icon name="info" size={13} /> No earlier session to compare with yet.
      </p>
    );
  return <MetricTable metrics={compareSessions(s, previous)} aLabel="This session" bLabel={`Previous (${fmtDateTime(previous.startedAt)})`} />;
}
