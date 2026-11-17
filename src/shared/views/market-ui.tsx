import { memo, useCallback, useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from "react";
import type { MarketSnapshot } from "@/core/ipc/commands";
import { useDisplayCurrency } from "@/core/market/DisplayCurrency";
import { useLeague } from "@/core/market/LeagueContext";
import { useNow } from "@/core/market/hooks";
import { Badge, IconButton, Select, Spinner } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { formatRelative } from "@/shared/utilities/format";
import { ItemGlyph } from "./common";

/** Item icon from the official PoE CDN, with the neutral glyph as fallback. */
export const ItemIcon = memo(function ItemIcon({ src, name, size = 28 }: { src: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <ItemGlyph name={name} size={size} />;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  );
});

export function LeagueSelect({ className, compact }: { className?: string; compact?: boolean }) {
  const { leagues, league, setLeague } = useLeague();
  const width = compact ? "w-36" : "w-48";
  if (!league) return <div className={cn(compact ? "h-7" : "h-8.5", width, "rounded-md border border-line bg-elevated", className)} aria-hidden />;
  return (
    <Select
      label="League"
      hideLabel
      value={league}
      onChange={setLeague}
      options={(leagues.length ? leagues : [{ name: league, displayName: league }]).map((l) => ({ value: l.name, label: l.displayName }))}
      size={compact ? "sm" : "md"}
      className={cn(width, className)}
    />
  );
}

/**
 * "Show prices in": the display currency for every price in this game
 * (chaos/exalted, divine, or any currency with a poe.ninja rate).
 */
export function DisplayCurrencySelect({ className, compact }: { className?: string; compact?: boolean }) {
  const d = useDisplayCurrency();
  if (!d) return null;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs whitespace-nowrap text-fg-subtle">Prices in</span>
      <Select
        label="Show prices in"
        hideLabel
        value={d.options.some((o) => o.id === d.selectedId) ? d.selectedId : d.unit.id}
        onChange={d.setUnit}
        options={d.options.map((o) => ({ value: o.id, label: o.id === d.base.id ? `${o.name} (base)` : o.name }))}
        size={compact ? "sm" : "md"}
        className={compact ? "w-36" : "w-44"}
      />
    </div>
  );
}

/**
 * Data provenance + freshness. Always visible on live-data screens so users know
 * where numbers come from and how old they are. Errors keep cached data visible.
 */
export function FreshnessBar({ snapshot, onRefresh, extra }: { snapshot: MarketSnapshot | null; onRefresh?: () => void; extra?: ReactNode }) {
  const now = useNow(30_000);
  if (!snapshot) return null;
  const { fetchedAt, expiresAt, refreshing, lastError } = snapshot;
  const expired = expiresAt == null || expiresAt * 1000 <= now;
  const nextMin = expiresAt ? Math.max(1, Math.round((expiresAt * 1000 - now) / 60_000)) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs text-fg-muted">
        <Badge tone="success" dot>
          Live · poe.ninja
        </Badge>
        {refreshing ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner size={12} /> Updating…
          </span>
        ) : fetchedAt ? (
          <span>
            Updated {formatRelative(fetchedAt * 1000, now)}
            {!expired && nextMin != null && <span className="text-fg-subtle"> · next check in ~{nextMin} min</span>}
          </span>
        ) : (
          <span>Not loaded yet</span>
        )}
        {extra}
        {onRefresh && (
          <IconButton
            icon="refresh"
            size="sm"
            label={expired ? "Check for new data" : "Up to date — poe.ninja refreshes this data about every 30 minutes"}
            disabled={!expired || refreshing}
            onClick={onRefresh}
            className="ml-auto"
          />
        )}
      </div>
      {lastError && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-warning">
          <Icon name="warning" size={14} />
          <span className="flex-1">
            {lastError} {fetchedAt ? "Showing the last saved data." : ""}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Fixed-row-height virtual list. Renders only visible rows (+ overscan), so
 * categories with ~900 uniques stay cheap. No dependency needed for this case.
 */
export function VirtualRows<T>({
  rows,
  rowHeight,
  renderRow,
  getKey,
  header,
  className,
  overscan = 8,
}: {
  rows: readonly T[];
  rowHeight: number;
  renderRow: (row: T, index: number) => ReactNode;
  getKey: (row: T) => string;
  header?: ReactNode;
  className?: string;
  overscan?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setHeight(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reset scroll when the data set changes identity (new category/filter).
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScrollTop(0);
  }, [rows]);

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop), []);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);

  return (
    <div ref={ref} onScroll={onScroll} className={cn("relative overflow-y-auto", className)}>
      {header && <div className="sticky top-0 z-10">{header}</div>}
      <div role="rowgroup" style={{ height: rows.length * rowHeight, position: "relative" }}>
        {rows.slice(start, end).map((row, i) => (
          <div key={getKey(row)} style={{ position: "absolute", top: (start + i) * rowHeight, left: 0, right: 0, height: rowHeight }}>
            {renderRow(row, start + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
