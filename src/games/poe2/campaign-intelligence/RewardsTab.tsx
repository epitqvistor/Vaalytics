/** Permanent Reward Guardian: every campaign reward with its own claim state. */
import { useMemo } from "react";
import type { CampaignRewardStage } from "@/core/ipc/commands";
import { Badge, Panel, Select, type BadgeTone } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { CampaignRewardMark } from "@/core/ipc/commands";
import type { CampaignProgress } from "./engine/progress";
import { heldItemWarnings, REWARD_STATE_LABEL, rewardStatuses, rewardTotals, TRACK_LABEL, TRACK_UNIT, type RewardState, type RewardStatus } from "./engine/rewards";
import { campaignGraph } from "./hooks";
import { provenanceText } from "./ui";

const STATE_TONE: Record<RewardState, BadgeTone> = {
  "not-available": "neutral",
  available: "neutral",
  "in-progress": "info",
  "boss-defeated": "info",
  "item-acquired": "info",
  submitted: "info",
  applied: "success",
  complete: "success",
  uncertain: "warning",
  skipped: "danger",
};

const STAGES: { value: CampaignRewardStage | "auto"; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "not-claimed", label: "Not claimed" },
  { value: "boss-defeated", label: "Boss defeated" },
  { value: "item-acquired", label: "Item acquired" },
  { value: "submitted", label: "Handed in" },
  { value: "applied", label: "Applied" },
  { value: "complete", label: "Confirmed complete" },
];

export function RewardsTab({
  progress,
  rewardMarks,
  onSetStage,
  busy,
}: {
  progress: CampaignProgress;
  rewardMarks: CampaignRewardMark[];
  onSetStage: (rewardId: string, stage: CampaignRewardStage | null, choice: string | null) => void;
  busy: boolean;
}) {
  const g = campaignGraph();
  const statuses = useMemo(() => rewardStatuses(g, progress, rewardMarks), [g, progress, rewardMarks]);
  const totals = useMemo(() => rewardTotals(statuses), [statuses]);
  const held = useMemo(() => heldItemWarnings(g, statuses), [g, statuses]);
  const markOf = new Map(rewardMarks.map((m) => [m.rewardId, m]));
  const parts = g.dataset.parts;

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Permanent rewards">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 xl:grid-cols-4">
          {totals.map((t) => (
            <div key={t.track}>
              <p className="text-2xs text-fg-subtle">{TRACK_LABEL[t.track]}</p>
              <p className="mt-0.5 text-lg font-semibold text-fg tabular-nums">
                {t.earned}
                {TRACK_UNIT[t.track]}
                <span className="ml-1 text-xs font-normal text-fg-muted">
                  / {t.total}
                  {TRACK_UNIT[t.track]}
                </span>
              </p>
              <p className="mt-0.5 text-2xs text-fg-muted tabular-nums">
                {[t.uncertain && `${t.uncertain} uncertain`, t.pending && `${t.pending} in progress`, t.missing && `${t.missing} missing`, t.locked && `${t.locked} later`]
                  .filter(Boolean)
                  .join(" · ") || "all earned"}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-2xs text-fg-subtle">
          “Earned” = applied (passive points seen in Client.txt) or confirmed by you. Spirit, resistances, Life/Mana and choices never appear in the
          log — set their state below once you've claimed them.
        </p>
      </Panel>

      {held.length > 0 && (
        <Panel title="Unfinished claims">
          <ul className="flex flex-col gap-2">
            {held.map((w) => (
              <li key={w} className="flex items-start gap-2 text-xs text-fg-muted">
                <Icon name="warning" size={13} className="mt-px shrink-0 text-warning" />
                {w}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {parts.map((part) => {
        const rows = statuses.filter((s) => s.objective.part === part.id);
        if (!rows.length) return null;
        return (
          <Panel key={part.id} title={part.name} flush>
            <ul className="divide-y divide-line">
              {rows.map((s) => (
                <RewardRow key={s.reward.id} s={s} manual={markOf.get(s.reward.id)?.stage ?? null} busy={busy} onSetStage={onSetStage} />
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

function RewardRow({
  s,
  manual,
  busy,
  onSetStage,
}: {
  s: RewardStatus;
  manual: CampaignRewardStage | null;
  busy: boolean;
  onSetStage: (rewardId: string, stage: CampaignRewardStage | null, choice: string | null) => void;
}) {
  const g = campaignGraph();
  const zone = g.zone.get(s.objective.zone)!;
  const choices = s.reward.choices ?? [];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      <div className="min-w-[220px] flex-1">
        <p className="flex items-center gap-2 text-sm text-fg">
          <span title={`${s.reward.claimCondition}\n\n${provenanceText(s.reward.provenance)}`}>{s.reward.label}</span>
          {s.reward.provenance.verification === "conflict" && (
            <span title={provenanceText(s.reward.provenance)}>
              <Badge tone="warning">Sources disagree</Badge>
            </span>
          )}
          {!s.reward.permanent && <Badge tone="neutral">Not permanent</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {s.objective.title} · {zone.name}
          {s.choice && <span className="text-fg"> · chosen: {s.choice}</span>}
        </p>
      </div>
      <span title={s.evidence}>
        <Badge tone={STATE_TONE[s.state]}>{REWARD_STATE_LABEL[s.state]}</Badge>
      </span>
      {choices.length > 1 && (
        <Select
          size="sm"
          label={`Choice for ${s.reward.label}`}
          hideLabel
          value={s.choice ?? ""}
          onChange={(v) => onSetStage(s.reward.id, manual ?? "complete", v || null)}
          options={[{ value: "", label: "Choice…" }, ...choices.map((c) => ({ value: c, label: c }))]}
        />
      )}
      <Select
        size="sm"
        label={`State of ${s.reward.label}`}
        hideLabel
        value={manual ?? "auto"}
        onChange={(v) => !busy && onSetStage(s.reward.id, v === "auto" ? null : (v as CampaignRewardStage), s.choice)}
        options={STAGES}
      />
    </li>
  );
}
