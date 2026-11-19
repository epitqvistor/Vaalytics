/**
 * Act Tracker data for one area (pure) — what the Location Atlas shows next to an area, and what the tracker uses
 * for "open this area in the Atlas". Agreed split: the Atlas owns maps and pathfinding; the Act Tracker owns the
 * levelling route, quests and rewards and exposes them per area through this function.
 *
 * Nothing here is geometry: it lists the route's steps done in the area, the quests and rewards tied to it, and
 * where the route enters and leaves it. Positions inside an area are not known (Client.txt doesn't have them).
 */
import type { GuardianReport, RewardState } from "./guardian";
import type { PrioritisedStep } from "./priorities";
import type { RouteProgress, StepProgress } from "./progress";
import type { ResolvedStep } from "./route";

export interface AreaGuideStep {
  step: ResolvedStep;
  progress: StepProgress | null;
  priority: PrioritisedStep | null;
  /** The guide's current step. */
  current: boolean;
}

export interface AreaGuide {
  areaId: string;
  /** Steps done while in this area (in route order; an area can be visited several times). */
  steps: AreaGuideStep[];
  /** Areas the route comes from into this one, and goes to from it (route moves, not all game connections). */
  routeIn: string[];
  routeOut: string[];
  /** Rewards whose objective is here, or which are handed in here. */
  rewards: { state: RewardState; role: "objective" | "hand-in" }[];
  /** The guide is in this area right now. */
  isGuideArea: boolean;
  /** Steps still to do here (not behind the guide). */
  remaining: number;
}

export function areaGuide(
  areaId: string,
  steps: readonly ResolvedStep[],
  progress: RouteProgress | null,
  priorities: readonly PrioritisedStep[],
  report: GuardianReport | null,
): AreaGuide {
  const cursor = progress?.cursor ?? 0;
  const here = steps.filter((s) => s.area === areaId);
  const routeIn = [...new Set(steps.filter((s) => s.to === areaId && s.area !== areaId).map((s) => s.area))];
  const routeOut = [...new Set(here.flatMap((s) => (s.to && s.to !== areaId ? [s.to] : [])))];
  const rewards: AreaGuide["rewards"] = [];
  for (const state of report?.rewards ?? []) {
    if (state.reward.objectiveArea === areaId) rewards.push({ state, role: "objective" });
    else if (state.handInArea === areaId) rewards.push({ state, role: "hand-in" });
  }
  return {
    areaId,
    steps: here.map((step) => ({
      step,
      progress: progress?.steps[step.index] ?? null,
      priority: priorities[step.index] ?? null,
      current: step.index === cursor,
    })),
    routeIn,
    routeOut,
    rewards,
    isGuideArea: steps[cursor]?.area === areaId,
    remaining: here.filter((s) => s.index >= cursor).length,
  };
}
