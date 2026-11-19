/**
 * Permanent campaign rewards the Passive Skill Point Guardian watches (PoE 1, Acts 1–10). Hand-checked; never
 * generated. Every entry carries two provenances: the reward itself (exists, amount) and its details (objective,
 * area, NPC).
 *
 * Passive points — VERIFIED from the game's own output: `/passives` in a real 3.27–3.30 client log prints
 * "N Passive Skill Points from quests:" followed by one "(n from <Quest>)" line per quest in this order; quest
 * names and amounts below are copied from it (22 Book of Skill quests = 23 points, An End to Hunger gives 2; Deal
 * with the Bandits gives 1 only when all three bandits are killed). The exile-leveling route says the same
 * ("all 24 passives from quests" with Kill all, 23 otherwise) and PoEDB lists the same Book of Skill quests.
 * Objective areas: the route's kill / pick-up steps, checked against the game's area ids (RePoE world_areas,
 * whose boss list also confirms e.g. Greust = Ralakesh in The Ashen Fields).
 *
 * Respec points — PoEDB lists Book of Regrets for these four quests and exile-leveling's quest data (from the game
 * files) has a book item for exactly these four plus the 22 above (`Book-a1q8` …), with the NPC who gives it. The
 * amounts are not in any source we read, and the log's "You have received a Passive Respec Point." lines also come
 * in bursts unrelated to quests, so they can't be attributed by count. Shown with amount "unknown", confirmed by hand.
 */
import type { BanditChoice, CampaignReward, Provenance, Source } from "./types";

export const SOURCES: Source[] = [
  { id: "client-log", name: "Your Client.txt (/passives output, reward lines)", url: null, license: null, kind: "game-output" },
  { id: "repoe", name: "RePoE fork — world_areas.json (game files 3.30.0.2.2)", url: "https://repoe-fork.github.io/world_areas.json", license: "Game data (Grinding Gear Games)", kind: "game-data" },
  { id: "exile-leveling", name: "exile-leveling (HeartofPhos) — levelling route", url: "https://github.com/HeartofPhos/exile-leveling", license: "MIT", kind: "community" },
  { id: "poedb", name: "PoEDB — Quest rewards", url: "https://poedb.tw/us/Quest", license: null, kind: "community" },
];

const CHECKED = "2026-11-19";
const VERSION = "3.30";

const passiveProof: Provenance = {
  sources: ["client-log", "exile-leveling", "poedb"],
  verification: "VERIFIED",
  lastVerified: CHECKED,
  gameVersion: VERSION,
  notes: "Name and amount as printed by /passives in the game client.",
};
const routeDetails = (notes?: string): Provenance => ({
  sources: ["exile-leveling", "repoe"],
  verification: "COMMUNITY_VERIFIED",
  lastVerified: CHECKED,
  gameVersion: VERSION,
  ...(notes ? { notes } : {}),
});

function passive(
  act: number,
  quest: string,
  questId: string,
  points: number,
  objectiveArea: string,
  objective: string,
  npc: string,
  detailsNote?: string,
): CampaignReward {
  return {
    id: `passive.${questId}`,
    type: "passive-points",
    act,
    quest,
    questId,
    points,
    objectiveArea,
    objective,
    npc,
    requires: [],
    requiredForPoints: true,
    onDefaultRoute: true,
    provenance: passiveProof,
    details: routeDetails(detailsNote),
  };
}

