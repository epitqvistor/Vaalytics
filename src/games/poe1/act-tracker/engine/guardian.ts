/**
 * Passive Skill Point Guardian (pure): the status of every permanent campaign reward, from what Client.txt proves,
 * what the route implies and what the player confirmed.
 *
 * Evidence, strongest first:
 * - `passives`: the game's own `/passives` output (the player types it; Vaalytics only reads the log). A quest listed
 *   with n > 0 points = reward claimed; listed with 0 = quest reached, point not received yet (or a helped bandit);
 *   not listed = not done at that time.
 * - `log`: "You have received a Passive Skill Point." in the act town right after a hand-in — the point is real;
 *   WHICH quest it was is matched by town and route order (labelled as matched). The reverse doesn't hold: a
 *   missing line is NOT proof of a missing point (real runs: 4 of 44 claimed points had no line), so only
 *   `/passives` can make a reward MISSED.
 * - `you`: the player's reward mark (`campaign_reward_marks`) or step mark.
 * - `route`: the guide moved past the step — an inference, never a claim.
 * Entering an area never completes anything; a boss kill or hand-in is never assumed from a visit.
 */
import type { CampaignEventRow, CampaignRewardMark } from "@/core/ipc/commands";
import type { BanditChoice, CampaignReward } from "../data/types";
import type { RouteProgress } from "./progress";
import type { ResolvedStep } from "./route";

export type RewardStatus = "COMPLETED" | "AVAILABLE" | "IN_PROGRESS" | "MISSED" | "NEEDS_CONFIRMATION";
export type Evidence = "passives" | "log" | "you" | "route";

export interface RewardStages {
  areaEntered: Evidence | null;
  objectiveCompleted: Evidence | null;
  questTurnedIn: Evidence | null;
  rewardClaimed: Evidence | null;
}

export interface RewardState {
  reward: CampaignReward;
  status: RewardStatus;
  stages: RewardStages;
  /** Not expected with the player's choices (a helped bandit's point). */
  notExpected: boolean;
  /** In a later act than the guide. */
  upcoming: boolean;
  /** Plain explanation of the status. */
  reason: string;
  /** Where the reward is handed in (route), when known. */
  handInArea: string | null;
}

export interface PassivesSnapshot {
  at: number;
  total: number | null;
  allocated: number | null;
  fromLevel: number | null;
  fromQuests: number | null;
  ascendancy: { total: number; allocated: number } | null;
  /** Quest name → points, as printed. */
  quests: Map<string, number>;
}

export type WarningKind = "missed" | "unclaimed" | "return" | "mismatch" | "bandit" | "no-snapshot" | "stale-snapshot" | "unmatched-grants";

export interface GuardianWarning {
  kind: WarningKind;
  severity: "danger" | "warning" | "info";
  text: string;
  rewardId?: string;
}

export interface AscendancyProgress {
  /** Trials per Labyrinth from the resolved route, with their step status. */
  labs: { lab: "normal" | "cruel" | "merciless"; trials: { step: ResolvedStep; done: boolean; evidence: string | null }[]; run: ResolvedStep | null; runDone: boolean }[];
  /** Ascendancy points from the last `/passives` (2 per Labyrinth), or null. */
  pointsFromPassives: number | null;
  /** The log saw the class change (first Labyrinth done). */
  ascendedInLog: boolean;
}

export interface GuardianReport {
  rewards: RewardState[];
  passive: {
    /** 24 with Kill all, 23 otherwise. */
    expected: number;
    /** Points of the expected rewards that are COMPLETED. */
    completed: number;
    /** "N Passive Skill Points from quests" in the last `/passives`, or null. */
    fromPassives: number | null;
    /** Quest points received in this character's log (all "You have received … Passive Skill Point(s)"). */
    receivedInLog: number;
  };
  respecReceivedInLog: number;
  snapshot: PassivesSnapshot | null;
  warnings: GuardianWarning[];
  ascendancy: AscendancyProgress;
}

interface Input {
  rewards: readonly CampaignReward[];
  steps: readonly ResolvedStep[];
  progress: RouteProgress;
  events: readonly CampaignEventRow[];
  rewardMarks: readonly CampaignRewardMark[];
  bandit: BanditChoice;
  /** Area display names (for messages). */
  name: (id: string | null) => string;
}

