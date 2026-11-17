/**
 * Path of Exile 1 patch definitions, newest first. Historical patches stay
 * here unchanged; a new patch gets a new entry (docs/architecture/game-data.md).
 */
import type { PatchDefinition } from "./types";

const PATCH_3_30_SOURCES = [
  { label: "Content Update 3.30.0 — Covens of Umbra (patch notes mirror)", url: "https://patchbot.io/games/path-of-exile/articles/2188-content-update-3300-path-of-exile-covens-of-umbra", checked: "2026-11-17" },
  { label: "Maxroll — 3.30 Covens of Umbra patch notes", url: "https://maxroll.gg/poe/news/3-30-covens-of-umbra-patch-notes", checked: "2026-11-17" },
];

export const POE1_PATCHES: readonly PatchDefinition[] = [
  {
    game: "poe1",
    patch: "3.30",
    name: "Covens of Umbra",
    leagues: ["Covens", "Hardcore Covens", "Covens of Umbra"],
    sources: PATCH_3_30_SOURCES,
    mechanics: {
      scarabs: { value: false, verification: "confirmed", source: 0, note: "Scarabs removed; Threads replace them." },
      threads: { value: true, verification: "confirmed", source: 0 },
      atlasPassivePoints: { value: 150, verification: "confirmed", source: 0, note: "Up from 138; tree rebuilt." },
      fates: { value: true, verification: "confirmed", source: 0 },
      grimFates: { value: true, verification: "unverified", note: "From the project brief; not found in the checked sources." },
      wickerman: { value: true, verification: "confirmed", source: 0, note: "Viscera strengthen the Wickerman." },
      itemTierDrops: { value: true, verification: "confirmed", source: 1, note: "Some endgame bases need a minimum Item Tier." },
    },
  },
  {
    // Everything before 3.30, kept separate so old data never mixes with 3.30 rules.
    game: "poe1",
    patch: "pre-3.30",
    name: "Before Covens of Umbra",
    leagues: [],
    sources: PATCH_3_30_SOURCES,
    mechanics: {
      scarabs: { value: true, verification: "confirmed", source: 0 },
      threads: { value: false, verification: "confirmed", source: 0 },
      atlasPassivePoints: { value: 138, verification: "confirmed", source: 0 },
      fates: { value: false, verification: "confirmed", source: 0 },
      grimFates: { value: false, verification: "confirmed", source: 0 },
      wickerman: { value: false, verification: "confirmed", source: 0 },
      itemTierDrops: { value: false, verification: "confirmed", source: 1 },
    },
  },
];

/** Patch whose rules the permanent leagues (Standard, Hardcore…) follow now. */
export const POE1_CURRENT = "3.30";
