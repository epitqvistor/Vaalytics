import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { MARKET_UPDATED_EVENT, marketCategories, marketOverview, type MarketItemRow, type MarketSnapshot, type MarketUpdatedEvent } from "@/core/ipc/commands";
import type { ParsedItem } from "@/shared/item-parser/types";
import { marketLookupCategories } from "@/shared/trade/query";

export interface ExchangePrice {
  /** loading: still looking · found: poe.ninja prices it · none: bulk item poe.ninja doesn't know · skip: not a bulk item. */
  status: "loading" | "found" | "none" | "skip";
  row: MarketItemRow | null;
  category: string | null;
  /** Unix seconds of the snapshot the row comes from. */
  fetchedAt: number | null;
  error: string | null;
}

const LOADING: ExchangePrice = { status: "loading", row: null, category: null, fetchedAt: null, error: null };
/** How long to wait for a category Market Data is still fetching for the first time. */
const COLD_WAIT_MS = 20_000;

/** A snapshot with nothing in it yet because the engine is still fetching it (cache-first read on a cold cache). */
const isCold = (s: MarketSnapshot) => s.items.length === 0 && (s.refreshing || s.fetchedAt == null) && !s.lastError;

/**
 * Looks a bulk item (currency, tattoos, essences, cards …) up in the game's poe.ninja exchange
 * categories through Market Data. Reads are cache-first; a category that is still being fetched for
 * the first time is waited for (market:updated event, bounded) instead of reporting "no price".
 */
export function useExchangePrice(item: ParsedItem, league: string): ExchangePrice {
  const [state, setState] = useState<ExchangePrice>(LOADING);
  const name = item.baseType ?? item.name ?? "";

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    setState(LOADING);

    const lookOnce = async (lookup: string[]) => {
      const results = await Promise.allSettled(lookup.map((c) => marketOverview(item.game, league, c)));
      let error: string | null = null;
      const cold: string[] = [];
      for (const [i, r] of results.entries()) {
        if (r.status === "rejected") {
          error ??= String(r.reason);
          continue;
        }
        const row = r.value.items.find((x) => x.name === name && x.variant == null);
        if (row) return { found: { status: "found", row, category: r.value.category, fetchedAt: r.value.fetchedAt, error: null } as ExchangePrice, cold, error };
        if (isCold(r.value)) cold.push(lookup[i]!);
        error ??= r.value.lastError;
      }
      return { found: null, cold, error };
    };

    (async (): Promise<ExchangePrice> => {
      const cats = await marketCategories(item.game).catch(() => []);
      const lookup = marketLookupCategories(
        item,
        cats.filter((c) => c.endpoint === "exchange").map((c) => c.id),
      );
      if (lookup.length === 0) return { ...LOADING, status: "skip" };

      let res = await lookOnce(lookup);
      const deadline = Date.now() + COLD_WAIT_MS;
      while (!res.found && res.cold.length > 0 && !cancelled && Date.now() < deadline) {
        // Wait for one of the cold categories to arrive (or the deadline), then look again.
        const waiting = new Set(res.cold);
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, deadline - Date.now());
          listen<MarketUpdatedEvent>(MARKET_UPDATED_EVENT, ({ payload }) => {
            if (payload.game === item.game && payload.league === league && waiting.has(payload.category)) {
              window.clearTimeout(timer);
              resolve();
            }
          })
            .then((u) => {
              unlisten?.();
              unlisten = u;
              if (cancelled) u();
            })
            .catch(() => {});
        });
        unlisten?.();
        unlisten = undefined;
        if (cancelled) break;
        res = await lookOnce(res.cold);
      }
      return res.found ?? { ...LOADING, status: "none", error: res.error };
    })().then((s) => !cancelled && setState(s));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [item, league, name]);

  return state;
}
