/** Currency emulator: click currency to craft on the item; Shift+click repeats until the targets hit. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { ItemCard } from "@/shared/item-renderer/ItemCard";
import type { DisplayItem } from "@/shared/item-renderer/types";
import { cn } from "@/shared/utilities/cn";
import { actionCost, CURRENCY, ELDRITCH, Emulator, type EldritchCurrency, type EmuAction, type EmuItem, type SimpleCurrency } from "./emulator";
import { HARVEST_REFORGES, harvestByTag } from "./harvest";
import type { PriceTable } from "./methods";
import { RESONATORS } from "./methods";
import { useChaos } from "./money";
import { pobTextFor } from "./paste";
import type { CraftingIndex } from "./pool";
import { needOf, targetsHit } from "./sampler";
import type { Gen, Goal, ItemSpec, ModDef } from "./types";

const ORDER: SimpleCurrency[] = ["transmute", "alteration", "augmentation", "regal", "alchemy", "chaos", "exalted", "annulment", "scouring"];
const AUTO_LIMIT = 1_000_000;
const FRAME_BUDGET_MS = 12;


export function EmulatorPanel({
  idx,
  spec,
  start,
  implicits,
  goal,
  prices,
  icons,
  divine,
  dominance,
  eldritchAllowed,
  onItemChange,
}: {
  idx: CraftingIndex;
  spec: ItemSpec;
  start: EmuItem;
  /** Rolled implicit lines of a pasted item; null → base ranges. */
  implicits: string[] | null;
  goal: Goal;
  prices: PriceTable;
  icons: Record<string, string>;
  divine: number | null;
  dominance: Gen | null;
  /** Eldritch implicits exist on this class (body armour, helmet, gloves, boots). */
  eldritchAllowed: boolean;
  onItemChange: (item: EmuItem) => void;
}) {
  const money = useChaos(divine);
  const unitMoney = useChaos(null);
  const notify = useToast();
  const emu = useMemo(() => new Emulator(idx, spec, dominance), [idx, spec, dominance]);
  const [item, setItem] = useState<EmuItem>(start);
  const [spent, setSpent] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [auto, setAuto] = useState<{ label: string; count: number } | null>(null);
  const stop = useRef(false);
  const rnd = useRef(Math.random);

  const essences = useMemo(
    () => idx.data.essences.filter((e) => emu.essenceMod(e) && (e.itemLevelRestriction === null || spec.ilvl <= e.itemLevelRestriction)),
    [idx, emu, spec.ilvl],
  );
  const [essenceId, setEssenceId] = useState("");
  const essence = essences.find((e) => e.id === essenceId) ?? essences.find((e) => e.name.startsWith("Deafening")) ?? essences[0];
  const [fossilIds, setFossilIds] = useState<string[]>([]);
  const fossils = idx.data.fossils.filter((f) => fossilIds.includes(f.id));

  // New item / base → fresh session.
  useEffect(() => {
    stop.current = true;
    setItem(start);
    setSpent({});
    setMessage(null);
    setAuto(null);
  }, [start, emu]);
  useEffect(() => () => void (stop.current = true), []);
  useEffect(() => onItemChange(item), [item, onItemChange]);

  const benchCrafts = useMemo(() => {
    const list = emu.benchCrafts().map((b) => ({ b, mod: idx.modById.get(b.modId)! }));
    const meta = (m: ModDef) => m.family.startsWith("ItemGeneration");
    return list.sort((x, y) => Number(meta(y.mod)) - Number(meta(x.mod)) || x.mod.gen.localeCompare(y.mod.gen) || x.mod.text.localeCompare(y.mod.text) || x.b.tier - y.b.tier);
  }, [emu, idx]);
  const [benchIdx, setBenchIdx] = useState("0");
  const craft = benchCrafts[Number(benchIdx)] ?? benchCrafts[0];
  const [harvestTag, setHarvestTag] = useState("life");
  const harvest = harvestByTag(harvestTag)!;

  const tierOf = emu.tierOf;
  const need = needOf(goal);
  const hits = (i: EmuItem) => targetsHit(i.mods.map((m) => m.mod), goal, tierOf);
  const done = goal.targets.length > 0 && hits(item) >= need;

  const priceOf = (n: string): number | null => (n === "Chaos Orb" ? 1 : (prices[n] ?? null));
  const costOf = (list: [string, number][]) => list.reduce<number | null>((s, [n, q]) => (s === null || priceOf(n) === null ? null : s + q * priceOf(n)!), 0);
  const totals = useMemo(() => {
    let chaos = 0;
    let missing = false;
    let count = 0;
    for (const [n, q] of Object.entries(spent)) {
      count += q;
      const p = n === "Chaos Orb" ? 1 : prices[n];
      if (p === undefined) missing = true;
      else chaos += p * q;
    }
    return { chaos, missing, count };
  }, [spent, prices]);

  const addSpent = (into: Record<string, number>, names: [string, number][]) => {
    for (const [n, q] of names) into[n] = (into[n] ?? 0) + q;
  };

  const once = (a: EmuAction) => {
    const next = emu.apply(item, a, rnd.current);
    if ("error" in next) return setMessage(next.error);
    setMessage(null);
    setItem(next);
    setSpent((s) => {
      const c = { ...s };
      addSpent(c, actionCost(a));
      return c;
    });
  };

  /** Repeats `a` until the goal is met. Alteration also augments a one-mod item. */
  const repeat = (a: EmuAction, label: string) => {
    if (!goal.targets.length) return setMessage("Add target modifiers first — auto-roll stops when they hit.");
    if (done) return setMessage("The targets are already on the item.");
    stop.current = false;
    let cur = item;
    const acc: Record<string, number> = {};
    let n = 0;
    const step = () => {
      const t0 = performance.now();
      while (performance.now() - t0 < FRAME_BUDGET_MS) {
        const next = emu.apply(cur, a, rnd.current);
        if ("error" in next) {
          stop.current = true;
          setMessage(next.error);
          break;
        }
        addSpent(acc, actionCost(a));
        cur = next;
        n++;
        if (a.kind === "alteration" && cur.mods.length === 1) {
          const aug = emu.apply(cur, { kind: "augmentation" }, rnd.current);
          if (!("error" in aug)) {
            cur = aug;
            addSpent(acc, [[CURRENCY.augmentation.name, 1]]);
          }
        }
        if (hits(cur) >= need || n >= AUTO_LIMIT) {
          stop.current = true;
          if (n >= AUTO_LIMIT) setMessage(`Stopped after ${AUTO_LIMIT.toLocaleString("en-US")} uses without hitting the targets.`);
          break;
        }
      }
      setItem(cur);
      const batch = Object.entries(acc);
      for (const k of Object.keys(acc)) delete acc[k];
      setSpent((s) => {
        const c = { ...s };
        for (const [k, v] of batch) c[k] = (c[k] ?? 0) + v;
        return c;
      });
      setAuto(stop.current ? null : { label, count: n });
      if (!stop.current) requestAnimationFrame(step);
    };
    setMessage(null);
    setAuto({ label, count: 0 });
    requestAnimationFrame(step);
  };

  const use = (a: EmuAction, label: string, shift: boolean) => (shift ? repeat(a, label) : once(a));

  const display: DisplayItem = {
    rarity: item.rarity,
    name: item.rarity === "rare" ? "Crafted Item" : undefined,
    baseType: spec.base.name,
    itemClass: spec.base.itemClass,
    itemLevel: spec.ilvl,
    properties: [],
    influences: spec.influences,
    mods: [
      ...(implicits ?? spec.base.implicits.map((t) => t.split("\n").join(", "))).map((t, i) => ({ id: `i${i}`, text: t, kind: "implicit" as const })),
      ...item.mods.map((m, i) => ({
        id: `m${i}`,
        text: m.text.split("\n").join(", "),
        kind: m.fractured ? ("fractured" as const) : m.crafted ? ("crafted" as const) : ("explicit" as const),
        // Unknown (not in the game data) and crafted mods have no tier.
        tier: m.crafted || m.mod.id.startsWith("unknown:") ? undefined : tierOf(m.mod),
      })),
    ],
  };

  return (
    <div className="flex flex-col gap-3">
      <ItemCard item={display} />

      {goal.targets.length > 0 && (
        <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-xs", done ? "border-success/40 bg-success/10 text-fg" : "border-line text-fg-muted")}>
          <Icon name={done ? "success" : "crafting"} size={14} className={done ? "text-success" : "text-fg-subtle"} />
          Targets on item: <span className="font-mono tabular text-fg">{hits(item)}</span> / {need}
          {done && <Badge tone="success">Hit</Badge>}
        </div>
      )}

      <section className="panel rounded-xl">
        <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
          <h2 className="text-sm font-semibold text-fg">Currency emulator</h2>
          <span className="text-2xs text-fg-subtle">Shift+click: repeat until hit</span>
        </header>
        <div className="grid grid-cols-3 gap-1.5 p-2.5">
          {ORDER.map((k) => (
            <CurrencyButton
              key={k}
              label={CURRENCY[k].short}
              hint={CURRENCY[k].hint}
              icon={icons[CURRENCY[k].name]}
              price={priceOf(CURRENCY[k].name)}
              disabled={!!auto}
              onClick={(shift) => use({ kind: k }, CURRENCY[k].short, shift)}
            />
          ))}
        </div>

        <div className="space-y-2 border-t border-line px-2.5 py-2.5">
          <div className="flex items-end gap-1.5">
            {essence ? (
              <>
                <Select
                  label="Essence"
                  size="sm"
                  value={essence.id}
                  onChange={setEssenceId}
                  options={essences.map((e) => ({ value: e.id, label: e.name }))}
                  className="min-w-0 flex-1"
                />
                <CurrencyButton
                  compact
                  label="Use"
                  hint={`${essence.name}: ${emu.essenceMod(essence)?.text.split("\n").join(", ")}`}
                  icon={icons[essence.name]}
                  price={priceOf(essence.name)}
                  disabled={!!auto}
                  onClick={(shift) => use({ kind: "essence", essence }, essence.name, shift)}
                />
              </>
            ) : (
              <p className="text-2xs text-fg-subtle">No essence applies to this item.</p>
            )}
          </div>

          <div className="flex items-end gap-1.5">
            <Select
              label="Harvest reforge"
              size="sm"
              value={harvestTag}
              onChange={setHarvestTag}
              options={HARVEST_REFORGES.map((h) => ({ value: h.tag, label: `${h.label} · ${h.cost.map(([n, q]) => `${q} ${n.split(" ")[0]}`).join(" + ")}` }))}
              className="min-w-0 flex-1"
            />
            <CurrencyButton
              compact
              label="Reforge"
              hint={`Reforge a Rare item with random modifiers, including a ${harvest.label} modifier`}
              icon={icons[harvest.cost[0]![0]]}
              price={costOf(harvest.cost)}
              disabled={!!auto}
              onClick={(shift) => use({ kind: "harvest", tag: harvest.tag }, `Harvest ${harvest.label}`, shift)}
            />
          </div>

          {craft && (
            <div className="space-y-1.5">
              <Select
                label="Crafting bench"
                size="sm"
                value={String(benchCrafts.indexOf(craft))}
                onChange={setBenchIdx}
                options={benchCrafts.map(({ b, mod }, i) => ({
                  value: String(i),
                  label: `${mod.gen === "prefix" ? "P" : "S"} · ${mod.text.split("\n").join(", ")} · ${b.cost.map(([n, q]) => `${q} ${n.replace(/^Orb of /, "")}`).join(" + ")}`,
                }))}
              />
              <div className="flex justify-end gap-1.5">
                <CurrencyButton compact label="Craft" hint={craft.mod.text} price={costOf(craft.b.cost)} disabled={!!auto} onClick={() => once({ kind: "bench", craft: craft.b })} />
                <CurrencyButton
                  compact
                  label="Remove crafted"
                  hint="Remove crafted modifiers (1 Orb of Scouring)"
                  price={costOf(actionCost({ kind: "removeCrafted" }))}
                  disabled={!!auto}
                  onClick={() => once({ kind: "removeCrafted" })}
                />
              </div>
            </div>
          )}

          {eldritchAllowed && (
            <div>
              <p className="mb-1 text-xs font-medium text-fg-muted">
                Eldritch {dominance ? <span className="text-fg-subtle">· {dominance === "prefix" ? "Exarch dominant → prefixes" : "Eater dominant → suffixes"}</span> : <span className="text-warning">· no dominance</span>}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(ELDRITCH) as EldritchCurrency[]).map((k) => (
                  <CurrencyButton
                    key={k}
                    label={ELDRITCH[k].short}
                    hint={ELDRITCH[k].hint}
                    icon={icons[ELDRITCH[k].name]}
                    price={priceOf(ELDRITCH[k].name)}
                    disabled={!!auto || !dominance}
                    onClick={(shift) => use({ kind: k }, ELDRITCH[k].short, shift)}
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-medium text-fg-muted">Fossils (up to 4)</p>
            <div className="flex flex-wrap gap-1">
              {idx.data.fossils.map((f) => {
                const on = fossilIds.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={on}
                    title={`${f.name} · ${priceOf(f.name) === null ? "no price" : unitMoney(priceOf(f.name)!)}`}
                    onClick={() => setFossilIds((ids) => (on ? ids.filter((x) => x !== f.id) : ids.length >= 4 ? ids : [...ids, f.id]))}
                    className={cn(
                      "flex h-7 items-center gap-1 rounded-md border px-1.5 text-2xs transition-colors",
                      on ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-fg-muted hover:bg-glass-hover hover:text-fg",
                    )}
                  >
                    {icons[f.name] && <img src={icons[f.name]} alt="" className="size-4" />}
                    {f.name.replace(/ Fossil$/, "")}
                  </button>
                );
              })}
            </div>
            {fossils.length > 0 && (
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-2xs text-fg-subtle">{RESONATORS[fossils.length - 1]}</span>
                <CurrencyButton
                  compact
                  label="Resonate"
                  hint={`${fossils.map((f) => f.name).join(" + ")} in a ${RESONATORS[fossils.length - 1]}`}
                  icon={icons[RESONATORS[fossils.length - 1]!]}
                  price={costOf(actionCost({ kind: "fossil", fossils }))}
                  disabled={!!auto}
                  onClick={(shift) => use({ kind: "fossil", fossils }, "Fossils", shift)}
                />
              </div>
            )}
          </div>
        </div>

        <footer className="space-y-2 border-t border-line px-3.5 py-2.5 text-xs">
          {auto ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-muted">
                Auto-rolling {auto.label}… <span className="font-mono tabular text-fg">{auto.count.toLocaleString("en-US")}</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => (stop.current = true)}>
                Stop
              </Button>
            </div>
          ) : (
            message && (
              <p className="flex gap-1.5 text-warning">
                <Icon name="info" size={13} className="mt-px shrink-0" />
                {message}
              </p>
            )
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-fg-muted" title={Object.entries(spent).map(([n, q]) => `${q}× ${n}`).join("\n")}>
              Used <span className="font-mono tabular text-fg">{totals.count.toLocaleString("en-US")}</span> ·{" "}
              <span className="font-mono tabular text-fg">{money(totals.chaos)}</span>
              {totals.missing && <span className="text-warning"> + unpriced</span>}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              onClick={() => {
                stop.current = true;
                setItem(start);
                setSpent({});
                setMessage(null);
              }}
            >
              Reset item
            </Button>
          </div>
        </footer>
      </section>

      <Button
        variant="secondary"
        icon="copy"
        onClick={() =>
          navigator.clipboard
            .writeText(pobTextFor(spec, item, implicits))
            .then(() => notify("success", "Copied for Path of Building", "In PoB: Items → Create custom → paste."))
            .catch(() => notify("warning", "Couldn't copy to the clipboard"))
        }
      >
        Copy PoB item text
      </Button>
    </div>
  );
}

function CurrencyButton({
  label,
  hint,
  icon,
  price,
  disabled,
  compact,
  onClick,
}: {
  label: string;
  hint: string;
  icon?: string;
  price: number | null;
  disabled?: boolean;
  compact?: boolean;
  onClick: (shift: boolean) => void;
}) {
  const unitMoney = useChaos(null);
  return (
    <button
      type="button"
      disabled={disabled}
      title={`${hint}\nShift+click: repeat until the targets hit`}
      onClick={(e) => onClick(e.shiftKey)}
      className={cn(
        "flex items-center gap-2 rounded-md border border-line bg-bg-2/80 text-left transition-colors hover:border-line-strong hover:bg-elevated disabled:opacity-50",
        compact ? "h-8 shrink-0 px-2" : "px-2 py-1.5",
      )}
    >
      {icon ? <img src={icon} alt="" className={compact ? "size-5" : "size-7"} /> : <Icon name="crafting" size={compact ? 14 : 18} className="text-fg-subtle" />}
      <span className="min-w-0">
        <span className="block truncate text-xs text-fg">{label}</span>
        {!compact && <span className="block font-mono text-2xs tabular text-fg-subtle">{price === null ? "no price" : unitMoney(price)}</span>}
      </span>
      {compact && <span className="font-mono text-2xs tabular text-fg-subtle">{price === null ? "—" : unitMoney(price)}</span>}
    </button>
  );
}
