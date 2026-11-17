import type { SectionProps } from "@/core/game-context/sections";
import { DashboardView } from "@/shared/views/DashboardView";
import { POE1_CONFIG } from "../config";

/** POE1 dashboard — live market data from poe.ninja via the market-data engine. */
export default function Section(props: SectionProps) {
  return <DashboardView {...props} config={POE1_CONFIG} />;
}
