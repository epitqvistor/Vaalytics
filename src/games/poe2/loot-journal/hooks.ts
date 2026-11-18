/**
 * Loot Journal data hooks. Data is re-read when the Rust service reports a
 * change (`loot:updated`) — no polling. Other modules can reuse these.
 */
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LOOT_STATUS_EVENT,
  LOOT_UPDATED_EVENT,
  lootConfig,
  lootDetail,
  lootList,
  lootStatus,
  type LootCaptureStatus,
  type LootConfig,
  type LootItem,
  type LootQuery,
  type LootValuation,
} from "@/core/ipc/commands";

const GAME = "poe2" as const;

function useEvent<T>(name: string, fn: (payload: T) => void) {
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

export function useLootConfig() {
  const r = useLoaded<LootConfig>(() => lootConfig(GAME), "config");
  const [override, setOverride] = useState<LootConfig | null>(null);
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
