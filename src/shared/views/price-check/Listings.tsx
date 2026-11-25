import { useMemo, useState } from "react";
import type { GameConfig } from "@/core/game-context/config";
import type { TradeListing } from "@/core/ipc/commands";
import { Button, IconButton, SegmentedControl, Spinner } from "@/shared/components";
import type { Verdict } from "@/shared/trade/valuation";
import { cn } from "@/shared/utilities/cn";
import { formatRelative } from "@/shared/utilities/format";
import { usePriceFormat } from "./money";

export type ListingSort = "price" | "price-desc" | "newest" | "match";
export const isListingSort = (v: unknown): v is ListingSort => v === "price" || v === "price-desc" || v === "newest" || v === "match";

const SORTS: { value: ListingSort; label: string }[] = [
  { value: "price", label: "Lowest" },
  { value: "price-desc", label: "Highest" },
  { value: "newest", label: "Newest" },
  { value: "match", label: "Best match" },
];

const VERDICT: Record<Exclude<Verdict, "used">, { label: string; title: string }> = {
  "low-outlier": { label: "cheap", title: "Far below the other comparable prices — likely bait or a mistake; not used in the estimate." },
  "high-outlier": { label: "pricey", title: "Far above the other comparable prices — not used in the estimate." },
  "no-price": { label: "no price", title: "Currency could not be converted — not used in the estimate." },
};

interface Props {
  listings: TradeListing[];
  total: number | null;
  verdicts: ReadonlyMap<string, Verdict> | null;
  matchOf: (l: TradeListing) => number | null;
  sort: ListingSort;
  onSort: (s: ListingSort) => void;
  config: GameConfig;
  loading: boolean;
  hasMore: boolean;
  onMore: () => void;
  onOpenTrade: (() => void) | null;
  /** Hide offline sellers (unless instant buyout) — listings age while the window is open. */
  hideOffline: boolean;
}

