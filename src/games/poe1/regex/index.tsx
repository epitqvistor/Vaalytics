/**
 * REGEX (PoE 1): build in-game search strings from 3.30 game data, edit them
 * by hand, keep them in a library with quick slots, test them against items.
 * Nothing is sent to the game: strings are copied to the clipboard on request.
 * Spec: docs/modules/regex.md
 */
import { useEffect, useMemo, useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import { regexExport, regexImport, regexSetSlot, type RegexEntry, type RegexSlot } from "@/core/ipc/commands";
import { Badge, Button, EmptyState, Input, PageHeader, Panel, ProvenanceTag, SegmentedControl, Select, useToast } from "@/shared/components";
import { cn } from "@/shared/utilities/cn";
import { useCraftingData } from "../crafting/hooks";
import { buildCategories, type Category, type PropValue } from "./categories";
import { ConfirmDialog, ImportDialog, SaveDialog, type SaveDraft } from "./dialogs";
import { emptyState, generate, lengthState, splitQuery, type GenState } from "./generator";
import { LibraryPanel } from "./LibraryPanel";
import { exportJson, parseImport, type ImportParse } from "./library";
import { PRESETS, resolvePreset } from "./presets";
import { reverseLookup, stateFromLookup } from "./reverse";
import { useEditorMemory, useLibrary } from "./store";
import { evaluate, itemLines, LIMIT } from "./syntax";

const SHOWN = 120;

const copy = async (text: string, notify: ReturnType<typeof useToast>, what = "Copied") => {
  try {
    await navigator.clipboard.writeText(text);
    notify("success", what, text.length > 60 ? `${text.slice(0, 60)}…` : text);
  } catch {
    notify("error", "Couldn't copy", "The clipboard is not available.");
  }
};

export default function RegexSection(_props: SectionProps) {
  const { res, error, loading, reload } = useCraftingData();
  const cats = useMemo(() => (res ? buildCategories(res.data) : null), [res]);

  if (!cats || !res) {
    return (
      <div className="mx-auto max-w-page">
        <PageHeader title="REGEX" />
        <div className="panel rounded-lg">
          {error ? (
            <EmptyState icon="error" title="Couldn't load game data" body={error} action={<Button onClick={reload}>Try again</Button>} />
          ) : (
            <EmptyState
              icon="search"
              loading={loading}
              title="Loading game data"
              body="Mods and item names come from RePoE (cached, checked once a day)."
            />
          )}
        </div>
      </div>
    );
  }
  return <Workspace cats={cats} checkedAt={res.data.checkedAt} staleError={res.staleError} />;
}

function Workspace({ cats, checkedAt, staleError }: { cats: Category[]; checkedAt: number; staleError: string | null }) {
  const notify = useToast();
  const lib = useLibrary();
  const { m, setM, stateOf } = useEditorMemory();
  const cat = cats.find((c) => c.id === m.category) ?? cats[0]!;
  const st = stateOf(cat.id);
  const gen = useMemo(() => generate(cat, st), [cat, st]);

  // Generated text follows the generator until the user edits it by hand.
  useEffect(() => {
    if (!m.manual && m.text !== gen.query) setM((x) => ({ ...x, text: gen.query }));
  }, [gen.query, m.manual, m.text, setM]);

  type Upd = GenState | ((s: GenState) => GenState);
  const setSt = (next: Upd) =>
    setM((x) => {
      const cur = x.states[cat.id] ?? emptyState();
      return { ...x, states: { ...x.states, [cat.id]: typeof next === "function" ? next(cur) : next } };
    });
  const [draft, setDraft] = useState<SaveDraft | null>(null);
  const [imported, setImported] = useState<ImportParse | null>(null);
  const [slotPick, setSlotPick] = useState<number | null>(null);
  const [clearSlot, setClearSlot] = useState<number | null>(null);

  const categoriesInUse = useMemo(() => [...new Set(lib.entries.map((e) => e.category))], [lib.entries]);

  const loadEntry = (e: RegexEntry) => {
    const genCat = cats.find((c) => c.library === e.category);
    setM((x) => ({ ...x, category: genCat?.id ?? x.category, text: e.regex, manual: true, loadedId: e.id }));
    notify("info", `Loaded “${e.name}”`, "Shown as hand-edited; the generator won't overwrite it.");
  };

  const doImport = async () => {
    try {
      const text = await regexImport();
      if (text === null) return;
      const p = parseImport(text);
      if (p.error) return notify("error", "Can't import this file", p.error);
      if (!p.entries.length) return notify("warning", "Nothing to import", p.rejected[0]?.reason ?? "No valid entries.");
      setImported(p);
    } catch (e) {
      notify("error", "Import failed", String(e));
    }
  };
  const doExport = async (entries: RegexEntry[]) => {
    if (!entries.length) return notify("info", "Nothing to export", "The library (with the current filters) is empty.");
    try {
      if (await regexExport("vaalytics-regex.json", exportJson(entries))) notify("success", "Exported", `${entries.length} entries`);
    } catch (e) {
      notify("error", "Export failed", String(e));
    }
  };

  const assignSlot = async (slot: number, value: RegexSlot | null) => {
    try {
      await regexSetSlot("poe1", slot, value);
      await lib.reload();
    } catch (e) {
      notify("error", "Couldn't update the slot", String(e));
    }
  };

  const loaded = lib.entries.find((e) => e.id === m.loadedId) ?? null;

  return (
    <div className="mx-auto grid max-w-page gap-4">
      <PageHeader
        title="REGEX"
        description="Search strings for the stash, vendor and inventory search box (English client). Copy, then paste in game with Ctrl+V."
        actions={
          <>
            <Button variant="ghost" onClick={doImport}>
              Import
            </Button>
            <Button variant="ghost" onClick={() => doExport(lib.entries)}>
              Export all
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Generator">
        {cats.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === cat.id}
            onClick={() => setM((x) => ({ ...x, category: c.id }))}
            className={cn(
              "h-8 rounded-md border px-3 text-sm transition-colors duration-150",
              c.id === cat.id ? "border-accent/40 bg-accent-soft text-fg" : "border-line bg-bg-2 text-fg-muted hover:text-fg",
            )}
          >
            {c.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-xs text-fg-subtle">
          <ProvenanceTag provenance={{ kind: "game-data", source: "RePoE", at: checkedAt * 1000, patch: "3.30" }} />
          {staleError && <span className="text-warning">couldn't refresh ({staleError})</span>}
        </span>
      </div>

      {/* Generator on the left; string, quick slots and library on the right (no scrolling past the generator). */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <GeneratorPanel cat={cat} st={st} setSt={setSt} />
        <div className="grid gap-4">
          <PreviewPanel
            cat={cat}
            gen={gen}
            text={m.text}
            manual={m.manual}
            loadedName={loaded?.name ?? null}
            onText={(text) => setM((x) => ({ ...x, text, manual: true }))}
            onDiscard={() => setM((x) => ({ ...x, text: gen.query, manual: false, loadedId: null }))}
            onLoadState={(next) => {
              setSt(next);
              setM((x) => ({ ...x, manual: false, loadedId: null }));
            }}
            onSave={() =>
              setDraft(
                loaded
                  ? { ...loaded, regex: m.text }
                  : { id: null, name: "", category: cat.library, regex: m.text, description: "", tags: [], notes: "", favorite: false },
              )
            }
            onSlot={() => setSlotPick(0)}
          />
          <SlotsPanel
            slots={lib.slots}
            onCopy={(s) => copy(s.regex, notify, `Slot ${s.slot} copied`)}
            onLoad={(s) => setM((x) => ({ ...x, text: s.regex, manual: true, loadedId: s.libraryId }))}
            onClear={(n) => setClearSlot(n)}
            picking={slotPick !== null}
            onPick={(n) => {
              setSlotPick(null);
              if (!m.text.trim()) return notify("info", "Nothing to put in the slot", "The editor is empty.");
              assignSlot(n, { slot: n, label: loaded?.name ?? `${cat.label} search`, regex: m.text, libraryId: loaded?.id ?? null });
            }}
            onCancelPick={() => setSlotPick(null)}
          />
          <LibraryPanel
            entries={lib.entries}
            error={lib.error}
            onLoad={loadEntry}
            onCopy={(e) => copy(e.regex, notify)}
            onEdit={(e) => setDraft({ ...e })}
            onChanged={lib.reload}
            onExport={doExport}
            onToSlot={(e, n) => assignSlot(n, { slot: n, label: e.name, regex: e.regex, libraryId: e.id })}
          />
        </div>
      </div>

      <SaveDialog
        draft={draft}
        categories={categoriesInUse}
        onClose={() => setDraft(null)}
        onSaved={(e) => {
          notify("success", "Saved", e.name);
          setM((x) => ({ ...x, loadedId: e.id }));
          lib.reload();
        }}
      />
      <ImportDialog
        parsed={imported}
        existing={lib.entries}
        onClose={() => setImported(null)}
        onDone={(s) => (notify("success", "Import finished", s), lib.reload())}
      />
      {clearSlot !== null && (
        <ConfirmDialog
          title={`Clear slot ${clearSlot}?`}
          body="The library entry it came from (if any) is not affected."
          confirm="Clear slot"
          onConfirm={() => assignSlot(clearSlot, null)}
          onClose={() => setClearSlot(null)}
        />
      )}
    </div>
  );
}

// ---------- generator ----------

function GeneratorPanel({ cat, st, setSt }: { cat: Category; st: GenState; setSt: (s: GenState | ((s: GenState) => GenState)) => void }) {
  const [filter, setFilter] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const presets = PRESETS.filter((p) => p.category === cat.id);
  const [presetId, setPresetId] = useState("");
  const notify = useToast();
  useEffect(() => {
    setFilter("");
    setPresetId("");
  }, [cat.id]);

  const selected = new Set([...st.want, ...st.avoid]);
  const q = filter.trim().toLowerCase();
  const matches = cat.options.filter(
    (o) => (!onlySelected || selected.has(o.id)) && (!q || o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q)),
  );
  // Selected options first so they stay reachable while filtering.
  const rows = [...matches.filter((o) => selected.has(o.id)), ...matches.filter((o) => !selected.has(o.id))].slice(0, SHOWN);

  const toggle = (id: string, list: "want" | "avoid") => {
    const other = list === "want" ? "avoid" : "want";
    setSt((s) => {
      const on = s[list].includes(id);
      return { ...s, [list]: on ? s[list].filter((x) => x !== id) : [...s[list], id], [other]: s[other].filter((x) => x !== id) };
    });
  };
  const setProp = (id: string, v: PropValue) => setSt((s) => ({ ...s, props: { ...s.props, [id]: v } }));

  return (
    <Panel
      title={cat.label}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSt(emptyState())}
          disabled={!selected.size && !Object.values(st.props).some((v) => v && v !== "any") && !st.extra.length}
        >
          Clear
        </Button>
      }
    >
      <p className="mb-3 text-xs text-fg-subtle">
        {cat.description} Source: {cat.source}.
      </p>

      {presets.length > 0 && (
        <div className="mb-3 flex items-end gap-2">
          <Select
            label="Built-in preset"
            className="flex-1"
            size="sm"
            value={presetId}
            onChange={setPresetId}
            options={[{ value: "", label: "Choose a preset…" }, ...presets.map((p) => ({ value: p.id, label: `Built-in · ${p.name}` }))]}
          />
          <Button
            size="sm"
            disabled={!presetId}
            onClick={() => {
              const p = presets.find((x) => x.id === presetId)!;
              const r = resolvePreset(cat, p);
              setSt(r.state);
              if (r.missing.length) notify("warning", "Part of the preset isn't in the current data", r.missing.join(", "));
              else notify("info", `Built-in preset: ${p.name}`, p.description);
            }}
          >
            Load
          </Button>
        </div>
      )}

      {cat.props.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {cat.props.map((p) =>
            p.kind === "tri" ? (
              <Select
                key={p.id}
                size="sm"
                label={p.label}
                value={(st.props[p.id] as string) || "any"}
                onChange={(v) => setProp(p.id, v as PropValue)}
                options={[
                  { value: "any", label: "Any" },
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                ]}
              />
            ) : (
              <Input
                key={p.id}
                size="sm"
                type="number"
                min={0}
                label={p.label}
                hint={p.unverified ? "Item Quantity or Atlas Drops" : undefined}
                value={typeof st.props[p.id] === "number" ? String(st.props[p.id]) : ""}
                onChange={(e) => setProp(p.id, e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
              />
            ),
          )}
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          icon="search"
          placeholder={`Filter ${cat.options.length} options`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          containerClassName="flex-1 min-w-48"
        />
        <SegmentedControl
          size="sm"
          label="Wanted options"
          value={st.wantMode}
          onChange={(v) => setSt({ ...st, wantMode: v })}
          segments={[
            { value: "any", label: "Any wanted" },
            { value: "all", label: "All wanted" },
          ]}
        />
        <Button size="sm" variant={onlySelected ? "secondary" : "ghost"} onClick={() => setOnlySelected((v) => !v)}>
          Selected ({selected.size})
        </Button>
      </div>

      <ul className="max-h-[520px] overflow-auto rounded-lg border border-line bg-bg-2" aria-label="Options">
        {rows.map((o) => {
          const want = st.want.includes(o.id);
          const avoid = st.avoid.includes(o.id);
          return (
            <li key={o.id} className={cn("flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-0", (want || avoid) && "bg-elevated")}>
              <span className="min-w-0 flex-1 text-sm">
                <span className={cn(avoid ? "text-danger" : want ? "text-success" : "text-fg")}>{o.label}</span>
                <span className="ml-2 text-xs text-fg-subtle">{o.group}</span>
              </span>
              {want && o.numeric && (
                <input
                  type="number"
                  min={0}
                  aria-label={`Minimum for ${o.label}`}
                  placeholder="min"
                  className="h-7 w-16 rounded-sm border border-line bg-well px-1.5 text-right font-mono text-xs"
                  value={st.mins[o.id] ?? ""}
                  onChange={(e) => {
                    const mins = { ...st.mins };
                    if (e.target.value === "") delete mins[o.id];
                    else mins[o.id] = Math.max(0, Number(e.target.value));
                    setSt({ ...st, mins });
                  }}
                />
              )}
              <button
                aria-pressed={want}
                onClick={() => toggle(o.id, "want")}
                className={cn("h-7 rounded px-2 text-xs", want ? "bg-success-soft text-success" : "text-fg-subtle hover:text-fg")}
              >
                Want
              </button>
              <button
                aria-pressed={avoid}
                onClick={() => toggle(o.id, "avoid")}
                className={cn("h-7 rounded px-2 text-xs", avoid ? "bg-danger-soft text-danger" : "text-fg-subtle hover:text-fg")}
              >
                Avoid
              </button>
            </li>
          );
        })}
        {!rows.length && <li className="px-3 py-6 text-center text-sm text-fg-subtle">No options match.</li>}
      </ul>
      {matches.length > SHOWN && (
        <p className="mt-1.5 text-xs text-fg-subtle">
          Showing {SHOWN} of {matches.length} — type to narrow the list.
        </p>
      )}
      {st.extra.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft p-2 text-xs">
          <div className="mb-1 font-medium text-warning">Kept from the loaded string (no option explains these)</div>
          <div className="flex flex-wrap gap-1.5">
            {st.extra.map((t, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-sm bg-elevated px-1.5 py-0.5 font-mono">
                {t}
                <button
                  aria-label={`Remove ${t}`}
                  className="text-fg-subtle hover:text-fg"
                  onClick={() => setSt({ ...st, extra: st.extra.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------- preview ----------

function PreviewPanel({
  cat,
  gen,
  text,
  manual,
  loadedName,
  onText,
  onDiscard,
  onLoadState,
  onSave,
  onSlot,
}: {
  cat: Category;
  gen: ReturnType<typeof generate>;
  text: string;
  manual: boolean;
  loadedName: string | null;
  onText: (t: string) => void;
  onDiscard: () => void;
  onLoadState: (s: GenState) => void;
  onSave: () => void;
  onSlot: () => void;
}) {
  const notify = useToast();
  const len = text.length;
  const ls = lengthState(len);
  const split = useMemo(() => splitQuery(text), [text]);
  const [tab, setTab] = useState<"issues" | "test" | "explain">("issues");
  const [item, setItem] = useState("");
  const test = useMemo(() => (item.trim() && text.trim() ? evaluate(text, itemLines(item)) : null), [item, text]);
  const explain = useMemo(() => (tab === "explain" && text.trim() ? reverseLookup(cat, text) : null), [tab, cat, text]);
  const label = (id: string) => cat.options.find((o) => o.id === id)?.label ?? id;
  const issues = manual ? [] : gen.issues;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Search string
          <Badge tone={manual ? "warning" : "accent"}>{manual ? "Edited by hand" : "Generated"}</Badge>
          {loadedName && <span className="truncate text-xs font-normal text-fg-subtle">from “{loadedName}”</span>}
        </span>
      }
      actions={
        manual ? (
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            Replace with generated
          </Button>
        ) : null
      }
    >
      <textarea
        aria-label="Search string"
        spellCheck={false}
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder="Pick options on the left, or type a search string."
        className={cn(
          "min-h-28 w-full rounded-md border bg-well p-3 font-mono text-sm text-fg outline-none transition-colors duration-120 focus:border-copper",
          ls === "error" ? "border-danger/50" : ls === "warn" ? "border-warning/50" : "border-line",
        )}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={cn("tabular", ls === "error" ? "text-danger" : ls === "warn" ? "text-warning" : "text-fg-muted")}
          aria-live="polite"
        >
          {len} / {LIMIT}
        </span>
        {ls === "error" && <span className="text-danger">Too long for the search box — use the split searches below. Nothing is cut off.</span>}
        {ls === "warn" && <span className="text-warning">Close to the limit.</span>}
        {manual && gen.query !== text && <span className="text-fg-subtle">Generator changes don't overwrite your edits.</span>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" icon="copy" disabled={!text.trim() || len > LIMIT} onClick={() => copy(text, notify)}>
          Copy
        </Button>
        <Button icon="star" disabled={!text.trim()} onClick={onSave}>
          Save to library
        </Button>
        <Button variant="ghost" disabled={!text.trim()} onClick={onSlot}>
          Put in quick slot
        </Button>
      </div>

      {len > LIMIT && (
        <div className="mt-3 rounded-lg border border-line bg-bg-2 p-3">
          {split.error ? (
            <p className="text-sm text-danger">{split.error}</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-fg-muted">
                {split.parts.length} searches.{" "}
                {split.mode === "any"
                  ? "An item is a match if it lights up in ANY of them."
                  : "An item is a match only if it lights up in EVERY one of them."}
              </p>
              <ol className="grid gap-1.5">
                {split.parts.map((p, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-5 text-xs text-fg-subtle">{i + 1}.</span>
                    <code className="min-w-0 flex-1 truncate rounded-sm bg-well px-2 py-1 font-mono text-xs" title={p}>
                      {p}
                    </code>
                    <span className="font-mono text-xs text-fg-subtle">{p.length}</span>
                    <Button size="sm" variant="ghost" icon="copy" onClick={() => copy(p, notify, `Search ${i + 1} copied`)}>
                      Copy
                    </Button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      <div className="mt-4">
        <SegmentedControl
          size="sm"
          label="Checks"
          value={tab}
          onChange={setTab}
          segments={[
            { value: "issues", label: `Checks${issues.length ? ` (${issues.length})` : ""}` },
            { value: "test", label: "Test against item" },
            { value: "explain", label: "Explain (reverse lookup)" },
          ]}
        />
        <div className="mt-2">
          {tab === "issues" &&
            (manual ? (
              <p className="text-xs text-fg-subtle">
                Hand-edited strings aren't checked against the data. Use “Explain” to see what each part matches.
              </p>
            ) : issues.length ? (
              <ul className="grid gap-1 text-xs">
                {issues.map((i, k) => (
                  <li key={k} className={i.kind === "unverified" || i.kind === "noMin" ? "text-warning" : "text-danger"}>
                    {i.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-subtle">
                {gen.pieces.length
                  ? `Every part was checked against ${cat.index.lines.length} lines of ${cat.label.toLowerCase()} data: each one matches only its own option.`
                  : "Nothing selected yet."}
              </p>
            ))}

          {tab === "test" && (
            <div className="grid gap-2">
              <textarea
                aria-label="Item text"
                spellCheck={false}
                value={item}
                onChange={(e) => setItem(e.target.value)}
                placeholder="Paste an item copied in game (Ctrl+C) to see whether this string matches it."
                className="min-h-28 w-full rounded-md border border-line bg-well p-2 font-mono text-xs text-fg"
              />
              {test && (
                <div className="text-xs">
                  <div className={cn("mb-1 font-medium", test.ok ? "text-success" : "text-danger")}>
                    {test.ok ? "Matches: the item would light up." : "No match: the item would stay dark."}
                  </div>
                  <ul className="grid gap-0.5">
                    {test.terms.map((t, i) => (
                      <li key={i} className="flex gap-2">
                        <span className={t.ok ? "text-success" : "text-danger"}>{t.ok ? "✓" : "✗"}</span>
                        <code className="font-mono">{t.text}</code>
                        <span className="text-fg-subtle">
                          {t.invalid
                            ? "not a valid pattern"
                            : t.matchedLines.length
                              ? `matched: ${t.matchedLines.slice(0, 2).join(" · ")}`
                              : "no line matched"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {tab === "explain" &&
            (explain && explain.length ? (
              <div className="grid gap-2 text-xs">
                <ul className="grid gap-1">
                  {explain.map((t, i) => (
                    <li key={i}>
                      <div className="font-mono text-fg-muted">
                        {t.term.negate ? "Exclude" : "Require"} · {t.text}
                      </div>
                      <ul className="ml-3">
                        {t.alts.map((a, j) => (
                          <li key={j} className="flex gap-2">
                            <code className="font-mono">{a.alt}</code>
                            <span
                              className={
                                a.status === "option"
                                  ? "text-success"
                                  : a.status === "property"
                                    ? "text-fg-muted"
                                    : a.status === "ambiguous"
                                      ? "text-warning"
                                      : "text-danger"
                              }
                            >
                              {a.status === "option"
                                ? label(a.options[0]!)
                                : a.status === "ambiguous"
                                  ? `matches ${a.options.length} options (${a.options.slice(0, 2).map(label).join(", ")}…)`
                                  : a.status === "property"
                                    ? "an item property or base name"
                                    : a.status === "invalid"
                                      ? "not a valid pattern"
                                      : `unknown in ${cat.label} — kept as is`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                <div>
                  <Button size="sm" onClick={() => onLoadState(stateFromLookup(explain))}>
                    Load into the {cat.label} generator
                  </Button>
                  <span className="ml-2 text-fg-subtle">Unknown and ambiguous parts are kept verbatim.</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-fg-subtle">Type or load a string to see which {cat.label.toLowerCase()} lines each part matches.</p>
            ))}
        </div>
      </div>
    </Panel>
  );
}

// ---------- quick slots ----------

function SlotsPanel({
  slots,
  onCopy,
  onLoad,
  onClear,
  picking,
  onPick,
  onCancelPick,
}: {
  slots: RegexSlot[];
  onCopy: (s: RegexSlot) => void;
  onLoad: (s: RegexSlot) => void;
  onClear: (n: number) => void;
  picking: boolean;
  onPick: (n: number) => void;
  onCancelPick: () => void;
}) {
  const by = new Map(slots.map((s) => [s.slot, s]));
  return (
    <Panel
      title="Quick slots"
      actions={
        picking ? (
          <span className="flex items-center gap-2 text-xs text-accent">
            Choose a slot for the current string
            <Button size="sm" variant="ghost" onClick={onCancelPick}>
              Cancel
            </Button>
          </span>
        ) : (
          <span className="text-xs text-fg-subtle">Click to copy · hover for Load / clear</span>
        )
      }
    >
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => {
          const s = by.get(n);
          return (
            <div key={n} className={cn("group relative min-w-0 rounded-md border bg-bg-2", picking ? "border-accent/40" : "border-line")}>
              <button
                className="block w-full px-2 py-1.5 text-left disabled:cursor-default"
                disabled={!picking && !s}
                title={s?.regex}
                onClick={() => (picking ? onPick(n) : s && onCopy(s))}
                aria-label={picking ? `Put the current string in slot ${n}` : s ? `Copy slot ${n}: ${s.label}` : `Slot ${n} is empty`}
              >
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-mono text-fg-subtle">{n}</span>
                  <span className={cn("truncate", s ? "text-fg" : "text-fg-subtle")}>{s?.label ?? (picking ? "Put here" : "Empty")}</span>
                </div>
                <code className="mt-0.5 block truncate font-mono text-2xs text-fg-muted">{s?.regex ?? "—"}</code>
              </button>
              {s && !picking && (
                <div className="absolute right-1 top-1 flex gap-0.5 rounded bg-bg-2 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    aria-label={`Load slot ${n} into the editor`}
                    title="Load into the editor"
                    className="rounded-sm px-1 text-2xs text-fg-subtle hover:bg-elevated hover:text-fg"
                    onClick={() => onLoad(s)}
                  >
                    Load
                  </button>
                  <button
                    aria-label={`Clear slot ${n}`}
                    title="Clear slot"
                    className="rounded-sm px-1 text-2xs text-fg-subtle hover:bg-elevated hover:text-danger"
                    onClick={() => onClear(n)}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
