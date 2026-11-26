import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { niceTicks } from "./scale";

export interface BarChartProps {
  values: readonly number[];
  /** Label for each bar (e.g. dates), same length as values. */
  labels: readonly string[];
  formatValue: (v: number) => string;
  formatTick?: (v: number) => string;
  height?: number;
  /** Accessible summary, e.g. "Hours played per day, last 14 days". */
  title: string;
}

const PAD = { top: 12, right: 8, bottom: 22 };
const TICK_CHAR_PX = 6.4;
const RADIUS = 1;

/** Path for a bar with rounded top corners anchored to the baseline. */
export function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0 || w <= 0) return "";
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Single-series bar chart on a zero baseline (magnitudes: time played, counts).
 * Thin bars with a 2px gap, recessive grid, per-bar tooltip on hover and on
 * keyboard focus (←/→). Pure SVG, no animation loop.
 */
export function BarChart({ values, labels, formatValue, formatTick = formatValue, height = 200, title }: BarChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const max = Math.max(0, ...values);
  const ticks = useMemo(() => niceTicks({ min: 0, max: max > 0 ? max : 1 }, 4).filter((t) => t >= 0), [max]);
  const top = Math.max(ticks[ticks.length - 1] ?? 1, max, 1e-9);
  const tickLabels = ticks.map(formatTick);
  const left = Math.ceil(Math.max(24, ...tickLabels.map((t) => t.length * TICK_CHAR_PX)) + 10);
  const innerW = Math.max(0, width - left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const n = values.length;
  const slot = n > 0 ? innerW / n : 0;
  const gap = 2;
  const barW = Math.max(1, Math.min(28, slot - gap));
  const xOf = (i: number) => i * slot + (slot - barW) / 2;
  const hOf = (v: number) => (Math.max(0, v) / top) * innerH;

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const cur = active ?? n - 1;
    setActive(Math.max(0, Math.min(n - 1, cur + (e.key === "ArrowRight" ? 1 : -1))));
  };
  const labelIdx = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height }}>
      {width > 0 && n > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. Use left and right arrow keys to inspect values.`}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          className="block rounded-md focus-visible:outline-offset-4"
        >
          <g transform={`translate(${left},${PAD.top})`}>
            {ticks.map((t, ti) => {
              const y = innerH - (t / top) * innerH;
              return (
                <g key={t}>
                  <line x1={0} x2={innerW} y1={y} y2={y} stroke="var(--color-line)" strokeDasharray={t === 0 ? undefined : "2 3"} />
                  <text x={-8} y={y} dy="0.32em" textAnchor="end" className="fill-fg-subtle text-2xs tabular">
                    {tickLabels[ti]}
                  </text>
                </g>
              );
            })}
            {labelIdx.map((i, k) => (
              <text
                key={i}
                x={xOf(i) + barW / 2}
                y={innerH + 16}
                textAnchor={k === 0 && n > 1 ? "start" : k === labelIdx.length - 1 && n > 1 ? "end" : "middle"}
                className="fill-fg-subtle text-2xs"
              >
                {labels[i]}
              </text>
            ))}
            {values.map((v, i) => (
              <path
                key={i}
                d={barPath(xOf(i), innerH - hOf(v), barW, hOf(v))}
                fill="var(--color-accent)"
                opacity={active === null || active === i ? 0.85 : 0.4}
              />
            ))}
            {/* Hit targets: the whole slot, taller than the bar. */}
            {values.map((_, i) => (
              <rect key={`h${i}`} x={i * slot} y={0} width={slot} height={innerH} fill="transparent" onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} />
            ))}
          </g>
        </svg>
      )}
      {active != null && n > 0 && (
        <div
          className="glass-float pointer-events-none absolute top-1 rounded-md px-2.5 py-1.5"
          style={{ left: Math.min(Math.max(left + xOf(active) + barW / 2 - 60, 0), Math.max(0, width - 120)), width: 120 }}
        >
          <div className="tabular text-sm font-semibold text-fg">{formatValue(values[active]!)}</div>
          <div className="text-2xs text-fg-muted">{labels[active]}</div>
        </div>
      )}
    </div>
  );
}
