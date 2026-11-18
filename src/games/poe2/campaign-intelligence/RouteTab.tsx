/** Route planner: everything still worth doing here, as an ordered list of trips. */
import { useMemo } from "react";
import { Badge, EmptyState, Panel } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { CampaignProgress } from "./engine/progress";
import { planRoute } from "./engine/plan";
import { importanceWithItems, type ModeSettings } from "./engine/recommend";
import { campaignGraph } from "./hooks";
import { MODE_LABEL } from "./settings";
import { ImportanceBadge, SectionLabel } from "./ui";

export function RouteTab({ progress, settings }: { progress: CampaignProgress; settings: ModeSettings }) {
  const g = campaignGraph();
  const plan = useMemo(() => planRoute(g, progress, settings), [g, progress, settings]);
  const title = plan.parts.map((p) => g.part.get(p)!.name.split(" — ")[0]).join(" · ");

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <Panel title={`Route plan — ${title}`} actions={<Badge tone="neutral">{MODE_LABEL[settings.mode]}</Badge>}>
        {plan.trips.length === 0 ? (
          <EmptyState icon="success" title="Nothing left to plan here" body="Everything this mode pursues in this part is done or skipped." />
        ) : (
          <ol className="flex flex-col gap-5">
            {plan.trips.map((t, i) => (
              <li key={`${t.destination.id}-${i}`} className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-line bg-bg-2 text-2xs text-fg-muted tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">
                    {t.destination.name}
                    {t.zones.length > 1 && <span className="ml-1.5 text-xs font-normal text-fg-muted">({t.zones.map((z) => z.name).join(" → ")})</span>}
                  </p>
                  {t.steps.length > 0 && <p className="mt-0.5 text-xs text-fg-subtle">{t.steps.join(" ")}</p>}
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {t.objectives.map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm text-fg">
                        <Icon name="chevronRight" size={12} className="text-fg-subtle" />
                        {o.title}
                        <ImportanceBadge importance={importanceWithItems(g, o)} />
                        {o.rewards.map((r) => (
                          <span key={r} className="text-xs text-fg-muted">
                            {g.reward.get(r)!.label}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <div className="flex flex-col gap-5">
        <Panel title="How this plan works">
          <ul className="flex flex-col gap-2 text-xs text-fg-muted">
            {plan.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <Icon name="info" size={13} className="mt-px shrink-0" />
                {n}
              </li>
            ))}
            <li className="flex gap-2">
              <Icon name="info" size={13} className="mt-px shrink-0" />
              Trips are ordered nearest-next by logical travel steps (walking, waypoints, the caravan or ship), only once their prerequisites are met. No
              distances or map positions are known.
            </li>
          </ul>
        </Panel>
        {plan.blocked.length > 0 && (
          <Panel title="Not plannable yet">
            <SectionLabel>Waiting for something outside this plan</SectionLabel>
            <ul className="flex flex-col gap-1 text-xs text-fg-muted">
              {plan.blocked.map((o) => (
                <li key={o.id}>
                  {o.title} — needs {o.requires.map((r) => g.objective.get(r)!.title).join("; ") || "its area to open"}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
