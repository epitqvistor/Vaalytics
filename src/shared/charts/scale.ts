/** Minimal chart math. No charting library: our charts are single-series lines. */

export interface Extent {
  min: number;
  max: number;
}

/** Data extent with proportional padding; degenerate (flat) series get a band. */
export function paddedExtent(values: readonly number[], pad = 0.08): Extent {
  if (values.length === 0) return { min: 0, max: 1 };
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || Math.abs(max) * 0.1 || 1;
  return { min: min - span * pad, max: max + span * pad };
}

/** Maps values to SVG points across [0,width] × [height,0]. */
export function toPoints(values: readonly number[], width: number, height: number, extent = paddedExtent(values)): [number, number][] {
  const n = values.length;
  const span = extent.max - extent.min || 1;
  return values.map((v, i) => [n === 1 ? width / 2 : (i / (n - 1)) * width, height - ((v - extent.min) / span) * height]);
}

export function linePath(points: readonly [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

export function areaPath(points: readonly [number, number][], height: number): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${linePath(points)}L${last[0].toFixed(1)} ${height}L${first[0].toFixed(1)} ${height}Z`;
}

/** ~`count` round tick values covering the extent. */
export function niceTicks(extent: Extent, count = 4): number[] {
  const span = extent.max - extent.min;
  if (!(span > 0)) return [extent.min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Pick the round step whose tick count lands closest to the request.
  let step = mag;
  let best = Infinity;
  for (const m of [1, 2, 2.5, 5, 10]) {
    const diff = Math.abs(span / (m * mag) - count);
    if (diff < best) {
      best = diff;
      step = m * mag;
    }
  }
  const ticks: number[] = [];
  for (let t = Math.ceil(extent.min / step) * step; t <= extent.max + 1e-9; t += step) {
    ticks.push(Number(t.toPrecision(12)));
  }
  return ticks;
}

/** Index of the data point nearest to x in a series spread across width. */
export function nearestIndex(x: number, width: number, n: number): number {
  if (n <= 1) return 0;
  return Math.min(n - 1, Math.max(0, Math.round((x / width) * (n - 1))));
}