/** In the order `/passives` prints them (= campaign order). */
export const PASSIVE_REWARDS: CampaignReward[] = [
  passive(1, "The Dweller of the Deep", "a1q7", 1, "1_1_4_0", "Kill The Dweller of the Deep in The Flooded Depths.", "Tarkleigh"),
  passive(1, "The Marooned Mariner", "a1q6", 1, "1_1_9", "Kill Captain Fairgraves in The Ship Graveyard and take the Allflame.", "Bestel"),
  passive(1, "The Way Forward", "a1q9", 1, "1_2_9", "Kill Captain Arteri in The Western Forest, take the Thaumetic Emblem and open the Thaumetic Seal.", "Bestel", "Handed in at Lioneye's Watch (Act 1 town) during Act 2."),
  passive(2, "Through Sacred Ground", "a2q5", 1, "1_2_5_2", "Take the Golden Hand from the altar in The Crypt Level 2.", "Yeena"),
  {
    id: "passive.a2q7",
    type: "bandit-choice",
    act: 2,
    quest: "Deal with the Bandits",
    questId: "a2q7",
    points: 1,
    objectiveArea: null,
    objective: "Kill Kraityn (The Broken Bridge), Alira (The Western Forest) and Oak (The Wetlands) for the passive point — or help one of them for their bonus instead (no point).",
    npc: "Eramir",
    requires: [],
    requiredForPoints: true,
    onDefaultRoute: true,
    provenance: { ...passiveProof, notes: "/passives prints \"(0 from Deal with the Bandits)\" after helping a bandit, 1 after killing all three." },
    details: routeDetails("Bandit areas from the route's bandit branches."),
  },
  passive(3, "Victario's Secrets", "a3q11", 1, "1_3_10_1", "Find the three Platinum Busts in The Sewers.", "Hargan"),
  passive(3, "Piety's Pets", "a3q9", 1, "1_3_14_2", "Kill Piety in The Lunaris Temple Level 2.", "Grigor"),
  passive(4, "An Indomitable Spirit", "a4q6", 1, "1_4_3_2", "Free Deshret's spirit in The Mines Level 2.", "Tasuni"),
  passive(5, "In Service to Science", "a5q3", 1, "1_5_2", "Take the Miasmeter in The Control Blocks.", "Vilenta"),
  passive(5, "Kitava's Torments", "a5q7", 1, "1_5_7", "Find the three Kitava's Torments in The Reliquary.", "Lani"),
  passive(6, "The Father of War", "a6q3", 1, "2_6_5", "Kill Tukohama in The Karui Fortress (Tukohama's Keep).", "Tarkleigh"),
  passive(6, "The Puppet Mistress", "a6q6", 1, "2_6_11", "Kill Ryslatha in The Wetlands (The Spawning Ground).", "Tarkleigh"),
  passive(6, "The Cloven One", "a6q7", 1, "2_6_8", "Kill Abberath at Prisoner's Gate (Valley of the Fire Drinker).", "Bestel"),
  passive(7, "The Master of a Million Faces", "a7q1", 1, "2_7_7", "Kill Greust (Ralakesh) in The Ashen Fields (The Forest Encampment).", "Eramir", "Game files list Ralakesh/Greust as the Ashen Fields boss."),
  passive(7, "Queen of Despair", "a7q9", 1, "2_7_9", "Kill Gruthkul in The Dread Thicket (Den of Despair).", "Eramir"),
  passive(7, "Kishara's Star", "a7q6", 1, "2_7_10", "Take Kishara's Star in The Causeway.", "Weylam Roth"),
  passive(8, "Love is Dead", "a8q6", 1, "2_8_8", "Take the Ankh of Eternity in The Quay, then kill Tolman.", "Clarissa"),
  passive(8, "Reflection of Terror", "a8q4", 1, "2_8_4", "Kill Yugul in The High Gardens (The Pools of Terror).", "Hargan"),
  passive(8, "The Gemling Legion", "a8q7", 1, "2_8_9", "Kill the Gemling Legionnaires in The Grain Gate.", "Maramoa"),
  passive(9, "Queen of the Sands", "a9q5", 1, "2_9_4", "Kill Shakari in The Oasis (The Sand Pit).", "Irasha"),
  passive(9, "The Ruler of Highgate", "a9q2", 1, "2_9_8", "Kill Garukhan in The Quarry (Shrine of the Winds).", "Irasha"),
  passive(10, "Vilenta's Vengeance", "a10q6", 1, "2_10_7", "Kill Vilenta in The Control Blocks.", "Lani"),
  passive(10, "An End to Hunger", "a10q3", 2, "2_10_6", "Kill Kitava in The Feeding Trough (Altar of Hunger).", "Lani", "Handed in at Karui Shores after leaving Oriath."),
];

const regrets = (
  act: number,
  quest: string,
  questId: string | null,
  objectiveArea: string | null,
  objective: string,
  npc: string | null,
  onDefaultRoute: boolean,
  details: Provenance,
): CampaignReward => ({
  id: `refund.${questId ?? quest.toLowerCase().replace(/\W+/g, "-")}`,
  type: "respec-points",
  act,
  quest,
  questId,
  points: null,
  objectiveArea,
  objective,
  npc,
  requires: [],
  requiredForPoints: false,
  onDefaultRoute,
  provenance: {
    sources: ["poedb", "exile-leveling"],
    verification: "COMMUNITY_VERIFIED",
    lastVerified: CHECKED,
    gameVersion: VERSION,
    notes: "Book of Regrets (PoEDB; book item in the quest data). The number of respec points is not in our sources.",
  },
  details,
});

const unverifiedDetails: Provenance = {
  sources: [],
  verification: "UNVERIFIED",
  lastVerified: CHECKED,
  gameVersion: VERSION,
  notes: "Objective and area not in our sources yet — confirm in game.",
};

const npcOnly: Provenance = { ...unverifiedDetails, verification: "PARTIALLY_VERIFIED", sources: ["exile-leveling"], notes: "NPC from the quest data; objective and area not in our sources yet — confirm in game." };

