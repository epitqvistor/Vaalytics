/**
 * League-aware access to versioned game data. Challenge leagues map to the
 * patch they belong to; permanent leagues (Standard, Hardcore, SSF…) follow the
 * current patch; unknown leagues fall back to the current patch and are
 * flagged `assumed` so the UI can say so.
 */
import type { GameId } from "@/core/game-context/games";
import { useLeague } from "@/core/market/LeagueContext";
import { POE1_CURRENT, POE1_PATCHES } from "./poe1";
import type { PatchDefinition } from "./types";

export type { Fact, PatchDefinition, PatchMechanics, SourceRef, Verification } from "./types";

const PATCHES: Record<GameId, { list: readonly PatchDefinition[]; current: string | null }> = {
  poe1: { list: POE1_PATCHES, current: POE1_CURRENT },
  // No PoE 2 definitions yet: modules must not assume PoE 1 rules there.
  poe2: { list: [], current: null },
};

const PERMANENT = /^(SSF )?(Hardcore|Standard|HC)( SSF)?$|^(Solo Self-Found|Ruthless)/i;

export interface ResolvedPatch {
  definition: PatchDefinition | null;
  /** The league wasn't recognised; the current patch is assumed. */
  assumed: boolean;
  permanent: boolean;
}

export function patchFor(game: GameId, league: string | null): ResolvedPatch {
  const { list, current } = PATCHES[game];
  const byId = (id: string | null) => (id ? (list.find((p) => p.patch === id) ?? null) : null);
  if (!league) return { definition: byId(current), assumed: true, permanent: false };
  const name = league.trim().toLowerCase();
  const exact = list.find((p) => p.leagues.some((l) => l.toLowerCase() === name));
  if (exact) return { definition: exact, assumed: false, permanent: false };
  if (PERMANENT.test(league.trim())) return { definition: byId(current), assumed: false, permanent: true };
  return { definition: byId(current), assumed: true, permanent: false };
}

export const patchById = (game: GameId, patch: string) => PATCHES[game].list.find((p) => p.patch === patch) ?? null;

/** Patch rules for the league selected in this game's workspace. */
export function usePatch(game: GameId): ResolvedPatch {
  const { league } = useLeague();
  return patchFor(game, league);
}
