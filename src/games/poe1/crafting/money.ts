import { useCallback } from "react";
import { useDisplayCurrency } from "@/core/market/DisplayCurrency";
import { formatAmount } from "@/shared/utilities/format";

const fmt = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString("en-US") : n >= 10 ? n.toFixed(1) : n.toFixed(2));

/**
 * Formats a chaos amount: in the chosen display currency ("Prices in"), or —
 * with chaos as display — as chaos, switching to divines from 1 div when `divine` is given.
 */
export function useChaos(divine: number | null = null) {
  const dc = useDisplayCurrency();
  return useCallback(
    (c: number) => {
      if (dc?.converting) return `${formatAmount(dc.toUnit(c))} ${dc.unit.short}`;
      return divine && c >= divine ? `${fmt(c / divine)} div` : `${fmt(c)}c`;
    },
    [dc, divine],
  );
}
