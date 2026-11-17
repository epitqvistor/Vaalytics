import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameId } from "@/core/game-context/games";
import {
  MARKET_UPDATED_EVENT,
  marketCategories,
  marketHistory,
  marketOverview,
  marketRefresh,
  type MarketCategory,
  type MarketHistoryPoint,
  type MarketSnapshot,
  type MarketUpdatedEvent,
} from "@/core/ipc/commands";
import { useGameSetting } from "@/core/settings/useGameSetting";

/** Subscribes to engine updates for one (game, league, category). */
function useMarketUpdates(game: GameId, league: string | null, category: string | null, onUpdate: () => void) {
  const cb = useRef(onUpdate);
  cb.current = onUpdate;
  useEffect(() => {
    if (!league || !category) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<MarketUpdatedEvent>(MARKET_UPDATED_EVENT, ({ payload }) => {
      if (payload.game === game && payload.league === league && payload.category === category) cb.current();
    })
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(() => {
        /* outside Tauri */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [game, league, category]);
}

export interface OverviewState {
  snapshot: MarketSnapshot | null;
  /** IPC failure (not a source failure; those are in snapshot.lastError). */
  error: string | null;
  refresh: () => void;
}

/** Cache-first market data for one category. Re-reads when the engine reports an update. */
export function useMarketOverview(game: GameId, league: string | null, category: string | null): OverviewState {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(() => {
    if (!league || !category) return;
    const id = ++reqId.current;
    marketOverview(game, league, category)
      .then((s) => {
        if (id !== reqId.current) return; // a newer request superseded this one
        setSnapshot(s);
        setError(null);
      })
      .catch((e) => id === reqId.current && setError(String(e)));
  }, [game, league, category]);

  useEffect(() => {
    setSnapshot(null);
    load();
  }, [load]);

  useMarketUpdates(game, league, category, load);

  const refresh = useCallback(() => {
    if (!league || !category) return;
    marketRefresh(game, league, category)
      .then((started) => started && setSnapshot((s) => (s ? { ...s, refreshing: true } : s)))
      .catch((e) => setError(String(e)));
  }, [game, league, category]);

  return { snapshot, error, refresh };
}

export function useMarketCategories(game: GameId): MarketCategory[] {
  const [cats, setCats] = useState<MarketCategory[]>([]);
  useEffect(() => {
    let cancelled = false;
    marketCategories(game)
      .then((c) => !cancelled && setCats(c))
      .catch(() => !cancelled && setCats([]));
    return () => {
      cancelled = true;
    };
  }, [game]);
  return cats;
}

/** Locally recorded history (one point per hour while Vaalytics syncs). */
export function useMarketHistory(game: GameId, league: string | null, category: string | null, itemId: string | null, days = 30) {
  const [points, setPoints] = useState<MarketHistoryPoint[]>([]);
  const load = useCallback(() => {
    if (!league || !category || !itemId) return setPoints([]);
    marketHistory(game, league, category, itemId, days)
      .then(setPoints)
      .catch(() => setPoints([]));
  }, [game, league, category, itemId, days]);
  useEffect(load, [load]);
  useMarketUpdates(game, league, category, load);
  return points;
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === "string");
const NO_FAVORITES: string[] = [];

/** Favourites are per game, stored as "category:itemId" keys. */
export function useFavorites(game: GameId) {
  const [list, setList] = useGameSetting<string[]>(game, "market.favorites", NO_FAVORITES, isStringArray);
  const set = useMemo(() => new Set(list), [list]);
  const toggle = useCallback(
    (key: string) => setList(set.has(key) ? list.filter((k) => k !== key) : [...list, key]),
    [list, set, setList],
  );
  return { favorites: set, list, toggle };
}

/** Re-renders every `ms` while mounted; used for "updated x min ago" labels. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === "visible" && setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Several categories at once (Dashboard: currency + favourites' categories).
 * Each read is cache-first; the engine only fetches expired data.
 */
export function useMarketOverviews(game: GameId, league: string | null, categories: readonly string[]) {
  const [snaps, setSnaps] = useState<Record<string, MarketSnapshot>>({});
  const key = categories.join("|");

  const loadOne = useCallback(
    (category: string) => {
      if (!league) return;
      marketOverview(game, league, category)
        .then((s) => setSnaps((prev) => ({ ...prev, [category]: s })))
        .catch(() => {
          /* surfaced per-snapshot via lastError when the source fails */
        });
    },
    [game, league],
  );

  useEffect(() => {
    setSnaps({});
    if (!league) return;
    key.split("|").filter(Boolean).forEach(loadOne);
  }, [key, league, loadOne]);

  useEffect(() => {
    if (!league) return;
    const wanted = new Set(key.split("|"));
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<MarketUpdatedEvent>(MARKET_UPDATED_EVENT, ({ payload }) => {
      if (payload.game === game && payload.league === league && wanted.has(payload.category)) loadOne(payload.category);
    })
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [game, league, key, loadOne]);

  return snaps;
}
