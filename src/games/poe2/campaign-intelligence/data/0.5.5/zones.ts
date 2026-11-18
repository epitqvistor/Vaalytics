/**
 * 0.5.5 campaign zones. Area ids, display names and levels come from a real
 * Client.txt (`Generating level N area "<id>"` + `[SCENE] Set Source [<name>]`);
 * `connects` are walking transitions observed at least twice in that log (town
 * returns and waypoint jumps excluded). Zones not seen in the log have no area id
 * and match by name only.
 */
import type { CampaignPart, CampaignZone, PartId, ZoneKind } from "../types";
import { LOGGED, conflict, unverified } from "../sources";

export const PARTS: CampaignPart[] = [
  { id: "act1", name: "Act 1", kind: "act", town: "a1.town", opensAfter: [] },
  { id: "act2", name: "Act 2", kind: "act", town: "a2.town", opensAfter: ["a1.geonor"] },
  { id: "act3", name: "Act 3", kind: "act", town: "a3.town", opensAfter: ["a2.jamanra"] },
  { id: "act4", name: "Act 4", kind: "act", town: "a4.town", opensAfter: ["a3.doryani"] },
  { id: "int1", name: "Interlude I — The Curse of Holten", kind: "interlude", town: "i1.town", opensAfter: ["a4.tavakai"] },
  { id: "int2", name: "Interlude II — The Stolen Barya", kind: "interlude", town: "i2.town", opensAfter: ["a4.tavakai"] },
  { id: "int3", name: "Interlude III — Doryani's Contingency", kind: "interlude", town: "i3.town", opensAfter: ["a4.tavakai"] },
];

type Extra = Partial<Pick<CampaignZone, "hubTravel" | "opensAfter" | "provenance">>;
const z = (
  id: string,
  part: PartId,
  name: string,
  areaIds: string[],
  levels: number[],
  connects: string[] = [],
  extra: Extra = {},
  kind: ZoneKind = "zone",
): CampaignZone => ({ id, part, name, areaIds, kind, levels, connects, provenance: LOGGED, ...extra });
/** `connects`: zones you walk into straight from town (frequent town → zone transitions in the real log). */
const town = (id: string, part: PartId, name: string, areaId: string, level: number, connects: string[] = []): CampaignZone =>
  z(id, part, name, [areaId], [level], connects, {}, "town");

/** Islands are reached by ship: being on one proves the player set sail from Kingsmarch. */
const sailed = (zones: CampaignZone[]): CampaignZone[] =>
  zones.map((zone) => (zone.part === "act4" && zone.hubTravel ? { ...zone, opensAfter: ["a4.arrival", ...(zone.opensAfter ?? [])] } : zone));

