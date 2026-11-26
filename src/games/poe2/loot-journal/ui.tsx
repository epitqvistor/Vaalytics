/** Small shared pieces for the Loot Journal views (also used by the Loot Tracker overlay). */
import type { ReactNode } from "react";
import type { LootItem } from "@/core/ipc/commands";
import { Badge } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";
import { Price } from "@/shared/views/common";
import { POE2_CONFIG } from "../config";
import { VALUE_STATUS_LABEL, VALUE_STATUS_SHORT } from "./stats";

export const fmtDateTime = (unixSecs: number) =>
  new Date(unixSecs * 1000).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const fmtTime = (unixSecs: number) => new Date(unixSecs * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "14:05" today, "17 Nov 14:05" otherwise. */
export function fmtWhen(unixSecs: number, nowMs = Date.now()) {
  const d = new Date(unixSecs * 1000);
  const n = new Date(nowMs);
  return d.toDateString() === n.toDateString() ? fmtTime(unixSecs) : fmtDateTime(unixSecs).replace(",", "");
}

/** 08:42 / 1:34:21 */
export function fmtClock(secs: number) {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(ss)}` : `${p(m)}:${p(ss)}`;
}

/** 1 h 05 min / 12 min / 40 s */
export function fmtDuration(secs: number) {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

/** An unidentified unique valued at the cheapest unique its base can be. */
export const isRangeEstimate = (item: Pick<LootItem, "valueNote">) => item.valueNote?.startsWith("Unidentified: one of") ?? false;
/** Not in poe.ninja's latest snapshot; valued at the last listed price (Rust `LAST_LISTED_NOTE`). */
export const isLastListed = (item: Pick<LootItem, "valueNote">) => item.valueNote?.startsWith("Not in the latest poe.ninja data") ?? false;

const CATEGORY_GLYPH: Record<string, IconName> = {
  currency: "currency",
  socketable: "gem",
  omen: "thread",
  fragment: "fate",
  weapon: "crafting",
  armour: "crafting",
  accessory: "crafting",
  flask: "flask",
  jewel: "gem",
  relic: "atlas",
  unique: "star",
  skill_gem: "gem",
  support_gem: "gem",
  waystone: "map",
  tablet: "map",
};

const RARITY_EDGE: Record<string, string> = {
  Unique: "border-accent/45",
  Rare: "border-warning/35",
  Magic: "border-info/35",
  Gem: "border-success/30",
};

/**
 * Item artwork in a recessed square. The image comes from market data (poe.ninja / the official CDN)
 * when the item is listed there; otherwise a category glyph — never a different item's picture.
 */
export function ItemIcon({ item, size = 32, className }: { item: Pick<LootItem, "icon" | "category" | "rarity">; size?: number; className?: string }) {
  return (
    <span
      className={cn("well flex shrink-0 items-center justify-center rounded-sm border", RARITY_EDGE[item.rarity] ?? "border-line", className)}
      style={{ width: size, height: size }}
    >
      {item.icon ? (
        <img src={item.icon} alt="" loading="lazy" draggable={false} className="object-contain" style={{ width: size - 6, height: size - 6 }} />
      ) : (
        <Icon name={CATEGORY_GLYPH[item.category] ?? "journal"} size={Math.round(size * 0.45)} className="text-fg-subtle" />
      )}
    </span>
  );
}

/** Value of an item, or why it has none — never a guessed number. */
export function ValueCell({ item, strong, full }: { item: Pick<LootItem, "valueStatus" | "valueTotal" | "valueNote">; strong?: boolean; full?: boolean }) {
  if ((item.valueStatus === "priced" || item.valueStatus === "manual") && item.valueTotal !== null) {
    return (
      <span className="inline-flex items-center gap-1.5" title={item.valueNote ?? undefined}>
        {isRangeEstimate(item) && <span className="text-2xs text-fg-subtle">from</span>}
        <Price amount={item.valueTotal} unit={POE2_CONFIG.baseUnit} strong={strong} />
      </span>
    );
  }
  return (
    <span className="text-xs whitespace-nowrap text-fg-subtle" title={item.valueNote ?? VALUE_STATUS_LABEL[item.valueStatus]}>
      {full ? VALUE_STATUS_LABEL[item.valueStatus] : VALUE_STATUS_SHORT[item.valueStatus]}
    </span>
  );
}

/** Market data older than this is labelled "stale" (the scheduler normally refreshes hourly). */
export const STALE_AFTER_SECS = 24 * 3600;

export const isStale = (item: Pick<LootItem, "valueStatus" | "valueFetchedAt">, nowSecs = Date.now() / 1000) =>
  item.valueStatus === "priced" && item.valueFetchedAt !== null && nowSecs - item.valueFetchedAt > STALE_AFTER_SECS;

/** Where a value comes from, in a few words: "poe.ninja · high", "last listed", "stale", "your value". */
export function priceSourceLabel(item: Pick<LootItem, "valueStatus" | "valueSource" | "valueConfidence" | "valueNote" | "valueFetchedAt">, nowSecs = Date.now() / 1000): string | null {
  if (item.valueStatus === "manual") return "your value";
  if (item.valueStatus !== "priced") return null;
  if (isLastListed(item)) return "last listed · low";
  if (isStale(item, nowSecs)) return `stale · ${item.valueSource ?? "market"}`;
  if (isRangeEstimate(item)) return "lowest possible";
  return [item.valueSource ?? "market", item.valueConfidence].filter(Boolean).join(" · ");
}

export function PriceSource({ item, className }: { item: Pick<LootItem, "valueStatus" | "valueSource" | "valueConfidence" | "valueNote" | "valueFetchedAt">; className?: string }) {
  const label = priceSourceLabel(item);
  if (!label) return null;
  const title = [item.valueNote, item.valueFetchedAt ? `Market data from ${fmtDateTime(item.valueFetchedAt)}` : null].filter(Boolean).join("\n") || undefined;
  return (
    <span className={cn("text-2xs whitespace-nowrap", item.valueConfidence === "low" || isLastListed(item) || isStale(item) ? "text-warning/80" : "text-fg-subtle", className)} title={title}>
      {label}
    </span>
  );
}

/** One figure in a metric strip. */
export function Metric({ label, value, caption, className }: { label: string; value: ReactNode; caption?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 border-r border-b border-line px-4 py-3", className)}>
      <p className="truncate text-2xs font-medium text-fg-subtle">{label}</p>
      <div className="mt-1 truncate font-display text-xl leading-6 font-semibold tracking-[-0.01em] text-fg">{value}</div>
      {caption && <div className="mt-0.5 truncate text-2xs text-fg-subtle">{caption}</div>}
    </div>
  );
}

/** Figures on one solid surface, divided by hairlines (no stacked glowing cards). `className` sets the grid columns. */
export function MetricStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="panel overflow-hidden rounded-lg">
      <div className={cn("-mr-px -mb-px grid", className)}>{children}</div>
    </div>
  );
}

export function CaptureBadge({ listening, enabled }: { listening: boolean; enabled: boolean }) {
  if (!enabled) return <Badge>Capture off</Badge>;
  return listening ? (
    <Badge tone="success" dot>
      Capturing (PoE 2 focused)
    </Badge>
  ) : (
    <Badge tone="accent" dot>
      Capture on · waiting for PoE 2
    </Badge>
  );
}

/** Small "auto" / "manual" marker for map records. */
export function MapSourceTag({ source }: { source: "auto" | "manual" }) {
  return (
    <span
      className={cn("rounded-xs border px-1 text-2xs leading-4 font-medium", source === "auto" ? "border-line text-fg-subtle" : "border-accent/35 text-accent-2/90")}
      title={source === "auto" ? "Detected by Session Intelligence from the game log" : "Started and finished by you"}
    >
      {source}
    </span>
  );
}
