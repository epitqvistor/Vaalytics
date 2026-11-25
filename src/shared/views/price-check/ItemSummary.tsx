import { useState } from "react";
import type { ParsedItem } from "@/shared/item-parser/types";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";

const RARITY_TEXT: Record<string, string> = {
  Normal: "text-rarity-normal",
  Magic: "text-rarity-magic",
  Rare: "text-rarity-rare",
  Unique: "text-rarity-unique",
  Gem: "text-rarity-gem",
  Currency: "text-rarity-currency",
  "Divination Card": "text-rarity-currency",
};

/** Order and colour of modifier groups. */
const GROUPS: { kinds: string[]; label: string; tone: string }[] = [
  { kinds: ["enchant", "scourge"], label: "Enchant", tone: "text-mod-enchant" },
  { kinds: ["implicit"], label: "Implicit", tone: "text-mod-explicit" },
  { kinds: ["fractured"], label: "Fractured", tone: "text-mod-fractured" },
  { kinds: ["explicit", "desecrated"], label: "Explicit", tone: "text-mod-explicit" },
  { kinds: ["rune"], label: "Rune", tone: "text-mod-enchant" },
  { kinds: ["crafted"], label: "Crafted", tone: "text-mod-crafted" },
];

/** Properties that matter for value; everything else stays in the full item card. */
const KEY_PROPS = ["Map Tier", "Corpse Level", "Monster Category", "Stack Size", "Area Level", "Waystone Tier"];

/**
 * Compact identification of the item: what it is, the few properties that drive its value, and its
 * modifiers grouped by type. Selected (searched) modifiers are emphasised.
 */
export function ItemSummary({ item, searched, icon, collapsed }: { item: ParsedItem; searched: ReadonlySet<string>; icon?: string | null; collapsed?: boolean }) {
  // The overlay starts collapsed: the filter list already shows the searchable lines.
  const [open, setOpen] = useState(!collapsed && item.mods.length <= 8);
  const facts = [
    item.itemLevel != null && `iLvl ${item.itemLevel}`,
    item.gemLevel != null && `Level ${item.gemLevel}`,
    item.quality != null && `Q ${item.quality}%`,
    item.links != null && item.links >= 5 && `${item.links}L`,
    item.stackSize && `Stack ${item.stackSize.current}${item.stackSize.max ? `/${item.stackSize.max}` : ""}`,
    ...item.properties.filter((p) => KEY_PROPS.includes(p.name)).map((p) => `${p.name} ${p.value}`),
  ].filter(Boolean) as string[];
  const flags = [
    item.corrupted && { label: "Corrupted", tone: "text-mod-corrupted" },
    item.mirrored && { label: "Mirrored", tone: "text-mod-enchant" },
    item.fractured && { label: "Fractured", tone: "text-mod-fractured" },
    item.synthesised && { label: "Synthesised", tone: "text-mod-enchant" },
    item.foulborn && { label: "Foulborn", tone: "text-mod-corrupted" },
    item.unidentified && { label: "Unidentified", tone: "text-warning" },
    ...item.influences.map((i) => ({ label: i, tone: "text-fg-muted" })),
  ].filter(Boolean) as { label: string; tone: string }[];

  return (
    <section className="flex flex-col gap-2" aria-label="Item">
      <div className="flex items-start gap-3">
        {icon && <img src={icon} alt="" className="size-10 shrink-0 object-contain" />}
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-sm font-semibold", RARITY_TEXT[item.rarity] ?? "text-fg")} title={item.name ?? item.baseType} data-selectable>
            {item.name ?? item.baseType}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            {item.name && <span className="truncate">{item.baseType}</span>}
            <span className="text-fg-subtle">{item.itemClass}</span>
            {facts.map((f) => (
              <span key={f} className="tabular">
                {f}
              </span>
            ))}
            {flags.map((f) => (
              <span key={f.label} className={f.tone}>
                {f.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {item.mods.length > 0 && (
        <div className="rounded-md bg-bg-2 px-2.5 py-1.5">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-1 text-2xs text-fg-subtle hover:text-fg-muted">
            <Icon name={open ? "chevronDown" : "chevronRight"} size={11} />
            {item.mods.length} modifier{item.mods.length === 1 ? "" : "s"}
          </button>
          {open && (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs" data-selectable>
              {GROUPS.flatMap((g) =>
                item.mods
                  .filter((m) => g.kinds.includes(m.kind))
                  .map((m) => (
                    <li key={m.id} className={cn("flex gap-2", g.tone, !searched.has(m.id) && searched.size > 0 && "opacity-60")}>
                      <span className="min-w-0 flex-1">{m.text}</span>
                      {m.tier != null && <span className="shrink-0 font-mono text-2xs text-fg-subtle">T{m.tier}</span>}
                      {g.label !== "Explicit" && <span className="shrink-0 text-2xs text-fg-subtle">{g.label.toLowerCase()}</span>}
                    </li>
                  )),
              )}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
