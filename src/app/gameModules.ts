import type { GameConfig } from "@/core/game-context/config";
import type { GameId } from "@/core/game-context/games";
import { POE1_CONFIG } from "@/games/poe1/config";
import { parsePoe1Item } from "@/games/poe1/parser";
import { POE2_CONFIG } from "@/games/poe2/config";
import { parsePoe2Item } from "@/games/poe2/parser";
import type { ParseResult } from "@/shared/item-parser/types";

/** Per-game pieces needed outside a game shell (the overlay). */
export const GAME_MODULES: Record<GameId, { config: GameConfig; parse: (text: string) => ParseResult }> = {
  poe1: { config: POE1_CONFIG, parse: parsePoe1Item },
  poe2: { config: POE2_CONFIG, parse: parsePoe2Item },
};
