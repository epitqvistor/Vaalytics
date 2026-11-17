import type { SectionProps } from "@/core/game-context/sections";
import { MarketIntelligenceView } from "@/shared/market-intel/MarketIntelligenceView";
import { POE1_CONFIG } from "../config";

export default function MarketIntelligence(props: SectionProps) {
  return <MarketIntelligenceView {...props} config={POE1_CONFIG} />;
}
