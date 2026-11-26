/** Frontend preferences of Deck Intelligence (per-game setting `decks.prefs`). */
import type { DeckAcquisition } from "@/core/ipc/commands";
import { DEFAULT_BUCKETS, isBuckets, type RangePreset } from "./analytics";

export interface DeckPrefs {
  [k: string]: string | number | boolean | number[] | null;
  /** "{date}" and "{n}" (session number) are replaced. */
  nameFormat: string;
  defaultAcquisition: DeckAcquisition;
  /** Toast when a card at or above this value arrives (chaos); null = off. */
  notifyHighValue: number | null;
  notifyReview: boolean;
  notifyFinished: boolean;
  /** Toast once when the running session's estimated profit crosses this (chaos); null = off. */
  notifyProfitMilestone: number | null;
  buckets: number[];
  defaultRange: RangePreset;
  /** Statistics league filter on open: the selected league or all leagues. */
  defaultLeague: "current" | "all";
  animateCharts: boolean;
}

export const DEFAULT_PREFS: DeckPrefs = {
  nameFormat: "Stacked Decks · {date}",
  defaultAcquisition: "bulk",
  notifyHighValue: 100,
  notifyReview: true,
  notifyFinished: true,
  notifyProfitMilestone: null,
  buckets: [...DEFAULT_BUCKETS],
  defaultRange: "all",
  defaultLeague: "current",
  animateCharts: true,
};

const ACQ = ["individual", "bulk", "farmed", "free", "unknown"];
const RANGES = ["7d", "30d", "90d", "all", "custom"];
const numOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

export function isPrefs(v: unknown): v is DeckPrefs {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.nameFormat === "string" &&
    p.nameFormat.length <= 120 &&
    ACQ.includes(p.defaultAcquisition as string) &&
    numOrNull(p.notifyHighValue) &&
    typeof p.notifyReview === "boolean" &&
    typeof p.notifyFinished === "boolean" &&
    numOrNull(p.notifyProfitMilestone) &&
    isBuckets(p.buckets) &&
    RANGES.includes(p.defaultRange as string) &&
    (p.defaultLeague === "current" || p.defaultLeague === "all") &&
    typeof p.animateCharts === "boolean"
  );
}

/** Session name from the format: "{date}" → 2026-11-26, "{n}" → next number. */
export function sessionName(format: string, now: Date, n: number): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const name = (format.trim() || DEFAULT_PREFS.nameFormat).replaceAll("{date}", d).replaceAll("{n}", String(n));
  return name.slice(0, 120);
}

export const PREFS_KEY = "decks.prefs";
