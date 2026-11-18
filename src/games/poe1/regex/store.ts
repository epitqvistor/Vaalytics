/**
 * Library + quick slots state (Rust storage, per game) and the editor state
 * kept while the app runs (survives switching sections).
 */
import { useCallback, useEffect, useState } from "react";
import { regexList, regexSlots, type RegexEntry, type RegexSlot } from "@/core/ipc/commands";
import type { CategoryId } from "./categories";
import { emptyState, type GenState } from "./generator";

export function useLibrary() {
  const [entries, setEntries] = useState<RegexEntry[]>([]);
  const [slots, setSlots] = useState<RegexSlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([regexList("poe1"), regexSlots("poe1")]);
      setEntries(e);
      setSlots(s);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  return { entries, slots, error, reload };
}

export interface EditorMemory {
  category: CategoryId;
  states: Partial<Record<CategoryId, GenState>>;
  text: string;
  manual: boolean;
  /** Library entry the editor text came from (for "save" defaults). */
  loadedId: string | null;
}

let memory: EditorMemory = { category: "maps", states: {}, text: "", manual: false, loadedId: null };

export function useEditorMemory() {
  const [m, setM] = useState<EditorMemory>(memory);
  useEffect(() => {
    memory = m;
  }, [m]);
  const stateOf = (c: CategoryId) => m.states[c] ?? emptyState();
  return { m, setM, stateOf };
}
