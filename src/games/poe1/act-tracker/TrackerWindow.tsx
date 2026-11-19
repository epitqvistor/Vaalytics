/**
 * Root of the Act Tracker overlay window (`#act-tracker`, PoE 1). Spec: docs/modules/act-tracker.md
 * Always on top, frameless, transparent background with the player's opacity; never takes focus from the game.
 * While hidden the body is unmounted, so nothing is read from Client.txt.
 */
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACT_TRACKER_STATE_EVENT,
  atlasOpen,
  actTrackerHide,
  actTrackerState,
  type ActTrackerWindowState,
} from "@/core/ipc/commands";
import { PreferencesProvider, usePreferences } from "@/core/settings/PreferencesContext";
import { ErrorBoundary, IconButton, Spinner } from "@/shared/components";
import { transition } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { useToolWindow } from "@/shared/window/ToolWindow";
import { areaName } from "./engine/route";
import type { GuardianReport, RewardStatus } from "./engine/guardian";
import { formatDuration, type CampaignTimes } from "./engine/timer";
import { useLiveExtra } from "./TimerPanels";
import { actProgress, currentObjective, nextSteps, townVisitAfter } from "./engine/view";
import { useTracker, useTrackerPrefs } from "./hooks";
import { WINDOW_KEY, type TrackerPrefs } from "./prefs";
import { HintLine, outsideName, PositionBadge, StepTagLabel, StepText, WayLine } from "./ui";

const GAME = "poe1" as const;
const COMPACT_HEIGHT = 44;

export default function TrackerWindow() {
  useEffect(() => {
    document.documentElement.classList.add("overlay-window");
    document.documentElement.dataset.game = GAME;
    document.title = "Act Tracker — Vaalytics";
  }, []);
  return (
    <PreferencesProvider>
      <MotionRoot>
        <ErrorBoundary>
          <Overlay />
        </ErrorBoundary>
      </MotionRoot>
    </PreferencesProvider>
  );
}

function MotionRoot({ children }: { children: React.ReactNode }) {
  const { prefs } = usePreferences();
  return (
    <MotionConfig reducedMotion={prefs.reduceMotion ? "always" : "user"} transition={transition.base}>
      {children}
    </MotionConfig>
  );
}

function useWindowState(): ActTrackerWindowState | null {
  const [state, setState] = useState<ActTrackerWindowState | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    void actTrackerState(GAME).then(setState).catch(() => {});
    const p = listen<ActTrackerWindowState>(ACT_TRACKER_STATE_EVENT, (e) => setState(e.payload));
    return () => void p.then((u) => u());
  }, []);
  return state;
}

function Overlay() {
  useToolWindow(WINDOW_KEY); // remembers position and size
  const win = useWindowState();
  const [prefs, setPrefs, loaded] = useTrackerPrefs();

  // Compact = one line: shrink the window; expanding restores a usable height.
  const setCompact = useCallback(
    async (compact: boolean) => {
      setPrefs({ ...prefs, compact });
      if (!isTauri()) return;
      const w = getCurrentWindow();
      const size = (await w.innerSize()).toLogical(await w.scaleFactor());
      await w.setSize(new LogicalSize(size.width, compact ? COMPACT_HEIGHT : Math.max(size.height, 420))).catch(() => {});
    },
    [prefs, setPrefs],
  );

  if (!loaded) return null;
  return (
    <div
      className="flex h-screen flex-col overflow-hidden rounded-lg border border-line-strong text-[13px] text-fg"
      style={{ backgroundColor: `rgb(15 16 19 / ${prefs.opacity})` }}
    >
      {/* Unmounted while hidden: no log reading in the background. */}
      {win && !win.visible ? null : <Body prefs={prefs} clickThrough={!!win?.clickThrough} onCompact={setCompact} />}
    </div>
  );
}