/** Groups the `/passives` lines into one snapshot per command (lines within a few seconds of a total line). */
export function passivesSnapshots(events: readonly CampaignEventRow[]): PassivesSnapshot[] {
  const out: PassivesSnapshot[] = [];
  let cur: PassivesSnapshot | null = null;
  for (const e of events) {
    if (e.kind !== "passives" || e.amount === null || !e.detail) continue;
    const startsNew = e.detail.startsWith("total:") || !cur || e.at - cur.at > 5;
    if (startsNew) {
      cur = { at: e.at, total: null, allocated: null, fromLevel: null, fromQuests: null, ascendancy: null, quests: new Map() };
      out.push(cur);
    }
    const c = cur!;
    if (e.detail.startsWith("total:")) {
      c.total = e.amount;
      c.allocated = Number(e.detail.slice(6));
    } else if (e.detail.startsWith("ascendancy:")) c.ascendancy = { total: e.amount, allocated: Number(e.detail.slice(11)) };
    else if (e.detail === "level") c.fromLevel = e.amount;
    else if (e.detail === "quests") c.fromQuests = e.amount;
    else if (e.detail.startsWith("quest:")) c.quests.set(e.detail.slice(6), e.amount);
  }
  return out.filter((s) => s.fromQuests !== null || s.quests.size > 0);
}

const CLAIMED_STAGES = new Set(["applied", "complete"]);
const TURNED_IN_STAGES = new Set(["submitted", "applied", "complete"]);
const OBJECTIVE_STAGES = new Set(["boss-defeated", "item-acquired", "submitted", "applied", "complete"]);
const BANDIT_NAME: Record<BanditChoice, string> = { kill: "", alira: "Alira", kraityn: "Kraityn", oak: "Oak" };

/** Where the player was when each event happened (the last zone entered before it). */
function areaAt(events: readonly CampaignEventRow[]): Map<CampaignEventRow, string | null> {
  const out = new Map<CampaignEventRow, string | null>();
  let here: string | null = null;
  for (const e of events) {
    if (e.kind === "zone") here = e.areaId;
    out.set(e, here);
  }
  return out;
}

