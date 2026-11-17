import type { SectionProps } from "@/core/game-context/sections";
import { Badge, Button, PageHeader } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";

/** Honest placeholder: crafting tools are planned, nothing here is simulated. */
export default function CraftingView({ onNavigate }: SectionProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Crafting" actions={<Badge tone="neutral">Planned</Badge>} />
      <div className="panel flex flex-col items-center rounded-xl px-10 py-14 text-center">
        <span className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-line bg-gradient-to-b from-white/[0.07] to-transparent">
          <Icon name="crafting" size={24} className="text-accent-2" />
        </span>
        <h2 className="text-lg font-semibold text-fg">Crafting cost calculator</h2>
        <p className="mt-2 max-w-md text-sm text-fg-muted">
          Estimate what a craft will cost using live currency prices from the Currency Tracker. This tool isn't built yet — when it arrives, every
          result will be clearly marked as an estimate.
        </p>
        <Button className="mt-6" icon="currency" onClick={() => onNavigate("currency")}>
          Check currency prices
        </Button>
      </div>
    </div>
  );
}
