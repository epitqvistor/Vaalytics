/**
 * Inventory snapshots: one screenshot per press of the user's own shortcut (or a PNG they pick), the
 * recognised currency and stack sizes for review, and the change against an earlier snapshot.
 * A change is an inventory change — never presented as guaranteed map loot.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LOOT_INVENTORY_EVENT,
  lootInventoryDelete,
  lootInventoryDetail,
  lootInventoryEditEntry,
  lootInventoryFromFile,
  lootInventoryItemNames,
  lootInventoryReprocess,
  lootInventorySnapshots,
  lootInventoryUpdate,
  lootSetConfig,
  type InventoryConfidence,
  type InventoryEntry,
  type InventorySnapshot,
  type InventorySnapshotDetail,
  type LootConfig,
  type LootInventoryEvent,
} from "@/core/ipc/commands";
import { Badge, Button, Checkbox, EmptyState, Input, Modal, Panel, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { Price } from "@/shared/views/common";
import { POE2_CONFIG } from "../config";
import { HotkeyField } from "./HotkeyField";
import { useEvent, useLootMaps, useLootUpdates } from "./hooks";
import { mapName } from "./stats";
import { fmtDateTime } from "./ui";

const GAME = "poe2" as const;
const unit = POE2_CONFIG.baseUnit;

const CONF_TONE: Record<InventoryConfidence, "success" | "accent" | "warning" | "danger"> = { high: "success", medium: "accent", low: "warning", unknown: "danger" };
const CONF_BORDER: Record<InventoryConfidence, string> = {
  high: "border-success/70",
  medium: "border-accent/70",
  low: "border-warning/90",
  unknown: "border-danger/90",
};
const STATUS_LABEL = { review: "To review", confirmed: "Confirmed", cancelled: "Cancelled" } as const;
const LINE_LABEL = { confirmed: "Confirmed", estimated: "Estimated", needs_review: "Needs review" } as const;

export function InventoryTab({ config, setConfig }: { config: LootConfig | null; setConfig: (c: LootConfig) => void }) {
  const notify = useToast();
  const [list, setList] = useState<InventorySnapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [live, setLive] = useState<LootInventoryEvent | null>(null);
  const load = useCallback(() => {
    lootInventorySnapshots(GAME, 200)
      .then((l) => {
        setList(l);
        setError(null);
        setSelected((s) => (s !== null && l.some((x) => x.id === s) ? s : (l[0]?.id ?? null)));
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(load, [load]);
  useLootUpdates(load);
  useEvent<LootInventoryEvent>(LOOT_INVENTORY_EVENT, (e) => {
    setLive(e);
    if (e.kind === "captured" && e.snapshotId) setSelected(e.snapshotId);
  });

  const saveKey = async (key: string) => {
    if (!config) return;
    setConfig(await lootSetConfig(GAME, { ...config, hotkeys: { ...config.hotkeys, screenshot: key } }));
  };
  const fromFile = async () => {
    try {
      setLive({ kind: "working", message: "Recognising the screenshot…", snapshotId: null, cells: null, toReview: null });
      const id = await lootInventoryFromFile(GAME);
      if (id === null) setLive(null);
    } catch (e) {
      setLive({ kind: "error", message: String(e), snapshotId: null, cells: null, toReview: null });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="Inventory snapshots">
          <ol className="mb-3 grid gap-1.5 text-xs text-fg-muted sm:grid-cols-3">
            <li className="well rounded-md px-3 py-2">
              <span className="text-fg">1.</span> Open your inventory in Path of Exile 2 (I).
            </li>
            <li className="well rounded-md px-3 py-2">
              <span className="text-fg">2.</span> Press your shortcut — exactly one screenshot of the game window.
            </li>
            <li className="well rounded-md px-3 py-2">
              <span className="text-fg">3.</span> Check the result here; confirm it to compare with the next one.
            </li>
          </ol>
          <p className="text-2xs leading-relaxed text-fg-subtle">
            Currency is identified by its picture (official item art from the market data, cached on this PC) and stack sizes by reading the digits. Nothing runs in the background: no
            screenshots without your key press, no continuous reading. Use “Windowed fullscreen” in the game. Uncertain cells are marked for you to check — nothing is saved as certain
            without your confirmation.
          </p>
          {live && (
            <p className={cn("mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs", live.kind === "error" ? "border-warning/30 bg-warning-soft text-warning" : live.kind === "captured" ? "border-success/25 bg-success-soft text-success" : "border-line bg-bg-2 text-fg-muted")}>
              <Icon name={live.kind === "error" ? "warning" : live.kind === "captured" ? "success" : "clock"} size={14} />
              {live.message}
            </p>
          )}
        </Panel>
        <Panel title="Screenshot shortcut">
          {config ? (
            <div className="flex flex-col gap-3">
              <HotkeyField
                label="Inventory screenshot"
                value={config.hotkeys.screenshot}
                defaultValue=""
                onSave={saveKey}
                description="Choose any key or combination with Ctrl/Alt (e.g. F8, Shift+F8, Ctrl+Shift+S). Active only while Path of Exile 2 is the focused window; separate from Ctrl+C item capture."
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Button size="sm" variant="secondary" icon="download" onClick={() => void fromFile()}>
                  Recognise a screenshot file…
                </Button>
                <span className="text-2xs text-fg-subtle">PNG, e.g. saved with the game's or Windows' screenshot key.</span>
              </div>
            </div>
          ) : (
            <EmptyState icon="settings" title="Loading…" loading />
          )}
        </Panel>
      </div>

      {error ? (
        <EmptyState icon="error" title="Couldn't load snapshots" body={error} />
      ) : list === null ? (
        <EmptyState icon="journal" title="Loading…" loading />
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState icon="journal" title="No snapshots yet" body="Set your shortcut, open the inventory in game and press it — the first snapshot becomes your baseline to compare with." />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <Panel title="History" flush>
            <ul className="max-h-[640px] divide-y divide-line overflow-y-auto">
              {list.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.id)}
                    className={cn("flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-glass", selected === s.id && "bg-accent-soft")}
                  >
                    <span className="flex items-center gap-2 text-sm text-fg">
                      {fmtDateTime(s.takenAt)}
                      {s.isBaseline && <Badge tone="accent">Baseline</Badge>}
                    </span>
                    <span className="flex items-center gap-2 text-2xs text-fg-subtle">
                      <span className={cn(s.status === "review" ? "text-warning" : s.status === "confirmed" ? "text-success" : "text-fg-subtle")}>{STATUS_LABEL[s.status]}</span>· {s.cells} cells
                      {s.toReview > 0 && s.status === "review" && ` · ${s.toReview} to check`}
                      {s.source === "file" && " · file"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          {selected !== null && <SnapshotView key={selected} id={selected} snapshots={list} onDeleted={() => (setSelected(null), load())} notify={notify} />}
        </div>
      )}
    </div>
  );
}

function SnapshotView({ id, snapshots, onDeleted, notify }: { id: number; snapshots: InventorySnapshot[]; onDeleted: () => void; notify: ReturnType<typeof useToast> }) {
  const [against, setAgainst] = useState<number | null>(null);
  const [d, setD] = useState<InventorySnapshotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const maps = useLootMaps(null, 100);
  const load = useCallback(() => {
    lootInventoryDetail(GAME, id, against)
      .then((x) => (setD(x), setError(null)))
      .catch((e) => setError(String(e)));
  }, [id, against]);
  useEffect(load, [load]);
  useLootUpdates(load);
  useEffect(() => {
    lootInventoryItemNames(GAME)
      .then((n) => setNames(n.map(([name]) => name)))
      .catch(() => setNames([]));
  }, []);

  const act = async (f: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await f();
      if (ok) notify("success", ok);
      load();
    } catch (e) {
      notify("warning", "That didn't work", String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <EmptyState icon="error" title="Couldn't load the snapshot" body={error} />;
  if (!d) return <EmptyState icon="journal" title="Loading…" loading />;
  const s = d.snapshot;
  const counted = d.entries.filter((e) => !e.excluded);
  const others = snapshots.filter((x) => x.id !== id && x.status !== "cancelled" && x.takenAt <= s.takenAt);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Panel
        title={
          <span className="flex items-center gap-2">
            Snapshot · {fmtDateTime(s.takenAt)}
            <Badge tone={s.status === "confirmed" ? "success" : s.status === "review" ? "warning" : "neutral"}>{STATUS_LABEL[s.status]}</Badge>
            {s.isBaseline && <Badge tone="accent">Baseline</Badge>}
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="-mt-1 flex flex-wrap items-center gap-1.5">
            {s.status !== "confirmed" && (
              <Button size="sm" variant="primary" icon="check" disabled={busy} onClick={() => act(() => lootInventoryUpdate(GAME, id, { status: "confirmed" }), "Snapshot confirmed")}>
                Confirm
              </Button>
            )}
            {s.status === "confirmed" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => lootInventoryUpdate(GAME, id, { status: "review" }))}>
                Reopen
              </Button>
            )}
            <Button size="sm" variant="ghost" icon="refresh" disabled={busy} onClick={() => act(() => lootInventoryReprocess(GAME, id), "Recognised again — your corrections were kept")}>
              Retry recognition
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => lootInventoryUpdate(GAME, id, { baseline: !s.isBaseline }))}>
              {s.isBaseline ? "Unmark baseline" : "Mark as baseline"}
            </Button>
            {s.status !== "cancelled" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => lootInventoryUpdate(GAME, id, { status: "cancelled" }), "Snapshot cancelled")}>
                Cancel snapshot
              </Button>
            )}
            <Button size="sm" variant="ghost" icon="trash" className="hover:text-danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
          {d.image && d.grid ? (
            <Screenshot image={d.image} grid={d.grid} entries={d.entries} focus={focus} onFocus={setFocus} />
          ) : (
            <p className="text-xs text-fg-subtle">The screenshot of this snapshot isn't available any more.</p>
          )}
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <Select
              label={s.mapAssignment === "auto" ? "Map (open when captured)" : s.mapAssignment === "user" ? "Map (your assignment)" : "Map"}
              value={s.mapRunId === null ? "" : String(s.mapRunId)}
              onChange={(v: string) => act(() => lootInventoryUpdate(GAME, id, { mapId: v === "" ? null : Number(v) }))}
              options={[{ value: "", label: "Not assigned" }, ...(maps.data ?? []).map((m) => ({ value: String(m.id), label: `#${String(m.ordinal).padStart(3, "0")} ${mapName(m)} · ${fmtDateTime(m.startedAt)}` }))]}
              className="w-80"
            />
            <span className="pb-2 text-fg-subtle">
              {counted.length} counted · {d.entries.length - counted.length} excluded · {s.screenW}×{s.screenH}
              {s.league && ` · ${s.league}`}
            </span>
          </div>
        </div>
      </Panel>

      <Panel title="Recognised cells" flush actions={<span>edit a name or quantity to correct it; the recognised value is kept</span>}>
        <datalist id="loot-inventory-names">
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <div role="table" className="text-sm">
          <div role="row" className="well grid h-8 grid-cols-[52px_minmax(0,1fr)_92px_92px_52px] items-center gap-3 border-b border-line px-4 text-2xs text-fg-subtle">
            <span>Cell</span>
            <span>Item</span>
            <span>Quantity</span>
            <span>Confidence</span>
            <span className="text-right">Count</span>
          </div>
          <div className="max-h-[520px] overflow-y-auto">
            {[...d.entries].sort((a, b) => Number(needsLook(b)) - Number(needsLook(a)) || a.row - b.row || a.col - b.col).map((e) => (
              <EntryRow key={e.id} e={e} focused={focus === e.id} onFocus={() => setFocus(e.id)} onEdit={(edit) => act(() => lootInventoryEditEntry(GAME, e.id, edit))} />
            ))}
          </div>
        </div>
      </Panel>

      <Panel
        title="Inventory change"
        flush
        actions={
          <span className="flex items-center gap-2">
            compared with
            <Select
              hideLabel
              label="Compare with"
              size="sm"
              value={String(d.delta.againstId ?? "")}
              onChange={(v: string) => setAgainst(v === "" ? null : Number(v))}
              options={[{ value: "", label: "nothing (counts only)" }, ...others.map((o) => ({ value: String(o.id), label: `${fmtDateTime(o.takenAt)}${o.isBaseline ? " · baseline" : ""}${o.status === "review" ? " · unconfirmed" : ""}` }))]}
              className="w-64"
            />
          </span>
        }
      >
        <p className="flex items-start gap-2 border-b border-line px-4 py-2 text-2xs text-fg-muted">
          <Icon name="info" size={13} className="mt-px shrink-0 text-accent-2" />
          This is how your inventory changed — not proof of map loot. Stash transfers, spending, trades and stack splits change it too. “Needs review” lines involve a cell you
          haven't checked.
        </p>
        {d.delta.lines.length === 0 ? (
          <EmptyState icon="journal" title={d.delta.againstId === null ? "Nothing to compare with yet" : "No change"} body={d.delta.againstId === null ? "Confirm this snapshot; the next one is compared with it." : undefined} className="py-8" />
        ) : (
          <div role="table" className="text-sm">
            <div role="row" className="well grid h-8 grid-cols-[minmax(0,1.5fr)_70px_70px_80px_110px_110px] items-center gap-3 border-b border-line px-4 text-2xs text-fg-subtle">
              <span>Item</span>
              <span className="text-right">Before</span>
              <span className="text-right">After</span>
              <span className="text-right">Change</span>
              <span>Status</span>
              <span className="text-right">Value</span>
            </div>
            {d.delta.lines.map((l) => (
              <div key={l.name} role="row" className="grid min-h-9 grid-cols-[minmax(0,1.5fr)_70px_70px_80px_110px_110px] items-center gap-3 border-b border-line px-4 last:border-b-0">
                <span className="truncate text-fg">{l.name}</span>
                <span className="tabular text-right text-fg-muted">{l.before}</span>
                <span className="tabular text-right text-fg-muted">{l.after}</span>
                <span className={cn("tabular text-right font-medium", l.change > 0 ? "text-success" : l.change < 0 ? "text-danger" : "text-fg-muted")}>{l.change > 0 ? `+${l.change}` : l.change}</span>
                <span>
                  <Badge tone={l.status === "confirmed" ? "success" : l.status === "estimated" ? "neutral" : "warning"}>{LINE_LABEL[l.status]}</Badge>
                </span>
                <span className="text-right">{l.value !== null ? <Price amount={l.value} unit={unit} /> : <span className="text-2xs text-fg-subtle">no price</span>}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-2.5 text-xs">
              <span className="text-fg-subtle">{d.delta.needsReview > 0 ? `${d.delta.needsReview} line${d.delta.needsReview === 1 ? "" : "s"} need review and aren't counted` : "All lines checked"}</span>
              <span className="text-fg-muted">
                Estimated inventory gain <Price amount={d.delta.estimatedGain} unit={unit} strong />
              </span>
            </div>
          </div>
        )}
      </Panel>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title="Delete this snapshot?"
        description="Its screenshot, recognition and your corrections are removed from this PC. This can't be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" icon="trash" onClick={() => act(() => lootInventoryDelete(GAME, id), "Snapshot deleted").then(() => (setConfirmDelete(false), onDeleted()))}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

/** Cells the user should look at first. */
const needsLook = (e: InventoryEntry) => !e.excluded && ((!e.corrected && (e.confidence === "low" || e.confidence === "unknown")) || e.name === null || e.quantity === null);

