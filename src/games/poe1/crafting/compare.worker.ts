/// <reference lib="webworker" />
/** Runs the method comparison (fossil optimizer included) off the UI thread. */
import { compareMethods, type CompareInput } from "./methods";
import { CraftingIndex } from "./pool";
import type { CraftingData } from "./types";

export type WorkerIn = { type: "init"; data: CraftingData } | { type: "compare"; id: number; input: CompareInput };
export type WorkerOut = { type: "result"; id: number; result: ReturnType<typeof compareMethods> } | { type: "error"; id: number; error: string };

let idx: CraftingIndex | null = null;

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === "init") {
    idx = new CraftingIndex(m.data);
    return;
  }
  if (!idx) return;
  try {
    const result = compareMethods(idx, m.input);
    (self as DedicatedWorkerGlobalScope).postMessage({ type: "result", id: m.id, result } satisfies WorkerOut);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ type: "error", id: m.id, error: String(err) } satisfies WorkerOut);
  }
};
