/**
 * Passive Skill Point Guardian on the Act Tracker page: quest passive points, respec books, the bandit choice,
 * Pantheon powers and Ascendancy progress — each with its status, how it is known, and the player's own marks.
 */
import { useState } from "react";
import type { CampaignRewardStage } from "@/core/ipc/commands";
import { Badge, type BadgeTone, Panel, SegmentedControl } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import type { Verification } from "./data/types";
import type { Evidence, GuardianReport, RewardState, RewardStatus } from "./engine/guardian";
import type { ReturnTrip } from "./engine/recovery";

export const STATUS_LABEL: Record<RewardStatus, string> = {
  COMPLETED: "Completed",
  AVAILABLE: "Available",
  IN_PROGRESS: "In progress",
  MISSED: "Missed",
  NEEDS_CONFIRMATION: "Needs confirmation",
};
export const STATUS_TONE: Record<RewardStatus, BadgeTone> = {
  COMPLETED: "success",
  AVAILABLE: "neutral",
  IN_PROGRESS: "accent",
  MISSED: "danger",
  NEEDS_CONFIRMATION: "warning",
};
const EVIDENCE: Record<Evidence, string> = {
  passives: "your /passives output",
  log: "Client.txt",
  you: "you",
  route: "the route (not confirmed)",
};
const VERIFICATION_TONE: Record<Verification, BadgeTone> = {
  VERIFIED: "success",
  COMMUNITY_VERIFIED: "info",
  PARTIALLY_VERIFIED: "warning",
  UNVERIFIED: "warning",
  OUTDATED: "danger",
  CONFLICT: "danger",
};

type Tab = "passives" | "refunds" | "pantheon" | "ascendancy";

