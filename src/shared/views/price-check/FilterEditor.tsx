import { useState, type ReactNode } from "react";
import type { ParsedItem } from "@/shared/item-parser/types";
import { Button, Checkbox, Input, SegmentedControl, Select, Spinner } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { RANGE_PRESETS, STATUS_OPTIONS, type RangePreset, type SearchMode, type SearchOptions, type StatFilter, type Range } from "@/shared/trade/query";
import { cn } from "@/shared/utilities/cn";

export interface FilterEditorProps {
  item: ParsedItem;
  mode: SearchMode;
  onMode: (m: SearchMode) => void;
  stats: StatFilter[];
  onStat: (key: string, patch: Partial<StatFilter>) => void;
  onRange: (preset: RangePreset) => void;
  opts: SearchOptions;
  onOpts: (patch: Partial<SearchOptions>) => void;
  unmatched: { id: string; text: string }[];
  loading: boolean;
  dirty: boolean;
  hasResult: boolean;
  onSearch: () => void;
  indexState: "loading" | "ready" | string;
}

const MODES: { value: SearchMode; label: string }[] = [
  { value: "quick", label: "Quick" },
  { value: "advanced", label: "Advanced" },
  { value: "base", label: "Base type" },
];

export function FilterEditor(p: FilterEditorProps) {
  const { item, mode, stats } = p;
  const [showAll, setShowAll] = useState(false);
  const [range, setRange] = useState<RangePreset>("min10");
  const advanced = mode === "advanced";
  const enabled = stats.filter((s) => s.enabled);
  const visible = mode === "base" ? [] : advanced || showAll ? stats : enabled;
  const hidden = mode === "base" ? 0 : stats.length - visible.length;
  const byIdentity = stats.length === 0;

  return (
    <section aria-label="Search filters" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SegmentedControl label="Search mode" size="sm" value={mode} onChange={p.onMode} segments={MODES} />
        <span className="ml-auto text-2xs text-fg-subtle">{enabled.length} active</span>
      </div>

      {p.indexState === "loading" ? (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <Spinner size={12} /> Loading Trade stat data…
        </p>
      ) : p.indexState !== "ready" ? (
        <p className="text-xs text-danger">Trade stat data unavailable: {p.indexState}</p>
      ) : (
        <>
          {mode === "base" && <Note tone="muted">Modifiers are ignored in this mode.</Note>}
          {mode !== "base" && byIdentity && <Note tone="info">Searched by {item.rarity === "Unique" ? "name" : "base type"} — this item has no modifiers to compare.</Note>}

          {visible.length > 0 && (
            <ul className="max-h-[260px] divide-y divide-line overflow-y-auto rounded-md border border-line">
              {visible.map((s) => (
                <FilterRow key={s.key} filter={s} editable={advanced} onChange={(patch) => p.onStat(s.key, patch)} />
              ))}
            </ul>
          )}
          {!advanced && hidden > 0 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="self-start text-2xs text-fg-muted hover:text-fg">
              {showAll ? "Show selected only" : `+${hidden} more modifier${hidden === 1 ? "" : "s"}`}
            </button>
          )}
          {mode !== "base" && p.unmatched.length > 0 && (
            <Note tone="muted">
              Not searchable on Trade: {p.unmatched.map((u) => u.text).join("; ")}
            </Note>
          )}

          {item.rarity === "Gem" && (
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <RangeInput label="Gem level" value={p.opts.gemLevel} max={21} onChange={(r) => p.onOpts({ gemLevel: r })} />
              <RangeInput label="Quality" suffix="%" value={p.opts.gemQuality} max={23} onChange={(r) => p.onOpts({ gemQuality: r })} />
            </div>
          )}

          {advanced && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {stats.some((s) => s.value != null) && (
                <SegmentedControl
                  label="Roll range"
                  size="sm"
                  value={range}
                  onChange={(r) => (setRange(r), p.onRange(r))}
                  segments={RANGE_PRESETS}
                />
              )}
              <Input
                size="sm"
                aria-label="Minimum item level"
                placeholder="iLvl ≥"
                inputMode="numeric"
                value={p.opts.itemLevelMin ?? ""}
                onChange={(e) => p.onOpts({ itemLevelMin: e.target.value.trim() === "" ? null : Math.max(1, Math.min(100, Math.round(Number(e.target.value)) || 1)) })}
                containerClassName="w-20"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Select label="Listings" hideLabel size="sm" value={p.opts.status} onChange={(v) => p.onOpts({ status: v })} options={STATUS_OPTIONS[item.game]} className="w-44" />
            {(advanced || item.rarity === "Gem" || item.corrupted) && (
              <SegmentedControl
                label="Corrupted"
                size="sm"
                value={p.opts.corrupted}
                onChange={(v) => p.onOpts({ corrupted: v })}
                segments={[
                  { value: "any", label: "Any" },
                  { value: "yes", label: "Corrupted" },
                  { value: "no", label: "Clean" },
                ]}
              />
            )}
            <Button size="sm" variant={p.dirty ? "primary" : "secondary"} icon={p.hasResult ? "refresh" : "search"} className="ml-auto" loading={p.loading} onClick={p.onSearch}>
              {p.dirty || !p.hasResult ? "Search" : "Refresh"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Note({ tone, children }: { tone: "warning" | "info" | "muted"; children: ReactNode }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-xs", tone === "warning" ? "text-warning" : tone === "info" ? "text-fg-muted" : "text-fg-subtle")}>
      <Icon name={tone === "warning" ? "warning" : "info"} size={12} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function FilterRow({ filter: f, editable, onChange }: { filter: StatFilter; editable: boolean; onChange: (p: Partial<StatFilter>) => void }) {
  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return (
    <li className="px-2.5 py-1">
      <div className="flex items-center gap-2">
        <Checkbox
          className="min-w-0 flex-1"
          checked={f.enabled}
          onChange={(enabled) => onChange({ enabled })}
          label={
            <span className={cn("flex min-w-0 items-center gap-1.5 text-xs", f.enabled ? "text-fg" : "text-fg-muted")}>
              <span className="truncate" title={f.sources ? `${f.label}\n= ${f.sources.join("\n+ ")}` : f.label}>
                {f.label}
              </span>
              {f.source === "pseudo" && <span className="shrink-0 rounded-sm bg-info-soft px-1 text-2xs text-info">total</span>}
              {f.kind !== "explicit" && f.source === "mod" && <span className="shrink-0 text-2xs text-fg-subtle">{f.kind}</span>}
              {f.tier != null && <span className="shrink-0 font-mono text-2xs text-fg-subtle">T{f.tier}</span>}
            </span>
          }
        />
        {f.option != null ? (
          <span className="w-[6.5rem] shrink-0 text-right text-2xs text-fg-subtle">exact match</span>
        ) : editable ? (
          <>
            <Input size="sm" aria-label={`Minimum for ${f.label}`} placeholder="min" inputMode="decimal" value={f.min ?? ""} disabled={!f.enabled} onChange={(e) => onChange({ min: num(e.target.value) })} containerClassName="w-12 shrink-0" className="tabular text-right" />
            <Input size="sm" aria-label={`Maximum for ${f.label}`} placeholder="max" inputMode="decimal" value={f.max ?? ""} disabled={!f.enabled} onChange={(e) => onChange({ max: num(e.target.value) })} containerClassName="w-12 shrink-0" className="tabular text-right" />
          </>
        ) : (
          // Quick mode: the range as text; editing happens in Advanced.
          <span className={cn("tabular w-[6.5rem] shrink-0 text-right text-2xs", f.enabled ? "text-fg-muted" : "text-fg-subtle")}>{rangeText(f)}</span>
        )}
      </div>
      {f.sources && f.enabled && <div className="truncate pl-6 text-2xs text-fg-subtle">= {f.sources.join(" + ")}</div>}
    </li>
  );
}

function rangeText(f: StatFilter): string {
  if (!f.enabled) return f.value != null ? String(f.value) : "";
  if (f.min != null && f.max != null) return f.min === f.max ? `= ${f.min}` : `${f.min}–${f.max}`;
  if (f.min != null) return `≥ ${f.min}`;
  if (f.max != null) return `≤ ${f.max}`;
  return "any";
}

/** Min–max number pair; an empty field means no limit. */
function RangeInput({ label, value, onChange, max, suffix }: { label: string; value: Range; onChange: (r: Range) => void; max: number; suffix?: string }) {
  const parse = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.min(max, Math.round(Number(v)) || 0)));
  return (
    <div className="flex items-center gap-1.5 text-xs text-fg-muted">
      <span>{label}</span>
      <Input size="sm" type="number" min={0} max={max} placeholder="min" aria-label={`${label} min`} value={value.min ?? ""} onChange={(e) => onChange({ ...value, min: parse(e.target.value) })} suffix={suffix} containerClassName="w-16" />
      <span className="text-fg-subtle">–</span>
      <Input size="sm" type="number" min={0} max={max} placeholder="max" aria-label={`${label} max`} value={value.max ?? ""} onChange={(e) => onChange({ ...value, max: parse(e.target.value) })} suffix={suffix} containerClassName="w-16" />
    </div>
  );
}