export const REFUND_REWARDS: CampaignReward[] = [
  regrets(1, "A Dirty Job", "a1q8", "1_1_3a", "Clear The Fetid Pool.", "Tarkleigh", false, { ...npcOnly, notes: "NPC from the quest data; the area (The Fetid Pool) is from community knowledge, not a source we read. Not on the levelling route." }),
  regrets(6, "Fallen from Grace", "a6q4", "2_6_1", "Kill the monsters on The Twilight Strand.", "Lilly Roth", true, routeDetails()),
  regrets(9, "Fastis Fortuna", "a9q4", null, "Optional Act 9 quest (not on the levelling route).", "Petarus and Vanja", false, npcOnly),
  regrets(10, "No Love for Old Ghosts", "a10q4", null, "Optional Act 10 quest (not on the levelling route).", "Weylam Roth", false, npcOnly),
];

/**
 * Pantheon powers — PoEDB "The Pantheon" (read 2026-11-19) lists the four major and eight minor gods and the Act
 * 6–9 quest whose boss unlocks each; the exile-leveling route kills the same bosses and has a "Select Pantheons"
 * step in Lioneye's Watch right after The Brine King. Not in Client.txt: confirmed by hand.
 */
const pantheonProof: Provenance = {
  sources: ["poedb", "exile-leveling"],
  verification: "COMMUNITY_VERIFIED",
  lastVerified: CHECKED,
  gameVersion: VERSION,
  notes: "PoEDB lists the unlocking quest; the route kills the same boss. Upgrades (Divine Vessels) are endgame and not tracked.",
};
const god = (tier: "major" | "minor", godName: string, act: number, quest: string, questId: string, objectiveArea: string, objective: string): CampaignReward => ({
  id: `pantheon.${godName.toLowerCase().replace(/\W+/g, "-")}`,
  type: "pantheon",
  act,
  quest,
  questId,
  points: null,
  objectiveArea,
  objective,
  npc: null,
  requires: [],
  requiredForPoints: false,
  onDefaultRoute: true,
  provenance: pantheonProof,
  details: routeDetails(),
  pantheon: { god: `Soul of ${godName}`, tier },
});

export const PANTHEON_REWARDS: CampaignReward[] = [
  god("major", "The Brine King", 6, "The Brine King", "a6q1", "2_6_15", "Kill Tsoagoth, The Brine King at The Brine King's Reef."),
  god("minor", "Tukohama", 6, "The Father of War", "a6q3", "2_6_5", "Kill Tukohama in The Karui Fortress."),
  god("minor", "Ryslatha", 6, "The Puppet Mistress", "a6q6", "2_6_11", "Kill Ryslatha in The Wetlands."),
  god("minor", "Abberath", 6, "The Cloven One", "a6q7", "2_6_8", "Kill Abberath at Prisoner's Gate."),
  god("minor", "Ralakesh", 7, "The Master of a Million Faces", "a7q1", "2_7_7", "Kill Greust (Ralakesh) in The Ashen Fields."),
  god("minor", "Gruthkul", 7, "Queen of Despair", "a7q9", "2_7_9", "Kill Gruthkul in The Dread Thicket."),
  god("major", "Arakaali", 7, "The Mother of Spiders", "a7q4", "2_7_12_2", "Kill Arakaali in The Temple of Decay Level 2."),
  god("major", "Solaris", 8, "Solar Eclipse", "a8q3", "2_8_13", "Kill Solaris (with Lunaris) at The Harbour Bridge."),
  god("major", "Lunaris", 8, "Lunar Eclipse", "a8q2", "2_8_13", "Kill Lunaris (with Solaris) at The Harbour Bridge."),
  god("minor", "Yugul", 8, "Reflection of Terror", "a8q4", "2_8_4", "Kill Yugul in The High Gardens."),
  god("minor", "Shakari", 9, "Queen of the Sands", "a9q5", "2_9_4", "Kill Shakari in The Oasis."),
  god("minor", "Garukhan", 9, "The Ruler of Highgate", "a9q2", "2_9_8", "Kill Garukhan in The Quarry."),
];

export const ALL_REWARDS: CampaignReward[] = [...PASSIVE_REWARDS, ...REFUND_REWARDS, ...PANTHEON_REWARDS];

/** Expected quest passive points for a bandit choice: 24 with Kill all, 23 otherwise. */
export function expectedQuestPoints(bandit: BanditChoice): number {
  return PASSIVE_REWARDS.reduce((n, r) => n + (r.type === "bandit-choice" ? (bandit === "kill" ? (r.points ?? 0) : 0) : (r.points ?? 0)), 0);
}

export const BANDITS: { id: BanditChoice; label: string; effect: string }[] = [
  { id: "kill", label: "Kill all", effect: "+1 Passive Skill Point" },
  { id: "alira", label: "Help Alira", effect: "Alira's bonus instead of the point" },
  { id: "kraityn", label: "Help Kraityn", effect: "Kraityn's bonus instead of the point" },
  { id: "oak", label: "Help Oak", effect: "Oak's bonus instead of the point" },
];
