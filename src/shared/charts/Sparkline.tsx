import { memo } from "react";
import { linePath, toPoints } from "./scale";

/**
 * Inline trend line for table rows. Decorative: the adjacent change % is the
 * readable value, so this is aria-hidden. Colour follows direction but the
 * number beside it carries the sign, so meaning is never colour-only.
 */
export const Sparkline = memo(function Sparkline({
  values,
  width = 72,
  height = 22,
  trend,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  trend?: "up" | "down" | "flat";
}) {
  if (values.length < 2) return <span style={{ width, height }} className="inline-block" />;
  const pts = toPoints(values, width - 2, height - 4).map(([x, y]) => [x + 1, y + 2] as [number, number]);
  const color = trend === "up" ? "var(--color-success)" : trend === "down" ? "var(--color-danger)" : "var(--color-fg-subtle)";
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block overflow-visible">
      <path d={linePath(pts)} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={1.5} fill={color} />
    </svg>
  );
});
