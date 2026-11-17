/// <reference lib="webworker" />
/** Monte Carlo runs off the UI thread; progress is posted while it runs. */
import { runMonteCarlo, type McInput, type McResult } from "./montecarlo";
import { CraftingIndex } from "./pool";
import type { CraftingData } from "./types";

export type McIn = { type: "init"; data: CraftingData } | { type: "run"; id: number; input: McInput } | { type: "cancel" };
export type McOut =
  | { type: "progress"; id: number; fraction: number; attempts: number; hits: number }
  | { type: "result"; id: number; result: McResult }
  | { type: "error"; id: number; error: string };

let idx: CraftingIndex | null = null;
let current = 0;
const post = (m: McOut) => (self as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<McIn>) => {
  const m = e.data;
  if (m.type === "init") idx = new CraftingIndex(m.data);
  else if (m.type === "cancel") current++;
  else if (idx) {
    const id = (current = m.id);
    try {
      const result = await runMonteCarlo(idx, m.input, (p) => post({ type: "progress", id, ...p }), () => current !== id);
      if (result) post({ type: "result", id, result });
    } catch (err) {
      post({ type: "error", id, error: err instanceof Error ? err.message : String(err) });
    }
  }
};
