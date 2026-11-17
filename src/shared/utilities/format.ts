const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

export function formatDuration(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Price amounts: more precision for small values, grouping for large ones. */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  // Below 0.01, keep 2 significant digits so converted amounts (0.0042 div) aren't shown as 0.
  if (abs > 0 && abs < 0.01) return value.toLocaleString("en-US", { maximumSignificantDigits: 2 });
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** Signed percentage from a ratio: 0.042 → "+4.2%". */
export function formatChange(ratio: number): string {
  if (!Number.isFinite(ratio)) return "—";
  const pct = ratio * 100;
  const rounded = Math.abs(pct) < 0.05 ? 0 : pct;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}

/** Coarse relative time for listing ages and sync times. */
export function formatRelative(thenMs: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

/** Compact axis/label form: 1,250 → "1.3k", 410,000 → "410k". */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs < 10_000) return formatAmount(value);
  const [div, suffix] = abs >= 1_000_000 ? [1_000_000, "M"] : [1_000, "k"];
  const n = value / div;
  return `${Number(n.toFixed(Math.abs(n) >= 100 ? 0 : 1))}${suffix}`;
}
