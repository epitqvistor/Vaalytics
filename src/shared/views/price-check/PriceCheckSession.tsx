import { openUrl } from "@tauri-apps/plugin-opener";
import { useDisplayCurrency, useMoney } from "@/core/market/DisplayCurrency";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GameConfig } from "@/core/game-context/config";
import { tradeFetchMore, tradePriceCheck, type TradeListing, type TradePriceCheck } from "@/core/ipc/commands";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { isValidContact, useStatIndex, useTradeContact } from "@/core/trade/hooks";
import { Badge, Button, Checkbox, IconButton, Input, Panel, SegmentedControl, Spinner, Switch, type BadgeTone } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { ItemCard } from "@/shared/item-renderer/ItemCard";
import { toDisplayItem } from "@/shared/item-renderer/adapt";
import type { ParsedItem } from "@/shared/item-parser/types";
import { estimatePrice } from "@/shared/trade/estimate";
import { buildFilters, buildQuery, defaultOptions, type SearchOptions, type StatFilter } from "@/shared/trade/query";
import { templateKey } from "@/shared/trade/stats";
import { cn } from "@/shared/utilities/cn";
import { formatAmount, formatRelative } from "@/shared/utilities/format";

export interface PriceCheckSessionProps {
  item: ParsedItem;
  league: string;
  config: GameConfig;
  /** Overlay mode: single column, smaller item card. */
  compact?: boolean;
}

type Sort = "price" | "newest" | "match";
const isSort = (v: unknown): v is Sort => v === "price" || v === "newest" || v === "match";

