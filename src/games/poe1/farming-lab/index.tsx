/**
 * Farming Lab (PoE 1): record your own farming sessions — strategy, time, maps,
 * costs and loot priced with live poe.ninja prices at save time — and compare
 * strategies by your own results. Spec: docs/modules/farming-lab.md
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import { farmingDeleteSession, farmingSaveSession, farmingSessions, type MarketItemRow } from "@/core/ipc/commands";
import { useMarketOverviews } from "@/core/market/hooks";
import { useLeague } from "@/core/market/LeagueContext";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { Badge, Button, EmptyState, IconButton, Input, PageHeader, Panel, ProvenanceTag, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { formatRelative } from "@/shared/utilities/format";
import { Price } from "@/shared/views/common";
import { DisplayCurrencySelect, ItemIcon, LeagueSelect } from "@/shared/views/market-ui";
import { POE1_CONFIG } from "../config";
import { STACKABLE_CATEGORIES, UNIQUE_CATEGORIES } from "../loot-intelligence/loot";
import { compareStrategies, formatDuration, isSession, newId, toJson, totals, type FarmingSession, type Line, type SessionData } from "./farming";

const unit = POE1_CONFIG.baseUnit;
/** Categories loot and costs can be picked from (cache-first; no extra requests when already loaded). */
const PICK_CATEGORIES = [...STACKABLE_CATEGORIES.map((c) => c.id), "maps", ...UNIQUE_CATEGORIES];

/** The session being recorded; persisted so it survives switching sections and restarts. */
type Draft = {
  strategy: string;
  maps: number;
  /** Unix ms when the timer was (re)started; null while paused. */
  runningSince: number | null;
  /** Seconds recorded before the current run. */
  elapsedSecs: number;
  /** Unix s of the first start (session start time). */
  firstStart: number | null;
  data: SessionData;
};
const EMPTY: Draft = { strategy: "", maps: 0, runningSince: null, elapsedSecs: 0, firstStart: null, data: { costs: [], loot: [], notes: "" } };
const isDraft = (v: unknown): v is Draft => {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return typeof d.strategy === "string" && typeof d.maps === "number" && typeof d.elapsedSecs === "number" && isSession({ id: "d", strategy: "", durationSecs: 0, maps: 0, data: d.data });
};

export default function FarmingLab(_props: SectionProps) {
  const { league } = useLeague();
  const notify = useToast();
  const [draft, setDraft] = useGameSetting<Draft>("poe1", "farming.draft", EMPTY, isDraft);
  const [sessions, setSessions] = useState<FarmingSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!league) return;
    farmingSessions("poe1", league)
      .then((list) => {
        setSessions(list.filter(isSession) as unknown as FarmingSession[]);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [league]);
  useEffect(reload, [reload]);

  const snaps = useMarketOverviews("poe1", league, PICK_CATEGORIES);
  const strategies = useMemo(() => compareStrategies(sessions ?? []), [sessions]);

  const save = async (durationSecs: number) => {
    if (!league) return;
    const record = {
      id: newId(),
      league,
      strategy: draft.strategy.trim(),
      startedAt: draft.firstStart ?? Math.floor(Date.now() / 1000) - durationSecs,
      durationSecs,
      maps: draft.maps,
      data: toJson(draft.data),
      savedAt: 0,
    };
    try {
      await farmingSaveSession("poe1", record);
      setDraft({ ...EMPTY, strategy: draft.strategy });
      notify("success", "Session saved", `${record.strategy} · ${formatDuration(durationSecs)}`);
      reload();
    } catch (e) {
      notify("warning", "Couldn't save the session", String(e));
    }
  };

  const remove = async (s: FarmingSession) => {
    try {
      await farmingDeleteSession("poe1", s.id);
      reload();
    } catch (e) {
      notify("warning", "Couldn't delete", String(e));
    }
  };

  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader
        title="Farming Lab"
        description="Record your farming sessions and compare strategies by your own results."
        actions={
          <>
            <DisplayCurrencySelect />
            <LeagueSelect />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <SessionEditor draft={draft} setDraft={setDraft} snaps={snaps} onSave={save} strategies={strategies.map((s) => s.strategy)} />
        <div className="flex min-w-0 flex-col gap-5">
          <StrategiesPanel strategies={strategies} loading={sessions === null && !error} />
          <HistoryPanel sessions={sessions} error={error} onDelete={remove} />
        </div>
      </div>
    </div>
  );
}

