/**
 * Campaign timer and run history on the Act Tracker page, plus the live clock used by the overlay.
 * All times are estimates from Client.txt timestamps (breaks over 30 minutes don't count) and say so.
 */
import { useEffect, useState } from "react";
import { Badge, Panel, ProvenanceTag } from "@/shared/components";
import { cn } from "@/shared/utilities/cn";
import { bestActs, BREAK_GAP_S, formatDuration, liveExtra, type CampaignTimes, type RunSummary } from "./engine/timer";

const ESTIMATE = {
  kind: "estimate" as const,
  source: "Client.txt timestamps",
  at: null,
  note: `Active time = gaps between log lines; a gap over ${BREAK_GAP_S / 60} minutes is a break and isn't counted.`,
};

/** Seconds to add for the time since the last log line, ticking once a second while it's recent. */
export function useLiveExtra(times: CampaignTimes | null): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const live = !!times?.current && times.finishedAt === null;
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  return times ? liveExtra(times, now) : 0;
}

export function TimerPanel({ times, name }: { times: CampaignTimes; name: (id: string | null) => string }) {
  const extra = useLiveExtra(times);
  const total = times.campaignSeconds + extra;
  const currentAct = times.acts[times.acts.length - 1];
  const topAreas = times.areas.filter((a) => a.kind === "area").slice(0, 6);
  return (
    <Panel title="Campaign timer" actions={<ProvenanceTag provenance={ESTIMATE} />}>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fig label={times.finishedAt ? "Campaign (finished)" : "Campaign so far"} value={formatDuration(total)} caption={times.fromStart ? "from The Twilight Strand" : "log starts mid-campaign"} />
        <Fig
          label={currentAct ? `Act ${currentAct.act}` : "Act"}
          value={currentAct ? formatDuration(currentAct.activeSeconds + (currentAct.finishedAt ? 0 : extra)) : "—"}
          caption={currentAct?.finishedAt ? "finished" : "in progress"}
        />
        <Fig label="In towns" value={formatDuration(times.townSeconds)} caption={`average area visit ${times.averageAreaSeconds !== null ? formatDuration(times.averageAreaSeconds) : "—"}`} />
        <Fig label="Hideout · away" value={`${formatDuration(times.hideoutSeconds)} · ${formatDuration(times.awaySeconds)}`} caption={`${times.breaks} break${times.breaks === 1 ? "" : "s"} not counted`} />
      </div>
      <table className="w-full text-xs tabular-nums">
        <thead className="text-xs text-fg-subtle">
          <tr>
            <th className="py-1 text-left font-semibold">Act</th>
            <th className="py-1 text-right font-semibold">Time</th>
            <th className="py-1 text-right font-semibold">In town</th>
            <th className="py-1 text-right font-semibold">Comparable</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {times.acts.map((a) => (
            <tr key={a.act} className="text-fg-muted">
              <td className="py-1 text-fg">Act {a.act}</td>
              <td className="py-1 text-right text-fg">{formatDuration(a.activeSeconds + (a.finishedAt ? 0 : extra))}</td>
              <td className="py-1 text-right">{formatDuration(a.townSeconds)}</td>
              <td className="py-1 text-right" title={a.timed ? "The log covers the whole act." : "The log doesn't cover the whole act (or it isn't finished), so it isn't compared."}>
                {a.timed ? "yes" : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {topAreas.length > 0 && (
        <p className="mt-3 text-2xs text-fg-subtle">
          Most time: {topAreas.map((a) => `${name(a.area)} ${formatDuration(a.activeSeconds)}${a.visits > 1 ? ` (${a.visits}×)` : ""}`).join(" · ")}
        </p>
      )}
      <p className="mt-1 text-2xs text-fg-subtle">
        Hideout / away: after you leave the campaign the log keeps only the first area outside it, so all of that time is shown there.
      </p>
    </Panel>
  );
}

function Fig({ label, value, caption }: { label: string; value: React.ReactNode; caption: string }) {
  return (
    <div className="rounded-md border border-line bg-bg-2 px-3 py-2">
      <div className="text-xs font-medium text-fg-muted">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-fg">{value}</div>
      <div className="truncate text-2xs text-fg-subtle">{caption}</div>
    </div>
  );
}

export function HistoryPanel({ runs, error, currentId }: { runs: RunSummary[] | null; error: string | null; currentId: number | null }) {
  const best = runs ? bestActs(runs) : [];
  return (
    <Panel title="Run history" actions={<ProvenanceTag provenance={ESTIMATE} />}>
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : !runs ? (
        <p className="text-xs text-fg-muted">Reading your characters…</p>
      ) : runs.length === 0 ? (
        <p className="text-xs text-fg-muted">No PoE 1 campaign runs in your Client.txt yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs tabular-nums">
            <thead className="text-xs text-fg-subtle">
              <tr>
                <th className="py-1 text-left font-semibold">Character</th>
                <th className="py-1 text-right font-semibold">Campaign</th>
                {Array.from({ length: 10 }, (_, k) => (
                  <th key={k} className="py-1 text-right font-semibold">
                    A{k + 1}
                  </th>
                ))}
                <th className="py-1 text-right font-semibold">Quest pts</th>
                <th className="py-1 text-right font-semibold">Deaths</th>
                <th className="py-1 text-right font-semibold">Skipped</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.map((r) => {
                const complete = r.times.fromStart && r.times.finishedAt !== null;
                return (
                  <tr key={r.characterId} className={cn("text-fg-muted", r.characterId === currentId && "bg-accent-soft")}>
                    <td className="py-1.5 pr-2 text-fg">
                      {r.name} <span className="text-fg-subtle">· {r.class} {r.level}</span>
                    </td>
                    <td className="py-1.5 text-right" title={complete ? "Whole campaign in the log." : "Not a whole campaign in the log — not comparable."}>
                      {complete ? <span className="text-fg">{formatDuration(r.times.campaignSeconds)}</span> : r.times.finishedAt ? "partial" : "in progress"}
                    </td>
                    {Array.from({ length: 10 }, (_, k) => {
                      const a = r.times.acts.find((x) => x.act === k + 1);
                      const isBest = best[k]?.best?.characterId === r.characterId;
                      return (
                        <td key={k} className={cn("py-1.5 text-right", isBest && "font-semibold text-accent-2")} title={a && !a.timed ? "Not comparable (the log doesn't cover the whole act)" : undefined}>
                          {a ? (a.timed ? formatDuration(a.activeSeconds) : <span className="text-fg-disabled">{formatDuration(a.activeSeconds)}</span>) : "—"}
                        </td>
                      );
                    })}
                    <td className="py-1.5 text-right" title={r.pointsFromPassives !== null ? "From your last /passives" : "Point lines in the log"}>
                      {r.pointsFromPassives ?? r.pointsInLog}
                      {r.pointsFromPassives !== null && <Badge tone="success" className="ml-1">/passives</Badge>}
                    </td>
                    <td className="py-1.5 text-right">{r.deaths}</td>
                    <td className="py-1.5 text-right">{r.skipped}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-2xs text-fg-subtle">
            One row per character (a character's campaign is one run). Highlighted: the fastest comparable time per act. Grey times aren't comparable — the log
            doesn't cover that act from start to finish.
          </p>
        </div>
      )}
    </Panel>
  );
}
