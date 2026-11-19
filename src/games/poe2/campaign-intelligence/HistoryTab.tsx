/** Run history: time per part, deaths, timeline, and your runs compared (personal bests). */
import { useEffect, useMemo, useState } from "react";
import { campaignEvents, campaignMarks, type CampaignCharacter, type CampaignRewardMark } from "@/core/ipc/commands";
import { missedObjectives } from "./engine/recovery";
import { rewardStatuses } from "./engine/rewards";
import { Badge, Button, EmptyState, Panel, ProvenanceTag, StatTile } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { toEngineEvents } from "./engine/events";
import { BREAK_GAP_S, campaignTimeline, formatDuration, personalBests, runStats, type RunRow, type RunStats, type TimelineKind } from "./engine/history";
import { deriveProgress, type CampaignEvent, type CampaignProgress } from "./engine/progress";
import { campaignGraph } from "./hooks";
import { SectionLabel } from "./ui";

const GAME = "poe2" as const;
const KIND_ICON: Record<TimelineKind, IconName> = { part: "map", objective: "success", ascended: "star", death: "warning", level: "chevronRight" };
const when = (at: number) => new Date(at * 1000).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
/** Timeline rows shown while collapsed (newest first). */
const COLLAPSED_ROWS = 8;
const ESTIMATE = {
  kind: "estimate" as const,
  source: "Your Client.txt timestamps",
  at: null,
  note: `Active time = time between log events while in a campaign area; gaps over ${BREAK_GAP_S / 60} min count as breaks. Finishing times come from the log only — a part you marked done by hand has no time.`,
};

