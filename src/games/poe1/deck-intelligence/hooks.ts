/**
 * Data hooks for Deck Intelligence. Everything is read on demand and re-read on `decks:updated`
 * (sent by Rust when a session changes) — no timers or polling.
 */
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DECKS_UPDATED_EVENT,
  type DeckCardTotal,
  type DeckConfig,
  type DeckSessionDetail,
  type DeckSessionSummary,
  type DivinationCardDb,
  decksCards,
  decksCardTotals,
  decksConfig,
  decksPriceOverrides,
  decksSession,
  decksSessions,
  decksSetConfig,
} from "@/core/ipc/commands";
import { useMarketOverview } from "@/core/market/hooks";
import type { PriceBook } from "./analytics";

export const GAME = "poe1" as const;

/** Calls `fn` whenever Rust reports a Deck Intelligence change. */
export function useDecksUpdated(fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen(DECKS_UPDATED_EVENT, () => ref.current())
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(() => {
        /* outside Tauri */
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

export function useDeckSessions() {
  const [sessions, setSessions] = useState<DeckSessionSummary[] | null>(null);
  const [totals, setTotals] = useState<DeckCardTotal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const id = ++seq.current;
    Promise.all([decksSessions(GAME), decksCardTotals(GAME)])
      .then(([s, t]) => {
        if (id !== seq.current) return;
        setSessions(s);
        setTotals(t);
        setError(null);
      })
      .catch((e) => id === seq.current && setError(String(e)));
  }, []);
  useEffect(reload, [reload]);
  useDecksUpdated(reload);
  return { sessions, totals, error, reload };
}

export function useDeckSession(id: number | null) {
  const [detail, setDetail] = useState<DeckSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(() => {
    if (id === null) return;
    const n = ++seq.current;
    decksSession(GAME, id)
      .then((d) => n === seq.current && (setDetail(d), setError(null)))
      .catch((e) => n === seq.current && setError(String(e)));
  }, [id]);
  useEffect(() => {
    setDetail(null);
    reload();
  }, [reload]);
  useDecksUpdated(reload);
  return { detail, error, reload };
}

/** The card database (RePoE), loaded once per mount; cached on disk by Rust. */
export function useCardDb() {
  const [db, setDb] = useState<DivinationCardDb | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((force = false) => {
    setError(null);
    decksCards(GAME, force)
      .then(setDb)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => load(false), [load]);
  return { db, error, refresh: () => load(true) };
}

/** poe.ninja divination prices (Market Data engine) + the user's manual prices for `league`. */
export function usePriceBook(league: string | null) {
  const overview = useMarketOverview(GAME, league, league ? "divination" : null);
  const [manual, setManual] = useState<Record<string, number>>({});
  const reloadManual = useCallback(() => {
    if (!league) return setManual({});
    decksPriceOverrides(GAME, league)
      .then(setManual)
      .catch(() => setManual({}));
  }, [league]);
  useEffect(reloadManual, [reloadManual]);
  const snap = overview.snapshot;
  const book: PriceBook | null = useMemo(() => {
    if (!league) return null;
    return {
      league,
      market: new Map((snap?.items ?? []).map((i) => [i.name, i.value])),
      manual: new Map(Object.entries(manual)),
      at: snap?.fetchedAt ? snap.fetchedAt * 1000 : null,
    };
  }, [league, snap, manual]);
  const icons = useMemo(() => new Map((snap?.items ?? []).filter((i) => i.icon).map((i) => [i.name, i.icon!])), [snap]);
  return { book, snapshot: snap, error: overview.error, refresh: overview.refresh, reloadManual, icons };
}

export function useDeckConfig() {
  const [config, setConfig] = useState<DeckConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    decksConfig(GAME)
      .then(setConfig)
      .catch((e) => setError(String(e)));
  }, []);
  const save = useCallback(async (next: DeckConfig) => {
    const saved = await decksSetConfig(GAME, next);
    setConfig(saved);
    setError(null);
    return saved;
  }, []);
  return { config, error, save };
}
