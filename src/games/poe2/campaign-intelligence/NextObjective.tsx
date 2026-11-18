/** The main card: where to go, what to do there, why, and what comes after. */
import { useState } from "react";
import { Badge, Button, Panel, Select } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { Recommendation } from "./engine/recommend";
import { ImportanceBadge, RewardChip, SectionLabel, VerificationBadge } from "./ui";
import { campaignGraph } from "./hooks";

export function NextObjective({
  rec,
  onDone,
  onSkip,
  busy,
}: {
  rec: Recommendation;
  onDone: (objectiveId: string, choice: string | null) => void;
  onSkip: (objectiveId: string) => void;
  busy: boolean;
}) {
  const p = rec.primary;
  const choiceReward = p?.rewards.find((r) => r.choices && r.choices.length > 1);
  const [choice, setChoice] = useState<string>("");

  if (!p) {
    return (
      <Panel title="Next objective">
        <div className="flex items-center gap-3 px-1 py-4 text-sm text-fg-muted">
          <Icon name="success" size={18} className="text-success" />
          {rec.explanation}
        </div>
      </Panel>
    );
  }
  const g = campaignGraph();
  const o = p.objective;
  const part = g.part.get(o.part)!;
  const here = p.travel.length === 0;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Next objective <ImportanceBadge importance={p.importance} />
          <VerificationBadge provenance={o.provenance} />
        </span>
      }
      actions={<span className="text-2xs text-fg-subtle">{part.name}</span>}
    >
      {rec.changed && (
        <p className="mb-3 flex items-start gap-2 rounded-md border border-line bg-bg-2/60 px-3 py-2 text-xs text-fg-muted">
          <Icon name="info" size={13} className="mt-px shrink-0" />
          <span>New recommendation: {rec.changed.reason}</span>
        </p>
      )}

      <p className="text-2xs font-semibold tracking-[0.14em] text-accent-2/80 uppercase">{here ? "You are here" : "Go to"}</p>
      <h3 className="mt-0.5 text-xl font-semibold tracking-[-0.01em] text-fg">{p.zone.name}</h3>
      <p className="mt-1 text-sm text-fg">{o.title}</p>
      <p className="mt-1 text-xs text-fg-muted">{o.why}</p>

      {p.rewards.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.rewards.map((r) => (
            <RewardChip key={r.id} reward={r} />
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <SectionLabel>Route</SectionLabel>
          {here ? (
            <p className="text-xs text-fg-muted">You're already in {p.zone.name}.</p>
          ) : (
            <ol className="flex flex-col gap-1 text-xs text-fg">
              {p.travel.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-4 shrink-0 text-right text-fg-subtle tabular-nums">{i + 1}.</span>
                  {s}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-2xs text-fg-subtle">Logical travel steps, not distances — Vaalytics can't see your position in a zone.</p>
          {p.turnIn && p.turnIn.id !== p.zone.id && <p className="mt-2 text-xs text-fg-muted">Hand-in: {p.turnIn.name}.</p>}
        </div>
        <div>
          <SectionLabel>What to do</SectionLabel>
          <ol className="flex flex-col gap-1.5 text-sm text-fg">
            {o.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-bg-2 text-2xs text-fg-muted tabular-nums">
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {((o.mistakes?.length ?? 0) > 0 || p.missingItems.length > 0) && (
        <div className="mt-4 flex flex-col gap-1.5">
          {p.missingItems.map((m) => (
            <p key={m.name} className="flex items-start gap-2 text-xs text-warning">
              <Icon name="warning" size={13} className="mt-px shrink-0" />
              You need {m.name} — from “{m.from.title}” ({g.zone.get(m.from.zone)!.name}).
            </p>
          ))}
          {o.mistakes?.map((m) => (
            <p key={m} className="flex items-start gap-2 text-xs text-fg-muted">
              <Icon name="info" size={13} className="mt-px shrink-0" />
              {m}
            </p>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-fg">
        <span className="text-fg-subtle">After: </span>
        {p.after}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {choiceReward && (
          <Select
            size="sm"
            label="Your choice"
            hideLabel
            value={choice}
            onChange={setChoice}
            options={[{ value: "", label: "Choice (optional)…" }, ...choiceReward.choices!.map((c) => ({ value: c, label: c }))]}
          />
        )}
        <Button size="sm" variant="primary" icon="check" disabled={busy} onClick={() => onDone(o.id, choice || null)}>
          Mark done
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSkip(o.id)}>
          Skip for now
        </Button>
        <span className="ml-auto flex items-center gap-2 text-2xs text-fg-subtle" title={p.detection.note}>
          <Badge tone={p.detection.kind === "manual" ? "neutral" : "info"}>
            {p.detection.kind === "automatic" ? "Auto-detected" : p.detection.kind === "partly" ? "Partly auto" : p.detection.kind === "inferred" ? "Inferred" : "Confirm yourself"}
          </Badge>
          <span className="hidden max-w-[260px] truncate lg:inline">{p.detection.note}</span>
        </span>
      </div>
    </Panel>
  );
}
