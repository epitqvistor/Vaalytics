/** Missed objectives and one efficient return trip. */
import { useMemo } from "react";
import { Badge, Button, EmptyState, Panel } from "@/shared/components";
import type { CampaignProgress } from "./engine/progress";
import { missedObjectives, recoveryRoute } from "./engine/recovery";
import { campaignGraph } from "./hooks";
import { RewardChip, SectionLabel } from "./ui";

export function RecoveryTab({
  progress,
  onDone,
  onReset,
  busy,
}: {
  progress: CampaignProgress;
  onDone: (objectiveId: string) => void;
  /** Removes the player's skip so the objective is recommended again. */
  onReset: (objectiveId: string) => void;
  busy: boolean;
}) {
  const g = campaignGraph();
  const missed = useMemo(() => missedObjectives(g, progress), [g, progress]);
  const stops = useMemo(() => recoveryRoute(g, progress, missed), [g, progress, missed]);

  if (!missed.length) {
    return (
      <Panel>
        <EmptyState icon="success" title="Nothing missed so far" body="No reward-bearing objective has been skipped or left behind for this character." />
      </Panel>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
      <Panel title={`Possibly missed (${missed.length})`} flush>
        <p className="border-b border-line px-4 py-2.5 text-2xs text-fg-subtle">
          The game log can't prove most rewards were claimed. If you've already done one, mark it done — it won't be listed again.
        </p>
        <ul className="divide-y divide-line">
          {missed.map((m) => (
            <li key={m.objective.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm text-fg">
                    {m.objective.title}
                    <Badge tone={m.advice === "now" ? "success" : "neutral"}>{m.advice === "now" ? "Do it now" : "Later"}</Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {m.zone.name} · {g.part.get(m.objective.part)!.name} · {m.explanation}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.rewards.map((r) => (
                      <RewardChip key={r.id} reward={r} />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-fg-muted">{m.adviceText}</p>
                  {m.route.length > 0 && m.missingPrerequisites.length === 0 && (
                    <p className="mt-1 text-2xs text-fg-subtle">Route: {m.route.join(" ")}</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" icon="check" disabled={busy} onClick={() => onDone(m.objective.id)}>
                    Already done
                  </Button>
                  {m.reason === "skipped" && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => onReset(m.objective.id)}>
                      Un-skip
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Return trip">
        {stops.length === 0 ? (
          <p className="text-xs text-fg-muted">Everything listed still needs a prerequisite first.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {stops.map((s, i) => (
              <li key={s.zone.id}>
                <SectionLabel>
                  Stop {i + 1} · {s.zone.name}
                </SectionLabel>
                <p className="text-xs text-fg-muted">{s.steps.join(" ")}</p>
                <ul className="mt-1.5 flex flex-col gap-0.5 text-sm text-fg">
                  {s.objectives.map((o) => (
                    <li key={o.id}>• {o.title}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-2xs text-fg-subtle">Ordered nearest-next by logical travel steps (waypoints, hubs, walking) — not distances.</p>
      </Panel>
    </div>
  );
}