export function guardian(input: Input): GuardianReport {
  const { rewards, steps, progress, events, bandit, name } = input;
  const marks = new Map(input.rewardMarks.map((m) => [m.rewardId, m]));
  const snapshots = passivesSnapshots(events);
  const snap = snapshots[snapshots.length - 1] ?? null;
  const where = areaAt(events);
  const visitedAt = new Map<string, number>();
  for (const e of events) if (e.kind === "zone" && e.areaId && !visitedAt.has(e.areaId)) visitedAt.set(e.areaId, e.at);
  const currentAct = steps[progress.cursor]?.act ?? 11;

  // Hand-in steps per quest (first in the resolved route), boss steps per area.
  const handIn = new Map<string, ResolvedStep>();
  for (const s of steps) if (s.kind === "hand-in") for (const q of s.quests ?? []) if (!handIn.has(q.id)) handIn.set(q.id, s);
  const bossStep = (area: string | null) => (area ? (steps.find((s) => s.area === area && s.kills?.length) ?? null) : null);

  // Match each quest point grant to a reward: same town as the hand-in, objective area entered before, route order.
  const pointRewards = rewards.filter((r) => r.type === "passive-points" || (r.type === "bandit-choice" && bandit === "kill"));
  const granted = new Map<string, CampaignEventRow>();
  let unmatched = 0;
  let receivedInLog = 0;
  for (const e of events) {
    if (e.kind !== "passive_points" || !e.amount) continue;
    receivedInLog += e.amount;
    const town = where.get(e) ?? null;
    const cand = pointRewards
      .filter((r) => !granted.has(r.id) && r.questId && handIn.get(r.questId)?.area === town)
      .filter((r) => !r.objectiveArea || (visitedAt.get(r.objectiveArea) ?? Infinity) <= e.at)
      .filter((r) => (e.amount === 2 ? r.points === 2 : r.points === 1))
      .sort((a, b) => (handIn.get(a.questId!)?.index ?? 0) - (handIn.get(b.questId!)?.index ?? 0));
    if (cand[0]) granted.set(cand[0].id, e);
    else unmatched++;
  }

  const states: RewardState[] = rewards.map((r) => {
    const mark = marks.get(r.id)?.stage ?? null;
    const step = r.type === "pantheon" ? bossStep(r.objectiveArea) : r.questId ? (handIn.get(r.questId) ?? null) : null;
    const stepState = step ? progress.steps[step.index] : undefined;
    const behind = !!step && step.index < progress.cursor && !stepState?.reopened;
    const stepConfirmed = stepState?.evidence === "confirmed";
    const line = r.type === "passive-points" || r.type === "bandit-choice" ? snap?.quests.get(r.quest) : undefined;
    const grant = granted.get(r.id);
    const notExpected = r.type === "bandit-choice" && bandit !== "kill";
    const entered = r.objectiveArea ? visitedAt.has(r.objectiveArea) : false;

    const stages: RewardStages = {
      areaEntered: entered ? "log" : null,
      objectiveCompleted:
        line !== undefined ? "passives" : grant ? "log" : mark && OBJECTIVE_STAGES.has(mark) ? "you" : stepConfirmed ? "you" : behind ? "route" : null,
      // `/passives` listing it with 0 says the reward wasn't taken: the route moving on proves nothing then.
      questTurnedIn:
        line !== undefined && line > 0
          ? "passives"
          : grant
            ? "log"
            : mark && TURNED_IN_STAGES.has(mark)
              ? "you"
              : line === 0 || r.type === "pantheon"
                ? null
                : stepConfirmed
                  ? "you"
                  : behind
                    ? "route"
                    : null,
      rewardClaimed: line !== undefined && line > 0 ? "passives" : grant ? "log" : mark && CLAIMED_STAGES.has(mark) ? "you" : null,
    };
    // Pantheon: the soul comes with the kill; a confirmed kill step is the claim.
    if (r.type === "pantheon" && !stages.rewardClaimed && (stepConfirmed || (mark && OBJECTIVE_STAGES.has(mark)))) stages.rewardClaimed = "you";

    const handInArea = r.type === "pantheon" ? null : (step?.area ?? null);
    const town = name(handInArea);
    let status: RewardStatus;
    let reason: string;
    if (notExpected) {
      status = line !== undefined ? "COMPLETED" : behind ? "COMPLETED" : "AVAILABLE";
      reason = `You help ${BANDIT_NAME[bandit]}: their bonus instead of the passive point.`;
    } else if (stages.rewardClaimed) {
      status = "COMPLETED";
      reason =
        stages.rewardClaimed === "passives"
          ? `Listed by /passives (${line} point${line === 1 ? "" : "s"}).`
          : stages.rewardClaimed === "log"
            ? `Point received in ${name(where.get(grant!) ?? null)} — matched to this quest by town and route order.`
            : "Confirmed by you.";
    } else if (line === 0) {
      if (r.type === "bandit-choice") {
        status = "NEEDS_CONFIRMATION";
        reason = "/passives shows 0 from Deal with the Bandits: you helped a bandit, or haven't talked to Eramir yet.";
      } else {
        status = "AVAILABLE";
        reason = `Quest done but the point isn't received yet — talk to ${r.npc ?? "the quest giver"} in ${town}.`;
      }
    } else if (snap && behind && step && snap.at >= (stepState?.at ?? 0) && r.type !== "pantheon" && r.type !== "respec-points") {
      status = "MISSED";
      reason = `Your last /passives doesn't list it, and the guide is past the hand-in in ${town}.`;
    } else if (behind && r.type !== "pantheon" && r.type !== "respec-points" && entered) {
      // Not MISSED: in real runs some claimed points have no "You have received" line in the log (checked against
      // /passives: 4 of 44 claimed points). Only /passives can say a point is missing.
      status = "NEEDS_CONFIRMATION";
      reason = `The guide is past the hand-in in ${town}, but no point for it is in your log. Type /passives to check.`;
    } else if (behind) {
      status = "NEEDS_CONFIRMATION";
      reason =
        r.type === "pantheon"
          ? "The guide is past this boss. The log can't see kills — confirm it."
          : stages.questTurnedIn === "you"
            ? "You marked the hand-in, but no point for it is in your log yet."
            : "The guide is past the hand-in, but your log doesn't cover it. Confirm it, or type /passives.";
    } else if (stages.objectiveCompleted || stages.areaEntered) {
      status = "IN_PROGRESS";
      reason = stages.objectiveCompleted ? `Hand it in to ${r.npc ?? "the quest giver"} in ${town}.` : `You've been in ${name(r.objectiveArea)}; the objective isn't confirmed.`;
    } else {
      status = "AVAILABLE";
      reason = r.onDefaultRoute ? `Act ${r.act}: ${r.objective}` : `Optional (not on the levelling route). ${r.objective}`;
    }
    return { reward: r, status, stages, notExpected, upcoming: r.act > currentAct, reason, handInArea };
  });

  const expectedRewards = states.filter((s) => (s.reward.type === "passive-points" || s.reward.type === "bandit-choice") && !s.notExpected);
  const expected = expectedRewards.reduce((n, s) => n + (s.reward.points ?? 0), 0);
  const completed = expectedRewards.filter((s) => s.status === "COMPLETED").reduce((n, s) => n + (s.reward.points ?? 0), 0);

  const warnings: GuardianWarning[] = [];
  const banditZero = snap?.quests.get("Deal with the Bandits") === 0;
  for (const s of states) {
    if (s.notExpected) continue;
    if (s.reward.type === "bandit-choice" && banditZero) continue; // one bandit warning below
    const pts = s.reward.points ? ` (${s.reward.points} passive point${s.reward.points === 1 ? "" : "s"})` : "";
    if (s.status === "MISSED") warnings.push({ kind: "missed", severity: "danger", text: `${s.reward.quest}${pts}: ${s.reason}`, rewardId: s.reward.id });
    else if (s.stages.objectiveCompleted && !s.stages.questTurnedIn && s.reward.type !== "pantheon" && s.status !== "COMPLETED")
      warnings.push({ kind: s.status === "AVAILABLE" ? "unclaimed" : "return", severity: "warning", text: `${s.reward.quest}${pts}: ${s.reason}`, rewardId: s.reward.id });
  }
  if (bandit === "kill" && banditZero)
    warnings.push({ kind: "bandit", severity: "warning", text: "Your route says Kill all, but /passives shows 0 from Deal with the Bandits. If you helped a bandit, change the bandit option." });
  if (snap && snap.fromQuests !== null && snap.fromQuests !== completed)
    warnings.push({ kind: "mismatch", severity: "warning", text: `/passives says ${snap.fromQuests} quest point${snap.fromQuests === 1 ? "" : "s"}; the tracker counts ${completed} for your route choices.` });
  if (!snap && receivedInLog + completed > 0)
    warnings.push({ kind: "no-snapshot", severity: "info", text: "Type /passives in the game chat: Vaalytics reads the answer from your Client.txt and confirms every quest point exactly." });
  const lastGrant = [...events].reverse().find((e) => e.kind === "passive_points");
  if (snap && lastGrant && lastGrant.at > snap.at) warnings.push({ kind: "stale-snapshot", severity: "info", text: "You received points after your last /passives — type it again to confirm them." });
  if (unmatched > 0)
    warnings.push({ kind: "unmatched-grants", severity: "info", text: `${unmatched} point grant${unmatched === 1 ? "" : "s"} in your log couldn't be matched to a quest (different town or order). /passives settles it.` });

  return {
    rewards: states,
    passive: { expected, completed, fromPassives: snap?.fromQuests ?? null, receivedInLog },
    respecReceivedInLog: events.filter((e) => e.kind === "respec_points").reduce((n, e) => n + (e.amount ?? 0), 0),
    snapshot: snap,
    warnings,
    ascendancy: ascendancyProgress(steps, progress, events, snap),
  };
}

