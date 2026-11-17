/** Turns address-bar input into a URL: full URLs as-is, bare domains → https, anything else → Google search. */
export function toUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^localhost:\d+/i.test(s)) return null; // other schemes are not allowed
  if (!/\s/.test(s) && /^[^/]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(s)) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

/** Short display label for a tab. */
export function hostOf(url: string | null): string {
  if (!url) return "Start page";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
