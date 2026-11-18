import { SOURCES_0_5_5 } from "../sources";
import type { CampaignDataset } from "../types";
import { ACT1_ITEMS, ACT1_OBJECTIVES, ACT1_REWARDS } from "./act1";
import { ACT2_ITEMS, ACT2_OBJECTIVES, ACT2_REWARDS } from "./act2";
import { ACT3_ITEMS, ACT3_OBJECTIVES, ACT3_REWARDS } from "./act3";
import { ACT4_ITEMS, ACT4_OBJECTIVES, ACT4_REWARDS } from "./act4";
import { INTERLUDE_ITEMS, INTERLUDE_OBJECTIVES, INTERLUDE_REWARDS } from "./interludes";
import { PARTS, ZONES } from "./zones";

/** PoE 2 0.5.5 campaign: Acts 1–4 and Interludes I–III (no Cruel repeat). */
export const CAMPAIGN_0_5_5: CampaignDataset = {
  game: "poe2",
  patch: "0.5.5",
  name: "Path of Exile 2 — 0.5.5 campaign",
  verifiedOn: "2026-11-17",
  sources: SOURCES_0_5_5,
  parts: PARTS,
  zones: ZONES,
  objectives: [...ACT1_OBJECTIVES, ...ACT2_OBJECTIVES, ...ACT3_OBJECTIVES, ...ACT4_OBJECTIVES, ...INTERLUDE_OBJECTIVES],
  rewards: [...ACT1_REWARDS, ...ACT2_REWARDS, ...ACT3_REWARDS, ...ACT4_REWARDS, ...INTERLUDE_REWARDS],
  items: [...ACT1_ITEMS, ...ACT2_ITEMS, ...ACT3_ITEMS, ...ACT4_ITEMS, ...INTERLUDE_ITEMS],
};
