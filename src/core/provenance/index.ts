/**
 * Data provenance: every number a module shows says what kind of data it is,
 * where it came from and when. Spec: docs/architecture/modules.md#data-integrity
 */
import type { MarketSnapshot } from "@/core/ipc/commands";
import { formatRelative } from "@/shared/utilities/format";

export type DataKind =
  /** Live market data (poe.ninja, official Trade), as fetched. */
  | "market"
  /** Past values recorded locally or by a source. */
  | "historical"
  /** Calculated by Vaalytics (odds, expected costs, price estimates). Never shown as a confirmed result. */
  | "estimate"
  /** Entered or recorded by the user (sessions, notes, allocations). */
  | "user"
  /** Extracted from the game files / versioned definitions (RePoE, patch data). */
  | "game-data";

export interface Provenance {
  kind: DataKind;
  /** e.g. "poe.ninja", "Official Trade", "RePoE", "You". */
  source: string;
  /** Unix ms of fetch / record / calculation; null if never fetched. */
  at: number | null;
  league?: string;
  patch?: string;
  note?: string;
}

export const KIND_LABEL: Record<DataKind, string> = {
  market: "Live",
  historical: "History",
  estimate: "Estimate",
  user: "Your data",
  "game-data": "Game data",
};

/** "Live · poe.ninja · 5 min ago" */
export function describeProvenance(p: Provenance, now = Date.now()): string {
  const parts = [KIND_LABEL[p.kind], p.source];
  if (p.at !== null) parts.push(formatRelative(p.at, now));
  else if (p.kind === "market") parts.push("not loaded yet");
  return parts.join(" · ");
}

/** Provenance of a cached market snapshot (source + fetch time from the Market engine). */
export function marketProvenance(snapshot: MarketSnapshot | null, league: string | null): Provenance {
  return { kind: "market", source: snapshot?.source ?? "poe.ninja", at: snapshot?.fetchedAt ? snapshot.fetchedAt * 1000 : null, league: league ?? undefined };
}
