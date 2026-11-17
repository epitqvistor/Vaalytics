type ClassValue = string | number | false | null | undefined;

/** Joins truthy class names. Tiny replacement for clsx; no conflict merging. */
export function cn(...values: ClassValue[]): string {
  let out = "";
  for (const v of values) {
    if (v || v === 0) out = out ? `${out} ${v}` : String(v);
  }
  return out;
}
