/** Small presentational pieces shared by the Update Center tabs. */
import type { ReactNode } from "react";
import type { GameId } from "@/core/game-context/games";
import type { UpdConfidence, UpdReliability, UpdValidation } from "@/core/ipc/commands";
import { FRESHNESS_LABEL, type Freshness } from "@/core/updates/logic";
import { Badge, type BadgeTone } from "@/shared/components";
import { formatRelative } from "@/shared/utilities/format";

export function ago(ts: number | null | undefined): string {
  return ts ? formatRelative(ts * 1000) : "never";
}

export function stamp(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toLocaleString() : "—";
}

export function Time({ ts }: { ts: number | null | undefined }) {
  return <span title={stamp(ts)}>{ago(ts)}</span>;
}

const FRESH_TONE: Record<Freshness, BadgeTone> = { fresh: "success", recent: "info", stale: "warning", unknown: "neutral", bundled: "neutral" };
export function FreshnessBadge({ f }: { f: Freshness }) {
  return (
    <Badge tone={FRESH_TONE[f]} dot className="whitespace-nowrap">
      {FRESHNESS_LABEL[f]}
    </Badge>
  );
}

const VALID_TONE: Record<UpdValidation, BadgeTone> = { passed: "success", warnings: "warning", review: "warning", failed: "danger" };
const VALID_LABEL: Record<UpdValidation, string> = { passed: "Passed", warnings: "Passed with warnings", review: "Requires review", failed: "Failed" };
export function ValidationBadge({ v }: { v: UpdValidation }) {
  return <Badge tone={VALID_TONE[v]}>{VALID_LABEL[v]}</Badge>;
}

const REL_LABEL: Record<UpdReliability, string> = { official: "Official", structured: "Established structured source", community: "Trusted community source", unverified: "Unverified source" };
const REL_TONE: Record<UpdReliability, BadgeTone> = { official: "accent", structured: "info", community: "neutral", unverified: "warning" };
export function ReliabilityBadge({ r }: { r: UpdReliability }) {
  return <Badge tone={REL_TONE[r]}>{REL_LABEL[r]}</Badge>;
}

const CONF_TONE: Record<UpdConfidence, BadgeTone> = { confirmed: "success", high: "info", review: "warning", unverified: "danger" };
const CONF_LABEL: Record<UpdConfidence, string> = { confirmed: "Confirmed", high: "High confidence", review: "Needs review", unverified: "Unverified" };
export function ConfidenceBadge({ c }: { c: UpdConfidence }) {
  return (
    <Badge tone={CONF_TONE[c]} className="whitespace-nowrap">
      {CONF_LABEL[c]}
    </Badge>
  );
}

export function GameTag({ game }: { game: GameId | null }) {
  return <Badge tone={game ? "neutral" : "warning"}>{game === "poe1" ? "PoE 1" : game === "poe2" ? "PoE 2" : "Game not stated"}</Badge>;
}

export function StatusDot({ status }: { status: "ok" | "warning" | "error" | "unknown" | "info" }) {
  const c = status === "ok" ? "bg-success" : status === "warning" ? "bg-warning" : status === "error" ? "bg-danger" : status === "info" ? "bg-info" : "bg-fg-subtle";
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${c}`} />;
}

/** Label / value row used in detail lists. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5 text-xs">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-fg-muted">{children}</dd>
    </div>
  );
}

export const MODULE_LABEL: Record<string, string> = {
  "deck-intelligence": "Deck Intelligence",
  currency: "Currency Tracker",
  "market-intelligence": "Market Intelligence",
  dashboard: "Dashboard",
  "price-checker": "Price Checker",
  trade: "Trade",
  crafting: "Crafting",
  regex: "REGEX",
  "loot-intelligence": "Loot Intelligence",
  "ultimatum-checker": "Ultimatum Checker",
  "mercenary-intelligence": "Mercenary Intelligence",
  "location-atlas": "Location Atlas",
  "act-tracker": "Act Tracker",
  "campaign-intelligence": "Campaign Intelligence",
  "loot-journal": "Loot Journal",
};

export const moduleLabel = (id: string) => MODULE_LABEL[id] ?? id;