export const ZONES: CampaignZone[] = sailed([
  // ── Act 1 ──────────────────────────────────────────────────────────────
  town("a1.town", "act1", "Clearfell Encampment", "G1_town", 15, ["a1.clearfell"]),
  z("a1.riverbank", "act1", "The Riverbank", ["G1_1"], [1], ["a1.town"]),
  z("a1.clearfell", "act1", "Clearfell", ["G1_2"], [2], ["a1.mud-burrow", "a1.grelwood"], { opensAfter: ["a1.miller"] }),
  z("a1.mud-burrow", "act1", "Mud Burrow", ["G1_3"], [3], ["a1.clearfell"]),
  z("a1.grelwood", "act1", "The Grelwood", ["G1_4"], [4], ["a1.red-vale", "a1.grim-tangle"]),
  z("a1.red-vale", "act1", "The Red Vale", ["G1_5"], [5], ["a1.grelwood"]),
  z("a1.grim-tangle", "act1", "The Grim Tangle", ["G1_6"], [6], ["a1.cemetery"], { opensAfter: ["a1.runic-seals"] }),
  z("a1.cemetery", "act1", "Cemetery of the Eternals", ["G1_7"], [7], ["a1.mausoleum", "a1.tomb", "a1.hunting-grounds"]),
  z("a1.mausoleum", "act1", "Mausoleum of the Praetor", ["G1_8"], [8, 9], ["a1.cemetery"]),
  z("a1.tomb", "act1", "Tomb of the Consort", ["G1_9"], [8, 9], ["a1.cemetery"]),
  z("a1.hunting-grounds", "act1", "Hunting Grounds", ["G1_11"], [10], ["a1.freythorn", "a1.farmlands"], { opensAfter: ["a1.lachlann"] }),
  z("a1.freythorn", "act1", "Freythorn", ["G1_12"], [11], ["a1.hunting-grounds"]),
  z("a1.farmlands", "act1", "Ogham Farmlands", ["G1_13_1"], [12], ["a1.village"]),
  z("a1.village", "act1", "Ogham Village", ["G1_13_2"], [13], ["a1.ramparts"]),
  z("a1.ramparts", "act1", "The Manor Ramparts", ["G1_14"], [14], ["a1.manor"], { opensAfter: ["a1.village-executioner"] }),
  z("a1.manor", "act1", "Ogham Manor", ["G1_15"], [15], []),

  // ── Act 2 (Desert Map: destinations are reached from the Ardura Caravan) ─
  town("a2.town", "act2", "The Ardura Caravan", "G2_town", 32),
  z("a2.outskirts", "act2", "Vastiri Outskirts", ["G2_1"], [16], ["a2.town"]),
  z("a2.quarry", "act2", "Mawdun Quarry", ["G2_10_1"], [17], ["a2.mine"], { hubTravel: true, opensAfter: ["a2.outskirts"] }),
  z("a2.mine", "act2", "Mawdun Mine", ["G2_10_2"], [18], []),
  z("a2.traitors-passage", "act2", "Traitor's Passage", ["G2_2"], [19], ["a2.halani-gates"], { hubTravel: true }),
  z("a2.halani-gates", "act2", "The Halani Gates", ["G2_3", "G2_3a"], [20], [], { hubTravel: true }),
  z("a2.sekhemas", "act2", "Trial of the Sekhemas", ["G2_13"], [22], [], { hubTravel: true }, "trial"),
  z("a2.keth", "act2", "Keth", ["G2_4_1"], [21, 23, 25], ["a2.lost-city"], { hubTravel: true, opensAfter: ["a2.halani"] }),
  z("a2.lost-city", "act2", "The Lost City", ["G2_4_2"], [22, 24, 26], ["a2.buried-shrines"]),
  z("a2.buried-shrines", "act2", "Buried Shrines", ["G2_4_3"], [23, 25], []),
  z("a2.badlands", "act2", "Mastodon Badlands", ["G2_5_1"], [21, 24, 26], ["a2.bone-pits"], { hubTravel: true, opensAfter: ["a2.halani"] }),
  z("a2.bone-pits", "act2", "The Bone Pits", ["G2_5_2"], [22, 25, 27], []),
  z("a2.valley", "act2", "Valley of the Titans", ["G2_6"], [21, 24, 26], ["a2.grotto"], { hubTravel: true, opensAfter: ["a2.halani"] }),
  z("a2.grotto", "act2", "The Titan Grotto", ["G2_7"], [22, 25, 27], ["a2.valley"]),
  z("a2.deshar", "act2", "Deshar", ["G2_8"], [28], ["a2.mourning"], { hubTravel: true }),
  z("a2.mourning", "act2", "Path of Mourning", ["G2_9_1"], [29], ["a2.spires"]),
  z("a2.spires", "act2", "The Spires of Deshar", ["G2_9_2"], [30], []),
  z("a2.dreadnought", "act2", "The Dreadnought", ["G2_12", "G2_12_1"], [31], ["a2.vanguard"], { hubTravel: true }),
  z("a2.vanguard", "act2", "Dreadnought Vanguard", ["G2_12_2"], [32], []),

  // ── Act 3 ──────────────────────────────────────────────────────────────
  town("a3.town", "act3", "Ziggurat Encampment", "G3_town", 44, ["a3.jungle-ruins", "a3.drowned-city", "a3.kopec", "a3.utzaal"]),
  z("a3.marsh", "act3", "Sandswept Marsh", ["G3_1"], [33], ["a3.town"]),
  z("a3.jungle-ruins", "act3", "Jungle Ruins", ["G3_3"], [34], ["a3.venom-crypts", "a3.barrens"]),
  z("a3.venom-crypts", "act3", "The Venom Crypts", ["G3_4"], [35], ["a3.jungle-ruins"]),
  z("a3.barrens", "act3", "Infested Barrens", ["G3_2_1"], [35], ["a3.chimeral", "a3.waterways", "a3.azak-bog"]),
  z("a3.chimeral", "act3", "Chimeral Wetlands", ["G3_5"], [36], ["a3.machinarium", "a3.temple-of-chaos"]),
  z("a3.temple-of-chaos", "act3", "The Temple of Chaos", ["G3_10_Airlock"], [38], ["a3.trial-of-chaos"]),
  z("a3.trial-of-chaos", "act3", "The Trial of Chaos", ["G3_10"], [38], ["a3.temple-of-chaos"], {}, "trial"),
  z("a3.machinarium", "act3", "Jiquani's Machinarium", ["G3_6_1"], [37], ["a3.sanctum"]),
  z("a3.sanctum", "act3", "Jiquani's Sanctum", ["G3_6_2"], [38], ["a3.machinarium"]),
  z("a3.waterways", "act3", "The Matlan Waterways", ["G3_2_2"], [39], ["a3.azak-bog"], { opensAfter: ["a3.zicoatl"] }),
  z("a3.azak-bog", "act3", "The Azak Bog", ["G3_7"], [36, 40], []),
  z("a3.drowned-city", "act3", "The Drowned City", ["G3_8"], [40], ["a3.apex"], { opensAfter: ["a3.waterways-drain"] }),
  z("a3.molten-vault", "act3", "The Molten Vault", [], [], [], {
    provenance: unverified("pathofexile-gg", "Not seen in the real log; area id unknown, matched by name only."),
  }),
  z("a3.apex", "act3", "Apex of Filth", ["G3_11"], [41], []),
  z("a3.kopec", "act3", "Temple of Kopec", ["G3_12"], [42], [], { opensAfter: ["a3.queen-of-filth"] }),
  z("a3.utzaal", "act3", "Utzaal", ["G3_14"], [43], ["a3.aggorat"], { opensAfter: ["a3.ketzuli"] }),
  z("a3.aggorat", "act3", "Aggorat", ["G3_16"], [44], ["a3.black-chambers"]),
  z("a3.black-chambers", "act3", "The Black Chambers", ["G3_17"], [45], []),

  // ── Act 4 (islands are reached by ship from Kingsmarch) ─────────────────
  town("a4.town", "act4", "Kingsmarch", "G4_town", 53),
  z("a4.isle-of-kin", "act4", "Isle of Kin", ["G4_1_1"], [49, 50, 51], ["a4.volcanic-warrens"], { hubTravel: true }),
  z("a4.volcanic-warrens", "act4", "Volcanic Warrens", ["G4_1_2"], [50, 51, 52], ["a4.isle-of-kin"]),
  z("a4.kedge-bay", "act4", "Kedge Bay", ["G4_2_1"], [46, 50], ["a4.journeys-end"], { hubTravel: true }),
  z("a4.journeys-end", "act4", "Journey's End", ["G4_2_2"], [47, 51], ["a4.kedge-bay"]),
  z("a4.whakapanu", "act4", "Whakapanu Island", ["G4_3_1"], [48, 50, 51], ["a4.singing-caverns"], { hubTravel: true }),
  z("a4.singing-caverns", "act4", "Singing Caverns", ["G4_3_2"], [49, 51, 52], ["a4.whakapanu"]),
  z("a4.eye-of-hinekora", "act4", "Eye of Hinekora", ["G4_4_1"], [48, 49, 51], ["a4.halls-of-the-dead"], { hubTravel: true }),
  z("a4.halls-of-the-dead", "act4", "Halls of the Dead", ["G4_4_2"], [49, 50, 52], ["a4.eye-of-hinekora", "a4.trial-of-ancestors"]),
  z("a4.trial-of-ancestors", "act4", "Trial of the Ancestors", ["G4_4_3"], [51], ["a4.halls-of-the-dead"], {}, "trial"),
  z("a4.abandoned-prison", "act4", "Abandoned Prison", ["G4_5_1"], [47, 48, 49], ["a4.solitary"], { hubTravel: true }),
  z("a4.solitary", "act4", "Solitary Confinement", ["G4_5_2"], [48, 49, 50], ["a4.abandoned-prison"]),
  z("a4.shrike-island", "act4", "Shrike Island", ["G4_7"], [47, 50, 51], [], { hubTravel: true }),
  z("a4.arastas", "act4", "Arastas", ["G4_8a", "G4_8b"], [52], ["a4.excavation"], { hubTravel: true }),
  z("a4.excavation", "act4", "The Excavation", ["G4_10"], [52], []),
  z("a4.ngakanu", "act4", "Ngakanu", ["G4_11_1a", "G4_11_1b"], [53], ["a4.heart-of-the-tribe"], { hubTravel: true }),
  z("a4.heart-of-the-tribe", "act4", "Heart of the Tribe", ["G4_11_2"], [53], ["a4.ngakanu"]),
  z("a4.plunders-point", "act4", "Plunder's Point", ["G4_13"], [53], [], { hubTravel: true, opensAfter: ["a4.map-whakapanu", "a4.map-shrike", "a4.map-kin", "a4.map-kedge"] }),
  z("a4.isle-of-decay", "act4", "Isle of Decay", [], [53], [], {
    hubTravel: true,
    provenance: unverified("metabot", "Listed by one source; not seen in the real log."),
  }),
  z("a4.brinerot-cove", "act4", "Brinerot Cove", [], [53], [], {
    hubTravel: true,
    provenance: unverified("metabot", "Listed by one source; not seen in the real log."),
  }),

  // ── Interlude I ────────────────────────────────────────────────────────
  town("i1.town", "int1", "The Refuge", "P1_Town", 64, ["i1.farmlands"]),
  z("i1.farmlands", "int1", "Scorched Farmlands", ["P1_1"], [54, 58, 62], ["i1.stones", "i1.blackwood"]),
  z("i1.stones", "int1", "Stones of Serle", ["P1_2"], [54, 58, 62], ["i1.farmlands"]),
  z("i1.blackwood", "int1", "The Blackwood", ["P1_3"], [55, 59, 63], ["i1.holten"], { opensAfter: ["i1.megaliths"] }),
  z("i1.holten", "int1", "Holten", ["P1_4"], [55, 59, 63], ["i1.wolvenhold", "i1.estate"]),
  z("i1.wolvenhold", "int1", "Wolvenhold", ["P1_5"], [56, 60, 64], ["i1.holten"]),
  z("i1.estate", "int1", "Holten Estate", ["P1_6"], [56, 60, 64], []),

  // ── Interlude II ───────────────────────────────────────────────────────
  town("i2.town", "int2", "The Khari Bazaar", "P2_Town", 64, ["i2.crossing"]),
  z("i2.crossing", "int2", "The Khari Crossing", ["P2_1"], [54, 57, 62], ["i2.pools", "i2.galai-gates"]),
  z("i2.pools", "int2", "Pools of Khatal", ["P2_2"], [55, 58, 63], ["i2.sanctuary"]),
  z("i2.sanctuary", "int2", "Sel Khari Sanctuary", ["P2_3"], [55, 58, 63], []),
  z("i2.skullmaw", "int2", "Skullmaw Stairway", [], [], [], {
    provenance: conflict(
      ["pathofexile-gg"],
      [{ source: "metabot-bonuses", says: "Places the Molten Shrine in The Khari Crossing, not a separate Skullmaw Stairway." }],
      "Not seen in the real log; area id unknown.",
    ),
  }),
  z("i2.galai-gates", "int2", "The Galai Gates", ["P2_5"], [56, 59, 64], ["i2.qimah"]),
  z("i2.qimah", "int2", "Qimah", ["P2_6"], [56, 59, 64], ["i2.reservoir"]),
  z("i2.reservoir", "int2", "Qimah Reservoir", ["P2_7"], [56, 59, 64], []),

  // ── Interlude III ──────────────────────────────────────────────────────
  town("i3.town", "int3", "The Glade", "P3_Town", 64, ["i3.ashen-forest"]),
  z("i3.ashen-forest", "int3", "Ashen Forest", ["P3_1"], [56, 58, 61, 62], ["i3.kriar-village"]),
  z("i3.kriar-village", "int3", "Kriar Village", ["P3_2"], [56, 58, 61, 62], ["i3.glacial-tarn"]),
  z("i3.glacial-tarn", "int3", "Glacial Tarn", ["P3_3"], [57, 59, 62, 63], ["i3.howling-caves", "i3.kriar-peaks"]),
  z("i3.howling-caves", "int3", "Howling Caves", ["P3_4"], [57, 59, 62, 63], []),
  z("i3.kriar-peaks", "int3", "Kriar Peaks", ["P3_5"], [58, 60, 63, 64], ["i3.etched-ravine"], { opensAfter: ["i3.rakkar"] }),
  z("i3.etched-ravine", "int3", "Etched Ravine", ["P3_6"], [58, 60, 63, 64], ["i3.cuachic-vault"]),
  z("i3.cuachic-vault", "int3", "The Cuachic Vault", ["P3_7"], [58, 60, 63, 64], []),
]);
