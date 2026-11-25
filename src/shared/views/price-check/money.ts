import { useCallback } from "react";
import type { GameConfig } from "@/core/game-context/config";
import { useDisplayCurrency } from "@/core/market/DisplayCurrency";
import { formatAmount } from "@/shared/utilities/format";

/** Trade currency ids → in-game names (poe.ninja rows are matched by name for their icon). */
const TRADE_CURRENCY: Record<string, string> = {
  chaos: "Chaos Orb",
  divine: "Divine Orb",
  exalted: "Exalted Orb",
  mirror: "Mirror of Kalandra",
  alch: "Orb of Alchemy",
  alt: "Orb of Alteration",
  regal: "Regal Orb",
  vaal: "Vaal Orb",
  annul: "Orb of Annulment",
  chrome: "Chromatic Orb",
  fusing: "Orb of Fusing",
  jewellers: "Jeweller's Orb",
  chance: "Orb of Chance",
  gcp: "Gemcutter's Prism",
  "mirror-shard": "Mirror Shard",
};

export interface PriceParts {
  amount: string;
  unit: string;
  icon: string | null;
}

/**
 * Price Check picks its own unit: the base unit (chaos / exalted) below one premium unit, the premium
 * unit (divine) above — "2 c" instead of "0.009 div". Values are always converted from the base unit.
 */
export function usePriceFormat(config: GameConfig) {
  const dc = useDisplayCurrency();
  const iconOf = useCallback(
    (name: string) => dc?.options.find((o) => o.name === name)?.icon ?? null,
    [dc],
  );
  const value = useCallback(
    (base: number, opts: { baseUnit?: boolean } = {}): PriceParts => {
      const premium = opts.baseUnit ? null : (dc?.toCurrency(base, config.premiumUnit.id) ?? null);
      if (premium != null && premium >= 1) return { amount: formatAmount(premium), unit: config.premiumUnit.short, icon: iconOf(config.premiumUnit.name) };
      return { amount: formatAmount(base), unit: config.baseUnit.short, icon: iconOf(config.baseUnit.name) };
    },
    [dc, config, iconOf],
  );
  /** A listing's own currency, as listed (icon when known). */
  const listed = useCallback(
    (amount: number, currency: string | null): PriceParts => {
      const name = currency ? TRADE_CURRENCY[currency] : undefined;
      const short = name ? (dc?.options.find((o) => o.name === name)?.short ?? currency!) : (currency ?? "");
      return { amount: formatAmount(amount), unit: short, icon: name ? iconOf(name) : null };
    },
    [dc, iconOf],
  );
  return { value, listed };
}
