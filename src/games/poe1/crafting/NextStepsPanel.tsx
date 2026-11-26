/** Next-step options for the current emulated / pasted rare item. */
import { useMemo } from "react";
import { Badge, EmptyState } from "@/shared/components";
import { cn } from "@/shared/utilities/cn";
import type { EmuItem } from "./emulator";
import type { PriceTable } from "./methods";
import { useChaos } from "./money";
import { nextSteps } from "./nextsteps";
import type { CraftingIndex } from "./pool";
import type { Gen, Goal, ItemSpec } from "./types";

const chance = (p: number) => (p >= 0.01 ? `${(p * 100).toFixed(p >= 0.1 ? 1 : 2)}%` : `1 in ${Math.round(1 / p).toLocaleString("en-US")}`);

export function NextStepsPanel({
  idx,
  spec,
  item,
  goal,
  prices,
  dominance,
  divine,
}: {
  idx: CraftingIndex;
  spec: ItemSpec;
  item: EmuItem | null;
  goal: Goal;
  prices: PriceTable;
  dominance: Gen | null;
  divine: number | null;
}) {
  const money = useChaos(divine);
  const steps = useMemo(() => (item ? nextSteps(idx, spec, item, goal, prices, dominance) : []), [idx, spec, item, goal, prices, dominance]);
  const bestRepeat = steps.filter((s) => s.repeatable && s.avgCost !== null).sort((a, b) => a.avgCost! - b.avgCost!)[0]?.id;

  return (
    <section className="panel rounded-lg">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <h2 className="text-sm font-semibold text-fg">Next step from this item</h2>
        <span className="text-2xs text-fg-subtle">metacrafts · Eldritch · Exalt</span>
      </header>
      {!item || item.rarity !== "rare" ? (
        <EmptyState icon="crafting" title="Needs a rare item" body="Paste an item or roll one in the emulator; options for finishing it appear here." className="py-8" />
      ) : !goal.targets.length ? (
        <EmptyState icon="crafting" title="No targets yet" className="py-8" />
      ) : steps.length === 0 ? (
        <p className="px-3.5 py-4 text-xs text-fg-subtle">The targets are on the item, or no supported step can add them.</p>
      ) : (
        <ul className="divide-y divide-line">
          {steps.map((s) => (
            <li key={s.id} className="flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-fg">{s.label}</p>
                <p className="text-2xs text-fg-subtle">{s.detail}</p>
                <p className="mt-0.5 text-2xs text-fg-subtle">
                  {s.components.map((c) => `${c.qty}× ${c.name}${c.price === null ? " (no price)" : ""}`).join(" + ")}
                </p>
                {s.id === bestRepeat && (
                  <Badge tone="success" className="mt-1">
                    Cheapest repeatable
                  </Badge>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-sm tabular text-fg">{chance(s.chance)}</p>
                <p className={cn("text-2xs tabular", s.costPerTry === null ? "text-warning" : "text-fg-subtle")}>
                  {s.costPerTry === null ? "no price" : s.repeatable ? `avg ${money(s.avgCost!)}` : `${money(s.costPerTry)} / try`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-3.5 py-2 text-2xs leading-relaxed text-fg-subtle">
        One-shot steps change the item when they miss. Repeatable steps keep the locked / non-dominant side, so their average is cost ÷ chance.
      </p>
    </section>
  );
}
