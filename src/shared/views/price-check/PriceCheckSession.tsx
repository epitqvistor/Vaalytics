import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameConfig } from "@/core/game-context/config";
import { tradeFetchMore, tradePriceCheck, type TradeListing, type TradePriceCheck } from "@/core/ipc/commands";
import { useMarketOverview } from "@/core/market/hooks";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { isValidContact, loadGemVariants, useStatIndex, useTradeContact } from "@/core/trade/hooks";
import { getCachedResult, putCachedResult, resultKey } from "@/core/trade/resultCache";
import { Button, Input, Panel } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { ParsedItem } from "@/shared/item-parser/types";
import {
  applyMode,
  applyRange,
  buildFilters,
  buildQuery,
  defaultOptions,
  searchBasis,
  tradeSiteSearchUrl,
  type RangePreset,
  type SearchMode,
  type SearchOptions,
  type StatFilter,
} from "@/shared/trade/query";
import { templateKey } from "@/shared/trade/stats";
import { valuate } from "@/shared/trade/valuation";
import { cn } from "@/shared/utilities/cn";
import { FilterEditor } from "./FilterEditor";
import { ItemSummary } from "./ItemSummary";
import { isListingSort, Listings, type ListingSort } from "./Listings";
import { ValueSummary, type ResultState } from "./ValueSummary";

export interface PriceCheckSessionProps {
  item: ParsedItem;
  league: string;
  config: GameConfig;
  /** Overlay / panel: single column. */
  compact?: boolean;
}

/** One search fetches this many of the cheapest matching listings (the host caps a call at 20). */
const FIRST_FETCH = 20;

