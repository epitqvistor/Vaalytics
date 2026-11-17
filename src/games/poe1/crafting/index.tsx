/**
 * PoE 1 crafting calculator: mod pool with real game weights (RePoE), target
 * modifiers, and the expected cost of each method with live poe.ninja prices.
 * Spec: docs/modules/crafting.md
 */
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLeague } from "@/core/market/LeagueContext";
import type { SectionProps } from "@/core/game-context/sections";
import { Badge, Button, EmptyState, IconButton, Input, PageHeader, SegmentedControl, Select, Spinner, useToast } from "@/shared/components";
import { variants } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import type { ParsedItem } from "@/shared/item-parser/types";
import { cn } from "@/shared/utilities/cn";
import { FreshnessBar, VirtualRows } from "@/shared/views/market-ui";
import { EmulatorPanel } from "./EmulatorPanel";
import { usePrices, useComparison, useCraftingData, useMonteCarlo } from "./hooks";
import { MonteCarloPanel } from "./MonteCarloPanel";
import { NextStepsPanel } from "./NextStepsPanel";
import type { EmuItem } from "./emulator";
import type { MethodResult } from "./methods";
import { emuFromPaste, specFromText } from "./paste";
import { families, type CraftingIndex, type FamilyRow, type Pool } from "./pool";
import { INFLUENCES, type BaseDef, type Gen, type Goal, type Influence, type ItemSpec, type ModDef, type Target } from "./types";

export default function CraftingSection(_props: SectionProps) {
  const { idx, res, error, loading, reload } = useCraftingData();
  if (!idx || !res) {
    return (
      <div className="mx-auto max-w-[1380px]">
        <PageHeader title="Crafting" />
        <div className="panel rounded-xl">
          {error ? (
            <EmptyState icon="error" title="Couldn't load crafting data" body={error} action={<Button onClick={reload}>Try again</Button>} />
          ) : (
            <EmptyState
              icon="crafting"
              loading={loading}
              title="Loading crafting data"
              body="The first time, Vaalytics downloads the game's modifier data from RePoE (about 30 MB, then cached and checked once a day)."
            />
          )}
        </div>
      </div>
    );
  }
  return <Workspace idx={idx} staleError={res.staleError} checkedAt={res.data.checkedAt} />;
}

// ---------- helpers ----------

const fmtNum = (n: number, digits = 1) =>
  n >= 1000 ? Math.round(n).toLocaleString("en-US") : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(digits) : n.toFixed(Math.max(digits, 2));

function Cost({ chaos, divine, className }: { chaos: number | null; divine: number | null; className?: string }) {
  if (chaos === null || !Number.isFinite(chaos)) return <span className={cn("text-fg-subtle", className)}>no price</span>;
  return (
    <span className={cn("font-mono tabular", className)}>
      {fmtNum(chaos)}c{divine && chaos >= divine ? <span className="text-fg-subtle"> · {fmtNum(chaos / divine, 2)} div</span> : null}
    </span>
  );
}

const chanceText = (p: number) => (p <= 0 ? "—" : p >= 0.01 ? `${(p * 100).toFixed(p >= 0.1 ? 1 : 2)}%` : `1 in ${Math.round(1 / p).toLocaleString("en-US")}`);

/** Classes that can have Searing Exarch / Eater of Worlds implicits. */
const ELDRITCH_CLASSES = ["Body Armour", "Helmet", "Gloves", "Boots"];
/** Implicit tiers by rank; equal tiers → no dominance. */
const ELDRITCH_TIERS = ["None", "Lesser", "Greater", "Grand", "Exceptional"];

const firstLine = (t: string) => t.split("\n").join(", ");

const defaultBase = (bases: BaseDef[]) => [...bases].sort((a, b) => b.dropLevel - a.dropLevel)[0];

// ---------- workspace ----------

