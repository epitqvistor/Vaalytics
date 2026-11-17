import type { SectionProps } from "@/core/game-context/sections";
import { DashboardView } from "@/shared/views/DashboardView";
import { POE2_CONFIG } from "../config";

/** POE2 dashboard — live market data from poe.ninja via the market-data engine. */
export default function Section(props: SectionProps) {
  return <DashboardView {...props} config={POE2_CONFIG} />;
}
