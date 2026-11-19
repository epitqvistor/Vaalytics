/**
 * Matches a keyboard event against a shortcut string in the global-shortcut
 * format used by the settings ("Ctrl+D", "Ctrl+Shift+D", "Alt+D", "Ctrl+Alt+D").
 * Modifiers must match exactly, so Ctrl+Shift+D does not trigger Ctrl+D.
 */
export function matchesShortcut(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">, shortcut: string): boolean {
  const parts = shortcut.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  const key = parts.pop();
  if (!key) return false;
  const mods = new Set(parts.map((m) => (m === "control" ? "ctrl" : m === "option" ? "alt" : m === "cmd" || m === "super" || m === "command" ? "meta" : m)));
  if (e.ctrlKey !== mods.has("ctrl") || e.shiftKey !== mods.has("shift") || e.altKey !== mods.has("alt") || e.metaKey !== mods.has("meta")) return false;
  // `code` is layout-independent ("KeyD"); `key` covers non-letter keys.
  if (/^[a-z]$/.test(key)) return e.code === `Key${key.toUpperCase()}` || e.key.toLowerCase() === key;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || e.key === key;
  return e.key.toLowerCase() === key || e.code.toLowerCase() === key;
}
