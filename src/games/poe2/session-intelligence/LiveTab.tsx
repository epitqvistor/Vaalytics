/** Live overview: tracker state, the current session, the current area and the last summary. */
import { useState } from "react";
import { sessionCheckNow, sessionSetPaused, type SessionStatus } from "@/core/ipc/commands";
import { Button, EmptyState, Panel, ProvenanceTag, StatTile, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { useLiveSeconds, useSessionDetail } from "./hooks";
import { clock, dur, fmtTime, formatMetric, perHour } from "./stats";
import { COMPLETION_NOTE, DEATHS_NOTE, KindBadge, MapRunsTable, SessionFigures, SessionHeading, StateBadge, TimeBreakdown, VersusPrevious } from "./ui";

const GAME = "poe2" as const;

export function LiveTab({ status, setStatus, goTo }: { status: SessionStatus; setStatus: (s: SessionStatus) => void; goTo: (tab: "settings" | "history" | "timeline") => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const active = status.activeSession;
  const elapsed = useLiveSeconds(active?.startedAt ?? null, active !== null);
  const areaSecs = useLiveSeconds(status.currentArea?.enteredAt ?? null, active !== null);
  const detailId = active?.id ?? status.lastCompletedId;
  const detail = useSessionDetail(GAME, detailId ?? null);

  const act = async (f: () => Promise<SessionStatus>) => {
    setBusy(true);
    try {
      setStatus(await f());
    } catch (e) {
      notify("warning", "Couldn't update tracking", String(e));
    } finally {
      setBusy(false);
    }
  };

  const recent = detail.data?.detail.visits.slice(-8).reverse() ?? [];
  const runs = detail.data?.detail.mapRuns ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={
          <span className="flex items-center gap-2">
            Tracking <StateBadge state={status.state} />
          </span>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" icon="refresh" disabled={busy} onClick={() => act(() => sessionCheckNow(GAME))}>
              Check now
            </Button>
            {active && (
              <Button size="sm" icon={status.paused ? "play" : "pause"} disabled={busy} onClick={() => act(() => sessionSetPaused(GAME, !status.paused))}>
                {status.paused ? "Resume" : "Pause"}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-xs">
          <div>
            <p className="text-2xs text-fg-subtle">Game process</p>
            <p className="mt-0.5 text-sm text-fg">{status.process ? `Running since ${fmtTime(status.process.startedAt)}` : "Not running"}</p>
          </div>
          <div className="min-w-0">
            <p className="text-2xs text-fg-subtle">Client.txt</p>
            <p className="mt-0.5 truncate text-sm text-fg">
              {status.log.found ? status.log.label : "Not found"}
              {status.log.found && <span className="ml-2 text-2xs text-fg-subtle">{status.log.manual ? "chosen by you" : "found automatically"}</span>}
            </p>
          </div>
          <div className="ml-auto self-center">
            <ProvenanceTag provenance={{ kind: "user", source: "Your game (process + Client.txt)", at: null, note: "Recorded on this PC; nothing is sent anywhere." }} />
          </div>
        </div>
        {status.message && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-line bg-bg-2/60 px-3 py-2 text-xs text-fg-muted">
            <Icon name={status.state === "error" ? "error" : status.state === "reconnecting" ? "warning" : "info"} size={14} className="mt-px shrink-0" />
            <span className="flex-1">{status.message}</span>
            {(status.state === "error" || status.state === "reconnecting") && (
              <Button size="sm" variant="secondary" onClick={() => goTo("settings")}>
                Settings
              </Button>
            )}
          </p>
        )}
      </Panel>

      {active ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Session time" value={clock(elapsed)} caption={`since ${fmtTime(active.startedAt)}`} />
            <StatTile label="Maps entered" value={active.logTracked ? active.mapsEntered : "—"} caption="distinct map instances" />
            <StatTile label="Maps per hour" value={active.logTracked ? formatMetric(perHour(active.mapsEntered, elapsed), "rate") : "—"} />
            <StatTile label="Hideout + town" value={active.logTracked ? dur(active.hideoutSecs + active.townSecs) : "—"} caption="downtime so far" />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Panel title="Current area">
              {status.currentArea ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-semibold text-fg">{status.currentArea.areaName ?? status.currentArea.areaId}</span>
                    <KindBadge kind={status.currentArea.kind} />
                    {status.currentArea.areaLevel !== null && <span className="text-xs text-fg-subtle">Level {status.currentArea.areaLevel}</span>}
                  </div>
                  <p className="text-xs text-fg-muted">
                    Entered {fmtTime(status.currentArea.enteredAt)} · <span className="tabular text-fg">{status.currentArea.exitedAt === null ? clock(areaSecs) : dur(status.currentArea.exitedAt - status.currentArea.enteredAt)}</span> here
                  </p>
                  {status.currentArea.kind === "map" && <p className="text-2xs text-fg-subtle">{COMPLETION_NOTE}</p>}
                </div>
              ) : (
                <p className="text-xs text-fg-muted">{active.logTracked ? "No area change seen yet in this session." : "Area tracking needs Client.txt."}</p>
              )}
              <h3 className="mt-5 mb-2 text-xs font-semibold text-fg">Time by area type</h3>
              <TimeBreakdown session={active} />
            </Panel>
            <Panel
              title="Recent areas"
              actions={
                <Button size="sm" variant="ghost" iconRight="chevronRight" onClick={() => goTo("timeline")}>
                  Timeline
                </Button>
              }
              flush
            >
              {recent.length === 0 ? (
                <EmptyState icon="map" title="No areas yet" body="Areas appear here as you move between them." className="py-8" />
              ) : (
                <ul className="divide-y divide-line">
                  {recent.map((v) => (
                    <li key={v.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="tabular w-12 text-xs text-fg-subtle">{fmtTime(v.enteredAt)}</span>
                      <span className="min-w-0 flex-1 truncate text-fg">{v.areaName ?? v.areaId}</span>
                      <KindBadge kind={v.kind} />
                      <span className="tabular w-16 text-right text-xs text-fg-muted">{v.exitedAt === null ? "now" : dur(v.exitedAt - v.enteredAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          {runs.length > 0 && (
            <Panel title="Maps this session">
              <MapRunsTable runs={runs} />
            </Panel>
          )}
          <p className="text-2xs text-fg-subtle">* {DEATHS_NOTE}</p>
        </>
      ) : detail.data ? (
        <Panel
          title="Last session summary"
          actions={
            <Button size="sm" variant="ghost" iconRight="chevronRight" onClick={() => goTo("history")}>
              History
            </Button>
          }
        >
          <SessionHeading s={detail.data.detail.summary} />
          <SessionFigures s={detail.data.detail.summary} className="mt-4" />
          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold text-fg">Compared with the previous session</h3>
              <VersusPrevious s={detail.data.detail.summary} previous={detail.data.previous} />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-fg">Time by area type</h3>
              <TimeBreakdown session={detail.data.detail.summary} />
            </div>
          </div>
        </Panel>
      ) : (
        <Panel>
          <EmptyState
            icon="clock"
            title={status.process ? "Path of Exile 2 is running" : "Start Path of Exile 2 to begin a session"}
            body="Vaalytics notices the game starting and closing, reads Client.txt (read-only) for the areas you enter, and saves each session here. Nothing in the game is touched."
          />
        </Panel>
      )}
    </div>
  );
}