// ---------- editor ----------

function useElapsed(d: Draft) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (d.runningSince === null) return;
    // Ticks only while a session is running and this view is open.
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [d.runningSince]);
  return d.elapsedSecs + (d.runningSince !== null ? Math.max(0, Math.floor((now - d.runningSince) / 1000)) : 0);
}

function SessionEditor({
  draft,
  setDraft,
  snaps,
  onSave,
  strategies,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  snaps: Record<string, import("@/core/ipc/commands").MarketSnapshot>;
  onSave: (durationSecs: number) => void;
  strategies: string[];
}) {
  const elapsed = useElapsed(draft);
  const [manualMin, setManualMin] = useState("");
  const running = draft.runningSince !== null;
  const duration = manualMin.trim() !== "" ? Math.max(0, Math.round(Number(manualMin) * 60) || 0) : elapsed;
  const t = totals({ durationSecs: duration, maps: draft.maps, data: draft.data });
  const canSave = draft.strategy.trim().length > 0 && duration > 0 && (draft.data.loot.length > 0 || draft.data.costs.length > 0);

  const start = () => setDraft({ ...draft, runningSince: Date.now(), firstStart: draft.firstStart ?? Math.floor(Date.now() / 1000) });
  const pause = () => setDraft({ ...draft, runningSince: null, elapsedSecs: elapsed });
  const setLines = (kind: "loot" | "costs", lines: Line[]) => setDraft({ ...draft, data: { ...draft.data, [kind]: lines } });

  return (
    <Panel
      title="Current session"
      actions={
        <ProvenanceTag provenance={{ kind: "user", source: "You", at: null, note: "Prices are fixed at the time each line is added." }} />
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input
            label="Strategy"
            placeholder="e.g. Essence + Harbinger, T16 Strand"
            value={draft.strategy}
            onChange={(e) => setDraft({ ...draft, strategy: e.target.value.slice(0, 80) })}
            list="farming-strategies"
          />
          <datalist id="farming-strategies">
            {strategies.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Maps run</span>
          <div className="flex items-center gap-1">
            <IconButton icon="chevronLeft" label="One map fewer" size="sm" variant="secondary" onClick={() => setDraft({ ...draft, maps: Math.max(0, draft.maps - 1) })} />
            <span className="tabular w-10 text-center font-display text-lg font-semibold text-fg">{draft.maps}</span>
            <IconButton icon="plus" label="One more map" size="sm" variant="secondary" onClick={() => setDraft({ ...draft, maps: draft.maps + 1 })} />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-line bg-bg-2/60 px-3 py-2.5">
        <span className={cn("tabular font-display text-2xl font-semibold", running ? "text-fg" : "text-fg-muted")}>{clock(elapsed)}</span>
        {running ? (
          <Button size="sm" onClick={pause}>
            Pause
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={start}>
            {elapsed > 0 ? "Resume" : "Start timer"}
          </Button>
        )}
        <span className="text-2xs text-fg-subtle">or</span>
        <Input size="sm" type="number" min={0} placeholder="minutes" aria-label="Duration in minutes" value={manualMin} onChange={(e) => setManualMin(e.target.value)} suffix="min" containerClassName="w-28" />
        <span className="text-2xs text-fg-subtle">{manualMin.trim() ? "Typed duration is used." : "Timer keeps running when you switch sections."}</span>
      </div>

      <LinesEditor title="Loot" lines={draft.data.loot} onChange={(l) => setLines("loot", l)} snaps={snaps} />
      <LinesEditor title="Costs" hint="Threads, map device, rolling…" lines={draft.data.costs} onChange={(l) => setLines("costs", l)} snaps={snaps} />

      <textarea
        value={draft.data.notes}
        onChange={(e) => setDraft({ ...draft, data: { ...draft.data, notes: e.target.value.slice(0, 2000) } })}
        placeholder="Notes (atlas setup, what dropped, what to change)"
        aria-label="Notes"
        className="well mt-4 h-16 w-full resize-none rounded-md p-2.5 text-xs text-fg placeholder:text-fg-subtle focus-visible:border-accent/55 focus-visible:outline-none"
      />

      <div className="mt-4 grid grid-cols-4 gap-3 border-t border-line pt-4">
        <Metric label="Loot" value={<Price amount={t.loot} unit={unit} />} />
        <Metric label="Costs" value={<Price amount={t.cost} unit={unit} />} />
        <Metric label="Profit / hour" value={t.perHour === null ? "—" : <Price amount={t.perHour} unit={unit} />} />
        <Metric label="Profit / map" value={t.perMap === null ? "—" : <Price amount={t.perMap} unit={unit} />} />
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => (setDraft({ ...EMPTY, strategy: draft.strategy }), setManualMin(""))}>
          Discard
        </Button>
        <Button
          variant="primary"
          icon="check"
          disabled={!canSave}
          onClick={() => {
            onSave(duration);
            setManualMin("");
          }}
        >
          Save session
        </Button>
      </div>
      {!canSave && <p className="mt-2 text-right text-2xs text-fg-subtle">Needs a strategy name, a duration and at least one loot or cost line.</p>}
    </Panel>
  );
}

const clock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-2xs text-fg-subtle">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-fg">{value}</p>
    </div>
  );
}