export function PriceCheckSession({ item, league, config, compact }: PriceCheckSessionProps) {
  const { index, error: indexError } = useStatIndex(item.game);
  const { contact } = useTradeContact();
  const [stats, setStats] = useState<StatFilter[]>([]);
  const defaults = useRef<StatFilter[]>([]);
  const [unmatched, setUnmatched] = useState<{ id: string; text: string }[]>([]);
  /** Item whose filters are built — the auto search waits for it (an item may have no searchable stats at all). */
  const [filtersFor, setFiltersFor] = useState<string | null>(null);
  const [mode, setMode] = useState<SearchMode>("quick");
  const [opts, setOpts] = useState<SearchOptions>(() => defaultOptions(item));
  const [result, setResult] = useState<TradePriceCheck | null>(null);
  const [listings, setListings] = useState<TradeListing[]>([]);
  const [searchedAt, setSearchedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Last query sent — lets the user open the same search on the Trade site. */
  const [lastQuery, setLastQuery] = useState<Record<string, unknown> | null>(null);
  /** Filters/options at the time of the shown result (basis and match scores refer to them). */
  const [searchedStats, setSearchedStats] = useState<StatFilter[]>([]);
  const [dirty, setDirty] = useState(false);
  const [defaultSort] = useGameSetting<ListingSort>(item.game, "priceCheck.defaultSort", "price", isListingSort);
  const [sortOverride, setSort] = useState<ListingSort | null>(null);
  const sort = sortOverride ?? defaultSort;

  // New item → fresh filters.
  useEffect(() => {
    if (!index) return;
    const f = buildFilters(item, index);
    defaults.current = f.stats;
    setStats(f.stats);
    setUnmatched(f.unmatched);
    setFiltersFor(item.raw);
    setMode("quick");
    setOpts(defaultOptions(item));
    setResult(null);
    setListings([]);
    setError(null);
    setSearchedStats([]);
  }, [item, index]);

  // Latest search wins: a response for an older search (filters changed meanwhile) is dropped.
  const seq = useRef(0);
  const inFlightKey = useRef<string | null>(null);
  const search = useCallback(
    async (filters: StatFilter[], options: SearchOptions, force = false) => {
      // Transfigured gems need base + discriminator; without the list the plain name is tried.
      const gems = item.rarity === "Gem" ? await loadGemVariants(item.game).catch(() => []) : [];
      const query = buildQuery(item, filters, options, gems);
      const key = resultKey(item.game, league, query);
      if (inFlightKey.current === key) return; // the same search is already running
      setLastQuery(query);
      setSearchedStats(filters);
      setDirty(false);
      setError(null);

      const cached = force ? null : getCachedResult(key);
      if (cached) {
        seq.current++;
        inFlightKey.current = null;
        setResult(cached.result);
        setListings(cached.listings);
        setSearchedAt(cached.at);
        setFromCache(true);
        setLoading(false);
        return;
      }

      const mine = ++seq.current;
      inFlightKey.current = key;
      setLoading(true);
      try {
        const r = await tradePriceCheck(item.game, league, query, FIRST_FETCH);
        if (mine !== seq.current) return;
        const at = Date.now();
        putCachedResult(key, { result: r, listings: r.listings, at });
        setResult(r);
        setListings(r.listings);
        setSearchedAt(at);
        setFromCache(false);
      } catch (e) {
        if (mine === seq.current) setError(String(e));
      } finally {
        if (mine === seq.current) {
          inFlightKey.current = null;
          setLoading(false);
        }
      }
    },
    [item, league],
  );

  // Search once automatically per item (the user explicitly asked for a price check).
  // A ref (not state) guarantees exactly one search even if the effect re-runs
  // before a re-render (e.g. React StrictMode) — every search costs rate limit.
  const autoSearched = useRef<string | null>(null);
  useEffect(() => {
    if (!index || !contact || filtersFor !== item.raw) return;
    if (autoSearched.current === `${item.raw}\u0000${league}`) return;
    autoSearched.current = `${item.raw}\u0000${league}`;
    void search(stats, opts);
  }, [index, contact, stats, opts, item, search, filtersFor, league]);

  const loadMore = async () => {
    if (!result) return;
    setLoading(true);
    try {
      const more = await tradeFetchMore(item.game, result.searchId, listings.length, 10);
      setListings((l) => [...l, ...more.listings]);
      setResult((r) => (r ? { ...r, hasMore: more.hasMore } : r));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // How well each listing matches the searched (not the currently edited) modifiers.
  const searchedKeys = useMemo(() => searchedStats.filter((s) => s.enabled && s.source === "mod" && s.option == null).map((s) => templateKey(s.label)), [searchedStats]);
  const matchOf = useCallback(
    (l: TradeListing) => {
      if (searchedKeys.length === 0) return null;
      const keys = new Set(l.item.mods.map(templateKey));
      return searchedKeys.filter((k) => keys.has(k)).length / searchedKeys.length;
    },
    [searchedKeys],
  );

  const basis = useMemo(() => searchBasis(item, searchedStats), [item, searchedStats]);
  const valuation = useMemo(
    () =>
      result
        ? valuate({
            listings: listings.map((l) => ({ id: l.id, amountBase: l.amountBase, indexed: l.indexed, match: matchOf(l) })),
            total: result.total,
            basis,
            unsearchedMods: basis === "stats" ? unmatched.length : 0,
          })
        : null,
    [result, listings, basis, unmatched.length, matchOf],
  );

  // Currency is traded in bulk: the poe.ninja rate (Market Data) is the better reference than the
  // cheapest single listings. Shown separately and labelled — never mixed into the listing estimate.
  const isCurrency = item.rarity === "Currency" && item.itemClass !== "Corpses";
  const { snapshot: currencyMarket } = useMarketOverview(item.game, isCurrency ? league : null, "currency");
  const market = useMemo(() => {
    const row = currencyMarket?.items.find((r) => r.name === item.baseType && r.variant == null);
    return row && currencyMarket ? { value: row.value, at: currencyMarket.fetchedAt, league, isPremium: item.baseType === config.premiumUnit.name } : null;
  }, [currencyMarket, item.baseType, league, config.premiumUnit.name]);

  const state: ResultState = error ? "failed" : loading && result ? "refreshing" : result ? (fromCache ? "cached" : "live") : "idle";
  const searchedIds = useMemo(() => {
    const ids = new Set(stats.filter((s) => s.enabled && s.source === "mod").map((s) => s.key));
    const pseudoTexts = new Set(stats.filter((s) => s.enabled && s.sources).flatMap((s) => s.sources!));
    for (const m of item.mods) if (pseudoTexts.has(m.text)) ids.add(m.id);
    return ids;
  }, [stats, item.mods]);
  const icon = useMemo(() => listings.find((l) => l.item.icon && l.item.typeLine.endsWith(item.baseType))?.item.icon ?? null, [listings, item.baseType]);

  const updateStat = (key: string, patch: Partial<StatFilter>) => {
    setStats((s) => s.map((f) => (f.key === key ? { ...f, ...patch } : f)));
    setDirty(true);
  };
  const changeMode = (m: SearchMode) => {
    const next = applyMode(stats, defaults.current, m);
    setMode(m);
    setStats(next);
    setDirty(true);
    // Switching to/from base type is a different question: answer it right away.
    if (m === "base" || mode === "base") void search(next, opts);
  };
  const changeRange = (preset: RangePreset) => {
    setStats((s) => applyRange(s, preset));
    setDirty(true);
  };
  const openTrade = lastQuery ? () => openUrl(result && !dirty ? result.tradeUrl : tradeSiteSearchUrl(item.game, league, lastQuery)).catch((e) => setError(String(e))) : null;

  if (contact === null) return <ContactGate />;

  const summary = (
    <ValueSummary valuation={valuation} config={config} state={state} searchedAt={searchedAt} loading={loading} ratesAvailable={result?.ratesAvailable ?? true} market={market} />
  );
  const filters = (
    <FilterEditor
      item={item}
      mode={mode}
      onMode={changeMode}
      stats={stats}
      onStat={updateStat}
      onRange={changeRange}
      opts={opts}
      onOpts={(patch) => (setOpts((o) => ({ ...o, ...patch })), setDirty(true))}
      unmatched={unmatched}
      loading={loading}
      dirty={dirty}
      hasResult={result != null}
      onSearch={() => search(stats, opts, !dirty)}
      indexState={indexError ? indexError : index ? "ready" : "loading"}
    />
  );
  const errorBox = error && (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
      <Icon name="error" size={14} className="mt-px shrink-0" />
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <span>{error}</span>
        {lastQuery && (
          <Button size="sm" variant="secondary" icon="external" onClick={() => openUrl(tradeSiteSearchUrl(item.game, league, lastQuery)).catch((e) => setError(String(e)))}>
            Open this search on the Trade site
          </Button>
        )}
      </div>
    </div>
  );
  const list = (
    <Listings
      listings={listings}
      total={result ? result.total : null}
      verdicts={valuation?.verdicts ?? null}
      matchOf={matchOf}
      sort={sort}
      onSort={setSort}
      config={config}
      loading={loading}
      hasMore={result?.hasMore ?? false}
      onMore={loadMore}
      onOpenTrade={openTrade}
      hideOffline={opts.status !== "any"}
    />
  );

  return (
    <div className={cn("grid items-start gap-3", compact ? "grid-cols-1" : "grid-cols-[minmax(300px,380px)_minmax(0,1fr)] gap-5")}>
      <div className="flex min-w-0 flex-col gap-3">
        <ItemSummary item={item} searched={searchedIds} icon={icon} collapsed={compact} />
        {compact && summary}
        {filters}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        {!compact && summary}
        {errorBox}
        {list}
      </div>
    </div>
  );
}

function ContactGate() {
  const { save } = useTradeContact();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const valid = isValidContact(value);
  return (
    <Panel title="One-time setup: Trade contact">
      <div className="flex max-w-xl flex-col gap-3 text-sm text-fg-muted">
        <p>
          Grinding Gear Games asks third-party tools to identify themselves when using the Trade site. Vaalytics sends your contact address in the
          request's User-Agent header — nothing else, and only to pathofexile.com.
        </p>
        <Input
          label="Contact email (or https:// link)"
          placeholder="you@example.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={value && !valid ? "Enter an email address or an https:// link." : undefined}
        />
        <div>
          <Button
            variant="primary"
            disabled={!valid}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              await save(value).finally(() => setSaving(false));
              location.reload();
            }}
          >
            Save and enable Trade
          </Button>
        </div>
      </div>
    </Panel>
  );
}