/** The stored inventory crop with a frame per recognised cell, coloured by confidence. */
function Screenshot({
  image,
  grid,
  entries,
  focus,
  onFocus,
}: {
  image: string;
  grid: { left: number; top: number; cell: number };
  entries: InventoryEntry[];
  focus: number | null;
  onFocus: (id: number) => void;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <div className="relative w-full overflow-hidden rounded-md border border-line bg-black">
      <img src={image} alt="Inventory screenshot" className="block w-full" draggable={false} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
      {size &&
        entries.map((e) => {
          const pct = (v: number, of: number) => `${(v / of) * 100}%`;
          return (
            <button
              key={e.id}
              type="button"
              title={`${e.name ?? "Not recognised"}${e.quantity ? ` ×${e.quantity}` : ""} · ${e.confidence}`}
              onClick={() => onFocus(e.id)}
              className={cn(
                "absolute border-2 transition-opacity duration-150",
                e.excluded ? "border-fg-subtle/40 border-dashed" : e.corrected ? "border-info/80" : CONF_BORDER[e.confidence],
                focus === e.id ? "opacity-100 ring-2 ring-white/70" : "opacity-80 hover:opacity-100",
              )}
              style={{
                left: pct(grid.left + e.col * grid.cell + 1, size.w),
                top: pct(grid.top + e.row * grid.cell + 1, size.h),
                width: pct(grid.cell - 2, size.w),
                height: pct(grid.cell - 2, size.h),
              }}
            />
          );
        })}
    </div>
  );
}

