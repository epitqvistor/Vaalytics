/** Session timeline: area visits and events in order, with filters. */
import { useMemo, useState } from "react";
import type { AreaKind, SessionEvent, SessionEventKind, SessionVisit } from "@/core/ipc/commands";
import { Checkbox, EmptyState, Panel, Select } from "@/shared/components";
import { cn } from "@/shared/utilities/cn";
import { useSessionDetail, useSessionHistory } from "./hooks";
import { dur, fmtDateTime, fmtTime, KIND_LABEL } from "./stats";
import { COMPLETION_NOTE, KindBadge, SessionHeading } from "./ui";

const GAME = "poe2" as const;
const KINDS: AreaKind[] = ["map", "hideout", "town", "campaign", "content", "unknown"];

const EVENT_LABEL: Record<SessionEventKind, string> = {
  game_started: "Game started",
  game_closed: "Game closed",
  tracking_resumed: "Tracking resumed after a Vaalytics restart",
  recovered: "Session closed after recovery",
  client_log_opened: "Client started writing Client.txt",
  death: "Character slain (you or a party member)",
  level_up: "Character levelled up (you or a party member)",
  afk_on: "AFK on",
  afk_off: "AFK off",
  disconnect: "Abnormal disconnect",
  paused: "Tracking paused",
  resumed: "Tracking resumed",
  log_reset: "Client.txt reset",
  log_unavailable: "Client.txt unavailable",
};

type Row = { at: number; visit?: SessionVisit; event?: SessionEvent };

export function TimelineTab({ initialId }: { initialId: number | null }) {
  const list = useSessionHistory(GAME, { sort: "newest", limit: 60 });
  const [picked, setPicked] = useState<number | null>(null);
  const id = picked ?? initialId ?? list.data?.[0]?.id ?? null;
  const detail = useSessionDetail(GAME, id);
  const [kinds, setKinds] = useState<Set<AreaKind>>(() => new Set(KINDS));
  const [showEvents, setShowEvents] = useState(true);

  const d = detail.data?.detail;
  const rows = useMemo<Row[]>(() => {
    if (!d) return [];
    const r: Row[] = d.visits.filter((v) => kinds.has(v.kind)).map((v) => ({ at: v.enteredAt, visit: v }));
    if (showEvents) r.push(...d.events.map((e) => ({ at: e.at, event: e })));
    return r.sort((a, b) => a.at - b.at || (a.event ? 1 : 0) - (b.event ? 1 : 0));
  }, [d, kinds, showEvents]);

  const options = (list.data ?? []).map((s) => ({ value: String(s.id), label: `${fmtDateTime(s.startedAt)} · ${dur(s.durationSecs)}${s.status === "active" ? " · active" : ""}` }));
  if (id !== null && !options.some((o) => o.value === String(id))) options.unshift({ value: String(id), label: `Session ${id}` });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-4">
        {options.length > 0 && <Select label="Session" value={String(id ?? "")} onChange={(v) => setPicked(Number(v))} options={options} className="w-80" />}
        <div className="flex flex-wrap items-center gap-3 pb-1.5">
          {KINDS.map((k) => (
            <Checkbox
              key={k}
              label={KIND_LABEL[k]}
              checked={kinds.has(k)}
              onChange={(on) =>
                setKinds((prev) => {
                  const next = new Set(prev);
                  if (on) next.add(k);
                  else next.delete(k);
                  return next;
                })
              }
            />
          ))}
          <Checkbox label="Events" checked={showEvents} onChange={setShowEvents} />
        </div>
      </div>

      {list.error || detail.error ? (
        <Panel>
          <EmptyState icon="error" title="Couldn't load the session" body={list.error ?? detail.error} />
        </Panel>
      ) : !d ? (
        <Panel>
          <EmptyState icon="clock" title={list.data === null ? "Loading…" : "No sessions yet"} loading={list.data === null} body={list.data === null ? undefined : "Play Path of Exile 2 with Vaalytics running and your sessions appear here."} />
        </Panel>
      ) : (
        <>
          <Panel title="Session at a glance">
            <SessionHeading s={d.summary} />
            <Strip visits={d.visits} start={d.summary.startedAt} end={d.summary.endedAt ?? d.summary.lastActivityAt} />
          </Panel>
          <Panel title="Timeline" actions={<span>{rows.length} entries</span>} flush>
            {rows.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches the filters" className="py-8" />
            ) : (
              <ol className="max-h-[560px] divide-y divide-line overflow-y-auto">
                {rows.map((r, i) =>
                  r.visit ? (
                    <li key={`v${r.visit.id}`} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="tabular w-12 shrink-0 text-xs text-fg-subtle">{fmtTime(r.at)}</span>
                      <span className="min-w-0 flex-1 truncate text-fg" title={r.visit.areaId}>
                        Entered {r.visit.areaName ?? r.visit.areaId}
                        {r.visit.areaLevel !== null && <span className="ml-1.5 text-2xs text-fg-subtle">lvl {r.visit.areaLevel}</span>}
                      </span>
                      <KindBadge kind={r.visit.kind} />
                      <span className="tabular w-24 text-right text-xs text-fg-muted" title={r.visit.kind === "map" ? COMPLETION_NOTE : undefined}>
                        {r.visit.exitedAt === null ? "still here" : `left after ${dur(r.visit.exitedAt - r.visit.enteredAt)}`}
                      </span>
                    </li>
                  ) : (
                    <li key={`e${r.event!.id}-${i}`} className="flex items-center gap-3 bg-bg-2/40 px-4 py-1.5 text-xs">
                      <span className="tabular w-12 shrink-0 text-fg-subtle">{fmtTime(r.at)}</span>
                      <span className="flex-1 text-fg-muted">
                        {EVENT_LABEL[r.event!.kind] ?? r.event!.kind}
                        {r.event!.detail && <span className="text-fg-subtle"> · {r.event!.detail}</span>}
                      </span>
                    </li>
                  ),
                )}
              </ol>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

/** Session strip: map visits highlighted against all other areas. */
function Strip({ visits, start, end }: { visits: SessionVisit[]; start: number; end: number }) {
  const span = Math.max(1, end - start);
  const [hover, setHover] = useState<SessionVisit | null>(null);
  return (
    <div className="mt-4">
      <div className="relative h-5 overflow-hidden rounded-sm bg-glass" onPointerLeave={() => setHover(null)}>
        {visits.map((v) => {
          const a = Math.max(0, v.enteredAt - start);
          const b = Math.min(span, (v.exitedAt ?? end) - start);
          if (b <= a) return null;
          return (
            <span
              key={v.id}
              onPointerEnter={() => setHover(v)}
              className={cn("absolute top-0 h-full border-r-2 border-bg-2", v.kind === "map" ? "bg-accent/85" : "bg-fg-subtle/25")}
              style={{ left: `${(a / span) * 100}%`, width: `${((b - a) / span) * 100}%` }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-2xs text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-accent/85" /> Map
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-fg-subtle/25" /> Other areas
        </span>
        <span className="ml-auto tabular">
          {hover ? `${hover.areaName ?? hover.areaId} · ${fmtTime(hover.enteredAt)} · ${dur((hover.exitedAt ?? end) - hover.enteredAt)}` : `${fmtTime(start)} – ${fmtTime(end)}`}
        </span>
      </div>
    </div>
  );
}
