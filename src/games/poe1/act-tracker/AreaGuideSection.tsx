/**
 * Act Tracker section for one area, for embedding in the Location Atlas area details:
 *   <ActTrackerAreaGuide areaId={selected.id} tracking={tracking} />
 * It reuses the caller's `useAtlasTracking` result (no second log sync) and reads the Act Tracker's own route,
 * preferences and marks. Steps, quests and rewards only — no positions (Client.txt has none).
 */
import { useMemo } from "react";
import type { AtlasTracking } from "@/games/poe1/location-atlas/hooks";
import { Badge } from "@/shared/components";
import { cn } from "@/shared/utilities/cn";
import { areaGuide } from "./engine/area";
import { areaName } from "./engine/route";
import { STATUS_LABEL, STATUS_TONE } from "./GuardianPanel";
import { useTrackerDataset, useTrackerPrefs, useTrackerWith } from "./hooks";
import { EVIDENCE_LABEL, StepText } from "./ui";

export function ActTrackerAreaGuide({ areaId, tracking }: { areaId: string; tracking: AtlasTracking }) {
  const [prefs] = useTrackerPrefs();
  const { dataset, issues } = useTrackerDataset();
  const t = useTrackerWith(prefs, dataset, issues, tracking);
  const guide = useMemo(() => (t.steps.length ? areaGuide(areaId, t.steps, t.progress, t.priorities, t.report) : null), [areaId, t.steps, t.progress, t.priorities, t.report]);
  if (!dataset || !guide) return null;
  const name = (id: string | null) => areaName(id, dataset.areas, dataset.route);
  const shown = guide.steps.filter((g) => g.step.to || t.show(g.step));
  if (shown.length === 0 && guide.rewards.length === 0) return <p className="text-xs text-fg-subtle">Act Tracker: the levelling route doesn't stop in this area.</p>;

  return (
    <section aria-label="Act Tracker" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-2xs font-semibold tracking-wide text-fg-subtle uppercase">Act Tracker — your route here</span>
        {guide.isGuideArea && (
          <Badge tone="accent" dot>
            The guide is here
          </Badge>
        )}
        <span className="text-2xs text-fg-subtle">{guide.remaining} step{guide.remaining === 1 ? "" : "s"} left</span>
      </div>
      {guide.rewards.length > 0 && (
        <ul className="flex flex-col gap-1">
          {guide.rewards.map(({ state, role }) => (
            <li key={state.reward.id} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-fg">{state.reward.pantheon ? state.reward.pantheon.god : state.reward.quest}</span>
              {state.reward.points !== null && <span className="font-semibold text-accent-2">+{state.reward.points}</span>}
              <span className="text-fg-subtle">{role === "objective" ? "objective here" : `hand in here${state.reward.npc ? ` (${state.reward.npc})` : ""}`}</span>
              <Badge tone={STATUS_TONE[state.status]}>{STATUS_LABEL[state.status]}</Badge>
            </li>
          ))}
        </ul>
      )}
      <ol className="flex flex-col gap-0.5 text-xs">
        {shown.map((g) => (
          <li key={g.step.id} className={cn("flex items-start gap-2 rounded px-1.5 py-0.5", g.current && "bg-accent-soft")}>
            <span
              className={cn(
                "mt-[5px] size-1.5 shrink-0 rounded-full",
                g.progress?.status === "done" ? "bg-success" : g.current ? "bg-accent" : g.progress?.status === "passed" ? "bg-fg-subtle" : "bg-line-strong",
              )}
              title={g.progress?.evidence ? EVIDENCE_LABEL[g.progress.evidence] : "To do"}
            />
            <StepText step={g.step} muted={!g.current} priority={g.priority ?? undefined} />
          </li>
        ))}
      </ol>
      {(guide.routeIn.length > 0 || guide.routeOut.length > 0) && (
        <p className="text-2xs text-fg-subtle">
          {guide.routeIn.length > 0 && `Route comes from ${guide.routeIn.map(name).join(", ")}. `}
          {guide.routeOut.length > 0 && `Route goes on to ${guide.routeOut.map(name).join(", ")}.`}
        </p>
      )}
    </section>
  );
}
