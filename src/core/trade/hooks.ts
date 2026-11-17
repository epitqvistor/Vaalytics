import { useEffect, useState } from "react";
import type { GameId } from "@/core/game-context/games";
import { getAppSetting, setAppSetting, tradeStats, TRADE_CONTACT_KEY } from "@/core/ipc/commands";
import { buildStatIndex, type StatIndex } from "@/shared/trade/stats";

const indexCache = new Map<GameId, Promise<StatIndex>>();

/** Trade stat index per game; downloaded once (cached on disk for 24 h by the host). */
export function loadStatIndex(game: GameId): Promise<StatIndex> {
  let p = indexCache.get(game);
  if (!p) {
    p = tradeStats(game).then(buildStatIndex);
    p.catch(() => indexCache.delete(game));
    indexCache.set(game, p);
  }
  return p;
}

export function useStatIndex(game: GameId): { index: StatIndex | null; error: string | null } {
  const [state, setState] = useState<{ index: StatIndex | null; error: string | null }>({ index: null, error: null });
  useEffect(() => {
    let cancelled = false;
    setState({ index: null, error: null });
    loadStatIndex(game)
      .then((index) => !cancelled && setState({ index, error: null }))
      .catch((e) => !cancelled && setState({ index: null, error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [game]);
  return state;
}

/** Contact address sent in the User-Agent of Trade requests (GGG asks tools to identify themselves). */
export function useTradeContact() {
  const [contact, setContact] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    getAppSetting<string>(TRADE_CONTACT_KEY)
      .then((v) => setContact(typeof v === "string" && v ? v : null))
      .catch(() => setContact(null));
  }, []);
  const save = async (value: string) => {
    await setAppSetting(TRADE_CONTACT_KEY, value.trim());
    setContact(value.trim() || null);
  };
  return { contact, save };
}

export function isValidContact(s: string): boolean {
  const v = s.trim();
  return v.length >= 4 && v.length <= 120 && !/[()\u0000-\u001f]/.test(v) && (v.includes("@") || v.startsWith("https://"));
}
