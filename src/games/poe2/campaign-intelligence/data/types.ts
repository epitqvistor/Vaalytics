/**
 * Campaign knowledge schema (PoE 2). A dataset is one patch's campaign as a
 * dependency graph: parts (acts/interludes) → zones → objectives → rewards,
 * plus quest items. All text lives in data files, never in UI components.
 * Spec: docs/modules/campaign-intelligence.md
 */

/** How sure the dataset is about an entry. */
export type Verification =
  /** Agreeing sources (≥ 2), or one source plus evidence from a real client log. */
  | "confirmed"
  /** Sources disagree; the disagreement is recorded in `conflicts`. Never shown as fact. */
  | "conflict"
  /** One source only; shown with an "unverified" mark. */
  | "unverified";

export type SourceId = "pathofexile-gg" | "wdguide" | "metabot" | "metabot-bonuses" | "client-log";

export interface CampaignSource {
  id: SourceId;
  label: string;
  url: string | null;
  /** Patch the source says it targets. */
  patch: string;
  /** ISO date the source was read for this dataset. */
  checked: string;
  /** Community walkthroughs give recommendations; the log gives observed facts. */
  kind: "community-guide" | "observed-log";
}

export interface Conflict {
  source: SourceId;
  says: string;
}

export interface Provenance {
  verification: Verification;
  sources: SourceId[];
  conflicts?: Conflict[];
  note?: string;
}

export type PartId = "act1" | "act2" | "act3" | "act4" | "int1" | "int2" | "int3";

export interface CampaignPart {
  id: PartId;
  name: string;
  kind: "act" | "interlude";
  /** Town / hub zone. */
  town: string;
  /** All of these objectives must be done before the part opens (empty = start). */
  opensAfter: string[];
}

export type ZoneKind = "town" | "zone" | "trial";

export interface CampaignZone {
  /** Stable dataset id, e.g. `a1.clearfell`. */
  id: string;
  part: PartId;
  name: string;
  /**
   * Internal area ids from `Generating level … area "<id>"`. Empty when the id
   * has not been seen in a real log yet — then only the display name (from
   * `[SCENE] Set Source [<name>]`) can match it.
   */
  areaIds: string[];
  kind: ZoneKind;
  /** Area levels seen in a real log; several values = the level depends on the order the zones are done. */
  levels: number[];
  /** Zones you can walk into from here (observed transitions, not geography). */
  connects: string[];
  /** Reached from the part's hub by travel (Desert Map caravan, Kingsmarch ship) rather than by walking. */
  hubTravel?: boolean;
  /** Objectives that open this zone (main-route gates). Entering the zone proves them done (inferred). */
  opensAfter?: string[];
  provenance: Provenance;
}

export type ObjectiveKind = "main" | "optional";

/** What an objective is worth to a player; drives scoring per campaign mode. */
export type ObjectiveCategory =
  | "progression"
  | "passive"
  | "spirit"
  | "resistance"
  | "life-mana"
  | "charm"
  | "choice"
  | "ascendancy"
  | "unlock"
  | "optional-boss"
  | "quest-item";

/**
 * Signals from Client.txt that relate to an objective. Each one is a line format
 * verified against a real PoE 2 log (docs/modules/campaign-intelligence.md):
 * - `area`: the player entered one of these zones (never completion on its own);
 * - `passive-points`: "You have received N Passive Skill Points." while in one of
 *   these zones — confirms points were applied; attributing them to this objective
 *   is an inference from the zone;
 * - `ascended`: the class in the level-up line changed (base class → ascendancy).
 */
export type DetectionSignal =
  | { kind: "passive-points"; zones: string[]; amount: number }
  | { kind: "ascended" };

export interface CampaignObjective {
  id: string;
  part: PartId;
  /** Where the objective is done. */
  zone: string;
  /** Where the reward is claimed, when different (e.g. an NPC in town). */
  turnIn?: string;
  title: string;
  kind: ObjectiveKind;
  categories: ObjectiveCategory[];
  /** All of these must be done first (a game rule: verified gate). */
  requires: string[];
  /**
   * Community route order, not a game rule: the engine prefers doing these first
   * but never treats them as a gate.
   */
  recommendedAfter?: string[];
  /**
   * Speaker names (NPC/boss) whose dialogue lines were observed in this zone in a
   * real log. Dialogue proves an encounter at most — never a kill or a claim.
   */
  encounterSpeakers?: string[];
  /** Ordered, short, actionable steps. */
  steps: string[];
  /** Why it matters, one sentence. */
  why: string;
  /** What to do afterwards, one sentence (optional; the engine also derives it). */
  after?: string;
  /** Common mistakes worth a warning. */
  mistakes?: string[];
  rewards: string[];
  /** Quest items this objective needs / produces. */
  needsItems?: string[];
  givesItems?: string[];
  detection?: DetectionSignal;
  provenance: Provenance;
}

export type RewardCategory =
  | "passive"
  | "spirit"
  | "resistance"
  | "life"
  | "mana"
  | "charm"
  | "choice"
  | "ascendancy"
  | "unlock"
  | "item";

/** How the reward is actually obtained once the objective is done. */
export type ClaimKind = "boss-kill" | "book" | "npc" | "altar" | "consume" | "choice";

export interface CampaignReward {
  id: string;
  objective: string;
  category: RewardCategory;
  /** Short display text, e.g. "+30 Spirit". */
  label: string;
  /** Numeric amount when meaningful (points, spirit, %). */
  amount?: number;
  /** For choice rewards: the options (only one is granted). */
  choices?: string[];
  /** Choice can be changed later at the same place. */
  swappable?: boolean;
  /** Counts toward permanent character power (Reward Guardian). */
  permanent: boolean;
  claim: ClaimKind;
  /** Exact claim condition in one sentence. */
  claimCondition: string;
  provenance: Provenance;
}

export interface QuestItem {
  id: string;
  name: string;
  /** Objective that produces it. */
  from: string;
  /** Objective that consumes it. */
  usedBy: string;
  hint: string;
  provenance: Provenance;
}

export interface CampaignDataset {
  game: "poe2";
  /** Game patch the dataset describes, e.g. "0.5.5". */
  patch: string;
  name: string;
  /** ISO date of the last verification pass. */
  verifiedOn: string;
  sources: CampaignSource[];
  parts: CampaignPart[];
  zones: CampaignZone[];
  objectives: CampaignObjective[];
  rewards: CampaignReward[];
  items: QuestItem[];
}
