/** Small shared pieces for the Loot Journal views. */
import type { LootItem } from "@/core/ipc/commands";
import { Badge } from "@/shared/components";
import { Price } from "@/shared/views/common";
import { POE2_CONFIG } from "../config";
import { VALUE_STATUS_LABEL, VALUE_STATUS_SHORT } from "./stats";

export const fmtDateTime = (unixSecs: number) =>
  new Date(unixSecs * 1000).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Value of an item, or why it has none — never a guessed number. */
/** An unidentified unique valued at the cheapest unique its base can be. */
export const isRangeEstimate = (item: Pick<LootItem, "valueNote">) => item.valueNote?.startsWith("Unidentified: one of") ?? false;
/** Not in poe.ninja's latest snapshot; valued at the last listed price (Rust `LAST_LISTED_NOTE`). */
export const isLastListed = (item: Pick<LootItem, "valueNote">) => item.valueNote?.startsWith("Not in the latest poe.ninja data") ?? false;

export function ValueCell({ item, strong, full }: { item: Pick<LootItem, "valueStatus" | "valueTotal" | "valueNote">; strong?: boolean; full?: boolean }) {
  if ((item.valueStatus === "priced" || item.valueStatus === "manual") && item.valueTotal !== null) {
    return (
      <span className="inline-flex items-center gap-1.5" title={item.valueNote ?? undefined}>
        {isRangeEstimate(item) && <span className="text-2xs text-fg-subtle">from</span>}
        {isLastListed(item) && <span className="text-2xs text-fg-subtle">last listed</span>}
        <Price amount={item.valueTotal} unit={POE2_CONFIG.baseUnit} strong={strong} />
        {item.valueStatus === "manual" && <span className="text-2xs text-fg-subtle">yours</span>}
      </span>
    );
  }
  return (
    <span className="text-xs whitespace-nowrap text-fg-subtle" title={item.valueNote ?? VALUE_STATUS_LABEL[item.valueStatus]}>
      {full ? VALUE_STATUS_LABEL[item.valueStatus] : VALUE_STATUS_SHORT[item.valueStatus]}
    </span>
  );
}

export function CaptureBadge({ listening, enabled }: { listening: boolean; enabled: boolean }) {
  if (!enabled) return <Badge>Capture off</Badge>;
  return listening ? (
    <Badge tone="success" dot>
      Capturing (PoE 2 focused)
    </Badge>
  ) : (
    <Badge tone="accent" dot>
      Capture on · waiting for PoE 2
    </Badge>
  );
}