function LinesEditor({
  title,
  hint,
  lines,
  onChange,
  snaps,
}: {
  title: string;
  hint?: string;
  lines: Line[];
  onChange: (l: Line[]) => void;
  snaps: Record<string, import("@/core/ipc/commands").MarketSnapshot>;
}) {
  const [query, setQuery] = useState("");
  const [manualValue, setManualValue] = useState("");
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: { category: string; row: MarketItemRow; at: number | null }[] = [];
    for (const [category, snap] of Object.entries(snaps)) {
      for (const row of snap.items) {
        if (row.name.toLowerCase().includes(q)) out.push({ category, row, at: snap.fetchedAt ? snap.fetchedAt * 1000 : null });
      }
    }
    return out.sort((a, b) => Number(b.row.name.toLowerCase().startsWith(q)) - Number(a.row.name.toLowerCase().startsWith(q)) || b.row.value - a.row.value).slice(0, 6);
  }, [query, snaps]);

  const add = (l: Omit<Line, "id">) => {
    // Same market item again: add to its quantity.
    const same = l.source === "market" ? lines.find((x) => x.source === "market" && x.itemId === l.itemId && x.category === l.category) : undefined;
    onChange(same ? lines.map((x) => (x === same ? { ...x, qty: x.qty + l.qty } : x)) : [...lines, { ...l, id: newId() }]);
    setQuery("");
    setManualValue("");
  };

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {hint && <span className="text-2xs text-fg-subtle">{hint}</span>}
      </div>
      <div className="relative flex gap-2">
        <Input size="sm" icon="search" placeholder="Add from market prices, or type a name" value={query} onChange={(e) => setQuery(e.target.value)} containerClassName="flex-1" aria-label={`Add ${title.toLowerCase()}`} />
        <Input size="sm" type="number" min={0} placeholder="value" aria-label="Manual value in chaos" value={manualValue} onChange={(e) => setManualValue(e.target.value)} suffix={unit.short} containerClassName="w-28" />
        <Button
          size="sm"
          disabled={!query.trim() || manualValue.trim() === "" || !(Number(manualValue) >= 0)}
          onClick={() => add({ name: query.trim().slice(0, 80), qty: 1, unitPrice: Number(manualValue), source: "manual" })}
          title="Add with the value you typed"
        >
          Add manual
        </Button>
        {matches.length > 0 && (
          <ul className="glass-float absolute top-8 right-0 left-0 z-20 mt-1 rounded-lg p-1">
            {matches.map((m) => (
              <li key={`${m.category}:${m.row.itemId}`}>
                <button
                  type="button"
                  onClick={() => add({ name: m.row.name + (m.row.variant ? ` (${m.row.variant})` : ""), qty: 1, unitPrice: m.row.value, source: "market", category: m.category, itemId: m.row.itemId, pricedAt: m.at ?? undefined })}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg-muted hover:bg-white/[0.06] hover:text-fg"
                >
                  <ItemIcon src={m.row.icon} name={m.row.name} size={18} />
                  <span className="min-w-0 flex-1 truncate">
                    {m.row.name}
                    {m.row.variant && <span className="text-fg-subtle"> · {m.row.variant}</span>}
                  </span>
                  <Price amount={m.row.value} unit={unit} className="text-xs" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {lines.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-md border border-line">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-fg" title={l.source === "market" && l.pricedAt ? `poe.ninja price from ${formatRelative(l.pricedAt)}` : "Value typed by you"}>
                {l.name}
              </span>
              <Badge tone={l.source === "market" ? "success" : "neutral"}>{l.source === "market" ? "poe.ninja" : "manual"}</Badge>
              <Input
                size="sm"
                type="number"
                min={0}
                aria-label={`Quantity of ${l.name}`}
                value={l.qty}
                onChange={(e) => onChange(lines.map((x) => (x === l ? { ...x, qty: Math.max(0, Math.round(Number(e.target.value)) || 0) } : x)))}
                containerClassName="w-20"
              />
              <span className="w-24 text-right text-xs">
                <Price amount={l.qty * l.unitPrice} unit={unit} />
              </span>
              <IconButton icon="close" size="sm" label={`Remove ${l.name}`} onClick={() => onChange(lines.filter((x) => x !== l))} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- comparison & history ----------

function StrategiesPanel({ strategies, loading }: { strategies: ReturnType<typeof compareStrategies>; loading: boolean }) {
  return (
    <Panel flush title="Strategies" actions={<span>Your recorded sessions in this league</span>}>
      {strategies.length === 0 ? (
        <EmptyState icon="chart" title={loading ? "Loading sessions…" : "No sessions yet"} loading={loading} body={loading ? undefined : "Save a session to start comparing strategies."} className="py-8" />
      ) : (
        <div role="table" className="text-sm">
          <div role="row" className="grid h-9 grid-cols-[minmax(0,1fr)_110px_90px] items-center gap-3 border-b border-line bg-bg-2/95 px-4 text-xs text-fg-subtle">
            <span>Strategy</span>
            <span className="text-right" title="Total profit ÷ total time">
              Profit / hour
            </span>
            <span className="text-right">Per map</span>
          </div>
          {strategies.map((s, i) => (
            <div key={s.strategy} role="row" className="grid min-h-12 grid-cols-[minmax(0,1fr)_110px_90px] items-center gap-3 border-b border-line px-4 py-1.5 last:border-b-0">
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate text-fg">{s.strategy}</span>
                  {i === 0 && strategies.length > 1 && s.perHour !== null && <Badge tone="success">Best so far</Badge>}
                </span>
                <span className="flex items-center gap-1 text-2xs text-fg-subtle">
                  {s.sessions} session{s.sessions === 1 ? "" : "s"} · {formatDuration(Math.round(s.hours * 3600))} · {s.maps} maps
                  {s.sessions < 3 && (
                    <span className="inline-flex items-center gap-0.5 text-warning" title="Few sessions — results can change a lot">
                      <Icon name="info" size={11} /> few
                    </span>
                  )}
                </span>
              </span>
              <span className="text-right" title={s.bestPerHour !== null ? `Range of sessions: ${Math.round(s.worstPerHour!)}–${Math.round(s.bestPerHour)} c/h` : undefined}>
                {s.perHour === null ? "—" : <Price amount={s.perHour} unit={unit} />}
              </span>
              <span className="text-right text-xs">{s.perMap === null ? "—" : <Price amount={s.perMap} unit={unit} />}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function HistoryPanel({ sessions, error, onDelete }: { sessions: FarmingSession[] | null; error: string | null; onDelete: (s: FarmingSession) => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  return (
    <Panel flush title="Sessions">
      {error ? (
        <EmptyState icon="error" title="Couldn't load sessions" body={error} className="py-8" />
      ) : !sessions?.length ? (
        <p className="px-4 py-4 text-xs text-fg-subtle">{sessions ? "Saved sessions appear here." : "Loading…"}</p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
          {sessions.map((s) => {
            const t = totals(s);
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-fg" title={s.data.notes || undefined}>
                    {s.strategy}
                  </span>
                  <span className="block text-2xs text-fg-subtle">
                    {new Date(s.startedAt * 1000).toLocaleString()} · {formatDuration(s.durationSecs)} · {s.maps} maps
                  </span>
                </span>
                <span className="text-right text-xs">
                  <Price amount={t.profit} unit={unit} />
                  <span className="block text-2xs text-fg-subtle">{t.perHour === null ? "—" : <>/ h <Price amount={t.perHour} unit={unit} /></>}</span>
                </span>
                {confirm === s.id ? (
                  <Button size="sm" variant="danger" onClick={() => (onDelete(s), setConfirm(null))}>
                    Delete
                  </Button>
                ) : (
                  <IconButton icon="close" size="sm" label={`Delete session ${s.strategy}`} onClick={() => setConfirm(s.id)} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
