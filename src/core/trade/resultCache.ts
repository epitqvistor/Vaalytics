/**
 * In-memory cache of price-check results for the life of the window. The key is the game, the
 * league and the exact query JSON, so a different filter set never reuses another result.
 * Cached results are always shown as cached (with their age), never as live.
 */
import type { GameId } from "@/core/game-context/games";
import type { TradeListing, TradePriceCheck } from "@/core/ipc/commands";

export interface CachedResult {
  result: TradePriceCheck;
  listings: TradeListing[];
  at: number;
}

/** Long enough to reopen an item after a quick look; short enough that prices aren't stale. */
export const RESULT_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 40;
const cache = new Map<string, CachedResult>();

export function resultKey(game: GameId, league: string, query: unknown): string {
  return `${game}\u0000${league}\u0000${JSON.stringify(query)}`;
}

export function getCachedResult(key: string, now = Date.now()): CachedResult | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > RESULT_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit;
}

export function putCachedResult(key: string, value: CachedResult): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

/** Test helper. */
export function clearResultCache(): void {
  cache.clear();
}