function Body({ prefs, clickThrough, onCompact }: { prefs: TrackerPrefs; clickThrough: boolean; onCompact: (c: boolean) => void }) {
  const t = useTracker(prefs);
  const { dataset, progress, steps } = t;
  const name = useCallback((id: string | null) => (dataset ? areaName(id, dataset.areas, dataset.route) : (id ?? "")), [dataset]);
  const objective = useMemo(() => (progress ? currentObjective(steps, progress, 6, t.show) : null), [steps, progress, t.show]);
  const upcoming = useMemo(() => (progress ? nextSteps(steps, progress, 5, t.show) : []), [steps, progress, t.show]);
  const isTown = useCallback((id: string) => !!dataset && (dataset.areas.get(id)?.kind === "town" || !!dataset.route.extraAreas[id]?.town), [dataset]);
  const visit = useMemo(() => (progress ? townVisitAfter(steps, objective, isTown, t.show) : null), [steps, objective, isTown, progress, t.show]);
  const act = useMemo(() => (progress ? actProgress(steps, progress) : null), [steps, progress]);
  const current = objective?.steps[0] ?? null;
  // The Atlas opens on the area you're in (if it's a campaign area), else where the guide continues.
  const pos = progress?.position;
  const atlasArea =
    pos && pos.kind !== "none" && pos.kind !== "outside" && dataset?.areas.has(pos.areaId) ? pos.areaId : objective && dataset?.areas.has(objective.area) ? objective.area : null;

  const header = (
    <header data-tauri-drag-region className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-3 pr-1">
      <Icon name="waypoint" size={14} className="shrink-0 text-accent" />
      <span data-tauri-drag-region className="min-w-0 flex-1 truncate text-xs font-medium text-fg-muted">
        {act ? `Act ${act.act}` : "Act Tracker"}
        {objective ? ` · ${name(objective.area)}` : ""}
      </span>
      {progress && !prefs.compact && <PositionBadge position={progress.position} name={(id) => name(id)} />}
      {clickThrough && (
        <span title="Click-through is on: clicks go to the game. Turn it off on the Act Tracker page in Vaalytics." className="text-fg-subtle">
          <Icon name="cursor" size={13} />
        </span>
      )}
      {atlasArea && <IconButton size="sm" icon="atlas" label={`Open ${name(atlasArea)} in the Location Atlas`} onClick={() => void atlasOpen(GAME, atlasArea).catch(() => {})} />}
      <IconButton size="sm" icon={prefs.compact ? "chevronDown" : "compact"} label={prefs.compact ? "Expand" : "Compact bar"} onClick={() => onCompact(!prefs.compact)} />
      <IconButton size="sm" icon="close" label="Hide (the hotkey shows it again)" onClick={() => void actTrackerHide(GAME)} />
    </header>
  );

  if (!dataset || !progress) {
    const problem = t.issues.find((i) => i.severity === "error") ?? null;
    return (
      <>
        {header}
        <div className="flex flex-1 items-center justify-center gap-2 p-4 text-center text-xs text-fg-muted">
          {problem ? (
            `Campaign data problem: ${problem.where}: ${problem.message}`
          ) : t.tracking.error ? (
            <span>
              Can't read your PoE 1 Client.txt: {t.tracking.error}
              <br />
              Choose it on the Location Atlas page in Vaalytics.
            </span>
          ) : t.tracking.characters && !t.tracking.character ? (
            "No PoE 1 character in your Client.txt yet. Enter the game — the tracker follows the character you play."
          ) : (
            <>
              <Spinner /> Reading your Client.txt…
            </>
          )}
        </div>
      </>
    );
  }

  if (prefs.compact) {
    return (
      <header data-tauri-drag-region className="flex h-full items-center gap-2 pl-3 pr-1">
        <Icon name="waypoint" size={14} className="shrink-0 text-accent" />
        <span data-tauri-drag-region className="min-w-0 flex-1 truncate">
          <span className="text-fg-muted">{act ? `A${act.act} ` : ""}</span>
          {current ? current.text : "Campaign route complete"}
          {objective?.nextLocation && <span className="text-fg-muted"> → {name(objective.nextLocation)}</span>}
        </span>
        <IconButton size="sm" icon="chevronDown" label="Expand" onClick={() => onCompact(false)} />
        <IconButton size="sm" icon="close" label="Hide" onClick={() => void actTrackerHide(GAME)} />
      </header>
    );
  }

  const position = progress.position;
  const banner =
    position.kind === "off-route"
      ? `You're in ${name(position.areaId)} — not the next area of the route. The guide continues in ${name(objective?.area ?? null)}.`
      : position.kind === "town-visit" && objective && position.areaId !== objective.area
        ? `Town visit — the guide continues in ${name(objective.area)}.`
        : position.kind === "outside"
          ? `In ${outsideName(position.areaId, position.areaName)} — outside the campaign. The guide continues in ${name(objective?.area ?? null)}.`
          : null;

  return (
    <>
      {header}
      <div className="flex-1 overflow-y-auto px-3 py-2.5">
        {banner && (
          <p
            className={cn(
              "mb-2 rounded-md border px-2 py-1.5 text-[11px]",
              position.kind === "off-route" ? "border-warning/25 bg-warning-soft text-warning" : "border-line bg-glass text-fg-muted",
            )}
          >
            {banner}
            {t.way && (
              <span className="mt-0.5 block text-fg-muted">
                <WayLine way={t.way} name={(id) => name(id)} />
              </span>
            )}
          </p>
        )}
        {current ? (
          <section aria-label="Current objective">
            <div className="text-[10px] font-semibold tracking-[0.1em] text-fg-subtle">CURRENT OBJECTIVE</div>
            <div className="mt-0.5 text-[15px] font-semibold text-fg">{name(objective!.area)}</div>
            <ol className="mt-1.5 space-y-1">
              {objective!.steps.map((s, k) => (
                <li key={s.id} className="flex items-start gap-1.5">
                  <span className={cn("w-4 shrink-0 text-right tabular-nums", k === 0 ? "text-accent" : "text-fg-subtle")}>{k + 1}.</span>
                  <StepText step={s} muted={k > 0} priority={t.priorities[s.index]} />
                </li>
              ))}
            </ol>
            {prefs.hints && current.hints.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 pl-5" aria-label="Community hints">
                {current.hints.map((h, k) => (
                  <HintLine key={k} text={h.text} direction={h.direction} />
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                className="rounded-md border border-accent/30 bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent-2 hover:bg-accent/25"
                onClick={() => void t.mark(current, "done")}
                title="Mark this step done (the log can't see kills, items or hand-ins)"
              >
                <Icon name="check" size={11} className="mr-1 inline" />
                Done
              </button>
              <button
                type="button"
                className="rounded-md border border-line px-2 py-1 text-[11px] text-fg-muted hover:bg-glass-hover"
                onClick={() => void t.mark(current, "skipped")}
              >
                Skip
              </button>
              {objective!.nextLocation && (
                <span className="ml-auto truncate text-[11px] text-fg-muted">
                  NEXT LOCATION: <span className="text-fg">{name(objective!.nextLocation)}</span>
                </span>
              )}
            </div>
            {visit && visit.handIns.length > 0 && (
              <p className="mt-1.5 text-[11px] text-fg-muted">
                In {name(visit.town)}, hand in:{" "}
                {visit.handIns.map((h, k) => (
                  <span key={h.id} className={t.priorities[h.index]?.priority === "PERMANENT_POWER" ? "text-accent-2" : undefined}>
                    {k > 0 ? ", " : ""}
                    {(h.quests ?? []).map((q) => q.name).join(" + ")}
                  </span>
                ))}
              </p>
            )}
          </section>
        ) : (
          <p className="text-fg-muted">You reached the end of the campaign route.</p>
        )}

        {upcoming.length > 1 && (
          <section aria-label="Next steps" className="mt-3 border-t border-line pt-2">
            <ul className="space-y-1">
              {upcoming.map(({ step, tag }) => (
                <li key={step.id} className="flex items-start text-[12px]">
                  <StepTagLabel tag={tag} />
                  <StepText step={step} muted={tag === "UPCOMING"} priority={t.priorities[step.index]} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {t.report && <RewardSummary report={t.report} />}
        {t.markError && <p className="mt-2 text-[11px] text-danger">{t.markError}</p>}
      </div>
      <footer className="flex shrink-0 items-center gap-3 border-t border-line px-3 py-1.5 text-[11px] text-fg-muted tabular-nums">
        {act && (
          <span>
            Act {act.act}: {act.done}/{act.total}
          </span>
        )}
        <span>Campaign {Math.floor(progress.fraction * 100)}%</span>
        {t.times && <Clock times={t.times} />}
        <span className="ml-auto truncate" title="Character followed (from Client.txt)">
          {t.tracking.character?.name}
        </span>
      </footer>
    </>
  );
}


/** Reward tracker: visible but below the instructions — the points, and the warnings that need action. */
function RewardSummary({ report }: { report: GuardianReport }) {
  const urgent = report.warnings.filter((w) => w.severity !== "info").slice(0, 3);
  const count = (st: RewardStatus) => report.rewards.filter((r) => r.status === st && !r.notExpected && (r.reward.type === "passive-points" || r.reward.type === "bandit-choice")).length;
  return (
    <section aria-label="Rewards" className="mt-3 border-t border-line pt-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-fg-muted">
        <span>
          Passive points <span className="font-semibold text-accent-2 tabular-nums">{report.passive.completed}</span>
          <span className="tabular-nums">/{report.passive.expected}</span>
        </span>
        {report.passive.fromPassives !== null && <span className="tabular-nums">/passives {report.passive.fromPassives}</span>}
        {count("MISSED") > 0 && <span className="text-danger">{count("MISSED")} missed</span>}
        {count("NEEDS_CONFIRMATION") > 0 && <span className="text-warning">{count("NEEDS_CONFIRMATION")} to confirm</span>}
      </div>
      {urgent.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {urgent.map((w, k) => (
            <li key={k} className={cn("flex items-start gap-1", w.severity === "danger" ? "text-danger" : "text-warning")}>
              <Icon name="warning" size={11} className="mt-[2px] shrink-0" />
              <span className="line-clamp-2">{w.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Campaign and act time (estimate from log timestamps; ticks while you're playing). */
function Clock({ times }: { times: CampaignTimes }) {
  const extra = useLiveExtra(times);
  const act = times.acts[times.acts.length - 1];
  return (
    <span title="Estimate from Client.txt timestamps; breaks over 30 minutes aren't counted.">
      ≈ {formatDuration(times.campaignSeconds + extra)}
      {act && !act.finishedAt ? ` · A${act.act} ${formatDuration(act.activeSeconds + extra)}` : ""}
    </span>
  );
}
