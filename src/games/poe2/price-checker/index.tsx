import type { SectionProps } from "@/core/game-context/sections";
import { PriceCheckerView } from "@/shared/views/PriceCheckerView";
import { POE2_CONFIG } from "../config";
import { parsePoe2Item } from "../parser";

/** POE2 price checker — POE2 parser + official Trade (live). */
export default function Section(props: SectionProps) {
  return <PriceCheckerView {...props} config={POE2_CONFIG} parse={parsePoe2Item} />;
}
