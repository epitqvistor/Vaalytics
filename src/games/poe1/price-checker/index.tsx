import type { SectionProps } from "@/core/game-context/sections";
import { PriceCheckerView } from "@/shared/views/PriceCheckerView";
import { POE1_CONFIG } from "../config";
import { parsePoe1Item } from "../parser";
import { MERCENARY_CHECK } from "../mercenary/special";
import { ULTIMATUM_CHECK } from "../ultimatum/special";

const SPECIAL = [ULTIMATUM_CHECK, MERCENARY_CHECK];

/** POE1 price checker — POE1 parser + official Trade (live). */
export default function Section(props: SectionProps) {
  return <PriceCheckerView {...props} config={POE1_CONFIG} parse={parsePoe1Item} special={SPECIAL} />;
}
