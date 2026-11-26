import { useState, type ReactNode } from "react";
import type { GameConfig } from "@/core/game-context/config";
import { Badge, ProvenanceTag, Spinner, type BadgeTone } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { Confidence, Valuation } from "@/shared/trade/valuation";
import { cn } from "@/shared/utilities/cn";
import { formatRelative } from "@/shared/utilities/format";
import { usePriceFormat, type PriceParts } from "./money";

export type ResultState = "idle" | "live" | "cached" | "refreshing" | "failed";

const CONFIDENCE: Record<Confidence, { tone: BadgeTone; label: string }> = {
  high: { tone: "success", label: "High confidence" },
  medium: { tone: "warning", label: "Medium confidence" },
  low: { tone: "danger", label: "Low confidence" },
  insufficient: { tone: "neutral", label: "Insufficient data" },
  "base-only": { tone: "warning", label: "Base type only" },
  unpriced: { tone: "neutral", label: "Unpriced" },
};

const STATE: Record<Exclude<ResultState, "idle">, { label: string; tone: string }> = {
  live: { label: "Live", tone: "text-success" },
  cached: { label: "Cached", tone: "text-fg-muted" },
  refreshing: { label: "Refreshing", tone: "text-info" },
  failed: { label: "Request failed", tone: "text-danger" },
};

function Price({ p, big }: { p: PriceParts; big?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className={cn("tabular font-semibold text-fg", big ? "font-display text-2xl" : "text-sm")}>{p.amount}</span>
      {p.icon ? <img src={p.icon} alt={p.unit} title={p.unit} className={cn("self-center object-contain", big ? "size-5" : "size-4")} /> : <span className="text-xs text-fg-muted">{p.unit}</span>}
    </span>
  );
}

/**
 * Compact two-row summary: the estimate (dominant) with its confidence, then lowest, typical range,
 * matching and excluded counts. Base-type-only and insufficient results say so instead of pretending.
 */
export function ValueSummary({
  valuation,
  config,
  state,
  searchedAt,
  loading,
  ratesAvailable,
  market,
}: {
  valuation: Valuation | null;
  config: GameConfig;
  state: ResultState;
  searchedAt: number | null;
  loading: boolean;
  ratesAvailable: boolean;
  /** Bulk market rate (poe.ninja) for currency — a separate reference, not part of the estimate. */
  market?: { value: number; at: number | null; league: string; isPremium: boolean } | null;
}) {
  const { value } = usePriceFormat(config);
  const [why, setWhy] = useState(false);
  const v = valuation;
  const conf = v ? CONFIDENCE[v.confidence] : null;
  const excluded = v ? v.lowOutliers + v.highOutliers : 0;

  return (
    <section aria-label="Price summary" className="rounded-md border border-line bg-bg-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-fg-muted">Estimate</span>
        <div className="flex min-h-8 items-center">
          {loading && !v ? (
            <Spinner size={16} className="text-fg-subtle" />
          ) : v?.estimate != null ? (
            <span className={cn(v.confidence === "base-only" && "opacity-70")}>
              <span className="mr-0.5 text-fg-subtle">~</span>
              <Price p={value(v.estimate)} big />
            </span>
          ) : (
            <span className="font-display text-2xl text-fg-subtle">—</span>
          )}
        </div>
        {conf && (
          <button type="button" onClick={() => setWhy((w) => !w)} aria-expanded={why} title="Why this confidence?">
            <Badge tone={conf.tone} dot>
              {conf.label}
            </Badge>
          </button>
        )}
        {state !== "idle" && (
          <span className={cn("ml-auto text-2xs", STATE[state].tone)}>
            {STATE[state].label}
            {searchedAt && state !== "refreshing" && state !== "failed" ? ` · ${formatRelative(searchedAt)}` : ""}
          </span>
        )}
      </div>

      {v && (v.confidence === "base-only" || v.confidence === "insufficient" || v.confidence === "unpriced") && (
        <p className={cn("mt-1 flex items-start gap-1.5 text-xs", v.confidence === "base-only" ? "text-warning" : "text-fg-muted")}>
          <Icon name={v.confidence === "base-only" ? "warning" : "info"} size={12} className="mt-0.5 shrink-0" />
          {v.confidence === "base-only"
            ? "Base type only — the estimate may not reflect this item's modifiers."
            : v.confidence === "insufficient"
              ? "Insufficient comparable listings — no estimate."
              : v.total === 0
                ? "No listings match this search."
                : "No usable prices among the fetched listings."}
        </p>
      )}

      {v && v.used > 0 && (
        <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Stat label="Lowest" value={v.lowest != null ? <Price p={value(v.lowest)} /> : "—"} />
          <Stat label="Median" value={v.median != null ? <Price p={value(v.median)} /> : "—"} />
          {v.used >= 4 && v.p25 != null && v.p75 != null && value(v.p25).amount !== value(v.p75).amount && (
            <Stat label="Typical" value={<span className="tabular text-sm text-fg">{`${value(v.p25).amount}–${value(v.p75).amount} ${value(v.p75).unit}`}</span>} />
          )}
          <Stat label="Matching" value={<span className="tabular text-sm text-fg">{v.total.toLocaleString("en-US")}</span>} />
          {(excluded > 0 || v.noPrice > 0) && (
            <Stat label="Excluded" value={<span className="tabular text-sm text-fg-muted">{excluded + v.noPrice}</span>} />
          )}
        </dl>
      )}

      {market && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-1.5 text-xs">
          <span className="text-fg-subtle">Market rate</span>
          {/* The premium currency itself (Divine Orb) is shown in the base unit — "1 div" says nothing. */}
          <Price p={value(market.value, { baseUnit: market.isPremium })} />
          <span className="text-2xs text-fg-subtle">bulk exchange, per unit</span>
          <ProvenanceTag provenance={{ kind: "market", source: "poe.ninja", at: market.at, league: market.league }} className="ml-auto" />
        </div>
      )}

      {why && v && (
        <ul className="mt-2 flex flex-col gap-0.5 border-t border-line pt-1.5 text-2xs text-fg-muted">
          {v.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          <li>
            Based on the {v.fetched} cheapest of {v.total.toLocaleString("en-US")} matching listings: {v.used} used
            {v.lowOutliers ? `, ${v.lowOutliers} suspiciously cheap` : ""}
            {v.highOutliers ? `, ${v.highOutliers} unusually expensive` : ""}
            {v.noPrice ? `, ${v.noPrice} without a convertible price` : ""}.
          </li>
          <li>Estimate = median of the comparable listings, weighted by how well each matches the searched modifiers.</li>
        </ul>
      )}
      {!ratesAvailable && v && <p className="mt-1 text-2xs text-warning">No poe.ninja currency rates for this league — prices in other currencies can't be converted.</p>}
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
