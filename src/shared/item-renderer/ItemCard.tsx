import { memo } from "react";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import type { DisplayItem, ItemMod, ItemRarity, ModKind } from "./types";

const RARITY_TEXT: Record<ItemRarity, string> = {
  normal: "text-rarity-normal",
  magic: "text-rarity-magic",
  rare: "text-rarity-rare",
  unique: "text-rarity-unique",
  gem: "text-rarity-gem",
  currency: "text-rarity-currency",
};

const RARITY_EDGE: Record<ItemRarity, string> = {
  normal: "from-rarity-normal/25",
  magic: "from-rarity-magic/25",
  rare: "from-rarity-rare/10",
  unique: "from-rarity-unique/30",
  gem: "from-rarity-gem/25",
  currency: "from-rarity-currency/25",
};

const MOD_TEXT: Record<ModKind, string> = {
  implicit: "text-mod-explicit",
  explicit: "text-mod-explicit",
  crafted: "text-mod-crafted",
  fractured: "text-mod-fractured",
  enchant: "text-mod-enchant",
  rune: "text-mod-enchant",
  pseudo: "text-fg-muted",
};

const MOD_TAG: Partial<Record<ModKind, string>> = {
  crafted: "crafted",
  fractured: "fractured",
  enchant: "enchant",
  rune: "rune",
  implicit: "implicit",
};

/**
 * Item tooltip-style card. Original Vaalytics styling (not a copy of the in-game
 * frame): a solid surface, rarity-coloured header and grouped sections.
 */
export const ItemCard = memo(function ItemCard({ item, className }: { item: DisplayItem; className?: string }) {
  const groups: ItemMod[][] = [
    item.mods.filter((m) => m.kind === "enchant" || m.kind === "rune"),
    item.mods.filter((m) => m.kind === "implicit"),
    item.mods.filter((m) => m.kind === "explicit" || m.kind === "crafted" || m.kind === "fractured"),
  ].filter((g) => g.length > 0);

  return (
    <article className={cn("panel overflow-hidden rounded-lg", className)} data-selectable>
      <header className={cn("border-b border-line bg-gradient-to-b to-transparent px-4 pt-3.5 pb-3 text-center", RARITY_EDGE[item.rarity])}>
        {item.name && <h3 className={cn("font-display text-lg font-semibold", RARITY_TEXT[item.rarity])}>{item.name}</h3>}
        <p className={cn(item.name ? "text-sm" : "font-display text-lg font-semibold", RARITY_TEXT[item.rarity])}>{item.baseType}</p>
        <p className="mt-1 text-2xs tracking-wide text-fg-subtle uppercase">
          {item.itemClass}
          {item.itemLevel != null && ` · iLvl ${item.itemLevel}`}
        </p>
      </header>

      <div className="divide-y divide-line text-sm">
        {(item.properties.length > 0 || item.sockets) && (
          <dl className="space-y-0.5 px-4 py-2.5">
            {item.properties.map((p) => (
              <div key={p.label} className="flex justify-between gap-4">
                <dt className="text-fg-muted">{p.label}</dt>
                <dd className={cn("tabular", p.augmented ? "text-mod-explicit" : "text-fg")}>{p.value}</dd>
              </div>
            ))}
            {item.sockets && (
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Sockets</dt>
                <dd className="font-mono text-xs leading-5 text-fg">{item.sockets}</dd>
              </div>
            )}
          </dl>
        )}

        {groups.map((group, gi) => (
          <ul key={gi} className="space-y-1 px-4 py-2.5">
            {group.map((m) => (
              <li key={m.id} className="flex items-start gap-2">
                <span className={cn("flex-1", MOD_TEXT[m.kind])}>{m.text}</span>
                {MOD_TAG[m.kind] && <span className="mt-0.5 shrink-0 text-2xs text-fg-subtle">{MOD_TAG[m.kind]}</span>}
                {m.tier != null && <span className="mt-0.5 shrink-0 font-mono text-2xs text-fg-subtle">T{m.tier}</span>}
              </li>
            ))}
          </ul>
        ))}

        {(item.corrupted || (item.influences && item.influences.length > 0) || item.requirements) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
            {item.requirements && <span className="text-fg-muted">{item.requirements}</span>}
            {item.influences?.map((inf) => (
              <span key={inf} className="text-accent-2">
                {inf}
              </span>
            ))}
            {item.corrupted && <span className="font-medium text-mod-corrupted">Corrupted</span>}
          </div>
        )}

        {item.unparsed && item.unparsed.length > 0 && (
          <div className="flex gap-2 bg-warning-soft px-4 py-2.5 text-xs text-warning">
            <Icon name="warning" size={14} className="mt-px" />
            <span>
              {item.unparsed.length} line{item.unparsed.length > 1 ? "s" : ""} not recognised — kept as text, not used for pricing.
            </span>
          </div>
        )}
      </div>
    </article>
  );
});
