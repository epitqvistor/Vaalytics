import { memo } from "react";
import type { CurrencyUnit } from "@/shared/market-data/types";
import { cn } from "@/shared/utilities/cn";
import { formatAmount } from "@/shared/utilities/format";

/**
 * Neutral placeholder glyph for market entries. Real item icons arrive with the
 * market-data engine (M4), using the image URLs the data source provides.
 */
export const ItemGlyph = memo(function ItemGlyph({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name
    .replace(/^(Orb|Essence|Omen|Scarab) of /, "")
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-md border border-line bg-elevated font-display text-2xs font-semibold text-fg-muted"
    >
      {initials}
    </span>
  );
});

/** "182 c" with the unit in muted ink. */
export function Price({ amount, unit, className, strong }: { amount: number; unit: CurrencyUnit; className?: string; strong?: boolean }) {
  return (
    <span className={cn("tabular whitespace-nowrap", className)} title={`${formatAmount(amount)} ${unit.name}`}>
      <span className={strong ? "font-semibold text-fg" : "text-fg"}>{formatAmount(amount)}</span>
      <span className="ml-1 text-xs text-fg-muted">{unit.short}</span>
    </span>
  );
}
