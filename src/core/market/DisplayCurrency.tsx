/**
 * Display currency: the unit prices are shown in (per game, persisted). Market
 * values are stored in the game's base unit (PoE 1 chaos, PoE 2 exalted); they
 * are converted with the current poe.ninja rate of the chosen currency. When a
 * rate is unavailable, values stay in the base unit — never guessed.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { GameId } from "@/core/game-context/games";
import type { MarketItemRow } from "@/core/ipc/commands";
import { useGameSetting } from "@/core/settings/useGameSetting";
import type { CurrencyUnit } from "@/shared/market-data/types";
import { formatAmount, formatCompact } from "@/shared/utilities/format";
import { useMarketOverview } from "./hooks";
import { useLeague } from "./LeagueContext";

export interface DisplayUnit extends CurrencyUnit {
  icon: string | null;
}

export interface DisplayCurrencyValue {
  base: CurrencyUnit;
  premium: CurrencyUnit;
  /** Chosen unit; falls back to `base` while its rate is unknown. */
  unit: DisplayUnit;
  /** True when a non-base unit is active (and its rate is known). */
  converting: boolean;
  /** Selected id, even if its rate is not loaded yet. */
  selectedId: string;
  options: DisplayUnit[];
  setUnit: (id: string) => void;
  /** Base amount → amount in `unit`. */
  toUnit: (base: number) => number;
  /** Base amount → amount in another currency id (null without a rate). */
  toCurrency: (base: number, id: string) => number | null;
}

/** Short labels for common currencies; others show their full name. */
const SHORT: Record<string, string> = {
  "Chaos Orb": "c",
  "Divine Orb": "div",
  "Exalted Orb": "ex",
  "Mirror of Kalandra": "mirror",
  "Mirror Shard": "shard",
  "Orb of Annulment": "annul",
  "Orb of Alchemy": "alch",
  "Orb of Alteration": "alt",
  "Regal Orb": "regal",
  "Vaal Orb": "vaal",
  "Orb of Fusing": "fuse",
  "Chromatic Orb": "chrom",
  "Jeweller's Orb": "jew",
  "Orb of Augmentation": "aug",
  "Orb of Transmutation": "trans",
};
/** Shown right after base / premium in the picker. */
const POPULAR = ["Exalted Orb", "Mirror of Kalandra", "Mirror Shard", "Orb of Annulment", "Orb of Alchemy"];

const Ctx = createContext<DisplayCurrencyValue | null>(null);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 120;

/** Pickable units and their rates (base per unit) from a poe.ninja currency snapshot. */
export function displayOptions(items: readonly MarketItemRow[], base: CurrencyUnit, premium: CurrencyUnit) {
  const rates = new Map<string, number>([[base.id, 1]]);
  const units = new Map<string, DisplayUnit>([[base.id, { ...base, icon: null }]]);
  for (const row of items) {
    if (row.variant !== null || !(row.value > 0)) continue;
    if (row.itemId === base.id) {
      units.set(base.id, { ...base, icon: row.icon });
      continue;
    }
    rates.set(row.itemId, row.value);
    units.set(row.itemId, { id: row.itemId, name: row.name, short: SHORT[row.name] ?? row.name, icon: row.icon });
  }
  // Premium may be absent from a snapshot that hasn't loaded yet; keep it listed.
  if (!units.has(premium.id)) units.set(premium.id, { ...premium, icon: null });
  const rank = (u: DisplayUnit) => (u.id === base.id ? 0 : u.id === premium.id ? 1 : POPULAR.includes(u.name) ? 2 + POPULAR.indexOf(u.name) : 100);
  const options = [...units.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return { options, rates };
}

export function DisplayCurrencyProvider({ game, base, premium, children }: { game: GameId; base: CurrencyUnit; premium: CurrencyUnit; children: ReactNode }) {
  const { league } = useLeague();
  const { snapshot } = useMarketOverview(game, league, "currency");
  const [selectedId, setSelected] = useGameSetting<string>(game, "market.displayUnit", base.id, isId);

  const { options, rates } = useMemo(() => displayOptions(snapshot?.items ?? [], base, premium), [snapshot, base, premium]);

  const rate = rates.get(selectedId);
  const unit = (rate && options.find((o) => o.id === selectedId)) || options.find((o) => o.id === base.id)!;
  const converting = unit.id !== base.id;
  const toUnit = useCallback((v: number) => (converting && rate ? v / rate : v), [converting, rate]);
  const toCurrency = useCallback((v: number, id: string) => {
    const r = rates.get(id);
    return r ? v / r : null;
  }, [rates]);

  const value = useMemo<DisplayCurrencyValue>(
    () => ({ base, premium, unit, converting, selectedId, options, setUnit: setSelected, toUnit, toCurrency }),
    [base, premium, unit, converting, selectedId, options, setSelected, toUnit, toCurrency],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Null outside a game workspace (e.g. the overlay without a provider): show base values. */
export const useDisplayCurrency = () => useContext(Ctx);

/** "1,234 c" / "8.12 div" for a base amount, in the display currency when one is set. */
export function useMoney() {
  const d = useDisplayCurrency();
  return useCallback(
    (base: number, opts: { compact?: boolean; unit?: CurrencyUnit } = {}) => {
      const fmt = opts.compact ? formatCompact : formatAmount;
      if (!d) return `${fmt(base)}${opts.unit ? ` ${opts.unit.short}` : ""}`;
      return `${fmt(d.toUnit(base))} ${d.unit.short}`;
    },
    [d],
  );
}
