import type { SectionProps } from "@/core/game-context/sections";
import { CurrencyView } from "@/shared/views/CurrencyView";
import { POE2_CONFIG } from "../config";

/** POE2 currency — live market data from poe.ninja via the market-data engine. */
export default function Section(props: SectionProps) {
  return <CurrencyView {...props} config={POE2_CONFIG} />;
}
