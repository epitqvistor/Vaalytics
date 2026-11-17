import { memo } from "react";
import { useDisplayCurrency } from "@/core/market/DisplayCurrency";
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

/**
 * "182 c" with the unit in muted ink. Amounts in the game's base unit follow the
 * display currency ("Show prices in"); the tooltip keeps the base value.
 */
export function Price({ amount, unit, className, strong }: { amount: number; unit: CurrencyUnit; className?: string; strong?: boolean }) {
  const d = useDisplayCurrency();
  const convert = d !== null && d.converting && unit.id === d.base.id;
  const shown = convert ? d.toUnit(amount) : amount;
  const shownUnit = convert ? d.unit : unit;
  const title = convert ? `${formatAmount(shown)} ${shownUnit.name} (${formatAmount(amount)} ${unit.name})` : `${formatAmount(amount)} ${unit.name}`;
  return (
    <span className={cn("tabular whitespace-nowrap", className)} title={title}>
      <span className={strong ? "font-semibold text-fg" : "text-fg"}>{formatAmount(shown)}</span>
      <span className="ml-1 text-xs text-fg-muted">{shownUnit.short}</span>
    </span>
  );
}

/**
 * Secondary line under a base-unit price: the premium unit (e.g. divine) while
 * showing base, or the base value while another display currency is active.
 */
export function AltPrice({
  amount,
  unit,
  premium,
  itemId,
  className,
}: {
  amount: number;
  unit: CurrencyUnit;
  premium: CurrencyUnit;
  /** The priced item; no secondary line for the premium currency itself. */
  itemId?: string;
  className?: string;
}) {
  const d = useDisplayCurrency();
  if (itemId && itemId === premium.id && !d?.converting) return null;
  if (d?.converting) {
    if (d.unit.id === unit.id) return null;
    return (
      <span className={cn("tabular block text-2xs text-fg-subtle", className)}>
        {formatAmount(amount)} {unit.short}
      </span>
    );
  }
  const p = d?.toCurrency(amount, premium.id) ?? null;
  if (p === null || p < 1) return null;
  return (
    <span className={cn("tabular block text-2xs text-fg-subtle", className)}>
      {formatAmount(p)} {premium.short}
    </span>
  );
}
