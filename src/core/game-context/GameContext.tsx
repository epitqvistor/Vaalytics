import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getLastGame, setAppSetting, setLastGame } from "@/core/ipc/commands";
import type { GameId } from "./games";

interface GameContextValue {
  /** `undefined` while the persisted choice is loading, `null` when no game is selected. */
  game: GameId | null | undefined;
  selectGame: (game: GameId) => void;
  clearGame: () => void;
}

const Ctx = createContext<GameContextValue | null>(null);

/**
 * Game Context Manager (frontend half). Owns the active game and persists it via
 * the native settings store. Game modules read `game` but never switch it.
 */
export function GameProvider({ children }: { children: ReactNode }) {
  const [game, setGame] = useState<GameId | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getLastGame()
      .then((g) => !cancelled && setGame(g))
      .catch((err) => {
        console.warn("Could not load last game", err);
        if (!cancelled) setGame(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectGame = useCallback((g: GameId) => {
    setGame(g);
    setLastGame(g).catch((err) => console.warn("Could not persist game", err));
    setAppSetting("app.lastPlayed", g).catch(() => {});
  }, []);

  const clearGame = useCallback(() => {
    setGame(null);
    setLastGame(null).catch((err) => console.warn("Could not persist game", err));
  }, []);

  const value = useMemo(() => ({ game, selectGame, clearGame }), [game, selectGame, clearGame]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGameContext(): GameContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGameContext must be used inside <GameProvider>");
  return ctx;
}

const ActiveGameCtx = createContext<GameId | null>(null);

/**
 * Pins the game for a game environment's subtree. The shell provides it from its
 * own prop, so screens still animating out after a game switch keep the game
 * they were rendered for instead of seeing `null` (or the new game).
 */
export function ActiveGameProvider({ game, children }: { game: GameId; children: ReactNode }) {
  return <ActiveGameCtx.Provider value={game}>{children}</ActiveGameCtx.Provider>;
}

/** For components that only render inside a game environment. */
export function useActiveGame(): GameId {
  const game = useContext(ActiveGameCtx);
  if (!game) throw new Error("useActiveGame must be used inside <ActiveGameProvider>");
  return game;
}
