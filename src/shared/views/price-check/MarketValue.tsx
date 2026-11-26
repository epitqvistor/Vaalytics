import type { ReactNode } from "react";
import type { GameConfig } from "@/core/game-context/config";
import type { MarketItemRow } from "@/core/ipc/commands";
import { Button, ProvenanceTag, Spinner } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { usePriceFormat, type PriceParts } from "./money";

function Price({ p, big }: { p: PriceParts; big?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className={cn("tabular font-semibold text-fg", big ? "font-display text-2xl" : "text-sm")}>{p.amount}</span>
      {p.icon ? <img src={p.icon} alt={p.unit} title={p.unit} className={cn("self-center object-contain", big ? "size-5" : "size-4")} /> : <span className="text-xs text-fg-muted">{p.unit}</span>}
    </span>
  );
}

/**
 * Bulk-market price (poe.ninja via Market Data) for items that are not priced from Trade listings —
 * PoE 1 divination cards. No Trade request is made unless the user asks for one.
 */
export function MarketValue({
  row,
  fetchedAt,
  league,
  loading,
  error,
  stack,
  config,
  onSearchTrade,
}: {
  row: MarketItemRow | null;
  fetchedAt: number | null;
  league: string;
  loading: boolean;
  error: string | null;
  stack?: { current: number; max?: number };
  config: GameConfig;
  onSearchTrade: () => void;
}) {
  const { value } = usePriceFormat(config);
  const full = stack?.max && stack.max > 1 ? stack.max : null;
  const owned = stack && stack.current > 1 && stack.current !== full ? stack.current : null;

  return (
    <section aria-label="Market price" className="rounded-md border border-line bg-bg-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-fg-muted">Market price</span>
        <div className="flex min-h-8 items-center">
          {row ? <Price p={value(row.value)} big /> : loading ? <Spinner size={16} className="text-fg-subtle" /> : <span className="font-display text-2xl text-fg-subtle">—</span>}
        </div>
        {row && <span className="text-2xs text-fg-subtle">per card</span>}
        <ProvenanceTag provenance={{ kind: "market", source: "poe.ninja", at: fetchedAt, league }} className="ml-auto" />
      </div>

      {row && (
        <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {full && <Stat label={`Full set (${full})`} value={<Price p={value(row.value * full)} />} />}
          {owned && <Stat label={`Your stack (${owned})`} value={<Price p={value(row.value * owned)} />} />}
          {row.change7d != null && (
            <Stat
              label="7 days"
              value={
                <span className={cn("tabular text-sm", row.change7d > 0 ? "text-success" : row.change7d < 0 ? "text-danger" : "text-fg")}>
                  {`${row.change7d > 0 ? "+" : ""}${(row.change7d * 100).toFixed(1)}%`}
                </span>
              }
            />
          )}
          {row.listings != null && <Stat label="Listed" value={<span className="tabular text-sm text-fg">{row.listings.toLocaleString("en-US")}</span>} />}
        </dl>
      )}

      {!row && !loading && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-fg-muted">
          <Icon name="info" size={12} className="mt-0.5 shrink-0" />
          {error ? `poe.ninja is unavailable: ${error}` : "poe.ninja has no price for this card in this league."}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
        <p className="min-w-0 flex-1 text-2xs text-fg-subtle">Cards are rarely listed one by one on Trade, so the bulk market price is used instead of listings.</p>
        <Button size="sm" variant="secondary" icon="search" onClick={onSearchTrade}>
          Search Trade
        </Button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-fg-subtle">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
