import type { SectionProps } from "@/core/game-context/sections";
import { PriceCheckerView } from "@/shared/views/PriceCheckerView";
import { POE1_CONFIG } from "../config";
import { parsePoe1Item } from "../parser";

/** POE1 price checker — POE1 parser + official Trade (live). */
export default function Section(props: SectionProps) {
  return <PriceCheckerView {...props} config={POE1_CONFIG} parse={parsePoe1Item} />;
}
