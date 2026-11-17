/**
 * Versioned game-data definitions. A module asks "which rules apply to the
 * selected league?" instead of hard-coding one patch, so a new patch is a new
 * definition file, not a rewrite. Spec: docs/architecture/game-data.md
 */
import type { GameId } from "@/core/game-context/games";

/** How sure we are about a fact in a definition. */
export type Verification =
  /** Checked against official patch notes or game data (source listed). */
  | "confirmed"
  /** Stated by the project brief or a single secondary source; must be checked before modules rely on it. */
  | "unverified";

export interface Fact<T> {
  value: T;
  verification: Verification;
  /** Index into `PatchDefinition.sources`. */
  source?: number;
  note?: string;
}

export interface SourceRef {
  label: string;
  url: string;
  /** ISO date the source was checked. */
  checked: string;
}

/** League-mechanic and system flags modules branch on. Add fields; never repurpose. */
export interface PatchMechanics {
  /** Scarabs exist as map-device items. */
  scarabs: Fact<boolean>;
  /** Threads of Creation (map-device items that add a league mechanic). */
  threads: Fact<boolean>;
  /** Maximum Atlas passive points. */
  atlasPassivePoints: Fact<number>;
  /** Covens of Umbra: Fates on area bosses, Viscera, the Wickerman. */
  fates: Fact<boolean>;
  grimFates: Fact<boolean>;
  wickerman: Fact<boolean>;
  /** Some endgame bases need a minimum Item Tier to drop. */
  itemTierDrops: Fact<boolean>;
}

export interface PatchDefinition {
  game: GameId;
  /** Patch id, e.g. "3.30". `baseline` definitions describe older patches without precise data. */
  patch: string;
  name: string;
  /** Challenge league names as poe.ninja / the Trade site show them (softcore first). */
  leagues: string[];
  mechanics: PatchMechanics | null;
  sources: SourceRef[];
}
