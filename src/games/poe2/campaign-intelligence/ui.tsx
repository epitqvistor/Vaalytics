/** Small presentational pieces shared by the Campaign Intelligence views. */
import type { ReactNode } from "react";
import { Badge, Button, type BadgeTone } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { CampaignReward, Provenance, Verification } from "./data/types";
import { CAMPAIGN_0_5_5 } from "./data/0.5.5";
import type { Confidence, ObjectiveProgress, ObjectiveStatus } from "./engine/progress";
import type { Importance, RecommendedObjective } from "./engine/recommend";

const IMPORTANCE: Record<Importance, { tone: BadgeTone; label: string }> = {
  critical: { tone: "accent", label: "Main quest" },
  high: { tone: "success", label: "High value" },
  medium: { tone: "info", label: "Useful" },
  low: { tone: "neutral", label: "Minor" },
};

export function ImportanceBadge({ importance }: { importance: Importance }) {
  const i = IMPORTANCE[importance];
  return <Badge tone={i.tone}>{i.label}</Badge>;
}

const VERIFY: Record<Verification, { tone: BadgeTone; label: string } | null> = {
  confirmed: null,
  unverified: { tone: "neutral", label: "Unverified" },
  conflict: { tone: "warning", label: "Sources disagree" },
};

const sourceLabel = (id: string) => CAMPAIGN_0_5_5.sources.find((s) => s.id === id)?.label ?? id;

/** Tooltip text: verification, sources, recorded disagreements. */
export function provenanceText(p: Provenance): string {
  const lines = [
    p.verification === "confirmed" ? "Confirmed by two or more sources." : p.verification === "conflict" ? "Sources disagree:" : "From one source only.",
    ...(p.conflicts ?? []).map((c) => `• ${sourceLabel(c.source)}: ${c.says}`),
    ...(p.note ? [p.note] : []),
    `Sources: ${p.sources.map(sourceLabel).join("; ")}`,
  ];
  return lines.join("\n");
}

export function VerificationBadge({ provenance, always }: { provenance: Provenance; always?: boolean }) {
  const v = VERIFY[provenance.verification];
  if (!v && !always) return null;
  return (
    <span title={provenanceText(provenance)}>
      <Badge tone={v?.tone ?? "success"}>{v?.label ?? "Verified"}</Badge>
    </span>
  );
}

export function RewardChip({ reward }: { reward: CampaignReward }) {
  return (
    <span
      title={`${reward.claimCondition}\n\n${provenanceText(reward.provenance)}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-2 px-2 py-1 text-xs text-fg"
    >
      <Icon name={reward.category === "choice" ? "sliders" : reward.category === "ascendancy" ? "star" : "gem"} size={12} className="text-accent-2" />
      {reward.label}
      {reward.provenance.verification !== "confirmed" && <Icon name="warning" size={11} className="text-warning" />}
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">{children}</p>;
}

/** Compact row for "also here" and alternatives. */
export function ObjectiveRow({
  entry,
  onDone,
  onSkip,
  onFocus,
  busy,
}: {
  entry: RecommendedObjective;
  onDone: () => void;
  onSkip: () => void;
  onFocus?: () => void;
  busy: boolean;
}) {
  const o = entry.objective;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm text-fg">
          <span className="truncate">{o.title}</span>
          <ImportanceBadge importance={entry.importance} />
        </p>
        <p className="mt-0.5 truncate text-xs text-fg-muted">
          {entry.zone.name}
          {entry.travelCost ? ` · ${entry.travel.length} step${entry.travel.length === 1 ? "" : "s"} away` : " · here"}
          {entry.rewards.length > 0 && ` · ${entry.rewards.map((r) => r.label).join(", ")}`}
        </p>
      </div>
      {onFocus && (
        <Button size="sm" variant="ghost" onClick={onFocus} title="Show this as the next objective">
          Do this next
        </Button>
      )}
      <Button size="sm" variant="ghost" icon="check" disabled={busy} onClick={onDone} title="Mark done">
        Done
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onSkip} title="Skip for now (it will be listed as missed)">
        Skip
      </Button>
    </li>
  );
}

const STATUS: Record<ObjectiveStatus, { tone: BadgeTone; label: string }> = {
  done: { tone: "success", label: "Done" },
  available: { tone: "info", label: "Available" },
  locked: { tone: "neutral", label: "Locked" },
  skipped: { tone: "warning", label: "Skipped" },
};
const CONFIDENCE: Record<Confidence, string> = { confirmed: "confirmed", inferred: "inferred", manual: "marked by you" };

/** Objective status with how it was established (inferred from the log / marked by you). */
export function StatusBadge({ progress }: { progress: ObjectiveProgress | undefined }) {
  const s = STATUS[progress?.status ?? "locked"];
  const how = progress?.confidence ? CONFIDENCE[progress.confidence] : null;
  return (
    <span title={progress?.evidence ?? undefined}>
      <Badge tone={s.tone}>
        {s.label}
        {how && progress?.status !== "available" && progress?.status !== "locked" ? ` · ${how}` : ""}
      </Badge>
    </span>
  );
}
