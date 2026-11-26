/** Small shared pieces of the Deck Intelligence views. */
import { memo, type ReactNode } from "react";
import type { DeckAcquisition, DeckEventSource, DeckEventStatus } from "@/core/ipc/commands";
import { Badge, type BadgeTone } from "@/shared/components";
import { cn } from "@/shared/utilities/cn";
import { formatAmount } from "@/shared/utilities/format";
import { Price } from "@/shared/views/common";
import { ItemIcon } from "@/shared/views/market-ui";
import { POE1_CONFIG } from "../config";

export const UNIT = POE1_CONFIG.baseUnit;

/**
 * The official Divination Card inventory icon (web.poecdn.com). Per-card artwork has no verified
 * source yet, so every card shows the same card icon (docs/modules/deck-intelligence.md).
 */
export const CARD_ICON = "https://web.poecdn.com/image/Art/2DItems/Divination/InventoryIcon.png";

export const CardArt = memo(function CardArt({ name, size = 28, src }: { name: string; size?: number; src?: string | null }) {
  return <ItemIcon src={src ?? CARD_ICON} name={name} size={size} />;
});

/** A chaos amount, or an explicit "unknown" (never 0). */
export function Money({ value, strong, className, unknown = "Unknown" }: { value: number | null | undefined; strong?: boolean; className?: string; unknown?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cn("text-xs text-fg-subtle", className)}>{unknown}</span>;
  return <Price amount={value} unit={UNIT} strong={strong} className={className} />;
}

/** Signed profit: green above zero, red below. */
export function Profit({ value, className, unknown = "No cost" }: { value: number | null; className?: string; unknown?: string }) {
  if (value === null) return <span className={cn("text-xs text-fg-subtle", className)}>{unknown}</span>;
  const tone = value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-fg-muted";
  return (
    <span className={cn("tabular whitespace-nowrap", tone, className)} title={`${formatAmount(value)} ${UNIT.name}`}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {formatAmount(Math.abs(value))}
      <span className="ml-1 text-xs opacity-70">{UNIT.short}</span>
    </span>
  );
}

export function Roi({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <span className={cn("text-xs text-fg-subtle", className)} title="ROI needs a known, non-zero acquisition cost">—</span>;
  const tone = value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-fg-muted";
  return (
    <span className={cn("tabular", tone, className)}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {Math.abs(value) >= 100 ? Math.round(Math.abs(value)) : Math.abs(value).toFixed(1)}%
    </span>
  );
}

export const fmtPct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) >= 100 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)}%`);
export const fmtChaos = (v: number) => `${formatAmount(v)} c`;
export const fmtSigned = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatAmount(Math.abs(v))} c`;

export const STATUS_LABEL: Record<DeckEventStatus, string> = { confirmed: "Confirmed", review: "Needs review", unrecognized: "Unrecognized", removed: "Removed" };
const STATUS_TONE: Record<DeckEventStatus, BadgeTone> = { confirmed: "success", review: "warning", unrecognized: "danger", removed: "neutral" };

export function StatusBadge({ status }: { status: DeckEventStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export const SOURCE_LABEL: Record<DeckEventSource, string> = { ocr: "Ground screenshot", log: "Client.txt", manual: "Added by you", import: "Client.txt import" };

export const ACQUISITION_LABEL: Record<DeckAcquisition, string> = {
  individual: "Bought individually",
  bulk: "Bought in bulk",
  farmed: "Farmed",
  free: "Free",
  unknown: "Unknown",
};
export const ACQUISITIONS = Object.keys(ACQUISITION_LABEL) as DeckAcquisition[];

/** KPI tile with a clear hierarchy: label, big value, supporting line. */
export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "accent" }) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface px-4 py-3", tone === "accent" && "border-line-warm")}>
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="mt-1.5 text-xl leading-none font-semibold text-fg">{value}</div>
      {sub && <div className="mt-1.5 truncate text-xs text-fg-muted">{sub}</div>}
    </div>
  );
}

export const dateLabel = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
export const timeLabel = (sec: number) => new Date(sec * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const shortDate = (sec: number) => new Date(sec * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