export function HistoryTab({
  character,
  characters,
  events,
  progress,
  rewardMarks,
}: {
  character: CampaignCharacter;
  characters: CampaignCharacter[];
  events: CampaignEvent[];
  progress: CampaignProgress;
  rewardMarks: CampaignRewardMark[];
}) {
  const g = campaignGraph();
  const stats = useMemo(() => runStats(g, events, progress), [g, events, progress]);
  const timeline = useMemo(() => campaignTimeline(g, events, progress).reverse(), [g, events, progress]);
  const [expanded, setExpanded] = useState(false);
  const { runs, error: runsError } = useRuns(characters, character.id, stats);
  const pb = useMemo(() => (runs ? personalBests(runs) : null), [runs]);
  const summary = useMemo(() => {
    const optional = g.dataset.objectives.filter((o) => o.kind === "optional");
    const rewards = rewardStatuses(g, progress, rewardMarks);
    return {
      optionalDone: optional.filter((o) => progress.objectives.get(o.id)?.status === "done").length,
      optionalTotal: optional.length,
      rewardsEarned: rewards.filter((r) => r.bucket === "earned").length,
      rewardsTotal: rewards.length,
      missed: missedObjectives(g, progress).length,
    };
  }, [g, progress, rewardMarks]);
  const deathZones = [...stats.zones.values()].filter((z) => z.deaths > 0).sort((a, b) => b.deaths - a.deaths).slice(0, 6);
  const started = stats.parts.filter((p) => p.firstAt !== null);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active time" value={formatDuration(stats.activeSeconds)} caption="estimate, campaign areas only" />
        <StatTile label="Acts 1–4" value={stats.campaignSeconds !== null ? formatDuration(stats.campaignSeconds) : "In progress"} caption={pb?.campaign ? `PB ${formatDuration(pb.campaign)}` : "no finished run yet"} />
        <StatTile label="Deaths" value={stats.deaths} caption="in campaign areas" />
        <StatTile label="Level" value={progress.level ?? character.level} caption={stats.startedAt ? `started ${when(stats.startedAt)}` : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title={`Time per part — ${character.name}`} actions={<ProvenanceTag provenance={ESTIMATE} />} flush>
            {started.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-fg-muted">No campaign areas logged yet.</p>
            ) : (
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="text-2xs text-fg-subtle">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 text-left font-medium">Part</th>
                    <th className="px-2 py-2 text-right font-medium">Level in → out</th>
                    <th className="px-2 py-2 text-right font-medium">Active time</th>
                    <th className="px-2 py-2 text-right font-medium">Deaths</th>
                    <th className="px-4 py-2 text-right font-medium">Personal best</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {started.map((p) => {
                    const best = pb?.parts.get(p.part);
                    const isBest = p.timed && best !== undefined && best === p.activeSeconds;
                    return (
                      <tr key={p.part} className="text-fg">
                        <td className="px-4 py-2">
                          {g.part.get(p.part)!.name.split(" — ")[0]}
                          {!p.finished && <span className="ml-1.5 text-fg-muted">in progress</span>}
                          {p.finished && !p.timed && (
                            <span className="ml-1.5 text-fg-muted" title="The log doesn't cover this whole part (e.g. history starts mid-campaign), so it isn't compared.">
                              partly logged
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {p.levelIn ?? "?"} → {p.levelOut ?? (p.finished ? "?" : "…")}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatDuration(p.activeSeconds)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{p.deaths}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {isBest ? (
                            <Badge tone="success">PB</Badge>
                          ) : best !== undefined ? (
                            <span className="text-fg-muted">
                              {formatDuration(best)}
                              {p.timed && <span className="ml-1">(+{formatDuration(p.activeSeconds - best)})</span>}
                            </span>
                          ) : (
                            <span className="text-fg-subtle">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Panel>

        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="This run" actions={<ProvenanceTag provenance={ESTIMATE} />}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              {[
                ["Time in towns", formatDuration(stats.townSeconds)],
                ["Backtracking", formatDuration(stats.revisitSeconds), "Time in areas you had already moved on from and came back to. Portal trips to town and back don't count."],
                ["Optional objectives done", `${summary.optionalDone} / ${summary.optionalTotal}`],
                ["Permanent rewards earned", `${summary.rewardsEarned} / ${summary.rewardsTotal}`],
                ["Possibly missed", String(summary.missed)],
                ["Breaks detected", String(stats.breaks), `Gaps over ${BREAK_GAP_S / 60} min between log events (client closed, AFK, disconnects).`],
              ].map(([label, value, title]) => (
                <div key={label}>
                  <dt className="text-2xs text-fg-subtle" title={title}>
                    {label}
                  </dt>
                  <dd className="mt-0.5 text-sm text-fg tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-2xs text-fg-subtle">XP per hour isn't shown: Client.txt has no experience lines. League isn't recorded with campaign events, so runs are compared by character.</p>
          </Panel>

          <Panel
            title="Timeline"
            actions={
              timeline.length > COLLAPSED_ROWS && (
                <Button size="sm" variant="ghost" iconRight={expanded ? "chevronUp" : "chevronDown"} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
                  {expanded ? "Collapse" : `Show all ${timeline.length}`}
                </Button>
              )
            }
          >
            {timeline.length === 0 ? (
              <p className="text-xs text-fg-muted">Nothing logged yet.</p>
            ) : (
              <>
                {/* Expanded: the full list scrolls inside the panel instead of stretching the page. */}
                <ol className={expanded ? "-mr-2 flex max-h-[420px] flex-col gap-1.5 overflow-y-auto pr-2" : "flex flex-col gap-1.5"}>
                  {(expanded ? timeline : timeline.slice(0, COLLAPSED_ROWS)).map((t, i) => (
                    <li key={`${t.at}-${i}`} className="flex items-start gap-2 text-xs">
                      <Icon name={KIND_ICON[t.kind]} size={12} className={t.kind === "death" ? "mt-0.5 shrink-0 text-warning" : "mt-0.5 shrink-0 text-fg-subtle"} />
                      <span className="min-w-0 flex-1 text-fg">
                        {t.text}
                        {t.manual && <span className="ml-1 text-fg-subtle">(your mark)</span>}
                      </span>
                      <span className="shrink-0 text-2xs text-fg-subtle tabular-nums">{when(t.at)}</span>
                    </li>
                  ))}
                </ol>
                {!expanded && timeline.length > COLLAPSED_ROWS && (
                  <p className="mt-2 text-2xs text-fg-subtle">
                    Latest {COLLAPSED_ROWS} of {timeline.length}.
                  </p>
                )}
                <p className="mt-2 text-2xs text-fg-subtle">Objective times are when the log first proved them — e.g. entering the zone they open.</p>
              </>
            )}
          </Panel>
          {deathZones.length > 0 && (
            <Panel title="Where you died">
              <ul className="flex flex-col gap-1 text-xs">
                {deathZones.map((z) => (
                  <li key={z.zone} className="flex justify-between gap-2 text-fg">
                    {g.zone.get(z.zone)!.name}
                    <span className="text-fg-muted tabular-nums">{z.deaths}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      {runsError && <p className="text-xs text-warning">Couldn't load your other characters for the comparison: {runsError}</p>}
      <RunComparison runs={runs} pb={pb} current={character.id} />
    </div>
  );
}

/** Loads every character's events and marks once (explicit tab visit), for the comparison. */
function useRuns(characters: CampaignCharacter[], currentId: number, current: RunStats): { runs: RunRow[] | null; error: string | null } {
  const [others, setOthers] = useState<RunRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = characters
    .filter((c) => !c.hidden && c.campaignZones > 0)
    .map((c) => c.id)
    .join(",");
  useEffect(() => {
    let cancelled = false;
    const list = characters.filter((c) => !c.hidden && c.campaignZones > 0 && c.id !== currentId);
    Promise.all(
      list.map(async (c) => {
        const [ev, mk] = await Promise.all([campaignEvents(GAME, c.id), campaignMarks(GAME, c.id)]);
        const e = toEngineEvents(ev);
        const p = deriveProgress(
          campaignGraph(),
          e,
          mk.map((m) => ({ objective: m.objectiveId, mark: m.mark, at: m.at, choice: m.choice ?? undefined })),
        );
        return { characterId: c.id, name: `${c.name} · ${c.class}`, stats: runStats(campaignGraph(), e, p) };
      }),
    )
      .then((r) => !cancelled && setOthers(r))
      .catch((e) => {
        if (cancelled) return;
        setOthers([]);
        setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, currentId]);
  const me = characters.find((c) => c.id === currentId);
  const runs = useMemo(
    () => (others ? [{ characterId: currentId, name: `${me?.name ?? "?"} · ${me?.class ?? "?"}`, stats: current }, ...others] : null),
    [others, current, currentId, me?.name, me?.class],
  );
  return { runs, error };
}

const COLUMNS = [
  { id: "act1", label: "Act 1" },
  { id: "act2", label: "Act 2" },
  { id: "act3", label: "Act 3" },
  { id: "act4", label: "Act 4" },
] as const;

function RunComparison({ runs, pb, current }: { runs: RunRow[] | null; pb: ReturnType<typeof personalBests> | null; current: number }) {
  if (!runs) return <EmptyState icon="chart" title="Loading your runs…" loading />;
  const cell = (secs: number | null, best: number | null | undefined, finished: boolean) =>
    !finished || secs === null ? (
      <span className="text-fg-subtle">—</span>
    ) : (
      <span className={best === secs ? "font-medium text-success" : "text-fg"}>{formatDuration(secs)}</span>
    );
  return (
    <Panel title="Your runs compared" actions={<ProvenanceTag provenance={ESTIMATE} />} flush>
      <div className="overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="text-2xs text-fg-subtle">
            <tr className="border-b border-line">
              <th className="px-4 py-2 text-left font-medium">Character</th>
              {COLUMNS.map((c) => (
                <th key={c.id} className="px-2 py-2 text-right font-medium">
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Acts 1–4</th>
              <th className="px-2 py-2 text-right font-medium">Interludes</th>
              <th className="px-3 py-2 text-right font-medium">Deaths</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {runs.map((r) => (
              <tr key={r.characterId} className={r.characterId === current ? "bg-bg-2" : undefined}>
                <td className="min-w-[140px] px-4 py-2 whitespace-normal text-fg">{r.name}</td>
                {COLUMNS.map((c) => {
                  const p = r.stats.parts.find((x) => x.part === c.id)!;
                  return (
                    <td key={c.id} className="px-2 py-2 text-right tabular-nums">
                      {cell(p.activeSeconds, pb?.parts.get(c.id), p.timed)}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-right tabular-nums">{cell(r.stats.campaignSeconds, pb?.campaign, r.stats.campaignSeconds !== null)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{cell(r.stats.interludeSeconds, pb?.interludes, r.stats.interludeSeconds !== null)}</td>
                <td className="px-3 py-2 text-right text-fg tabular-nums">{r.stats.deaths}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-4 py-2">
        <SectionLabel>How to read this</SectionLabel>
        <p className="text-2xs text-fg-subtle">
          Green = personal best. Only parts the log covers from start to finish are compared; “—” = not finished, or the log starts mid-way (imported history, a character created before tracking). Party play and breaks shorter than{" "}
          {BREAK_GAP_S / 60} min are counted as active time.
        </p>
      </div>
    </Panel>
  );
}
