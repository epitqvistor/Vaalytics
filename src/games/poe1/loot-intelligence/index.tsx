/**
 * Loot Intelligence (PoE 1): value tiers for drops from live poe.ninja prices,
 * unique bases worth picking up, and a show-only loot-filter block.
 * Spec: docs/modules/loot-intelligence.md
 */
import { useMemo, useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import type { MarketSnapshot } from "@/core/ipc/commands";
import { useMarketCategories, useMarketOverviews } from "@/core/market/hooks";
import { useLeague } from "@/core/market/LeagueContext";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { Badge, type BadgeTone, Button, EmptyState, Input, PageHeader, Panel, ProvenanceTag, SegmentedControl, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { formatRelative } from "@/shared/utilities/format";
import { Price } from "@/shared/views/common";
import { DisplayCurrencySelect, ItemIcon, LeagueSelect, VirtualRows } from "@/shared/views/market-ui";
import { POE1_CONFIG } from "../config";
import {
  DEFAULT_THRESHOLDS,
  isThresholds,
  lootFilter,
  MIN_LISTINGS,
  STACKABLE_CATEGORIES,
  stackableTiers,
  TIER_LABEL,
  TIERS,
  type Tier,
  type TierThresholds,
  UNIQUE_CATEGORIES,
  uniqueBases,
} from "./loot";

const CATEGORY_IDS = [...STACKABLE_CATEGORIES.map((c) => c.id), ...UNIQUE_CATEGORIES];
const TONE: Record<Tier, BadgeTone> = { top: "accent", valuable: "warning", pickup: "neutral", ignore: "neutral" };
const unit = POE1_CONFIG.baseUnit;
type Tab = "stackables" | "uniques" | "filter";

export default function LootIntelligence(_props: SectionProps) {
  const { league } = useLeague();
  const categories = useMarketCategories("poe1");
  const snaps = useMarketOverviews("poe1", league, CATEGORY_IDS);
  const [thresholds, setThresholds] = useGameSetting<TierThresholds>("poe1", "loot.thresholds", DEFAULT_THRESHOLDS, isThresholds);
  const [tab, setTab] = useState<Tab>("stackables");

  // Snapshots without a fetch time are placeholders while the engine fetches.
  const ready: Record<string, MarketSnapshot> = useMemo(() => Object.fromEntries(Object.entries(snaps).filter(([, s]) => s.fetchedAt !== null)), [snaps]);
  const loadedCount = CATEGORY_IDS.filter((id) => ready[id]).length;
  const oldest = Object.values(ready).reduce<number | null>((m, s) => (m === null ? s.fetchedAt : Math.min(m, s.fetchedAt!)), null);
  const stackables = useMemo(() => stackableTiers(ready, thresholds), [ready, thresholds]);
  const bases = useMemo(() => uniqueBases(ready, thresholds), [ready, thresholds]);
  const labelOf = (id: string) => categories.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="mx-auto max-w-page">
      <PageHeader
        title="Loot Intelligence"
        description="Which drops are worth picking up in this league, from live poe.ninja prices — with a loot-filter block to match."
        actions={
          <>
            <DisplayCurrencySelect />
            <LeagueSelect />
          </>
        }
      />

      <ThresholdBar value={thresholds} onChange={setThresholds} />

      <div className="mt-4 mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={setTab}
          segments={[
            { value: "stackables", label: "Currency & stackables" },
            { value: "uniques", label: "Unique bases" },
            { value: "filter", label: "Loot filter" },
          ]}
        />
        <div className="flex items-center gap-3 text-xs text-fg-muted">
          <ProvenanceTag provenance={{ kind: "market", source: "poe.ninja", at: oldest ? oldest * 1000 : null, league: league ?? undefined }} />
          <span>
            {loadedCount} of {CATEGORY_IDS.length} categories loaded
            {oldest && <span className="text-fg-subtle"> · oldest update {formatRelative(oldest * 1000)}</span>}
          </span>
        </div>
      </div>

      {tab === "stackables" && <StackablesTab rows={stackables} labelOf={labelOf} loading={loadedCount < CATEGORY_IDS.length} />}
      {tab === "uniques" && <UniquesTab bases={bases} loading={UNIQUE_CATEGORIES.some((c) => !ready[c])} />}
      {tab === "filter" && (
        <FilterTab
          text={lootFilter({ league: league ?? "—", pricesAt: oldest ? oldest * 1000 : null, thresholds, stackables, bases, unit: unit.short })}
          incomplete={loadedCount < CATEGORY_IDS.length}
        />
      )}
    </div>
  );
}

// ---------- thresholds ----------

function ThresholdBar({ value, onChange }: { value: TierThresholds; onChange: (t: TierThresholds) => void }) {
  const [draft, setDraft] = useState(value);
  const valid = draft.top >= draft.valuable && draft.valuable >= draft.pickup && draft.pickup >= 0;
  const set = (k: keyof TierThresholds) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [k]: Math.max(0, Number(e.target.value) || 0) });
  const dirty = draft.top !== value.top || draft.valuable !== value.valuable || draft.pickup !== value.pickup;
  return (
    <section className="panel flex flex-wrap items-end gap-3 rounded-lg px-4 py-3">
      {(["top", "valuable", "pickup"] as const).map((k) => (
        <Input key={k} size="sm" type="number" min={0} label={`${TIER_LABEL[k]} at`} value={draft[k]} onChange={set(k)} suffix={unit.short} containerClassName="w-32" />
      ))}
      <Button size="sm" variant="primary" disabled={!dirty || !valid} onClick={() => onChange(draft)}>
        Apply
      </Button>
      <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setDraft(value)}>
        Reset
      </Button>
      <p className="mb-1 ml-auto max-w-md text-2xs leading-relaxed text-fg-subtle">
        {valid ? "Thresholds in Chaos Orbs, saved for PoE 1. An item's tier comes from its current poe.ninja price — not from drop rates." : "Top ≥ Valuable ≥ Pick up."}
      </p>
    </section>
  );
}

