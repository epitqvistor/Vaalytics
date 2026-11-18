/** Quest journal: every objective with its status and why; correct the engine or undo your own marks. */
import { useMemo, useState } from "react";
import type { CampaignMark } from "@/core/ipc/commands";
import { Badge, Button, Panel, SegmentedControl, Select } from "@/shared/components";
import type { PartId } from "./data/types";
import type { CampaignProgress } from "./engine/progress";
import { campaignGraph } from "./hooks";
import { SectionLabel, StatusBadge } from "./ui";

type Filter = "all" | "open" | "done" | "skipped" | "marked";
const FILTERS = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
  { value: "skipped", label: "Skipped" },
  { value: "marked", label: "Marked by you" },
] as const;
const MARK_LABEL: Record<CampaignMark["mark"], string> = { done: "Done", skipped: "Skipped", "not-done": "Not done" };

const when = (at: number) => new Date(at * 1000).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

export function JournalTab({
  progress,
  marks,
  busy,
  onMark,
}: {
  progress: CampaignProgress;
  marks: CampaignMark[];
  busy: boolean;
  onMark: (id: string, mark: CampaignMark["mark"] | null) => void;
}) {
  const g = campaignGraph();
  const [filter, setFilter] = useState<Filter>("all");
  const here = progress.currentZone ? g.zone.get(progress.currentZone)!.part : null;
  const [part, setPart] = useState<PartId | "all">(here ?? "all");
  const markOf = useMemo(() => new Map(marks.map((m) => [m.objectiveId, m])), [marks]);
  const recent = useMemo(() => [...marks].sort((a, b) => b.at - a.at).slice(0, 15), [marks]);

  const shown = g.dataset.objectives.filter((o) => {
    if (part !== "all" && o.part !== part) return false;
    const s = progress.objectives.get(o.id)?.status;
    switch (filter) {
      case "open":
        return s === "available" || s === "locked";
      case "done":
        return s === "done";
      case "skipped":
        return s === "skipped";
      case "marked":
        return markOf.has(o.id);
      default:
        return true;
    }
  });
  const parts = g.dataset.parts.filter((p) => shown.some((o) => o.part === p.id));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
      <Panel
        title="Quest journal"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label="Part"
              hideLabel
              size="sm"
              value={part}
              onChange={(v) => setPart(v as PartId | "all")}
              options={[{ value: "all", label: "Whole campaign" }, ...g.dataset.parts.map((p) => ({ value: p.id, label: p.name.split(" — ")[0]! }))]}
            />
            <SegmentedControl label="Filter" size="sm" value={filter} onChange={setFilter} segments={FILTERS} />
          </div>
        }
        flush
      >
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-fg-muted">Nothing matches this filter.</p>
        ) : (
          parts.map((p) => (
            <section key={p.id}>
              <p className="border-b border-line bg-bg-2 px-4 py-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{p.name}</p>
              <ul className="divide-y divide-line">
                {shown
                  .filter((o) => o.part === p.id)
                  .map((o) => {
                    const pr = progress.objectives.get(o.id);
                    const m = markOf.get(o.id);
                    return (
                      <li key={o.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm text-fg">
                            {o.title}
                            {o.kind === "optional" && <Badge tone="neutral">Optional</Badge>}
                            <StatusBadge progress={pr} />
                          </p>
                          <p className="mt-0.5 text-xs text-fg-muted">
                            {g.zone.get(o.zone)!.name}
                            {pr?.evidence ? ` · ${pr.evidence}` : ""}
                            {pr?.choice ? ` · chose ${pr.choice}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {pr?.status !== "done" && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMark(o.id, "done")}>
                              Done
                            </Button>
                          )}
                          {pr?.status !== "done" && pr?.status !== "skipped" && o.kind === "optional" && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMark(o.id, "skipped")}>
                              Skip
                            </Button>
                          )}
                          {pr?.status === "done" && pr.source !== "manual" && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMark(o.id, "not-done")} title="The log suggests this is done, but it isn't">
                              Not done
                            </Button>
                          )}
                          {m && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMark(o.id, null)} title="Remove your mark and go back to automatic detection">
                              Undo
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </section>
          ))
        )}
      </Panel>

      <div className="flex flex-col gap-5">
        <Panel title="Your recent marks">
          {recent.length === 0 ? (
            <p className="text-xs text-fg-muted">No marks yet — everything shown comes from your Client.txt.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {recent.map((m) => (
                <li key={m.objectiveId} className="flex items-center gap-2 text-xs text-fg">
                  <span className="min-w-0 flex-1">
                    {g.objective.get(m.objectiveId)?.title ?? m.objectiveId}
                    <span className="ml-1.5 text-fg-muted">
                      {MARK_LABEL[m.mark]}
                      {m.choice ? ` (${m.choice})` : ""} · {when(m.at)}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => onMark(m.objectiveId, null)}>
                    Undo
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-2xs text-fg-subtle">Undo removes your mark; the objective goes back to what the log shows.</p>
        </Panel>
        <Panel title="How statuses are set">
          <SectionLabel>Inferred</SectionLabel>
          <p className="text-xs text-fg-muted">
            From your log: a zone you can only reach after the objective, passive points received where it is claimed, or your class changing to an Ascendancy.
          </p>
          <SectionLabel>
            <span className="mt-3 block">Marked by you</span>
          </SectionLabel>
          <p className="text-xs text-fg-muted">Client.txt doesn't record quests, so optional objectives usually need your mark. Your mark always wins.</p>
        </Panel>
      </div>
    </div>
  );
}