function EntryRow({ e, focused, onFocus, onEdit }: { e: InventoryEntry; focused: boolean; onFocus: () => void; onEdit: (edit: { name?: string; quantity?: number; excluded?: boolean; reset?: boolean }) => void }) {
  const [name, setName] = useState(e.name ?? "");
  const [qty, setQty] = useState(e.quantity === null ? "" : String(e.quantity));
  useEffect(() => setName(e.name ?? ""), [e.name]);
  useEffect(() => setQty(e.quantity === null ? "" : String(e.quantity)), [e.quantity]);
  const options = useMemo(() => [e.recognizedName, ...e.alternatives].filter((x): x is string => !!x), [e.recognizedName, e.alternatives]);
  return (
    <div
      role="row"
      onFocusCapture={onFocus}
      className={cn("grid min-h-11 grid-cols-[52px_minmax(0,1fr)_92px_92px_52px] items-center gap-3 border-b border-line px-4 last:border-b-0", focused && "bg-accent-soft/40", e.excluded && "opacity-55")}
    >
      <span className="tabular text-2xs text-fg-subtle">
        r{e.row + 1} · c{e.col + 1}
        {e.tierStrokes >= 2 && <span className="block text-fg-muted">{e.tierStrokes === 2 ? "II" : "III"}</span>}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <Input
          size="sm"
          aria-label="Item"
          list="loot-inventory-names"
          placeholder="Not recognised — type the item"
          value={name}
          onChange={(ev) => setName(ev.target.value.slice(0, 120))}
          onBlur={() => name.trim() !== (e.name ?? "") && onEdit({ name: name.trim() })}
          containerClassName="w-full"
        />
        {e.corrected && (
          <span className="truncate text-2xs text-fg-subtle">
            recognised: {e.recognizedName ?? "nothing"}
            {e.recognizedQuantity !== null && ` ×${e.recognizedQuantity}`}
            <button type="button" className="ml-1.5 text-fg-muted underline-offset-2 hover:underline" onClick={() => onEdit({ reset: true })}>
              undo
            </button>
          </span>
        )}
        {options.length > 1 && !e.corrected && (
          <span className="flex flex-nowrap gap-1 overflow-hidden">
            {options.slice(0, 4).map((o) => (
              <button
                key={o}
                type="button"
                title={o}
                onClick={() => (setName(o), onEdit({ name: o }))}
                className={cn("max-w-[150px] shrink-0 truncate rounded-xs border px-1.5 text-2xs leading-4", o === e.name ? "border-accent/50 text-accent-2" : "border-line text-fg-subtle hover:text-fg")}
              >
                {o}
              </button>
            ))}
          </span>
        )}
      </span>
      <Input
        size="sm"
        aria-label="Quantity"
        type="number"
        min={1}
        placeholder="?"
        value={qty}
        onChange={(ev) => setQty(ev.target.value)}
        onBlur={() => {
          const n = Math.round(Number(qty));
          if (qty.trim() === "" && e.quantity !== null) onEdit({ quantity: 0 });
          else if (n >= 1 && n !== e.quantity) onEdit({ quantity: n });
        }}
      />
      <span className="flex flex-col items-start gap-0.5">
        <span title={`Icon match ${e.iconScore.toFixed(2)} · digits ${e.quantityConfidence.toFixed(2)}`}>
          {e.corrected ? <Badge tone="info">Corrected</Badge> : <Badge tone={CONF_TONE[e.confidence]}>{e.confidence}</Badge>}
        </span>
        {e.recognizedQuantity === null && !e.corrected && <span className="text-2xs text-fg-subtle">qty unread</span>}
      </span>
      <span className="flex justify-end">
        <Checkbox label={<span className="sr-only">Count this cell</span>} checked={!e.excluded} onChange={(on) => onEdit({ excluded: !on })} />
      </span>
    </div>
  );
}
