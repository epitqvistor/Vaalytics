/**
 * Route Intelligence, part 1 (pure): what each route step is worth.
 *
 * Categories, in the order the spec ranks them:
 * 1. CRITICAL — main progression: moving through the campaign, the objectives the route needs, waypoints.
 * 2. PERMANENT_POWER — Book of Skill / Book of Regrets: the objective in the reward's area and its hand-in.
 * 3. ASCENDANCY — Trials of Ascendancy and Labyrinth trips.
 * 4. IMPORTANT — bandits and Pantheon bosses / the Pantheon choice.
 * 5. BUILD_OPTIONAL — skill gem hand-ins and league-start extras (gear, flasks, gems).
 * 6. SKIP — crafting recipes: useful, not needed for a fast campaign.
 * A step gets one category; when several apply, the one that matters most for the player wins
 * (permanent power > ascendancy > important > critical > build optional > skip).
 * "Important only" hides BUILD_OPTIONAL and SKIP steps from the guide — they stay in the route and in the data.
 */
import type { CampaignReward, RouteData } from "../data/types";
import type { ResolvedStep } from "./route";

export type StepPriority = "CRITICAL" | "PERMANENT_POWER" | "ASCENDANCY" | "IMPORTANT" | "BUILD_OPTIONAL" | "SKIP";

export const PRIORITY_LABEL: Record<StepPriority, string> = {
  CRITICAL: "Critical",
  PERMANENT_POWER: "Permanent power",
  ASCENDANCY: "Ascendancy",
  IMPORTANT: "Important",
  BUILD_OPTIONAL: "Build optional",
  SKIP: "Skippable",
};

export interface PrioritisedStep {
  priority: StepPriority;
  /** Why (shown on hover). */
  why: string;
}

/** Priority of every step of a resolved route. */
export function prioritise(steps: readonly ResolvedStep[], route: RouteData, rewards: readonly CampaignReward[]): PrioritisedStep[] {
  const books = new Map(rewards.filter((r) => r.type === "passive-points" || r.type === "respec-points" || r.type === "bandit-choice").map((r) => [r.questId, r]));
  const pantheon = rewards.filter((r) => r.type === "pantheon");
  const bookAreas = new Map(rewards.filter((r) => (r.type === "passive-points" || r.type === "respec-points") && r.objectiveArea).map((r) => [r.objectiveArea!, r]));
  const pantheonAreas = new Map(pantheon.map((r) => [r.objectiveArea!, r]));

  return steps.map((s): PrioritisedStep => {
    const handInBooks = s.kind === "hand-in" ? (s.quests ?? []).map((q) => books.get(q.id)).filter((r): r is CampaignReward => !!r) : [];
    const pointBook = handInBooks.find((r) => r.type !== "bandit-choice");
    if (pointBook)
      return { priority: "PERMANENT_POWER", why: `Hand-in for ${pointBook.quest} (${pointBook.type === "respec-points" ? "respec points" : `${pointBook.points} passive point${pointBook.points === 1 ? "" : "s"}`}).` };
    // Killing or helping a bandit shares areas with The Way Forward's objective, but it's the bandit choice.
    if (s.kills?.some((k) => /^(Alira|Kraityn|Oak)\b/.test(k)))
      return { priority: "IMPORTANT", why: "Bandit choice: a passive point (Kill all) or a bandit's bonus." };
    const objectiveFor = bookAreas.get(s.area);
    if (objectiveFor && (s.kind === "kill" || s.kind === "quest-item" || s.kind === "other"))
      return { priority: "PERMANENT_POWER", why: `Objective of ${objectiveFor.quest} (${objectiveFor.type === "respec-points" ? "respec points" : "passive point"}).` };
    if (s.kind === "trial" || s.kind === "labyrinth" || s.labTrip) return { priority: "ASCENDANCY", why: "Trials of Ascendancy and Labyrinths give Ascendancy points." };
    if (s.when?.flag.startsWith("BANDIT") || handInBooks.some((r) => r.type === "bandit-choice"))
      return { priority: "IMPORTANT", why: "Bandit choice: a passive point (Kill all) or a bandit's bonus." };
    const god = pantheonAreas.get(s.area);
    if ((god && s.kills?.length) || /Pantheon/i.test(s.text)) return { priority: "IMPORTANT", why: god ? `Unlocks ${god.pantheon!.god} (Pantheon).` : "Choose your Pantheon powers." };
    if (s.kind === "crafting") return { priority: "SKIP", why: "Crafting recipe: useful, not needed to finish the campaign." };
    if (s.kind === "hand-in") {
      const gemOnly = (s.quests ?? []).every((q) => (route.quests[q.id]?.gemRewards ?? 0) > 0 && !route.quests[q.id]?.book);
      if (gemOnly) return { priority: "BUILD_OPTIONAL", why: "Hand-in for a skill gem — only if your build wants one." };
    }
    if (s.when?.flag === "LEAGUE_START" && !s.when.negate) return { priority: "BUILD_OPTIONAL", why: "League-start extra (gear, flasks, gems)." };
    return { priority: "CRITICAL", why: s.to ? "Moves you on through the campaign." : "Part of the main progression." };
  });
}

export const isImportantStep = (p: PrioritisedStep) => p.priority !== "BUILD_OPTIONAL" && p.priority !== "SKIP";
