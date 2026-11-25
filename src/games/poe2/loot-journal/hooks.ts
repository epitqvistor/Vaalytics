/**
 * Loot Journal data hooks. Data is re-read when the Rust service reports a
 * change (`loot:updated`) — no polling. Other modules can reuse these.
 */
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LOOT_CONFIG_EVENT,
  LOOT_STATUS_EVENT,
  LOOT_UPDATED_EVENT,
  lootConfig,
  lootDetail,
  lootList,
  lootMapCounts,
  lootMaps,
  lootStatus,
  lootTrackerSummary,
  type LootCaptureStatus,
  type LootConfig,
  type LootItem,
  type LootMapRun,
  type LootQuery,
  type LootValuation,
} from "@/core/ipc/commands";

const GAME = "poe2" as const;

export function useEvent<T>(name: string, fn: (payload: T) => void) {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<T>(name, ({ payload }) => cb.current(payload))
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(() => {
        /* outside Tauri */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name]);
}

export const useLootUpdates = (fn: () => void) => useEvent(LOOT_UPDATED_EVENT, fn);

function useLoaded<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);
  const ref = useRef(load);
  ref.current = load;
  const reload = useCallback(() => {
    const id = ++req.current;
    ref
      .current()
      .then((d) => {
        if (id !== req.current) return;
        setData(d);
        setError(null);
      })
      .catch((e) => id === req.current && setError(String(e)));
  }, [key]);
  useEffect(reload, [reload]);
  useLootUpdates(reload);
  return { data, error, reload };
}

export const useLootItems = (query: LootQuery) => useLoaded<LootItem[]>(() => lootList(GAME, query), JSON.stringify(query));

export const useLootDetail = (id: number | null) =>
  useLoaded<{ item: LootItem; rawText: string; valuations: LootValuation[] } | null>(() => (id === null ? Promise.resolve(null) : lootDetail(GAME, id)), String(id));

/** Map records, newest first (Session Intelligence updates arrive as `loot:updated` when they change a record). */
export const useLootMaps = (sessionId: number | null, limit = 200) => useLoaded<LootMapRun[]>(() => lootMaps(GAME, sessionId, limit), `${sessionId}:${limit}`);

export const useLootMapCounts = () => useLoaded<{ maps: number; sessions: number }>(() => lootMapCounts(GAME), "counts");

/** Unix time of the user's last "Reset session" (null = none), kept current through `loot:updated`. */
export function useSessionReset(): number | null | undefined {
  const r = useLoaded<number | null>(() => lootTrackerSummary(GAME, 1).then((s) => s.resetAt), "reset");
  return r.error ? null : (r.data ?? undefined);
}

export function useLootConfig() {
  const r = useLoaded<LootConfig>(() => lootConfig(GAME), "config");
  const [override, setOverride] = useState<LootConfig | null>(null);
  // Saved from another window (main window ↔ Loot Tracker overlay).
  useEvent<LootConfig>(LOOT_CONFIG_EVENT, setOverride);
  return { ...r, data: override ?? r.data, set: setOverride };
}

/** Capture status, pushed by Rust on change (`loot:status`). */
export function useLootStatus(): LootCaptureStatus | null {
  const [s, setS] = useState<LootCaptureStatus | null>(null);
  useEffect(() => {
    lootStatus(GAME)
      .then(setS)
      .catch(() => setS(null));
  }, []);
  useEvent<LootCaptureStatus>(LOOT_STATUS_EVENT, setS);
  return s;
}