function Workspace({ idx, staleError, checkedAt }: { idx: CraftingIndex; staleError: string | null; checkedAt: number }) {
  const notify = useToast();
  const { league } = useLeague();
  const { prices, snapshots } = usePrices(league);
  const divine = prices["Divine Orb"] ?? null;

  const [classId, setClassId] = useState("Ring");
  const basesOfClass = useMemo(() => idx.data.bases.filter((b) => b.itemClass === classId), [idx, classId]);
  const [baseId, setBaseId] = useState(() => defaultBase(idx.data.bases.filter((b) => b.itemClass === "Ring"))?.id ?? idx.data.bases[0]!.id);
  const base = idx.data.bases.find((b) => b.id === baseId) ?? basesOfClass[0]!;
  const [ilvl, setIlvl] = useState(86);
  const [influences, setInfluences] = useState<Influence[]>([]);
  const [exarch, setExarch] = useState(0);
  const [eater, setEater] = useState(0);
  const [emuItem, setEmuItem] = useState<EmuItem | null>(null);
  const [fixed, setFixed] = useState<ModDef[]>([]);
  const [pasted, setPasted] = useState<ParsedItem | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [mode, setMode] = useState<"all" | "any" | "count">("all");
  const [count, setCount] = useState(2);

  const spec: ItemSpec = useMemo(() => ({ base, ilvl, influences, fixed }), [base, ilvl, influences, fixed]);
  const pool = useMemo(() => idx.pool(spec), [idx, spec]);
  const goal: Goal = useMemo(
    () => ({ targets, need: mode === "all" ? targets.length : mode === "any" ? 1 : Math.min(count, targets.length) }),
    [targets, mode, count],
  );
  const input = useMemo(() => (targets.length ? { spec, goal, prices } : null), [spec, goal, prices, targets.length]);
  const { results, busy, error } = useComparison(idx, input);
  const mc = useMonteCarlo(idx, input);

  const icons = useMemo(() => {
    const out: Record<string, string> = {};
    for (const snap of Object.values(snapshots)) for (const row of snap.items) if (row.icon && !(row.name in out)) out[row.name] = row.icon;
    return out;
  }, [snapshots]);

  // Emulator start: the pasted item (fractured + recognised mods), else a normal base.
  const emuStart = useMemo(() => {
    if (!pasted) return { item: { rarity: "normal" as const, mods: [] }, implicits: null, dropped: [] as string[], unknown: [] as string[] };
    const r = emuFromPaste(idx, spec, pasted);
    return { ...r, implicits: pasted.mods.filter((m) => m.kind === "implicit").map((m) => m.text) };
  }, [idx, spec, pasted]);

  const changeItem = () => {
    setPasted(null);
    setWarnings([]);
  };
  const resetAll = () => {
    changeItem();
    setFixed([]);
    setInfluences([]);
    setExarch(0);
    setEater(0);
    setTargets([]);
  };

  const applyText = useCallback(
    (text: string) => {
      const r = specFromText(idx, text);
      if ("error" in r) return notify("warning", "Couldn't read that item", r.error);
      setClassId(r.spec.base.itemClass);
      setBaseId(r.spec.base.id);
      setIlvl(r.spec.ilvl);
      setInfluences(r.spec.influences);
      setFixed(r.spec.fixed);
      setPasted(r.item);
      setWarnings(r.warnings);
      // Targets that no longer fit the base are dropped.
      const next = idx.pool(r.spec);
      setTargets((ts) => ts.filter((t) => next.mods.some((m) => m.mod.family === t.family && m.mod.gen === t.gen)));
      notify("success", "Item loaded", `${r.spec.base.name}, item level ${r.spec.ilvl}`);
    },
    [idx, notify],
  );

  // Ctrl+V anywhere in the section (not while typing in a field).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const text = e.clipboardData?.getData("text/plain");
      if (text && /^Item Class:|^Rarity:/m.test(text)) {
        e.preventDefault();
        applyText(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [applyText]);

  const pasteButton = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return notify("info", "Clipboard is empty", "Copy an item in game with Ctrl+C first.");
      applyText(text);
    } catch {
      notify("info", "Press Ctrl+V", "Copy the item in game with Ctrl+C, then press Ctrl+V here.");
    }
  };

  const eldritchAllowed = ELDRITCH_CLASSES.includes(base.itemClass);
  const dominance: Gen | null = !eldritchAllowed || exarch === eater ? null : exarch > eater ? "prefix" : "suffix";

  const toggleInfluence = (inf: Influence) => {
    changeItem();
    setInfluences((cur) => (cur.includes(inf) ? cur.filter((i) => i !== inf) : cur.length >= 2 ? [cur[1]!, inf] : [...cur, inf]));
  };

  const best = results.find((r) => r.avgCost !== null) ?? results[0];

  return (
    <div className="mx-auto max-w-[1380px] space-y-3.5">
      <PageHeader
        title="Crafting"
        description="Odds from the game's modifier data (RePoE) · costs from live poe.ninja prices. Every result is an estimate."
        actions={
          <>
            <Button icon="copy" variant="secondary" onClick={pasteButton}>
              Paste item <span className="ml-1 text-fg-subtle">Ctrl+V</span>
            </Button>
            <Button variant="ghost" icon="refresh" onClick={resetAll}>
              Reset
            </Button>
          </>
        }
      />

      <FreshnessBar
        snapshot={snapshots.currency ?? null}
        extra={
          <span className="text-fg-subtle">
            {divine ? <>1 div = <span className="font-mono tabular text-fg-muted">{fmtNum(divine)}c</span> · </> : null}
            Mod data checked {new Date(checkedAt * 1000).toLocaleDateString()}
            {staleError && <span className="text-warning"> · couldn't refresh ({staleError})</span>}
          </span>
        }
      />

      {/* Item configuration + summary */}
      <section className="panel flex flex-wrap items-end gap-3 rounded-xl p-3.5">
        <Select
          label="Item class"
          size="sm"
          value={classId}
          onChange={(c) => {
            changeItem();
            setFixed([]);
            setTargets([]);
            setClassId(c);
            setBaseId(defaultBase(idx.data.bases.filter((b) => b.itemClass === c))!.id);
          }}
          options={idx.data.classes.filter((c) => idx.data.bases.some((b) => b.itemClass === c.id)).map((c) => ({ value: c.id, label: c.name }))}
          className="w-44"
        />
        <Select
          label="Base"
          size="sm"
          value={base.id}
          onChange={(id) => {
            changeItem();
            setBaseId(id);
          }}
          options={basesOfClass.map((b) => ({
            value: b.id,
            label: basesOfClass.filter((x) => x.name === b.name).length > 1 && b.implicits[0] ? `${b.name} (${firstLine(b.implicits[0])})` : b.name,
          }))}
          className="w-64"
        />
        <Input
          label="Item level"
          size="sm"
          type="number"
          min={1}
          max={100}
          value={ilvl}
          onChange={(e) => {
            changeItem();
            setIlvl(Math.max(1, Math.min(100, Number(e.target.value) || 1)));
          }}
          containerClassName="w-24"
          className="font-mono"
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Influence (max 2)</span>
          <div className="flex flex-wrap gap-1">
            {INFLUENCES.map((inf) => (
              <button
                key={inf}
                type="button"
                aria-pressed={influences.includes(inf)}
                onClick={() => toggleInfluence(inf)}
                className={cn(
                  "h-7 rounded-md border px-2 text-xs transition-colors",
                  influences.includes(inf) ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-fg-muted hover:bg-glass-hover hover:text-fg",
                )}
              >
                {inf}
              </button>
            ))}
          </div>
        </div>

        {eldritchAllowed && (
          <>
            <Select
              label="Searing Exarch"
              size="sm"
              value={String(exarch)}
              onChange={(v) => setExarch(Number(v))}
              options={ELDRITCH_TIERS.map((t, i) => ({ value: String(i), label: t }))}
              className="w-32"
            />
            <Select
              label="Eater of Worlds"
              size="sm"
              value={String(eater)}
              onChange={(v) => setEater(Number(v))}
              options={ELDRITCH_TIERS.map((t, i) => ({ value: String(i), label: t }))}
              className="w-32"
            />
          </>
        )}
        <div className="ml-auto flex min-w-60 items-center gap-4 rounded-lg border border-line bg-bg-2/80 px-3.5 py-2">
          {best ? (
            <>
              <div>
                <p className="text-2xs tracking-wide text-fg-subtle uppercase">Best: {best.label}</p>
                <Cost chaos={best.avgCost} divine={divine} className="text-base text-fg" />
              </div>
              <div className="text-xs text-fg-muted">
                <p>
                  Chance <span className="font-mono tabular text-fg">{chanceText(best.chance)}</span>
                </p>
                {best.costAt && (
                  <p className="text-fg-subtle">
                    90%: <Cost chaos={best.costAt.p90} divine={divine} />
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-fg-subtle">{targets.length ? (busy ? "Calculating…" : "No method can reach these targets.") : "Pick target modifiers to compare methods."}</p>
          )}
        </div>
      </section>

      {(warnings.length > 0 || emuStart.dropped.length > 0 || emuStart.unknown.length > 0) && (
        <div className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs text-fg-muted">
          <Icon name="warning" size={14} className="mt-px shrink-0 text-warning" />
          <ul className="space-y-0.5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {emuStart.unknown.length > 0 && (
              <li>Kept as unknown modifiers (they hold their prefix/suffix slot but aren't in the game data): {emuStart.unknown.map((t) => t.replace(/\n/g, " / ")).join("; ")}</li>
            )}
            {emuStart.dropped.length > 0 && (
              <li>
                Not recognised and left out: {emuStart.dropped.join("; ")}. Copy the item with <span className="font-mono">Ctrl+Alt+C</span> so Vaalytics
                knows their prefix/suffix and keeps their slots.
              </li>
            )}
          </ul>
        </div>
      )}

      <section className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
        <div className="flex min-h-0 flex-col gap-3.5 lg:col-span-4">
          <TargetsPanel
            pool={pool}
            targets={targets}
            setTargets={setTargets}
            mode={mode}
            setMode={setMode}
            count={count}
            setCount={setCount}
          />
          <PoolPanel pool={pool} targets={targets} onAdd={(t) => setTargets((ts) => [...ts, t])} />
        </div>

        <div className="lg:col-span-4">
          <EmulatorPanel
            idx={idx}
            spec={spec}
            start={emuStart.item}
            implicits={emuStart.implicits}
            goal={goal}
            prices={prices}
            icons={icons}
            divine={divine}
            dominance={dominance}
            eldritchAllowed={eldritchAllowed}
            onItemChange={setEmuItem}
          />
        </div>

        <div className="flex flex-col gap-3.5 lg:col-span-4">
          <MethodsPanel results={results} busy={busy} error={error} divine={divine} hasTargets={targets.length > 0} />
          {results.length > 0 && (
            <MonteCarloPanel methods={results} state={mc.state} onRun={(method) => mc.run({ spec, goal, method, prices })} onCancel={mc.cancel} divine={divine} />
          )}
          <NextStepsPanel idx={idx} spec={spec} item={emuItem} goal={goal} prices={prices} dominance={dominance} divine={divine} />
          <p className="px-1 text-2xs leading-relaxed text-fg-subtle">
            Not modelled: Harvest “more/less likely” reforges, Bestiary crafts, “1/2 modifiers cannot be changed” and multi-mod.
          </p>
        </div>
      </section>
    </div>
  );
}

// ---------- targets ----------

function TargetsPanel({
  pool,
  targets,
  setTargets,
  mode,
  setMode,
  count,
  setCount,
}: {
  pool: Pool;
  targets: Target[];
  setTargets: (f: (t: Target[]) => Target[]) => void;
  mode: "all" | "any" | "count";
  setMode: (m: "all" | "any" | "count") => void;
  count: number;
  setCount: (n: number) => void;
}) {
  const rows = useMemo(() => families(pool), [pool]);
  return (
    <section className="panel rounded-xl">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <h2 className="text-sm font-semibold text-fg">Target modifiers</h2>
        {targets.length > 1 && (
          <SegmentedControl
            label="How many targets must hit"
            size="sm"
            value={mode}
            onChange={setMode}
            segments={[
              { value: "all", label: "All" },
              { value: "any", label: "Any" },
              { value: "count", label: "At least" },
            ]}
          />
        )}
      </header>
      {targets.length === 0 ? (
        <p className="px-3.5 py-4 text-xs text-fg-subtle">Add modifiers from the pool below. Choose the worst tier you'd accept.</p>
      ) : (
        <ul className="divide-y divide-line">
          <AnimatePresence initial={false}>
            {targets.map((t, i) => {
              const row = rows.find((r) => r.family === t.family && r.gen === t.gen);
              return (
                <motion.li key={`${t.gen}:${t.family}`} variants={variants.rise} initial="hidden" animate="visible" exit="exit" className="flex items-center gap-2 px-3.5 py-2">
                  <GenTag gen={t.gen} />
                  <span className="min-w-0 flex-1 text-xs leading-snug text-fg">{row ? firstLine(row.best.mod.text) : t.family}</span>
                  {row ? (
                    <Select
                      label="Minimum tier"
                      hideLabel
                      size="sm"
                      value={String(t.maxTier)}
                      onChange={(v) => setTargets((ts) => ts.map((x, j) => (j === i ? { ...x, maxTier: Number(v) } : x)))}
                      options={row.tiers.map((pm) => ({ value: String(pm.tier), label: `T${pm.tier}+ · ${firstLine(pm.mod.text).replace(/^.*?(\(.*?\)).*$/, "$1")}` }))}
                      className="w-36"
                    />
                  ) : (
                    <Badge tone="warning">can't roll</Badge>
                  )}
                  <IconButton icon="close" label="Remove target" size="sm" onClick={() => setTargets((ts) => ts.filter((_, j) => j !== i))} />
                </motion.li>
              );
            })}
          </AnimatePresence>
          {mode === "count" && targets.length > 1 && (
            <li className="flex items-center gap-2 px-3.5 py-2 text-xs text-fg-muted">
              At least
              <Select
                label="Targets needed"
                hideLabel
                size="sm"
                value={String(Math.min(count, targets.length))}
                onChange={(v) => setCount(Number(v))}
                options={targets.map((_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                className="w-16"
              />
              of {targets.length}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function GenTag({ gen }: { gen: Gen }) {
  return (
    <span
      className={cn(
        "w-5 shrink-0 rounded border text-center font-mono text-[10px] leading-4",
        gen === "prefix" ? "border-info/40 text-info" : "border-accent/40 text-accent-2",
      )}
      title={gen === "prefix" ? "Prefix" : "Suffix"}
    >
      {gen === "prefix" ? "P" : "S"}
    </span>
  );
}

// ---------- pool ----------

function PoolPanel({ pool, targets, onAdd }: { pool: Pool; targets: Target[]; onAdd: (t: Target) => void }) {
  const [query, setQuery] = useState("");
  const [gen, setGen] = useState<"all" | Gen>("all");
  const rows = useMemo(() => families(pool), [pool]);
  const total = useMemo(() => pool.mods.reduce((s, m) => s + m.weight, 0), [pool]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (gen === "all" || r.gen === gen) &&
        (!q || r.best.mod.text.toLowerCase().includes(q) || r.tiers.some((t) => t.mod.tags.some((tag) => tag.includes(q)))),
    );
  }, [rows, query, gen]);
  const picked = (r: FamilyRow) => targets.some((t) => t.family === r.family && t.gen === r.gen);

  return (
    <section className="panel flex h-[520px] min-h-0 flex-col rounded-xl">
      <header className="space-y-2 border-b border-line px-3.5 py-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Modifier pool</h2>
          <span className="text-2xs text-fg-subtle">
            {pool.mods.length} mods · {rows.length} groups
          </span>
        </div>
        <div className="flex gap-2">
          <Input size="sm" icon="search" placeholder="Search mods or tags (life, speed, gem…)" value={query} onChange={(e) => setQuery(e.target.value)} containerClassName="flex-1" aria-label="Search modifiers" />
          <SegmentedControl
            label="Prefix or suffix"
            size="sm"
            value={gen}
            onChange={setGen}
            segments={[
              { value: "all", label: "All" },
              { value: "prefix", label: "P" },
              { value: "suffix", label: "S" },
            ]}
          />
        </div>
      </header>
      <div className="flex px-3.5 py-1.5 text-2xs tracking-wide text-fg-subtle uppercase">
        <span className="flex-1">Modifier (best tier)</span>
        <span className="w-16 text-right">Weight</span>
        <span className="w-14 text-right">Roll %</span>
        <span className="w-8" />
      </div>
      {shown.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-xs text-fg-subtle">No modifiers match.</p>
      ) : (
        <VirtualRows
          rows={shown}
          rowHeight={36}
          getKey={(r) => `${r.gen}:${r.family}`}
          className="min-h-0 flex-1"
          renderRow={(r) => (
            <div className="flex h-full items-center gap-2 border-t border-line/60 px-3.5 text-xs">
              <GenTag gen={r.gen} />
              <span className="min-w-0 flex-1 truncate text-fg" title={r.tiers.map((t) => `T${t.tier} (ilvl ${t.mod.level}): ${firstLine(t.mod.text)}`).join("\n")}>
                {firstLine(r.best.mod.text)}
                <span className="ml-1.5 text-fg-subtle">T{r.best.tier}</span>
              </span>
              <span className="w-16 text-right font-mono tabular text-fg-muted">{r.weight.toLocaleString("en-US")}</span>
              <span className="w-14 text-right font-mono tabular text-fg-muted">{((r.weight / total) * 100).toFixed(2)}</span>
              <span className="w-8 text-right">
                {picked(r) ? (
                  <Icon name="check" size={14} className="ml-auto text-success" />
                ) : (
                  <IconButton icon="plus" label="Add as target" size="sm" onClick={() => onAdd({ family: r.family, gen: r.gen, maxTier: r.best.tier })} />
                )}
              </span>
            </div>
          )}
        />
      )}
    </section>
  );
}

// ---------- methods ----------

function MethodsPanel({ results, busy, error, divine, hasTargets }: { results: MethodResult[]; busy: boolean; error: string | null; divine: number | null; hasTargets: boolean }) {
  const bestId = results.find((r) => r.avgCost !== null)?.id;
  return (
    <section className="panel flex flex-col rounded-xl">
      <header className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <h2 className="text-sm font-semibold text-fg">Cheapest methods</h2>
        {busy && <Spinner size={14} className="text-fg-subtle" />}
      </header>
      {error ? (
        <EmptyState icon="error" title="Calculation failed" body={error} />
      ) : !hasTargets ? (
        <EmptyState icon="crafting" title="No targets yet" body="Add the modifiers you want; methods are ranked by expected cost." />
      ) : results.length === 0 ? (
        busy ? <EmptyState icon="crafting" loading title="Calculating…" /> : <EmptyState icon="warning" title="Not reachable" body="No supported method can roll this combination on this base and item level." />
      ) : (
        <ul className={cn("divide-y divide-line transition-opacity", busy && "opacity-60")}>
          {results.map((m) => (
            <MethodRow key={m.id} m={m} best={m.id === bestId} divine={divine} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MethodRow({ m, best, divine }: { m: MethodResult; best: boolean; divine: number | null }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-3.5 py-2.5">
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-fg">{m.label}</p>
          {m.detail && <p className="text-2xs text-fg-subtle">{m.detail}</p>}
          {best && (
            <Badge tone="success" className="mt-1">
              Best value
            </Badge>
          )}
        </div>
        <div className="shrink-0 text-right">
          <Cost chaos={m.avgCost} divine={divine} className="text-sm text-fg" />
          <p className="text-2xs text-fg-subtle">
            chance <span className="font-mono tabular">{chanceText(m.chance)}</span>
          </p>
        </div>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={14} className="mt-1 text-fg-subtle" />
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-md bg-bg-2/80 px-3 py-2 text-xs text-fg-muted">
          <dl className="grid grid-cols-3 gap-2">
            {(["p50", "p63", "p90"] as const).map((k) => (
              <div key={k}>
                <dt className="text-2xs text-fg-subtle">{k.slice(1)}% chance by</dt>
                <dd>{m.costAt ? <Cost chaos={m.costAt[k]} divine={divine} /> : "—"}</dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="text-2xs text-fg-subtle">Per try {m.costPerTry !== null && <Cost chaos={m.costPerTry} divine={null} />}</p>
            <ul>
              {m.components.map((c) => (
                <li key={c.name} className="flex justify-between">
                  <span>
                    {c.qty}× {c.name}
                  </span>
                  <span className={cn("font-mono tabular", c.price === null && "text-warning")}>{c.price === null ? "no price" : `${fmtNum(c.price)}c`}</span>
                </li>
              ))}
            </ul>
          </div>
          {m.notes.map((n) => (
            <p key={n} className="text-2xs text-fg-subtle">
              {n}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}