// ---------- stackables ----------

function StackablesTab({ rows, labelOf, loading }: { rows: ReturnType<typeof stackableTiers>; labelOf: (id: string) => string; loading: boolean }) {
  const [tier, setTier] = useState<Tier | "worth">("worth");
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");
  const counts = useMemo(() => Object.fromEntries(TIERS.map((t) => [t, rows.filter((r) => r.tier === t).length])) as Record<Tier, number>, [rows]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => (tier === "worth" ? r.tier !== "ignore" : r.tier === tier) && (cat === "all" || r.category === cat) && (!q || r.row.name.toLowerCase().includes(q)),
    );
  }, [rows, tier, cat, query]);
  return (
    <Panel flush className="flex flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <SegmentedControl
          label="Tier"
          size="sm"
          value={tier}
          onChange={setTier}
          segments={[
            { value: "worth", label: "Worth picking" },
            ...TIERS.map((t) => ({ value: t, label: `${TIER_LABEL[t]} · ${counts[t] ?? 0}` })),
            { value: "ignore", label: TIER_LABEL.ignore },
          ]}
        />
        <Select
          label="Category"
          hideLabel
          size="sm"
          value={cat}
          onChange={setCat}
          options={[{ value: "all", label: "All categories" }, ...STACKABLE_CATEGORIES.map((c) => ({ value: c.id, label: labelOf(c.id) }))]}
          className="w-48"
        />
        <Input size="sm" icon="search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} containerClassName="w-56" aria-label="Search items" />
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={loading ? "refresh" : "search"} loading={loading} title={loading ? "Loading prices…" : "Nothing in this tier"} />
      ) : (
        <VirtualRows
          rows={shown}
          rowHeight={40}
          getKey={(r) => `${r.category}:${r.row.itemId}`}
          className="max-h-[560px]"
          renderRow={(r) => (
            <div className="grid h-full grid-cols-[minmax(220px,1fr)_160px_120px_110px] items-center gap-3 border-b border-line px-4 text-sm">
              <span className="flex min-w-0 items-center gap-2.5">
                <ItemIcon src={r.row.icon} name={r.row.name} size={22} />
                <span className="truncate text-fg">{r.row.name}</span>
              </span>
              <span className="truncate text-xs text-fg-subtle">{labelOf(r.category)}</span>
              <span className="text-right">
                <Price amount={r.row.value} unit={unit} />
              </span>
              <span className="text-right">
                <Badge tone={TONE[r.tier]}>{TIER_LABEL[r.tier]}</Badge>
              </span>
            </div>
          )}
        />
      )}
    </Panel>
  );
}

// ---------- unique bases ----------

