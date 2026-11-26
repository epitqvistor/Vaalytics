/**
 * Deck Intelligence charts: pure SVG on the design tokens, sized by ResizeObserver, no chart library
 * and no animation loop. Bars grow once per data set (transform/opacity only; MotionConfig honours
 * reduced motion and the module's "chart animation" setting). Tooltips are Vaalytics-styled HTML.
 */
import { motion } from "motion/react";
import { type KeyboardEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { niceTicks } from "@/shared/charts/scale";
import { cn } from "@/shared/utilities/cn";

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export type Tone = "accent" | "success" | "danger" | "muted" | "info";
const FILL: Record<Tone, string> = {
  accent: "var(--color-accent)",
  success: "var(--color-success)",
  danger: "var(--color-danger)",
  muted: "var(--color-fg-subtle)",
  info: "var(--color-info)",
};

export interface Column {
  key: string;
  /** Axis label (short). */
  label: string;
  value: number;
  tone?: Tone;
  tooltip: ReactNode;
}

const PAD = { top: 14, right: 10, bottom: 24 };
const CHAR = 6.4;

/**
 * Columns on a zero baseline; negative values hang below it. Optional line overlay (e.g. a
 * cumulative total) drawn on the same scale. Hover, focus + ←/→, and click (`onSelect`).
 */
export function ColumnChart({
  columns,
  line,
  formatTick,
  height = 240,
  title,
  onSelect,
  animate = true,
}: {
  columns: readonly Column[];
  /** Values per column for the overlay line (same length), or undefined. */
  line?: readonly number[];
  formatTick: (v: number) => string;
  height?: number;
  title: string;
  onSelect?: (key: string) => void;
  animate?: boolean;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const values = columns.map((c) => c.value);
  const all = [...values, ...(line ?? []), 0];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  const extent = { min: lo < 0 ? lo - pad : 0, max: hi > 0 ? hi + pad : 0 + (lo < 0 ? 0 : 1) };
  const ticks = useMemo(() => niceTicks(extent, 4), [extent.min, extent.max]);
  const tMin = Math.min(extent.min, ...ticks);
  const tMax = Math.max(extent.max, ...ticks);
  const labels = ticks.map(formatTick);
  const left = Math.ceil(Math.max(28, ...labels.map((t) => t.length * CHAR)) + 10);
  const innerW = Math.max(0, width - left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const span = tMax - tMin || 1;
  const y = (v: number) => innerH - ((v - tMin) / span) * innerH;
  const n = columns.length;
  const slot = n > 0 ? innerW / n : 0;
  const barW = Math.max(2, Math.min(34, slot * 0.62));
  const x = (i: number) => i * slot + slot / 2;
  const zero = y(0);
  const labelEvery = Math.max(1, Math.ceil((n * 70) / Math.max(1, innerW)));

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "Enter" && active !== null && onSelect) return onSelect(columns[active]!.key);
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const cur = active ?? n - 1;
    setActive(Math.max(0, Math.min(n - 1, cur + (e.key === "ArrowRight" ? 1 : -1))));
  };
  const linePath = line && line.length === n ? line.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("") : null;
  const dataKey = values.join(",");

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && n > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. ${n} entries. Use left and right arrow keys to inspect, Enter to open.`}
          tabIndex={0}
          onKeyDown={onKey}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          className="block rounded-md focus-visible:outline-offset-4"
        >
          <g transform={`translate(${left},${PAD.top})`}>
            {ticks.map((t, i) => (
              <g key={t}>
                <line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
                <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-subtle text-2xs tabular">
                  {labels[i]}
                </text>
              </g>
            ))}
            {columns.map((c, i) =>
              i % labelEvery === 0 ? (
                <text key={c.key} x={x(i)} y={innerH + 16} textAnchor="middle" className="fill-fg-subtle text-2xs">
                  {c.label}
                </text>
              ) : null,
            )}
            {columns.map((c, i) => {
              const top = Math.min(y(c.value), zero);
              const h = Math.max(1, Math.abs(y(c.value) - zero));
              return (
                <motion.rect
                  key={`${dataKey}:${c.key}`}
                  x={x(i) - barW / 2}
                  y={top}
                  width={barW}
                  height={h}
                  rx={Math.min(3, barW / 3)}
                  fill={FILL[c.tone ?? "accent"]}
                  opacity={active === null || active === i ? 0.92 : 0.45}
                  style={{ transformOrigin: `${x(i)}px ${zero}px` }}
                  initial={animate ? { scaleY: 0 } : false}
                  animate={{ scaleY: 1, transition: { duration: 0.22, delay: Math.min(i * 0.012, 0.18), ease: [0.22, 1, 0.36, 1] } }}
                />
              );
            })}
            <line x1={0} x2={innerW} y1={zero} y2={zero} stroke="var(--color-line-strong)" strokeWidth={1} />
            {linePath && (
              <motion.path
                key={`l${dataKey}`}
                d={linePath}
                fill="none"
                stroke="var(--color-accent-2)"
                strokeWidth={1.75}
                strokeLinejoin="round"
                initial={animate ? { opacity: 0 } : false}
                animate={{ opacity: 1, transition: { duration: 0.25, delay: 0.15 } }}
              />
            )}
            {linePath && active !== null && line && <circle cx={x(active)} cy={y(line[active]!)} r={4} fill="var(--color-accent-2)" stroke="var(--color-surface)" strokeWidth={2} />}
            {columns.map((c, i) => (
              <rect
                key={`hit${c.key}`}
                x={i * slot}
                y={0}
                width={slot}
                height={innerH}
                fill="transparent"
                className={onSelect ? "cursor-pointer" : undefined}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onClick={() => onSelect?.(c.key)}
              />
            ))}
          </g>
        </svg>
      )}
      {active !== null && columns[active] && width > 0 && (
        <div
          className="glass-float pointer-events-none absolute z-10 rounded-md px-3 py-2 text-xs"
          style={{ left: Math.min(Math.max(left + x(active) - 110, 0), Math.max(0, width - 220)), top: 4, width: 220 }}
        >
          {columns[active].tooltip}
        </div>
      )}
    </div>
  );
}

/** Label/value rows for chart tooltips. */
export function TipRows({ title, rows }: { title: ReactNode; rows: [string, ReactNode][] }) {
  return (
    <div>
      <div className="mb-1 truncate font-medium text-fg">{title}</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-subtle">{k}</dt>
            <dd className="tabular text-right text-fg-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Horizontal ranked bars (HTML): label, bar proportional to value, value text. */
export function RankedBars<T>({
  rows,
  value,
  render,
  getKey,
  onSelect,
}: {
  rows: readonly T[];
  value: (r: T) => number;
  render: (r: T) => { left: ReactNode; right: ReactNode };
  getKey: (r: T) => string;
  onSelect?: (r: T) => void;
}) {
  const max = Math.max(0, ...rows.map(value)) || 1;
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => {
        const { left, right } = render(r);
        return (
          <li key={getKey(r)}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(r)}
              className={cn("group relative flex w-full items-center gap-3 overflow-hidden rounded-md px-2.5 py-1.5 text-left text-sm", onSelect && "hover:bg-elevated")}
            >
              <span aria-hidden className="absolute inset-y-1 left-0 rounded-r-sm bg-accent-soft" style={{ width: `${Math.max(2, (value(r) / max) * 100)}%` }} />
              <span className="relative flex min-w-0 flex-1 items-center gap-2.5">{left}</span>
              <span className="tabular relative shrink-0 text-right">{right}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One stacked bar of parts with a legend (outcome distribution). */
export function StackedBar({ parts }: { parts: { key: string; label: string; value: number; tone: Tone }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-elevated" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: FILL[p.tone] }} className="h-full first:rounded-l-full last:rounded-r-full" />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: FILL[p.tone] }} aria-hidden />
            <span className="text-fg-muted">{p.label}</span>
            <span className="tabular ml-auto text-fg">
              {p.value}
              {total > 0 && <span className="ml-1 text-fg-subtle">{Math.round((p.value / total) * 100)}%</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
