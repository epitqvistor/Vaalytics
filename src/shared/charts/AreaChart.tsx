import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { areaPath, linePath, nearestIndex, niceTicks, paddedExtent, toPoints } from "./scale";

export interface AreaChartProps {
  values: readonly number[];
  /** Label for each point (e.g. dates), same length as values. */
  labels: readonly string[];
  formatValue: (v: number) => string;
  /** Axis tick format; defaults to formatValue. Use a compact form for large values. */
  formatTick?: (v: number) => string;
  height?: number;
  /** Accessible summary, e.g. "Divine Orb price, last 14 days". */
  title: string;
}

const PAD = { top: 12, right: 12, bottom: 22 };
/** Approximate glyph width of the 11px tick labels, used to size the left gutter. */
const TICK_CHAR_PX = 6.4;

/**
 * Single-series area chart with crosshair + tooltip on hover and keyboard focus
 * (←/→). Pure SVG, sized to its container via ResizeObserver; no animation loop.
 */
export function AreaChart({ values, labels, formatValue, formatTick = formatValue, height = 220, title }: AreaChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const gradId = useId();

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const extent = useMemo(() => paddedExtent(values, 0.12), [values]);
  const ticks = useMemo(() => niceTicks(extent, 4), [extent]);
  const tickLabels = useMemo(() => ticks.map(formatTick), [ticks, formatTick]);
  const left = Math.ceil(Math.max(28, ...tickLabels.map((t) => t.length * TICK_CHAR_PX)) + 10);
  const innerW = Math.max(0, width - left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const points = useMemo(() => toPoints(values, innerW, innerH, extent), [values, innerW, innerH, extent]);
  const span = extent.max - extent.min || 1;

  const onMove = useCallback(
    (e: PointerEvent<SVGRectElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setActive(nearestIndex(e.clientX - rect.left, innerW, values.length));
    },
    [innerW, values.length],
  );

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const cur = active ?? values.length - 1;
    setActive(Math.max(0, Math.min(values.length - 1, cur + (e.key === "ArrowRight" ? 1 : -1))));
  };

  const pt = active != null ? points[active] : undefined;
  const xLabelIdx = values.length > 1 ? [0, Math.floor((values.length - 1) / 2), values.length - 1] : [0];

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. Latest ${formatValue(values[values.length - 1] ?? 0)}. Use left and right arrow keys to inspect values.`}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setActive((a) => a ?? values.length - 1)}
          onBlur={() => setActive(null)}
          className="block rounded-md focus-visible:outline-offset-4"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g transform={`translate(${left},${PAD.top})`}>
            {ticks.map((t, ti) => {
              const y = innerH - ((t - extent.min) / span) * innerH;
              return (
                <g key={t}>
                  <line x1={0} x2={innerW} y1={y} y2={y} stroke="var(--color-line)" />
                  <text x={-8} y={y} dy="0.32em" textAnchor="end" className="fill-fg-subtle text-2xs tabular">
                    {tickLabels[ti]}
                  </text>
                </g>
              );
            })}
            {xLabelIdx.map((i, k) => (
              <text
                key={i}
                x={points[i]?.[0] ?? 0}
                y={innerH + 16}
                textAnchor={k === 0 ? "start" : k === xLabelIdx.length - 1 ? "end" : "middle"}
                className="fill-fg-subtle text-2xs"
              >
                {labels[i]}
              </text>
            ))}
            <path d={areaPath(points, innerH)} fill={`url(#${gradId})`} />
            <path d={linePath(points)} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {pt && (
              <g pointerEvents="none">
                <line x1={pt[0]} x2={pt[0]} y1={0} y2={innerH} stroke="var(--color-line-strong)" />
                <circle cx={pt[0]} cy={pt[1]} r={4.5} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={2} />
              </g>
            )}
            <rect
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setActive(null)}
            />
          </g>
        </svg>
      )}
      {pt && active != null && (
        <div
          className="glass-float pointer-events-none absolute top-1 rounded-md px-2.5 py-1.5"
          style={{
            left: Math.min(Math.max(left + pt[0] - 60, 0), width - 120),
            width: 120,
          }}
        >
          <div className="tabular text-sm font-semibold text-fg">{formatValue(values[active]!)}</div>
          <div className="text-2xs text-fg-muted">{labels[active]}</div>
        </div>
      )}
    </div>
  );
}