export function Listings(p: Props) {
  const shown = useMemo(() => {
    const out = p.hideOffline ? p.listings.filter((l) => l.status !== "offline" || l.instantBuyout) : [...p.listings];
    const price = (l: TradeListing) => l.amountBase ?? Infinity;
    const age = (l: TradeListing) => Date.parse(l.indexed ?? "") || 0;
    out.sort((a, b) =>
      p.sort === "price"
        ? price(a) - price(b)
        : p.sort === "price-desc"
          ? (b.amountBase ?? -1) - (a.amountBase ?? -1)
          : p.sort === "newest"
            ? age(b) - age(a)
            : (p.matchOf(b) ?? 0) - (p.matchOf(a) ?? 0) || price(a) - price(b),
    );
    return out;
  }, [p.listings, p.sort, p.hideOffline, p.matchOf]);

  return (
    <section aria-label="Listings" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-fg">Listings</span>
        {p.total != null && (
          <span className="tabular text-2xs text-fg-subtle">
            {shown.length} of {p.total.toLocaleString("en-US")}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <SegmentedControl size="sm" label="Sort listings" value={p.sort} onChange={p.onSort} segments={SORTS} />
          {p.onOpenTrade && <IconButton icon="external" size="sm" label="Open this search on the Trade site" onClick={p.onOpenTrade} />}
        </div>
      </div>

      <div className="rounded-md border border-line bg-bg-2">
        {p.loading && p.listings.length === 0 && (
          <p className="flex items-center justify-center gap-2 px-3 py-5 text-xs text-fg-muted">
            <Spinner size={12} /> Searching official Trade…
          </p>
        )}
        {!p.loading && p.total === 0 && <p className="px-3 py-5 text-center text-xs text-fg-muted">No listings match. Widen the ranges or disable a filter.</p>}
        {!p.loading && p.total == null && <p className="px-3 py-5 text-center text-xs text-fg-muted">No search yet.</p>}
        <ul className="divide-y divide-line">
          {shown.map((l) => (
            <ListingRow key={l.id} listing={l} verdict={p.verdicts?.get(l.id) ?? null} match={p.matchOf(l)} config={p.config} />
          ))}
        </ul>
        {p.hasMore && (
          <div className="border-t border-line p-1.5 text-center">
            <Button size="sm" variant="ghost" loading={p.loading} onClick={p.onMore}>
              Load 10 more
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

const STATUS_DOT: Record<string, { cls: string; label: string }> = {
  instant: { cls: "bg-info", label: "Instant buyout" },
  online: { cls: "bg-success", label: "Online" },
  afk: { cls: "bg-warning", label: "AFK" },
  offline: { cls: "bg-fg-subtle", label: "Offline" },
};

function ListingRow({ listing: l, verdict, match, config }: { listing: TradeListing; verdict: Verdict | null; match: number | null; config: GameConfig }) {
  const { listed, value } = usePriceFormat(config);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"whisper" | "price" | null>(null);
  const status = STATUS_DOT[l.instantBuyout ? "instant" : l.status]!;
  const excluded = verdict != null && verdict !== "used";
  const price = l.amount != null ? listed(l.amount, l.currency) : null;
  const copy = (what: "whisper" | "price", text: string | null) => {
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(what);
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => {});
  };
  const priceText = price ? `${price.amount} ${l.currency ?? ""}`.trim() : null;

  return (
    <li className={cn(excluded && "opacity-55")}>
      <div className="grid grid-cols-[minmax(84px,auto)_minmax(0,1fr)_auto] items-center gap-2.5 px-2.5 py-1.5 text-xs">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-left" aria-expanded={open} title="Show the listed item">
          {price ? (
            <span className="inline-flex items-center gap-1">
              <span className="tabular text-sm font-semibold text-fg">{price.amount}</span>
              {price.icon ? <img src={price.icon} alt={price.unit} title={price.unit} className="size-4 object-contain" /> : <span className="text-fg-muted">{price.unit}</span>}
            </span>
          ) : (
            <span className="text-fg-subtle">—</span>
          )}
          {l.amountBase != null && l.currency !== "chaos" && l.currency !== "exalted" && (
            <span className="tabular block text-2xs text-fg-subtle">
              ≈ {value(l.amountBase).amount} {value(l.amountBase).unit}
            </span>
          )}
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("size-1.5 shrink-0 rounded-full", status.cls)} title={status.label} aria-label={status.label} />
            <span className="truncate text-fg" data-selectable title={l.character ?? undefined}>
              {l.account}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-2xs text-fg-subtle">
            <span>{l.instantBuyout ? "Instant buyout" : status.label}</span>
            {l.indexed && <span>· {formatRelative(Date.parse(l.indexed))}</span>}
            {match != null && <span className="tabular">· {Math.round(match * 100)}% match</span>}
            {excluded && (
              <span className="rounded-sm bg-elevated px-1 text-fg-muted" title={VERDICT[verdict].title}>
                {VERDICT[verdict].label}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center">
          <IconButton icon={copied === "price" ? "check" : "currency"} size="sm" label={copied === "price" ? "Price copied" : "Copy price"} disabled={!priceText} onClick={() => copy("price", priceText)} />
          <IconButton
            icon={copied === "whisper" ? "check" : "copy"}
            size="sm"
            label={l.whisper ? (copied === "whisper" ? "Whisper copied" : "Copy whisper") : "No whisper available"}
            disabled={!l.whisper}
            onClick={() => copy("whisper", l.whisper)}
          />
        </div>
      </div>
      {open && (
        <div className="border-t border-line bg-bg px-2.5 py-1.5 text-2xs" data-selectable>
          <div className="mb-0.5 text-fg">
            {l.item.name} {l.item.typeLine}
            {l.item.ilvl != null && <span className="text-fg-subtle"> · iLvl {l.item.ilvl}</span>}
            {l.item.corrupted && <span className="text-mod-corrupted"> · Corrupted</span>}
            <span className="text-fg-subtle"> · {l.priceSource === "item" ? "priced by item note" : l.priceSource === "stash" ? "priced by stash tab" : "price source unknown"}</span>
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