function UniquesTab({ bases, loading }: { bases: ReturnType<typeof uniqueBases>; loading: boolean }) {
  const [query, setQuery] = useState("");
  const [onlyWorth, setOnlyWorth] = useState(true);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bases.filter((b) => (!onlyWorth || b.tier !== "ignore" || b.chase) && (!q || b.baseType.toLowerCase().includes(q) || b.uniques.some((u) => u.name.toLowerCase().includes(q))));
  }, [bases, query, onlyWorth]);
  return (
    <Panel flush className="flex flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
        <Input size="sm" icon="search" placeholder="Search bases or uniques" value={query} onChange={(e) => setQuery(e.target.value)} containerClassName="w-64" aria-label="Search bases" />
        <SegmentedControl
          label="Show"
          size="sm"
          value={onlyWorth ? "worth" : "all"}
          onChange={(v) => setOnlyWorth(v === "worth")}
          segments={[
            { value: "worth", label: "Worth picking or chase" },
            { value: "all", label: "All bases" },
          ]}
        />
        <p className="mb-1 ml-auto max-w-lg text-2xs leading-relaxed text-fg-subtle">
          Floor = cheapest unique on the base with ≥ {MIN_LISTINGS} listings: what an unidentified drop is at least worth. Chase = its best unique
          reaches Top. 3.30 Item Tier drop requirements aren't shown — no data source yet.
        </p>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={loading ? "refresh" : "search"} loading={loading} title={loading ? "Loading unique prices…" : "No bases match"} />
      ) : (
        <VirtualRows
          rows={shown}
          rowHeight={44}
          getKey={(b) => b.baseType}
          className="max-h-[560px]"
          header={
            <div className="grid h-9 grid-cols-[minmax(180px,1fr)_120px_minmax(220px,1.3fr)_80px_150px] items-center gap-3 border-b border-line bg-bg-2/95 px-4 text-xs text-fg-subtle">
              <span>Base type</span>
              <span className="text-right">Floor</span>
              <span>Best unique</span>
              <span className="text-right">Uniques</span>
              <span className="text-right">Tier</span>
            </div>
          }
          renderRow={(b) => (
            <div className="grid h-full grid-cols-[minmax(180px,1fr)_120px_minmax(220px,1.3fr)_80px_150px] items-center gap-3 border-b border-line px-4 text-sm">
              <span className="truncate text-fg" title={b.uniques.map((u) => u.name).join(", ")}>
                {b.baseType}
              </span>
              <span className="text-right">{b.floor === null ? <span className="text-xs text-fg-subtle">thin data</span> : <Price amount={b.floor} unit={unit} />}</span>
              <span className="flex min-w-0 items-center gap-2">
                <ItemIcon src={b.top.icon} name={b.top.name} size={22} />
                <span className="truncate text-fg-muted">{b.top.name}</span>
                <Price amount={b.top.value} unit={unit} className="ml-auto text-xs" />
              </span>
              <span className="tabular text-right text-fg-muted">{b.uniques.length}</span>
              <span className="flex justify-end gap-1">
                {b.chase && <Badge tone="info">Chase</Badge>}
                <Badge tone={TONE[b.tier]}>{TIER_LABEL[b.tier]}</Badge>
              </span>
            </div>
          )}
        />
      )}
    </Panel>
  );
}

// ---------- filter ----------

function FilterTab({ text, incomplete }: { text: string; incomplete: boolean }) {
  const notify = useToast();
  return (
    <Panel
      title="Loot filter block"
      actions={
        <Button
          size="sm"
          icon="copy"
          onClick={() =>
            navigator.clipboard
              .writeText(text)
              .then(() => notify("success", "Filter block copied", "Paste it above the first rule of your .filter file."))
              .catch(() => notify("warning", "Couldn't copy to the clipboard"))
          }
        >
          Copy
        </Button>
      }
    >
      <div className={cn("mb-3 flex gap-2 text-xs", incomplete ? "text-warning" : "text-fg-muted")}>
        <Icon name={incomplete ? "warning" : "info"} size={14} className="mt-px shrink-0" />
        {incomplete
          ? "Some categories are still loading — the block will be missing their items."
          : "Show-only rules for Top, Valuable and Pick up. Nothing is hidden: everything else falls through to your own filter. Prices change — regenerate regularly."}
      </div>
      <textarea readOnly value={text} spellCheck={false} aria-label="Loot filter text" className="well h-[440px] w-full resize-none rounded-md p-3 font-mono text-xs leading-5 text-fg" />
    </Panel>
  );
}