function labOf(act: number): "normal" | "cruel" | "merciless" {
  return act <= 3 ? "normal" : act <= 7 ? "cruel" : "merciless";
}

function ascendancyProgress(steps: readonly ResolvedStep[], progress: RouteProgress, events: readonly CampaignEventRow[], snap: PassivesSnapshot | null): AscendancyProgress {
  const pointsFromPassives = snap?.ascendancy?.total ?? null;
  const ascendedInLog = events.some((e) => e.kind === "ascended");
  // Labyrinths done, from the game: 2 Ascendancy points per Labyrinth (/passives), or the class change (the first).
  const labsDone = pointsFromPassives !== null ? Math.floor(pointsFromPassives / 2) : ascendedInLog ? 1 : 0;
  const labs = (["normal", "cruel", "merciless"] as const).map((lab, n) => {
    // A Labyrinth opens only after its trials, so a finished Labyrinth implies them.
    const implied = n < labsDone;
    const trials = steps
      .filter((s) => s.kind === "trial" && labOf(s.act) === lab)
      .map((step) => {
        const p = progress.steps[step.index];
        const confirmed = p?.evidence === "confirmed";
        return { step, done: confirmed || implied, evidence: confirmed ? "confirmed by you" : implied ? "implied: Labyrinth completed" : (p?.evidence ?? null) };
      });
    const run = steps.find((s) => s.kind === "labyrinth" && s.labyrinth === lab) ?? null;
    return { lab, trials, run, runDone: implied || (run ? progress.steps[run.index]?.evidence === "confirmed" : false) };
  });
  return { labs, pointsFromPassives, ascendedInLog };
}
