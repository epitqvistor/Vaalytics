/**
 * Quest Intelligence (pure): what each Act 1–10 quest matters for, from the reward database and the quest data.
 * - passive / refund: in the reward database (Book of Skill / Book of Regrets, verified above).
 * - gem: the quest data lists class gem rewards.
 * - route: handed in on the levelling route (main progression plus the rewards the route collects).
 * - optional: not on the levelling route.
 * - pantheon: its boss unlocks a Pantheon power (PoEDB).
 * Ascendancy objectives are route steps (trials, Labyrinths), not quests.
 */
import type { CampaignReward, QuestCategory, RouteData } from "../data/types";

export interface QuestInfo {
  id: string;
  name: string;
  act: number;
  npcs: string[];
  categories: QuestCategory[];
  /** Highest-priority category, for sorting and the "important only" filter. */
  primary: QuestCategory;
  reward: CampaignReward | null;
}

const ORDER: QuestCategory[] = ["passive", "refund", "ascendancy", "pantheon", "main", "gem", "optional"];

export function classifyQuests(route: RouteData, rewards: readonly CampaignReward[]): QuestInfo[] {
  const byQuest = new Map(rewards.filter((r) => r.questId && r.type !== "pantheon").map((r) => [r.questId!, r]));
  const pantheonQuests = new Set(rewards.filter((r) => r.type === "pantheon").map((r) => r.questId));
  const out: QuestInfo[] = [];
  for (const [id, q] of Object.entries(route.quests)) {
    const reward = byQuest.get(id) ?? null;
    const cats = new Set<QuestCategory>();
    if (reward?.type === "passive-points" || reward?.type === "bandit-choice") cats.add("passive");
    if (reward?.type === "respec-points") cats.add("refund");
    if (pantheonQuests.has(id)) cats.add("pantheon");
    if (q.onRoute) cats.add("main");
    if (q.gemRewards > 0) cats.add("gem");
    if (!q.onRoute && !reward && !pantheonQuests.has(id)) cats.add("optional");
    const categories = ORDER.filter((c) => cats.has(c));
    out.push({ id, name: q.name, act: q.act, npcs: q.npcs, categories, primary: categories[0] ?? "optional", reward });
  }
  return out.sort((a, b) => a.act - b.act || ORDER.indexOf(a.primary) - ORDER.indexOf(b.primary) || a.name.localeCompare(b.name));
}

/** "Show only important quests": passive points, refunds and the levelling route; gem-only and optional hidden. */
export const isImportant = (q: QuestInfo) => q.categories.some((c) => c === "passive" || c === "refund" || c === "main" || c === "ascendancy" || c === "pantheon");