export function GuardianPanel({
  report,
  trips,
  name,
  canMark,
  onMark,
}: {
  report: GuardianReport;
  trips: ReturnTrip[];
  name: (id: string | null) => string;
  canMark: boolean;
  onMark: (rewardId: string, stage: CampaignRewardStage | null) => void;
}) {
  const [tab, setTab] = useState<Tab>("passives");
  const { passive, snapshot } = report;
  const of = (t: RewardState["reward"]["type"][]) => report.rewards.filter((r) => t.includes(r.reward.type));
  const rows = tab === "passives" ? of(["passive-points", "bandit-choice"]) : tab === "refunds" ? of(["respec-points"]) : of(["pantheon"]);

  return (
    <Panel
      title="Passive Skill Point Guardian"
      actions={
        <SegmentedControl<Tab>
          size="sm"
          label="Rewards"
          value={tab}
          onChange={setTab}
          segments={[
            { value: "passives", label: "Passive points" },
            { value: "refunds", label: "Respec" },
            { value: "pantheon", label: "Pantheon" },
            { value: "ascendancy", label: "Ascendancy" },
          ]}
        />
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Figure label="Quest points" value={`${passive.completed} / ${passive.expected}`} caption="completed / expected" />
        <Figure
          label="/passives says"
          value={passive.fromPassives ?? "—"}
          caption={snapshot ? `typed ${new Date(snapshot.at * 1000).toLocaleString()}` : "type /passives in game"}
        />
        <Figure label="Received in your log" value={passive.receivedInLog} caption="quest point lines" />
        <Figure label="Respec points in your log" value={report.respecReceivedInLog} caption="all sources" />
      </div>

      {trips.length > 0 && (
        <div className="mb-4 rounded-md border border-accent/25 bg-accent-soft px-3 py-2">
          <div className="mb-1 text-2xs font-semibold tracking-[0.08em] text-accent-2 uppercase">Worth going back for</div>
          <ul className="flex flex-col gap-1 text-xs">
            {trips.map((trip) => (
              <li key={trip.reward.reward.id} className="text-fg">
                <span className="font-medium">{trip.reward.reward.quest}</span>
                <span className="text-accent-2"> +{trip.reward.reward.points}</span>
                <span className="text-fg-muted">
                  {" "}
                  — {trip.purpose === "objective" ? `objective in ${name(trip.target)}` : `hand in in ${name(trip.target)}${trip.reward.reward.npc ? ` (${trip.reward.reward.npc})` : ""}`}
                  {trip.plan ? ` · ${trip.plan.path.map((id) => name(id)).join(" → ")} · ${trip.plan.loads} loading screen${trip.plan.loads === 1 ? "" : "s"}` : " · no known way with your waypoints"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.warnings.length > 0 && (
        <ul className="mb-4 flex flex-col gap-1.5">
          {report.warnings.map((w, k) => (
            <li
              key={k}
              className={cn(
                "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs",
                w.severity === "danger" ? "border-danger/25 bg-danger-soft text-danger" : w.severity === "warning" ? "border-warning/25 bg-warning-soft text-warning" : "border-line bg-glass text-fg-muted",
              )}
            >
              <Icon name={w.severity === "info" ? "info" : "warning"} size={13} className="mt-px shrink-0" />
              {w.text}
            </li>
          ))}
        </ul>
      )}

      {tab === "ascendancy" ? (
        <AscendancyView report={report} name={name} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((s) => (
            <RewardRow key={s.reward.id} s={s} name={name} canMark={canMark} onMark={onMark} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-2xs text-fg-subtle">
        In game, type <span className="text-fg-muted">/passives</span> in chat: Vaalytics reads the game's answer from Client.txt and confirms every quest
        point exactly. Nothing is sent to the game. Entering an area never completes a reward.
      </p>
    </Panel>
  );
}

function Figure({ label, value, caption }: { label: string; value: React.ReactNode; caption: string }) {
  return (
    <div className="rounded-md border border-line bg-bg-2 px-3 py-2">
      <div className="text-2xs font-semibold tracking-[0.08em] text-fg-subtle uppercase">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-fg">{value}</div>
      <div className="truncate text-2xs text-fg-subtle">{caption}</div>
    </div>
  );
}

const STAGES: [keyof RewardState["stages"], string][] = [
  ["areaEntered", "Area entered"],
  ["objectiveCompleted", "Objective completed"],
  ["questTurnedIn", "Quest turned in"],
  ["rewardClaimed", "Reward claimed"],
];

function RewardRow({
  s,
  name,
  canMark,
  onMark,
}: {
  s: RewardState;
  name: (id: string | null) => string;
  canMark: boolean;
  onMark: (rewardId: string, stage: CampaignRewardStage | null) => void;
}) {
  const r = s.reward;
  const pts = r.points !== null ? `+${r.points}` : r.type === "respec-points" ? "?" : null;
  return (
    <li className={cn("group flex flex-wrap items-start gap-x-3 gap-y-1 py-2", s.notExpected && "opacity-60")}>
      <span className="w-9 shrink-0 pt-0.5 text-2xs text-fg-subtle tabular-nums">A{r.act}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg">{r.pantheon ? r.pantheon.god : r.quest}</span>
          {pts && <span className="text-xs font-semibold text-accent-2 tabular-nums">{pts}</span>}
          {r.pantheon && <span className="text-2xs text-fg-subtle">{r.pantheon.tier} · {r.quest}</span>}
          <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
          {!r.onDefaultRoute && <Badge tone="neutral">Optional</Badge>}
          <span title={`${r.provenance.sources.join(", ")} · checked ${r.provenance.lastVerified} · ${r.provenance.gameVersion}${r.provenance.notes ? ` — ${r.provenance.notes}` : ""}`}>
            <Badge tone={VERIFICATION_TONE[r.provenance.verification]}>{r.provenance.verification.replace("_", " ").toLowerCase()}</Badge>
          </span>
        </div>
        <p className="mt-0.5 text-xs text-fg-muted">{s.reason}</p>
        <p className="mt-0.5 text-2xs text-fg-subtle">
          {r.objective}
          {r.npc ? ` · ${r.npc}${s.handInArea ? `, ${name(s.handInArea)}` : ""}` : ""}
          <span title={`${r.details.verification}${r.details.notes ? ` — ${r.details.notes}` : ""}`}> · details {r.details.verification.replace("_", " ").toLowerCase()}</span>
        </p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {STAGES.map(([k, label]) => {
            const e = s.stages[k];
            return (
              <span key={k} className={cn("flex items-center gap-1 text-2xs", e ? "text-fg-muted" : "text-fg-disabled")} title={e ? `${label}: ${EVIDENCE[e]}` : `${label}: not known`}>
                <span className={cn("size-1.5 rounded-full", e === "passives" || e === "log" ? "bg-success" : e === "you" ? "bg-accent" : e === "route" ? "bg-fg-subtle" : "bg-line-strong")} />
                {label}
              </span>
            );
          })}
        </div>
      </div>
      {canMark && !s.notExpected && (
        <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {s.stages.rewardClaimed === "you" || s.stages.objectiveCompleted === "you" ? (
            <MarkButton onClick={() => onMark(r.id, null)}>Undo</MarkButton>
          ) : s.stages.rewardClaimed ? null : (
            <>
              {r.type !== "pantheon" && <MarkButton onClick={() => onMark(r.id, "boss-defeated")}>Objective done</MarkButton>}
              <MarkButton onClick={() => onMark(r.id, "complete")}>{r.type === "pantheon" ? "Unlocked" : "Claimed"}</MarkButton>
            </>
          )}
        </span>
      )}
    </li>
  );
}

function MarkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded border border-line px-1.5 py-0.5 text-2xs text-fg-muted hover:bg-glass-hover hover:text-fg">
      {children}
    </button>
  );
}

function AscendancyView({ report, name }: { report: GuardianReport; name: (id: string | null) => string }) {
  const a = report.ascendancy;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-fg-muted">
        {a.pointsFromPassives !== null
          ? `/passives: ${a.pointsFromPassives} Ascendancy points (${a.pointsFromPassives / 2} Labyrinth${a.pointsFromPassives === 2 ? "" : "s"}).`
          : a.ascendedInLog
            ? "Your log shows the class change: the Normal Labyrinth is done."
            : "No Ascendancy yet in your log."}{" "}
        Trials aren't in Client.txt: a finished Labyrinth implies its trials; otherwise mark them done in the guide.
      </p>
      {a.labs.map((l) => (
        <div key={l.lab}>
          <div className="mb-1 flex items-center gap-2 text-xs">
            <span className="font-semibold text-fg capitalize">{l.lab} Labyrinth</span>
            <span className="text-fg-subtle tabular-nums">
              trials {l.trials.filter((t) => t.done).length}/{l.trials.length}
            </span>
            {l.runDone && <Badge tone="success">Labyrinth done</Badge>}
          </div>
          {l.trials.length === 0 ? (
            <p className="text-2xs text-fg-subtle">Trials are off in your route options.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {l.trials.map((t) => (
                <li
                  key={t.step.id}
                  className={cn("rounded border px-2 py-0.5 text-2xs", t.done ? "border-success/30 bg-success-soft text-success" : "border-line text-fg-muted")}
                  title={t.evidence ? `Status: ${t.evidence}` : "Not done"}
                >
                  A{t.step.act} · {name(t.step.area)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
