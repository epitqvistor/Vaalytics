import { useMemo, useState } from "react";
import { Button } from "@/shared/components";
import type { ParsedItem } from "@/shared/item-parser/types";
import { useGameSetting } from "@/core/settings/useGameSetting";
import type { JsonValue } from "@/core/ipc/commands";
import { Comparables, ValuationCard, WarrantOverview } from "./components";
import { useMarketRun } from "./hooks";
import { applyCorrections, parseWarrant } from "./parse";
import { DEFAULT_THRESHOLDS, validThresholds, type SampleThresholds } from "./rules";
import type { WarrantCorrections } from "./types";

const isThresholds = (v: unknown): v is JsonValue => !!v && typeof v === "object" && validThresholds(v as SampleThresholds);

/** Warrant check inside the Price Checker / overlay (hotkey path). Same engine as the module page. */
export function MercenaryCheck({ item, league, compact }: { item: ParsedItem; league: string; compact?: boolean }) {
  const [corrections, setCorrections] = useState<WarrantCorrections>({});
  const [stored] = useGameSetting<JsonValue>("poe1", "mercenary.thresholds", DEFAULT_THRESHOLDS as unknown as JsonValue, isThresholds);
  const parsed = useMemo(() => parseWarrant(item.raw), [item.raw]);
  const warrant = useMemo(() => (parsed ? applyCorrections(parsed, corrections) : null), [parsed, corrections]);
  const { run, start } = useMarketRun(warrant, league, stored as unknown as SampleThresholds);
  if (!warrant) return <p className="text-sm text-warning">This doesn't look like a Mercenary Warrant.</p>;
  const running = run.state === "running";
  return (
    <div className="flex flex-col gap-4">
      <WarrantOverview warrant={warrant} corrections={corrections} onCorrect={setCorrections} />
      <div className="flex items-center gap-2">
        <Button variant="primary" icon="search" disabled={running || run.plans.length === 0} onClick={() => void start(false)}>
          {running ? "Checking…" : run.state === "done" ? "Check again" : "Check the market"}
        </Button>
        {run.problems.map((p) => (
          <span key={p} className="text-xs text-warning">
            {p}
          </span>
        ))}
      </div>
      <ValuationCard v={run.valuation} running={running} />
      {run.valuation && !compact && <Comparables v={run.valuation} plans={run.plans} />}
    </div>
  );
}
