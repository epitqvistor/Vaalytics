/**
 * Dataset checks run on load (and in tests): every area and quest the route or the reward database mentions must
 * exist, each passive reward must be handed in on the default route, and the point totals must match the game's
 * (24 with Kill all, 23 otherwise). Problems are reported, never thrown at the UI.
 */
import type { CampaignReward, RouteData } from "./types";

export interface ValidationIssue {
  severity: "error" | "warning";
  where: string;
  message: string;
}

/** `knownArea(id)`: true when the id is a campaign area of the game data (Location Atlas dataset). */
export function validateRoute(route: RouteData, knownArea: (id: string) => boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (where: string, message: string) => issues.push({ severity: "error", where, message });
  const area = (id: string) => knownArea(id) || id in route.extraAreas;
  const ids = new Set<string>();
  let lastAct = 0;
  for (const s of route.steps) {
    if (ids.has(s.id)) err(s.id, "duplicate step id");
    ids.add(s.id);
    if (s.act < lastAct) err(s.id, "acts out of order");
    lastAct = s.act;
    if (!area(s.area)) err(s.id, `unknown area ${s.area}`);
    for (const e of s.enters ?? []) if (!area(e)) err(s.id, `unknown area ${e}`);
    if (s.waypointTo && !area(s.waypointTo)) err(s.id, `unknown area ${s.waypointTo}`);
    if (s.when && !route.blocks[s.when.block]) err(s.id, `unknown block ${s.when.block}`);
    if (!s.text.trim()) err(s.id, "empty instruction");
  }
  if (lastAct !== 10) err("route", `route ends in act ${lastAct}, expected 10`);
  return issues;
}

export function validateRewards(rewards: readonly CampaignReward[], route: RouteData, knownArea: (id: string) => boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (where: string, message: string) => issues.push({ severity: "error", where, message });
  const handIns = new Map<string, string[]>();
  for (const s of route.steps)
    if (s.kind === "hand-in") for (const q of s.quests ?? []) handIns.set(q.id, [...(handIns.get(q.id) ?? []), s.when?.block ?? ""]);
  const seen = new Set<string>();
  for (const r of rewards) {
    if (seen.has(r.id)) err(r.id, "duplicate reward id");
    seen.add(r.id);
    if (r.objectiveArea && !knownArea(r.objectiveArea)) err(r.id, `unknown area ${r.objectiveArea}`);
    // Book rewards are handed in to an NPC; Pantheon souls come from the boss kill, not a hand-in.
    if (r.onDefaultRoute && r.type !== "pantheon") {
      if (!r.questId) err(r.id, "on the default route but without a quest id");
      else if (!handIns.has(r.questId)) err(r.id, `no hand-in for ${r.questId} in the route`);
    }
    if (r.type === "pantheon" && r.objectiveArea && !route.steps.some((s) => s.area === r.objectiveArea && s.kills?.length))
      err(r.id, `no boss kill in ${r.objectiveArea} on the route`);
    if (r.type === "passive-points" && (r.points ?? 0) < 1) err(r.id, "passive reward without points");
    if (r.questId) {
      const q = route.quests[r.questId];
      if (!q) err(r.id, `unknown quest ${r.questId}`);
      else {
        if (q.name !== r.quest) err(r.id, `quest name "${r.quest}" ≠ quest data "${q.name}"`);
        // Books of Skill / Regrets are quest items in the game data; the bandit point is not a book.
        if ((r.type === "passive-points" || r.type === "respec-points") && !q.book) err(r.id, "no book reward in the quest data");
        if (r.npc && !q.npcs.includes(r.npc)) issues.push({ severity: "warning", where: r.id, message: `NPC ${r.npc} not in the quest data (${q.npcs.join(", ")})` });
      }
    }
    if (!r.provenance.lastVerified || !r.provenance.gameVersion) err(r.id, "provenance incomplete");
  }
  const passives = rewards.filter((r) => r.type === "passive-points" || r.type === "bandit-choice");
  const total = passives.reduce((n, r) => n + (r.points ?? 0), 0);
  if (total !== 24) err("rewards", `quest passive points add up to ${total}, the game gives 24 (Kill all)`);
  const books = rewards.filter((r) => r.type === "passive-points").length;
  if (books !== 22) err("rewards", `${books} Book of Skill quests, the game has 22`);
  // Every book in the quest data is covered (Skill or Regrets) — a new book after a patch is reported.
  const covered = new Set(rewards.filter((r) => r.type !== "pantheon").map((r) => r.questId));
  if (rewards.filter((r) => r.type === "pantheon").length !== 12) err("rewards", "the Pantheon has 4 major and 8 minor gods");
  for (const [id, q] of Object.entries(route.quests)) if (q.book && !covered.has(id)) err(id, `quest ${q.name} rewards ${q.book} but isn't in the reward database`);
  return issues;
}
