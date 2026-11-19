/**
 * Act Tracker preferences (PoE 1 setting `actTracker.prefs`), validated on load; anything malformed falls back
 * to the defaults. Window bounds live in the app setting `actTracker.window`, click-through and the hotkey are
 * owned by Rust (`act_tracker.rs`).
 */
import type { BanditChoice } from "./data/types";
import { FAST_ALL_PASSIVES, type GuideOptions } from "./engine/route";

export const PREFS_KEY = "actTracker.prefs";
export const WINDOW_KEY = "actTracker.window";
export const DEFAULT_HOTKEY = "Ctrl+Shift+T";
/** Broadcast between the main window and the overlay when marks or preferences change. */
export const CHANGED_EVENT = "act-tracker:changed";

export interface TrackerPrefs {
  options: GuideOptions;
  /** Overlay collapsed to one line. */
  compact: boolean;
  /** Overlay background opacity, 0.5–1. */
  opacity: number;
  /** Follow this character instead of the one the log shows in game (null = follow). */
  characterId: number | null;
  /** Show community minimap hints under the objective. */
  hints: boolean;
  /** Hide build-optional and skippable steps from the guide (they stay in the route). */
  importantOnly: boolean;
  /** Active guide profile: the built-in one, or one of yours (`actTracker.profiles`). */
  profileId: string;
}

export const DEFAULT_PREFS: TrackerPrefs = {
  options: FAST_ALL_PASSIVES.options,
  compact: false,
  opacity: 0.92,
  characterId: null,
  hints: true,
  importantOnly: false,
  profileId: "fast-all-passives",
};

const BANDITS: BanditChoice[] = ["kill", "alira", "kraityn", "oak"];
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function isGuideOptions(v: unknown): v is GuideOptions {
  return (
    isObj(v) &&
    BANDITS.includes(v.bandit as BanditChoice) &&
    typeof v.trials === "boolean" &&
    typeof v.leagueStartExtras === "boolean" &&
    typeof v.library === "boolean"
  );
}

export function isTrackerPrefs(v: unknown): v is TrackerPrefs {
  return (
    isObj(v) &&
    isGuideOptions(v.options) &&
    typeof v.compact === "boolean" &&
    typeof v.opacity === "number" &&
    v.opacity >= 0.5 &&
    v.opacity <= 1 &&
    (v.characterId === null || (typeof v.characterId === "number" && Number.isInteger(v.characterId))) &&
    typeof v.hints === "boolean" &&
    typeof v.importantOnly === "boolean" &&
    typeof v.profileId === "string" &&
    /^[a-z0-9.-]{1,64}$/.test(v.profileId)
  );
}

/** Stored preferences from an older version (fields added since) are completed with defaults, not thrown away. */
export function normalizePrefs(v: unknown): TrackerPrefs {
  if (!isObj(v)) return DEFAULT_PREFS;
  const merged = { ...DEFAULT_PREFS, ...v };
  return isTrackerPrefs(merged) ? merged : DEFAULT_PREFS;
}
