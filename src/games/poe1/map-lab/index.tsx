/**
 * Map Lab (PoE 1): paste a map (Ctrl+V), see its modifiers grouped by your own
 * risk rules and its reward properties; compare the last pasted maps.
 * Spec: docs/modules/map-lab.md
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { Badge, type BadgeTone, Button, EmptyState, IconButton, Kbd, PageHeader, Panel, ProvenanceTag, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { ParsedItem } from "@/shared/item-parser/types";
import { cn } from "@/shared/utilities/cn";
import { parsePoe1Item } from "../parser";
import { DEFAULT_RULES, isMap, isRules, mapReport, SEVERITY_LABEL, setRule, type Rules, type Severity } from "./maplab";

const TONE: Record<Severity, BadgeTone> = { breaking: "danger", danger: "warning", ok: "success" };
const NO_RULES: Rules = {};

// Recently pasted maps: kept while the app runs (survives switching sections).
let recent: { id: number; item: ParsedItem }[] = [];
let seq = 0;
const subs = new Set<() => void>();
const recentStore = {
  get: () => recent,
  sub: (f: () => void) => (subs.add(f), () => subs.delete(f)),
  push(item: ParsedItem) {
    recent = [{ id: ++seq, item }, ...recent].slice(0, 12);
    subs.forEach((f) => f());
  },
  clear() {
    recent = [];
    subs.forEach((f) => f());
  },
};

export default function MapLab(_props: SectionProps) {
  const notify = useToast();
  const [rules, setRules] = useGameSetting<Rules>("poe1", "maplab.rules", NO_RULES, isRules);
  const maps = useSyncExternalStore(recentStore.sub, recentStore.get);
  const [selected, setSelected] = useState<number | null>(null);
  const current = maps.find((m) => m.id === selected) ?? maps[0];

  const load = useCallback(
    (text: string) => {
      const r = parsePoe1Item(text);
      if (!r.ok) return notify("warning", "Couldn't read that item", r.error);
      if (!isMap(r.item)) return notify("info", "Not a map", `${r.item.baseType} is a ${r.item.itemClass.toLowerCase()} — Map Lab reads maps.`);
      recentStore.push(r.item);
      setSelected(null);
    },
    [notify],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const text = e.clipboardData?.getData("text/plain");
      if (text && /^Item Class:|^Rarity:/m.test(text)) {
        e.preventDefault();
        load(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [load]);

  const report = current ? mapReport(current.item, rules) : null;

  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader
        title="Map Lab"
        description="Copy a map in game (Ctrl+C) and press Ctrl+V here. Mods are grouped by your own rules; rewards are shown as the map lists them."
        actions={
          maps.length > 0 ? (
            <Button variant="ghost" icon="refresh" onClick={() => (recentStore.clear(), setSelected(null))}>
              Clear maps
            </Button>
          ) : undefined
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {report ? (
            <MapPanel report={report} onRule={(key, s) => setRules(setRule(rules, key, s))} />
          ) : (
            <Panel>
              <EmptyState
                icon="map"
                title="Paste a map"
                body={
                  <>
                    Hover a map in game, press <Kbd>Ctrl</Kbd> <Kbd>C</Kbd>, then press <Kbd>Ctrl</Kbd> <Kbd>V</Kbd> here. Use Ctrl+Alt+C to also see prefixes and suffixes.
                  </>
                }
              />
            </Panel>
          )}
          {maps.length > 1 && <RecentPanel maps={maps} rules={rules} selected={current?.id ?? null} onSelect={setSelected} />}
        </div>
        <RulesPanel rules={rules} onChange={setRules} />
      </div>
    </div>
  );
}

function MapPanel({ report: r, onRule }: { report: ReturnType<typeof mapReport>; onRule: (key: string, s: Severity) => void }) {
  return (
    <Panel
      flush
      title={
        <span className="flex items-center gap-2">
          {r.name ?? r.base}
          {r.name && <span className="font-normal text-fg-muted">{r.base}</span>}
        </span>
      }
      actions={<ProvenanceTag provenance={{ kind: "user", source: "Pasted map", at: null, note: "Severities are your rules (or marked defaults)." }} />}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 border-b border-line px-4 py-3",
          r.verdict === "breaking" ? "bg-danger-soft" : r.verdict === "danger" ? "bg-warning-soft" : "bg-success-soft",
        )}
      >
        <Icon name={r.verdict === "breaking" ? "error" : r.verdict === "danger" ? "warning" : "success"} size={18} className={r.verdict === "breaking" ? "text-danger" : r.verdict === "danger" ? "text-warning" : "text-success"} />
        <span className="text-sm font-semibold text-fg">
          {r.verdict === "breaking" ? "Don't run with these rules" : r.verdict === "danger" ? "Runnable — watch out" : "Fine by your rules"}
        </span>
        <span className="text-xs text-fg-muted">
          {r.counts.breaking} can't run · {r.counts.danger} dangerous · {r.counts.ok} fine
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {r.tier != null && <Badge tone="neutral">Tier {r.tier}</Badge>}
          {r.corrupted && <Badge tone="danger">Corrupted</Badge>}
        </span>
      </div>
      {r.rewards.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 border-b border-line px-4 py-3 text-sm sm:grid-cols-4">
          {r.rewards.map((p) => (
            <div key={p.name}>
              <dt className="text-2xs text-fg-subtle">{p.name}</dt>
              <dd className="tabular font-semibold text-fg">{p.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {r.mods.length === 0 ? (
        <p className="px-4 py-4 text-xs text-fg-subtle">No modifiers.</p>
      ) : (
        <ul className="divide-y divide-line">
          {r.mods.map((m, i) => (
            <li key={`${m.key}:${i}`} className="flex items-center gap-3 px-4 py-2">
              <span className={cn("h-7 w-1 shrink-0 rounded-full", m.severity === "breaking" ? "bg-danger" : m.severity === "danger" ? "bg-warning" : "bg-white/10")} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-fg">{m.text}</span>
                <span className="block text-2xs text-fg-subtle">
                  {[m.generation, m.source === "rule" ? "your rule" : m.source === "default" ? `default: ${m.why}` : null].filter(Boolean).join(" · ") || " "}
                </span>
              </span>
              <SeverityPicker value={m.severity} onChange={(s) => onRule(m.key, s)} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SeverityPicker({ value, onChange }: { value: Severity; onChange: (s: Severity) => void }) {
  return (
    <div role="radiogroup" aria-label="Severity" className="well inline-flex shrink-0 rounded-md p-0.5">
      {(["breaking", "danger", "ok"] as const).map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onChange(s)}
          className={cn(
            "h-6 rounded-[5px] px-2 text-2xs font-medium transition-colors",
            value === s ? (s === "breaking" ? "bg-danger/25 text-danger" : s === "danger" ? "bg-warning/20 text-warning" : "bg-success/20 text-success") : "text-fg-subtle hover:text-fg",
          )}
        >
          {SEVERITY_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

function RecentPanel({ maps, rules, selected, onSelect }: { maps: { id: number; item: ParsedItem }[]; rules: Rules; selected: number | null; onSelect: (id: number) => void }) {
  const rows = useMemo(() => maps.map((m) => ({ id: m.id, r: mapReport(m.item, rules) })), [maps, rules]);
  const prop = (r: ReturnType<typeof mapReport>, name: string) => r.rewards.find((p) => p.name === name)?.value ?? "—";
  return (
    <Panel flush title="Pasted maps" actions={<span>Kept until you close Vaalytics</span>}>
      <div role="table" className="text-sm">
        <div role="row" className="grid h-9 grid-cols-[minmax(0,1fr)_50px_70px_70px_80px_110px] items-center gap-3 border-b border-line bg-bg-2/95 px-4 text-xs text-fg-subtle">
          <span>Map</span>
          <span className="text-right">Tier</span>
          <span className="text-right">Quantity</span>
          <span className="text-right">Rarity</span>
          <span className="text-right">Pack size</span>
          <span className="text-right">Verdict</span>
        </div>
        {rows.map(({ id, r }) => (
          <button
            key={id}
            type="button"
            role="row"
            onClick={() => onSelect(id)}
            className={cn(
              "grid h-10 w-full grid-cols-[minmax(0,1fr)_50px_70px_70px_80px_110px] items-center gap-3 border-b border-line px-4 text-left transition-colors last:border-b-0",
              id === selected ? "bg-accent-soft shadow-[inset_2px_0_0_var(--color-accent)]" : "hover:bg-white/[0.025]",
            )}
          >
            <span className="truncate text-fg">{r.name ? `${r.name} · ${r.base}` : r.base}</span>
            <span className="tabular text-right text-fg-muted">{r.tier ?? "—"}</span>
            <span className="tabular text-right">{prop(r, "Item Quantity")}</span>
            <span className="tabular text-right text-fg-muted">{prop(r, "Item Rarity")}</span>
            <span className="tabular text-right text-fg-muted">{prop(r, "Monster Pack Size")}</span>
            <span className="text-right">
              <Badge tone={TONE[r.verdict]}>{SEVERITY_LABEL[r.verdict]}</Badge>
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function RulesPanel({ rules, onChange }: { rules: Rules; onChange: (r: Rules) => void }) {
  const entries = Object.entries(rules).sort(([, a], [, b]) => (a === b ? 0 : a === "breaking" ? -1 : b === "breaking" ? 1 : a === "danger" ? -1 : 1));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Panel flush title="Your rules" actions={<span>{entries.length} saved · PoE 1</span>}>
        {entries.length === 0 ? (
          <p className="px-4 py-4 text-xs leading-relaxed text-fg-subtle">Mark any mod as Can't run, Dangerous or Fine on a pasted map — the rule applies to every map with that mod, whatever its roll.</p>
        ) : (
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {entries.map(([key, s]) => (
              <li key={key} className="flex items-center gap-2 px-4 py-2 text-sm">
                <Badge tone={TONE[s]}>{SEVERITY_LABEL[s]}</Badge>
                <span className="min-w-0 flex-1 truncate text-fg-muted" title={key}>
                  {key}
                </span>
                <IconButton
                  icon="close"
                  size="sm"
                  label={`Remove rule ${key}`}
                  onClick={() => {
                    const next = { ...rules };
                    delete next[key];
                    onChange(next);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Defaults">
        <p className="mb-2 text-xs text-fg-subtle">Starting suggestions until you set your own rule for a mod. # = any value.</p>
        <ul className="space-y-1.5 text-xs">
          {DEFAULT_RULES.map((d) => (
            <li key={d.why} className="flex items-center gap-2">
              <Badge tone={TONE[d.severity]}>{SEVERITY_LABEL[d.severity]}</Badge>
              <span className="text-fg-muted">{d.why}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
