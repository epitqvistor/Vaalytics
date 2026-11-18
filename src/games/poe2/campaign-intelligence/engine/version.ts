/**
 * Dataset ↔ game client compatibility. The PoE 2 client names its build in the
 * log's User-Agent line (`poe2_production/tags/0.5.5g`). Older clients used a
 * different scheme (`tags/4.5.4f`); its mapping to game patches isn't documented,
 * so such tags are reported as "unknown" rather than guessed.
 */
export type Compatibility =
  | { kind: "match"; clientPatch: string }
  | { kind: "different"; clientPatch: string; datasetPatch: string }
  | { kind: "unknown"; tag: string | null };

/** "0.5.5g" → "0.5.5"; anything not shaped like `0.<minor>.<patch>[letter]` → null. */
export function patchFromClientTag(tag: string | null | undefined): string | null {
  const m = /^(0\.\d+\.\d+)[a-z]?$/.exec(tag?.trim() ?? "");
  return m?.[1] ?? null;
}

export function compatibility(datasetPatch: string, clientTag: string | null | undefined): Compatibility {
  const clientPatch = patchFromClientTag(clientTag);
  if (!clientPatch) return { kind: "unknown", tag: clientTag ?? null };
  return clientPatch === datasetPatch ? { kind: "match", clientPatch } : { kind: "different", clientPatch, datasetPatch };
}
