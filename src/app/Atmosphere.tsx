import { useEffect } from "react";
import type { GameId } from "@/core/game-context/games";

/**
 * Marks the active game on <html data-game> (used by per-game styling such as
 * the PoE 2 `led-edge`). The canvas itself is plain obsidian (`bg`): since the
 * 2026-11 "Vaal / Obsidian instrument" redesign there is no light, linework,
 * grain or vignette behind content.
 */
export function Atmosphere({ game }: { game: GameId | null | undefined }) {
  useEffect(() => {
    const root = document.documentElement;
    if (game) root.dataset.game = game;
    else delete root.dataset.game;
  }, [game]);
  return null;
}
