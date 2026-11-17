import type { CurrencyUnit } from "@/shared/market-data/types";
import type { GameId } from "./games";

/**
 * Static, per-game configuration. Each game module provides one; shared views
 * receive it as a prop and never branch on the game id themselves.
 */
export interface GameConfig {
  id: GameId;
  /** Unit market values are expressed in (chaos in PoE 1, exalted in PoE 2). */
  baseUnit: CurrencyUnit;
  /** High-value unit used for large prices. */
  premiumUnit: CurrencyUnit;
  /** Item ids (in the "currency" market category) highlighted on the Dashboard. */
  keyCurrencies: readonly string[];
  links: {
    officialSite: string;
    trade: string;
    ninja: string;
  };
}
