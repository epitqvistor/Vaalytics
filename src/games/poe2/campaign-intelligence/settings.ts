/** Per-game Campaign Intelligence preferences (`campaign.config`, PoE 2). */
import type { ObjectiveCategory } from "./data/types";
import { type CampaignMode, DEFAULT_SETTINGS, type ModeSettings } from "./engine/recommend";

export const CONFIG_KEY = "campaign.config";

export interface CampaignConfig {
  [key: string]: string | number | string[] | null | Record<string, string>;
  mode: CampaignMode;
  categories: ObjectiveCategory[];
  pinned: string[];
  levelGap: number;
  /** Character chosen by the player; null = follow the character the log shows. */
  characterId: number | null;
  /** PoB build linked per character id ("folder/name" as listed by pob_builds). */
  builds: Record<string, string>;
}

export const DEFAULT_CONFIG: CampaignConfig = { ...DEFAULT_SETTINGS, characterId: null, builds: {} };

const MODES: CampaignMode[] = ["full", "fast", "power", "custom"];
const CATEGORIES: ObjectiveCategory[] = ["progression", "passive", "spirit", "resistance", "life-mana", "charm", "choice", "ascendancy", "unlock", "optional-boss", "quest-item"];

export function isCampaignConfig(v: unknown): v is CampaignConfig {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  const strings = (x: unknown) => Array.isArray(x) && x.length <= 200 && x.every((s) => typeof s === "string" && s.length <= 64);
  return (
    MODES.includes(c.mode as CampaignMode) &&
    strings(c.categories) &&
    (c.categories as string[]).every((s) => CATEGORIES.includes(s as ObjectiveCategory)) &&
    strings(c.pinned) &&
    typeof c.levelGap === "number" &&
    c.levelGap >= 1 &&
    c.levelGap <= 20 &&
    (c.characterId === null || typeof c.characterId === "number") &&
    (c.builds === undefined ||
      (typeof c.builds === "object" && c.builds !== null && !Array.isArray(c.builds) && Object.values(c.builds).every((v) => typeof v === "string" && v.length <= 260)))
  );
}

export const toModeSettings = (c: CampaignConfig): ModeSettings => ({ mode: c.mode, categories: c.categories, pinned: c.pinned, levelGap: c.levelGap });

export const MODE_LABEL: Record<CampaignMode, string> = { full: "Full Completion", fast: "Fast", power: "Power Leveling", custom: "Custom" };
export const MODE_HELP: Record<CampaignMode, string> = {
  full: "Main quest plus every permanent reward (passive points, Spirit, resistances, Life/Mana, charm slots, choices, Ascendancy).",
  fast: "Main quest first; only high-value optional rewards that are close by. Skipped rewards can be recovered later.",
  power: "Like Full Completion, but nearby optional content counts more when you are under-levelled for the area.",
  custom: "Main quest plus only the reward types you choose.",
};
export const CATEGORY_LABEL: Record<ObjectiveCategory, string> = {
  progression: "Main quest",
  passive: "Passive points",
  spirit: "Spirit",
  resistance: "Resistances",
  "life-mana": "Life / Mana",
  charm: "Charm slots",
  choice: "Permanent choices",
  ascendancy: "Ascendancy",
  unlock: "Unlocks",
  "optional-boss": "Optional bosses",
  "quest-item": "Quest items",
};