export function PriceCheckSession({ item, league, config, compact }: PriceCheckSessionProps) {
  const { index, error: indexError } = useStatIndex(item.game);
  const { contact } = useTradeContact();
  const [stats, setStats] = useState<StatFilter[]>([]);
  const [unmatched, setUnmatched] = useState<{ id: string; text: string }[]>([]);
  const [opts, setOpts] = useState<SearchOptions>(() => defaultOptions(item));
  const [result, setResult] = useState<TradePriceCheck | null>(null);
  const [listings, setListings] = useState<TradeListing[]>([]);
  const [searchedAt, setSearchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [defaultSort] = useGameSetting<Sort>(item.game, "priceCheck.defaultSort", "price", isSort);
  const [sortOverride, setSort] = useState<Sort | null>(null);
  const sort = sortOverride ?? defaultSort;

  // New item → fresh filters.
  useEffect(() => {
    if (!index) return;
    const f = buildFilters(item, index);
    setStats(f.stats);
    setUnmatched(f.unmatched);
    setOpts(defaultOptions(item));
    setResult(null);
    setListings([]);
    setError(null);
  }, [item, index]);

  const inFlight = useRef(false);
  const search = useCallback(
    async (filters: StatFilter[], options: SearchOptions) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setLoading(true);
      setError(null);
      try {
        const r = await tradePriceCheck(item.game, league, buildQuery(item, filters, options), 10);
        setResult(r);
        setListings(r.listings);
        setSearchedAt(Date.now());
        setDirty(false);
      } catch (e) {
        setError(String(e));
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [item, league],
  );

  // Search once automatically per item (the user explicitly asked for a price check).
  // A ref (not state) guarantees exactly one search even if the effect re-runs
  // before a re-render (e.g. React StrictMode) — every search costs rate limit.
  const autoSearched = useRef<string | null>(null);
  useEffect(() => {
    if (!index || !contact || (stats.length === 0 && item.mods.length > 0)) return;
    if (autoSearched.current === item.raw) return;
    autoSearched.current = item.raw;
    void search(stats, opts);
  }, [index, contact, stats, opts, item, search]);

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

  const enabledKeys = useMemo(() => stats.filter((s) => s.enabled && s.source === "mod").map((s) => templateKey(s.label)), [stats]);
  const matchOf = useCallback(
    (l: TradeListing) => {
      if (enabledKeys.length === 0) return null;
      const keys = new Set(l.item.mods.map(templateKey));
      return enabledKeys.filter((k) => keys.has(k)).length / enabledKeys.length;
    },
    [enabledKeys],
  );

  const shown = useMemo(() => {
    const out = opts.onlineOnly ? listings.filter((l) => l.status !== "offline") : [...listings];
    const price = (l: TradeListing) => l.amountBase ?? Infinity;
    out.sort((a, b) =>
      sort === "price" ? price(a) - price(b) : sort === "newest" ? Date.parse(b.indexed ?? "") - Date.parse(a.indexed ?? "") : (matchOf(b) ?? 0) - (matchOf(a) ?? 0),
    );
    return out;
  }, [listings, sort, opts.onlineOnly, matchOf]);

  const estimate = useMemo(() => estimatePrice(listings), [listings]);

  const update = (key: string, patch: Partial<StatFilter>) => {
    setStats((s) => s.map((f) => (f.key === key ? { ...f, ...patch } : f)));
    setDirty(true);
  };

  if (contact === null) return <ContactGate />;

  return (
    <div className={cn("grid items-start gap-4", compact ? "grid-cols-1" : "grid-cols-[340px_1fr]")}>
      <div className="flex min-w-0 flex-col gap-4">
        {!compact && <ItemCard item={toDisplayItem(item)} />}
        <Panel
          title="Search filters"
          flush
          actions={<span className="text-xs text-fg-subtle">{stats.filter((s) => s.enabled).length} active</span>}
        >
          {indexError ? (
            <p className="px-4 py-3 text-xs text-danger">Trade stat data unavailable: {indexError}</p>
          ) : !index ? (
            <p className="flex items-center gap-2 px-4 py-3 text-xs text-fg-muted">
              <Spinner size={12} /> Loading Trade stat data…
            </p>
          ) : (
            <>
              {stats.length === 0 && <p className="px-4 py-3 text-xs text-fg-muted">Searching by {item.rarity === "Unique" ? "name" : "base type"} only.</p>}
              <ul className="max-h-[340px] divide-y divide-line overflow-y-auto">
                {stats.map((s) => (
                  <FilterRow key={s.key} filter={s} onChange={(p) => update(s.key, p)} />
                ))}
              </ul>
              {unmatched.length > 0 && (
                <div className="flex gap-2 border-t border-line bg-warning-soft px-4 py-2 text-xs text-warning">
                  <Icon name="warning" size={13} className="mt-px shrink-0" />
                  <span>
                    {unmatched.length} modifier{unmatched.length > 1 ? "s" : ""} not matched to a Trade stat and not searched: {unmatched.map((u) => u.text).join("; ")}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-4 py-3">
                <Switch label="Online only" checked={opts.onlineOnly} onChange={(v) => (setOpts((o) => ({ ...o, onlineOnly: v })), setDirty(true))} />
                {item.corrupted !== undefined && (
                  <Checkbox
                    checked={opts.matchCorrupted}
                    onChange={(v) => (setOpts((o) => ({ ...o, matchCorrupted: v })), setDirty(true))}
                    label={<span className="text-xs text-fg-muted">Match {item.corrupted ? "corrupted" : "uncorrupted"}</span>}
                  />
                )}
                <Button
                  size="sm"
                  variant={dirty ? "primary" : "secondary"}
                  icon="search"
                  className="ml-auto"
                  loading={loading}
                  onClick={() => search(stats, opts)}
                >
                  {result ? "Search again" : "Search"}
                </Button>
              </div>
            </>
          )}
        </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <Icon name="error" size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <EstimatePanel result={result} estimate={estimate} listingsCount={listings.length} config={config} searchedAt={searchedAt} loading={loading && !result} />
        <Panel
          title={result ? `Listings · ${shown.length} of ${result.total.toLocaleString("en-US")}` : "Listings"}
          flush
          actions={
            <>
              <SegmentedControl
                size="sm"
                label="Sort listings"
                value={sort}
                onChange={setSort}
                segments={[
                  { value: "price", label: "Lowest" },
                  { value: "newest", label: "Newest" },
                  { value: "match", label: "Best match" },
                ]}
              />
              {result && (
                <IconButton icon="external" size="sm" label="Open this search on the official Trade site" onClick={() => openUrl(result.tradeUrl).catch((e) => setError(String(e)))} />
              )}
            </>
          }
        >
          {!result && !loading && <p className="px-4 py-6 text-center text-sm text-fg-muted">No search yet.</p>}
          {loading && !result && (
            <p className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-fg-muted">
              <Spinner size={14} /> Searching official Trade…
            </p>
          )}
          {result && shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-fg-muted">No listings match. Try disabling some filters.</p>}
          <ul className="divide-y divide-line">
            {shown.map((l) => (
              <ListingRow key={l.id} listing={l} match={matchOf(l)} config={config} compact={compact} />
            ))}
          </ul>
          {result?.hasMore && (
            <div className="border-t border-line p-2 text-center">
              <Button size="sm" variant="ghost" loading={loading} onClick={loadMore}>
                Load 10 more
              </Button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function FilterRow({ filter: f, onChange }: { filter: StatFilter; onChange: (p: Partial<StatFilter>) => void }) {
  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return (
    <li className="flex items-center gap-2 px-3 py-1.5">
      <Checkbox
        className="flex-1"
        checked={f.enabled}
        onChange={(enabled) => onChange({ enabled })}
        label={
          <span className={cn("flex items-center gap-1.5 text-sm", f.enabled ? "text-fg" : "text-fg-muted")}>
            <span className="truncate" title={f.label}>
              {f.label}
            </span>
            {f.source === "pseudo" && <Badge tone="info">pseudo</Badge>}
            {f.kind !== "explicit" && f.source === "mod" && <span className="shrink-0 text-2xs text-fg-subtle">{f.kind}</span>}
            {f.tier != null && <span className="shrink-0 font-mono text-2xs text-fg-subtle">T{f.tier}</span>}
          </span>
        }
      />
      <Input
        size="sm"
        aria-label={`Minimum for ${f.label}`}
        placeholder="min"
        inputMode="decimal"
        value={f.min ?? ""}
        disabled={!f.enabled}
        onChange={(e) => onChange({ min: num(e.target.value) })}
        containerClassName="w-14 shrink-0"
        className="tabular text-right"
      />
      <Input
        size="sm"
        aria-label={`Maximum for ${f.label}`}
        placeholder="max"
        inputMode="decimal"
        value={f.max ?? ""}
        disabled={!f.enabled}
        onChange={(e) => onChange({ max: num(e.target.value) })}
        containerClassName="w-14 shrink-0"
        className="tabular text-right"
      />
    </li>
  );
}

const CONFIDENCE: Record<string, { tone: BadgeTone; label: string }> = {
  high: { tone: "success", label: "High confidence" },
  medium: { tone: "warning", label: "Medium confidence" },
  low: { tone: "danger", label: "Low confidence" },
};

function EstimatePanel({
  result,
  estimate,
  listingsCount,
  config,
  searchedAt,
  loading,
}: {
  result: TradePriceCheck | null;
  estimate: ReturnType<typeof estimatePrice>;
  listingsCount: number;
  config: GameConfig;
  searchedAt: number | null;
  loading: boolean;
}) {
  const dc = useDisplayCurrency();
  const money = useMoney();
  const conv = (v: number) => (dc ? dc.toUnit(v) : v);
  const unit = dc ? dc.unit.short : config.baseUnit.short;
  const conf = estimate ? CONFIDENCE[estimate.confidence]! : null;
  return (
    <div className="panel grid grid-cols-[1.4fr_1fr_1fr_1fr] divide-x divide-line rounded-lg">
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          Estimated value <Badge tone="accent">Estimate</Badge>
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          {loading ? (
            <Spinner size={18} className="text-fg-subtle" />
          ) : (
            <>
              <span className="tabular font-display text-2xl font-semibold text-fg">{estimate ? `~${formatAmount(conv(estimate.estimate))}` : "—"}</span>
              {estimate && <span className="text-sm text-fg-muted">{unit}</span>}
            </>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {conf && (
            <Badge tone={conf.tone} dot>
              {conf.label}
            </Badge>
          )}
          {result && !result.ratesAvailable && <span className="text-2xs text-warning">No poe.ninja rates — open Currency Tracker once to enable conversion</span>}
        </div>
      </div>
      <Metric label="Lowest comparable" value={estimate ? money(estimate.low, { unit: config.baseUnit }) : "—"} />
      <Metric label="Median comparable" value={estimate ? money(estimate.median, { unit: config.baseUnit }) : "—"} caption={estimate?.outliers ? `${estimate.outliers} suspiciously cheap ignored` : undefined} />
      <Metric
        label="Matching listings"
        value={result ? result.total.toLocaleString("en-US") : "—"}
        caption={searchedAt ? `${listingsCount} fetched · ${formatRelative(searchedAt)}` : undefined}
      />
    </div>
  );
}

function Metric({ label, value, caption }: { label: string; value: ReactNode; caption?: ReactNode }) {
  return (
    <div className="px-4 py-3.5">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="tabular mt-2 text-lg font-semibold text-fg">{value}</div>
      {caption && <div className="mt-0.5 text-2xs text-fg-subtle">{caption}</div>}
    </div>
  );
}

const STATUS: Record<TradeListing["status"], { tone: BadgeTone; label: string }> = {
  online: { tone: "success", label: "Online" },
  afk: { tone: "warning", label: "AFK" },
  offline: { tone: "neutral", label: "Offline" },
};

function ListingRow({ listing: l, match, config, compact }: { listing: TradeListing; match: number | null; config: GameConfig; compact?: boolean }) {
  const dc = useDisplayCurrency();
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const status = STATUS[l.status];
  const copy = () => {
    if (!l.whisper) return;
    navigator.clipboard
      .writeText(l.whisper)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <li>
      <div className={cn("grid items-center gap-3 px-4 py-2 text-sm", compact ? "grid-cols-[90px_1fr_auto]" : "grid-cols-[110px_minmax(0,1fr)_80px_90px_80px_60px_auto]")}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-left" aria-expanded={open} title="Show item modifiers">
          <span className="tabular font-semibold text-fg">{l.amount != null ? formatAmount(l.amount) : "—"}</span>{" "}
          <span className="text-xs text-fg-muted">{l.currency ?? ""}</span>
          {l.amountBase != null && l.currency !== (dc ? dc.unit.id : config.baseUnit.id) && (
            <span className="tabular block text-2xs text-fg-subtle">≈ {money(l.amountBase, { unit: config.baseUnit })}</span>
          )}
        </button>
        <div className="min-w-0">
          <div className="truncate text-fg" data-selectable>
            {l.account}
          </div>
          {l.character && <div className="truncate text-xs text-fg-subtle">{l.character}</div>}
        </div>
        {!compact && (
          <>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            <span className="text-xs text-fg-muted">{l.indexed ? formatRelative(Date.parse(l.indexed)) : "—"}</span>
            <span className="text-xs text-fg-muted">{l.priceSource === "item" ? "Item note" : l.priceSource === "stash" ? "Stash tab" : "—"}</span>
            <span className="tabular text-right text-xs text-fg-muted">{match != null ? `${Math.round(match * 100)}%` : "—"}</span>
          </>
        )}
        <div className="flex items-center gap-1">
          {compact && <span className={cn("size-2 rounded-full", l.status === "online" ? "bg-success" : l.status === "afk" ? "bg-warning" : "bg-fg-subtle")} title={status.label} />}
          <IconButton
            icon={copied ? "check" : "copy"}
            size="sm"
            label={l.whisper ? (copied ? "Whisper copied" : "Copy whisper") : "No whisper available"}
            disabled={!l.whisper}
            onClick={copy}
          />
        </div>
      </div>
      {open && (
        <div className="border-t border-line bg-bg-2 px-4 py-2 text-xs" data-selectable>
          <div className="mb-1 text-fg">
            {l.item.name} {l.item.typeLine}
            {l.item.ilvl != null && <span className="text-fg-subtle"> · iLvl {l.item.ilvl}</span>}
            {l.item.corrupted && <span className="text-mod-corrupted"> · Corrupted</span>}
          </div>
          <ul className="space-y-0.5 text-mod-explicit">
            {l.item.mods.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
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
