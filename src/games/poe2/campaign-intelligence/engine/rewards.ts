/**
 * Permanent Reward Guardian (pure). Each reward gets its own claim state,
 * separate from its objective: defeating a boss is not claiming its reward,
 * and an objective inferred from a later zone doesn't prove the reward was
 * taken. Only the passive-point line in Client.txt shows a reward being
 * applied; everything else is the player's own record.
 */
import type { CampaignRewardMark, CampaignRewardStage } from "@/core/ipc/commands";
import type { CampaignObjective, CampaignReward } from "../data/types";
import type { CampaignGraph } from "./graph";
import type { CampaignProgress, Confidence } from "./progress";

export type RewardState =
  | "not-available"
  | "available"
  | "in-progress"
  | "boss-defeated"
  | "item-acquired"
  | "submitted"
  | "applied"
  | "complete"
  | "uncertain"
  | "skipped";

/** How a reward counts in the totals. */
export type RewardBucket = "earned" | "uncertain" | "pending" | "missing" | "locked";

export interface RewardStatus {
  reward: CampaignReward;
  objective: CampaignObjective;
  state: RewardState;
  bucket: RewardBucket;
  confidence: Confidence | null;
  evidence: string;
  choice: string | null;
}

export const REWARD_STATE_LABEL: Record<RewardState, string> = {
  "not-available": "Not available yet",
  available: "Available",
  "in-progress": "Visited, not confirmed",
  "boss-defeated": "Boss defeated",
  "item-acquired": "Item acquired",
  submitted: "Handed in",
  applied: "Applied",
  complete: "Confirmed",
  uncertain: "Uncertain",
  skipped: "Skipped",
};

const STAGE_BUCKET: Record<CampaignRewardStage, RewardBucket> = {
  "not-claimed": "missing",
  "boss-defeated": "pending",
  "item-acquired": "pending",
  submitted: "pending",
  applied: "earned",
  complete: "earned",
};

export function rewardStatuses(g: CampaignGraph, progress: CampaignProgress, marks: readonly CampaignRewardMark[] = []): RewardStatus[] {
  const byReward = new Map(marks.map((m) => [m.rewardId, m]));
  return g.dataset.rewards.map((reward) => {
    const objective = g.objective.get(reward.objective)!;
    const op = progress.objectives.get(objective.id);
    const mark = byReward.get(reward.id);
    const choice = mark?.choice ?? op?.choice ?? null;
    const base = { reward, objective, choice };
    if (mark) {
      const state: RewardState = mark.stage === "not-claimed" ? "available" : mark.stage;
      const evidence = mark.stage === "not-claimed" ? "You marked this reward as not claimed." : `Marked by you: ${REWARD_STATE_LABEL[state].toLowerCase()}.`;
      return { ...base, state, bucket: STAGE_BUCKET[mark.stage], confidence: "manual", evidence };
    }
    switch (op?.status) {
      case "done":
        if (op.source === "manual") return { ...base, state: "complete", bucket: "earned", confidence: "manual", evidence: "You marked the objective done." };
        if (op.source === "passive-grant" || op.source === "ascended") return { ...base, state: "applied", bucket: "earned", confidence: "inferred", evidence: op.evidence ?? "" };
        return {
          ...base,
          state: "uncertain",
          bucket: "uncertain",
          confidence: "inferred",
          evidence: `${op.evidence ?? "The objective looks done."} The log can't show whether the reward was claimed.`,
        };
      case "skipped":
        return { ...base, state: "skipped", bucket: "missing", confidence: "manual", evidence: "You skipped the objective." };
      case "available": {
        const visited = progress.visited.has(objective.zone);
        return visited
          ? { ...base, state: "in-progress", bucket: "missing", confidence: null, evidence: `You've been to ${g.zone.get(objective.zone)!.name}; the reward isn't confirmed.` }
          : { ...base, state: "available", bucket: "missing", confidence: null, evidence: "Not done yet." };
      }
      default:
        return { ...base, state: "not-available", bucket: "locked", confidence: null, evidence: "Its prerequisites aren't done yet." };
    }
  });
}

/** Numeric tracks the guardian totals. */
export type RewardTrack = "passive" | "spirit" | "res-cold" | "res-fire" | "res-lightning" | "life-flat" | "life-pct" | "mana-pct" | "charm" | "ascendancy" | "choice";

export const TRACK_LABEL: Record<RewardTrack, string> = {
  passive: "Passive skill points",
  spirit: "Spirit",
  "res-cold": "Cold resistance",
  "res-fire": "Fire resistance",
  "res-lightning": "Lightning resistance",
  "life-flat": "Maximum Life",
  "life-pct": "Increased maximum Life",
  "mana-pct": "Increased maximum Mana",
  charm: "Charm slots",
  ascendancy: "Ascendancy points",
  choice: "Permanent choices",
};
export const TRACK_UNIT: Record<RewardTrack, string> = {
  passive: "",
  spirit: "",
  "res-cold": "%",
  "res-fire": "%",
  "res-lightning": "%",
  "life-flat": "",
  "life-pct": "%",
  "mana-pct": "%",
  charm: "",
  ascendancy: "",
  choice: "",
};

export function trackOf(r: CampaignReward): RewardTrack | null {
  switch (r.category) {
    case "passive":
      return "passive";
    case "spirit":
      return "spirit";
    case "resistance":
      return /cold/i.test(r.label) ? "res-cold" : /fire/i.test(r.label) ? "res-fire" : /lightning/i.test(r.label) ? "res-lightning" : null;
    case "life":
      return /increased/i.test(r.label) ? "life-pct" : "life-flat";
    case "mana":
      return "mana-pct";
    case "charm":
      return "charm";
    case "ascendancy":
      return "ascendancy";
    case "choice":
      return "choice";
    default:
      return null;
  }
}

export interface TrackTotal {
  track: RewardTrack;
  total: number;
  earned: number;
  uncertain: number;
  pending: number;
  missing: number;
  locked: number;
}

/** Sums per track; choices count 1 each. */
export function rewardTotals(statuses: readonly RewardStatus[]): TrackTotal[] {
  const out = new Map<RewardTrack, TrackTotal>();
  for (const s of statuses) {
    const track = trackOf(s.reward);
    if (!track || !s.reward.permanent) continue;
    const amount = track === "choice" ? 1 : (s.reward.amount ?? 0);
    const t = out.get(track) ?? { track, total: 0, earned: 0, uncertain: 0, pending: 0, missing: 0, locked: 0 };
    t.total += amount;
    t[s.bucket] += amount;
    out.set(track, t);
  }
  return (Object.keys(TRACK_LABEL) as RewardTrack[]).flatMap((k) => (out.has(k) ? [out.get(k)!] : []));
}

/** Rewards whose item is in hand but not handed in yet (from the player's own marks). */
export function heldItemWarnings(g: CampaignGraph, statuses: readonly RewardStatus[]): string[] {
  return statuses
    .filter((s) => s.state === "item-acquired" || s.state === "boss-defeated")
    .map((s) => {
      const where = s.objective.turnIn ? g.zone.get(s.objective.turnIn)!.name : g.zone.get(s.objective.zone)!.name;
      return s.state === "item-acquired"
        ? `You have the item for “${s.reward.label}” — finish it in ${where}: ${s.reward.claimCondition}`
        : `“${s.objective.title}” is marked defeated but “${s.reward.label}” isn't claimed yet: ${s.reward.claimCondition}`;
    });
}
