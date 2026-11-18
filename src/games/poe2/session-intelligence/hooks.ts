/**
 * Read interfaces for Session Intelligence. Data is re-read only when the Rust
 * tracker reports a change (`session:updated`, debounced to ≤ 1/s there) —
 * no polling from the UI. Other modules can use these hooks for session time,
 * map counts and area history.
 */
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameId } from "@/core/game-context/games";
import {
  SESSION_UPDATED_EVENT,
  sessionDetail,
  sessionList,
  sessionStatus,
  type SessionDetail,
  type SessionHistoryQuery,
  type SessionStatus,
  type SessionSummary,
} from "@/core/ipc/commands";

/** Calls `fn` whenever the tracker reports a change for `game`. */
export function useSessionUpdates(game: GameId, fn: () => void) {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<{ game: GameId }>(SESSION_UPDATED_EVENT, ({ payload }) => {
      if (payload.game === game) cb.current();
    })
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(() => {
        /* outside Tauri */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [game]);
}

interface Loaded<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

function useLoaded<T>(game: GameId, load: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);
  const reload = useCallback(() => {
    const id = ++req.current;
    load()
      .then((d) => {
        if (id !== req.current) return;
        setData(d);
        setError(null);
      })
      .catch((e) => id === req.current && setError(String(e)));
  }, deps);
  useEffect(reload, [reload]);
  useSessionUpdates(game, reload);
  return { data, error, reload };
}

export function useSessionStatus(game: GameId): Loaded<SessionStatus> & { set: (s: SessionStatus) => void } {
  const r = useLoaded(game, () => sessionStatus(game), [game]);
  const [override, setOverride] = useState<SessionStatus | null>(null);
  useEffect(() => setOverride(null), [r.data]);
  return { ...r, data: override ?? r.data, set: setOverride };
}

export function useSessionHistory(game: GameId, query: SessionHistoryQuery): Loaded<SessionSummary[]> {
  const key = JSON.stringify(query);
  return useLoaded(game, () => sessionList(game, query), [game, key]);
}

export function useSessionDetail(game: GameId, id: number | null): Loaded<{ detail: SessionDetail; previous: SessionSummary | null } | null> {
  return useLoaded(game, () => (id === null ? Promise.resolve(null) : sessionDetail(game, id)), [game, id]);
}

/** Seconds since `sinceUnix`, ticking once per second while `active` (view open). */
export function useLiveSeconds(sinceUnix: number | null, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || sinceUnix === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active, sinceUnix]);
  return sinceUnix === null ? 0 : Math.max(0, Math.floor(now / 1000 - sinceUnix));
}
