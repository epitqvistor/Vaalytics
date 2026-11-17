import type { SectionProps } from "@/core/game-context/sections";
import { CurrencyView } from "@/shared/views/CurrencyView";
import { POE1_CONFIG } from "../config";

/** POE1 currency — live market data from poe.ninja via the market-data engine. */
export default function Section(props: SectionProps) {
  return <CurrencyView {...props} config={POE1_CONFIG} />;
}
