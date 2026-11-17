import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { GameId } from "@/core/game-context/games";
import { marketLeagues, type MarketLeague } from "@/core/ipc/commands";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { defaultLeague } from "./derive";

interface LeagueValue {
  leagues: MarketLeague[];
  /** Selected league name; null until leagues are known. */
  league: string | null;
  setLeague: (name: string) => void;
  error: string | null;
}

const Ctx = createContext<LeagueValue | null>(null);
const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 80;

/** League list + per-game selected league, shared by all market screens of a game. */
export function LeagueProvider({ game, children }: { game: GameId; children: ReactNode }) {
  const [leagues, setLeagues] = useState<MarketLeague[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored, storedLoaded] = useGameSetting<string>(game, "market.league", "", isString);

  useEffect(() => {
    let cancelled = false;
    marketLeagues(game)
      .then((l) => {
        if (cancelled) return;
        setLeagues(l);
        setError(null);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [game]);

  // A stored league that no longer exists (league ended) falls back to the default.
  const league = useMemo(() => {
    if (!storedLoaded) return null; // never request a league the user did not pick
    if (stored && (leagues.length === 0 || leagues.some((l) => l.name === stored))) return stored;
    return defaultLeague(leagues);
  }, [stored, storedLoaded, leagues]);

  const value = useMemo(() => ({ leagues, league, setLeague: setStored, error }), [leagues, league, setStored, error]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLeague(): LeagueValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLeague must be used inside <LeagueProvider>");
  return ctx;
}
