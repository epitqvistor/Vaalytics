/** Zone intelligence: what a zone holds, where it leads, and your own history there. */
import { Panel } from "@/shared/components";
import type { RunStats } from "./engine/history";
import { formatDuration } from "./engine/history";
import type { CampaignProgress } from "./engine/progress";
import { campaignGraph } from "./hooks";
import { SectionLabel, StatusBadge } from "./ui";

export function ZonePanel({ zoneId, here, progress, stats }: { zoneId: string; here: boolean; progress: CampaignProgress; stats: RunStats | null }) {
  const g = campaignGraph();
  const zone = g.zone.get(zoneId)!;
  const objectives = g.objectivesInZone.get(zoneId) ?? [];
  const items = g.dataset.items.filter((i) => objectives.some((o) => o.id === i.from || o.id === i.usedBy));
  const from = g.dataset.zones.filter((z) => z.connects.includes(zoneId));
  const mine = stats?.zones.get(zoneId);
  const level = progress.level;
  const levels = [...new Set(zone.levels)].sort((a, b) => a - b);
  const gap = level != null && levels.length ? levels[0]! - level : null;
  const names = (ids: string[]) => ids.map((id) => g.zone.get(id)?.name ?? id).join(", ");

  return (
    <Panel title={`Zone — ${zone.name}`} actions={<span className="text-2xs text-fg-subtle">{here ? "You are here" : "Next objective's zone"}</span>}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <div>
          <dt className="text-2xs text-fg-subtle">Part</dt>
          <dd className="mt-0.5 text-fg">{g.part.get(zone.part)!.name.split(" — ")[0]}</dd>
        </div>
        <div>
          <dt className="text-2xs text-fg-subtle" title="Area levels seen in real logs; several values = it depends on the order you do things">
            Area level
          </dt>
          <dd className="mt-0.5 text-fg tabular-nums">
            {levels.length ? levels.join(" / ") : "—"}
            {gap != null && <span className="ml-1.5 text-fg-muted">({gap >= 0 ? "+" : ""}{gap} vs you)</span>}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-2xs text-fg-subtle">Leads to</dt>
          <dd className="mt-0.5 text-fg">
            {zone.connects.length ? names(zone.connects) : "—"}
            {zone.hubTravel && <span className="ml-1 text-fg-muted">· reached by {zone.part === "act4" ? "ship" : "the Desert Map"}</span>}
          </dd>
        </div>
        {from.length > 0 && (
          <div className="col-span-2">
            <dt className="text-2xs text-fg-subtle">Reached from</dt>
            <dd className="mt-0.5 text-fg">{names(from.map((z) => z.id))}</dd>
          </div>
        )}
      </dl>

      {objectives.length > 0 && (
        <div className="mt-4">
          <SectionLabel>Here</SectionLabel>
          <ul className="flex flex-col gap-1.5">
            {objectives.map((o) => (
              <li key={o.id} className="flex items-start justify-between gap-2 text-xs text-fg">
                <span className="min-w-0">
                  {o.title}
                  {o.rewards.length > 0 && <span className="ml-1.5 text-fg-muted">{o.rewards.map((r) => g.reward.get(r)!.label).join(", ")}</span>}
                </span>
                <StatusBadge progress={progress.objectives.get(o.id)} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-4">
          <SectionLabel>Quest items</SectionLabel>
          <ul className="flex flex-col gap-1 text-xs text-fg-muted">
            {items.map((i) => (
              <li key={i.id}>
                <span className="text-fg">{i.name}</span> — {i.hint}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <SectionLabel>Your history here</SectionLabel>
        {mine ? (
          <p className="text-xs text-fg-muted tabular-nums">
            {mine.visits} visit{mine.visits === 1 ? "" : "s"} · ~{formatDuration(mine.activeSeconds)} active · {mine.deaths} death{mine.deaths === 1 ? "" : "s"}
          </p>
        ) : (
          <p className="text-xs text-fg-muted">Not visited yet with this character.</p>
        )}
      </div>
    </Panel>
  );
}
