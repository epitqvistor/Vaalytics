/** Item details: parsed properties (existing PoE 2 parser on the raw copy), valuation history, user actions. */
import { useEffect, useMemo, useState } from "react";
import { lootDelete, lootEdit, lootRevalue, lootSetManualValue, type LootItem, type LootOrigin, type LootStatus } from "@/core/ipc/commands";
import { useLeague } from "@/core/market/LeagueContext";
import { Badge, Button, EmptyState, Input, Modal, SegmentedControl, Select, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { Price } from "@/shared/views/common";
import { PriceCheckSession } from "@/shared/views/price-check/PriceCheckSession";
import { POE2_CONFIG } from "../config";
import { parsePoe2Item } from "../parser";
import { useLootDetail } from "./hooks";
import { categoryLabel, VALUE_STATUS_LABEL } from "./stats";
import { fmtDateTime, ValueCell } from "./ui";

const GAME = "poe2" as const;
const unit = POE2_CONFIG.baseUnit;

const STATUSES = [
  { value: "captured", label: "Captured" },
  { value: "kept", label: "Kept" },
  { value: "sold", label: "Sold" },
  { value: "discarded", label: "Discarded" },
] as const;
const ORIGINS = [
  { value: "unknown", label: "Origin unknown" },
  { value: "user_confirmed_drop", label: "I confirm it dropped then" },
  { value: "user_not_a_drop", label: "Not a drop (stash, trade…)" },
] as const;

export function ItemDetailModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const detail = useLootDetail(id);
  const d = detail.data;
  return (
    <Modal open={id !== null} onClose={onClose} title="Item details" size="lg">
      {detail.error ? (
        <EmptyState icon="error" title="Couldn't load the item" body={detail.error} />
      ) : !d ? (
        <EmptyState icon="journal" title="Loading…" loading />
      ) : (
        <Detail key={d.item.id} item={d.item} raw={d.rawText} valuations={d.valuations} reload={detail.reload} onDeleted={onClose} />
      )}
    </Modal>
  );
}

function Detail({ item, raw, valuations, reload, onDeleted }: { item: LootItem; raw: string; valuations: import("@/core/ipc/commands").LootValuation[]; reload: () => void; onDeleted: () => void }) {
  const notify = useToast();
  const { league } = useLeague();
  const parsed = useMemo(() => parsePoe2Item(raw), [raw]);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [tags, setTags] = useState(item.tags.join(", "));
  const [manual, setManual] = useState("");
  const [trade, setTrade] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setNotes(item.notes ?? ""), [item.notes]);

  const act = async (f: () => Promise<unknown>, ok?: string) => {
    try {
      await f();
      if (ok) notify("success", ok);
      reload();
    } catch (e) {
      notify("warning", "That didn't work", String(e));
    }
  };
  const edit = (e: Parameters<typeof lootEdit>[2], ok?: string) => act(() => lootEdit(GAME, item.id, e), ok);
  const warnings = [...item.parserWarnings, ...(parsed.ok ? parsed.item.unparsed.map((l) => `Not recognised: ${l}`) : [`Full parser: ${parsed.error}`])];

  return (
    <div className="flex max-h-[72vh] flex-col gap-5 overflow-y-auto pr-1 text-sm">
      {/* identity */}
      <div className="flex flex-wrap items-center gap-2">
        {item.icon && <img src={item.icon} alt="" className="size-8 object-contain" />}
        <div className="min-w-0">
          {item.itemName && <p className="font-display text-base font-semibold text-fg">{item.itemName}</p>}
          <p className={item.itemName ? "text-fg-muted" : "font-display text-base font-semibold text-fg"}>{item.baseType}</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Badge tone={item.rarity === "Unique" ? "accent" : "neutral"}>{item.rarity}</Badge>
          <Badge>{categoryLabel(item.category)}</Badge>
          {item.corrupted && <Badge tone="danger">Corrupted</Badge>}
          {item.unidentified && <Badge tone="warning">Unidentified</Badge>}
          <Badge tone={item.parserConfidence === "high" ? "success" : item.parserConfidence === "medium" ? "warning" : "danger"}>Parser: {item.parserConfidence}</Badge>
        </div>
      </div>

      {/* value */}
      <section className="rounded-md border border-line bg-bg-2/60 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-2xs text-fg-subtle">Estimated value{item.stackSize && item.stackSize > 1 ? ` (stack of ${item.stackSize})` : ""}</p>
            <div className="mt-0.5 text-base">
              <ValueCell item={item} strong full />
            </div>
          </div>
          <span className="text-2xs text-fg-subtle">{item.valueCheckedAt ? `checked ${fmtDateTime(item.valueCheckedAt)}` : "not checked yet"}</span>
          {item.valueNote && <p className="basis-full text-2xs leading-relaxed text-fg-muted">{item.valueNote}</p>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => act(() => lootRevalue(GAME, [item.id]), "Price rechecked")}>
              Recheck price
            </Button>
            <Input size="sm" type="number" min={0} placeholder="your value" aria-label="Your value in exalted" value={manual} onChange={(e) => setManual(e.target.value)} suffix={unit.short} containerClassName="w-32" />
            <Button
              size="sm"
              disabled={manual.trim() === "" || !(Number(manual) >= 0)}
              onClick={() => act(() => lootSetManualValue(GAME, item.id, Number(manual), null), "Value saved").then(() => setManual(""))}
            >
              Set value
            </Button>
            {item.valueStatus === "manual" && (
              <Button size="sm" variant="ghost" onClick={() => act(() => lootSetManualValue(GAME, item.id, null, null), "Back to automatic pricing")}>
                Use automatic
              </Button>
            )}
          </div>
        </div>
        {valuations.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <p className="mb-1 text-2xs text-fg-subtle">Valuation history (a row is added only when the value changes)</p>
            <ul className="divide-y divide-line text-xs">
              {[...valuations].reverse().map((v) => (
                <li key={v.id} className="grid grid-cols-[130px_minmax(0,1fr)_110px] items-center gap-3 py-1.5">
                  <span className="tabular text-fg-subtle">{fmtDateTime(v.at)}</span>
                  <span className="min-w-0 truncate text-fg-muted" title={v.note ?? undefined}>
                    {VALUE_STATUS_LABEL[v.status]} · {v.source}
                    {v.marketCategory && ` · ${v.marketCategory}`}
                    {v.confidence && ` · ${v.confidence} confidence`}
                    {v.dataFetchedAt && ` · data from ${fmtDateTime(v.dataFetchedAt)}`}
                    {v.note && <span className="text-fg-subtle"> · {v.note}</span>}
                  </span>
                  <span className="text-right">{v.totalValue === null ? <span className="text-fg-subtle">—</span> : <Price amount={v.totalValue} unit={unit} />}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(item.rarity === "Rare" || item.rarity === "Magic" || (item.rarity === "Unique" && !item.unidentified)) && parsed.ok && (
          <div className="mt-3 border-t border-line pt-3">
            {!trade ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                <span>Items like this are priced by their modifiers. You can search live listings on the official Trade site:</span>
                <Button size="sm" variant="secondary" icon="priceCheck" disabled={!league} onClick={() => setTrade(true)}>
                  Check live listings
                </Button>
              </div>
            ) : (
              league && <PriceCheckSession item={parsed.item} league={league} config={POE2_CONFIG} compact />
            )}
          </div>
        )}
      </section>

      {/* capture & origin */}
      <section className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        <Field label="Captured">{fmtDateTime(item.capturedAt)}{item.captureCount > 1 && ` · copied ${item.captureCount}× (last ${fmtDateTime(item.lastCapturedAt)})`}</Field>
        <Field label="Session">{item.sessionId !== null ? `#${item.sessionId}${item.sessionElapsedSecs !== null ? ` · ${Math.round(item.sessionElapsedSecs / 60)} min in` : ""}` : "none (no active session)"}</Field>
        <Field label="Area when copied">{item.captureAreaName ? `${item.captureAreaName}${item.captureAreaKind ? ` (${item.captureAreaKind})` : ""}` : "—"}</Field>
      </section>
      <p className="-mt-3 flex items-start gap-1.5 text-2xs text-fg-subtle">
        <Icon name="info" size={12} className="mt-px shrink-0" />
        Where an item was copied isn't where it dropped — it may have come from your stash or a trade. Origin stays unknown unless you set it.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Origin" value={item.originStatus} onChange={(v: LootOrigin) => edit({ originStatus: v })} options={ORIGINS} className="w-64" />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Status</span>
          <SegmentedControl label="Status" size="sm" value={item.status} onChange={(v: LootStatus) => edit({ status: v })} segments={STATUSES} />
        </div>
        <Button size="sm" variant={item.favorite ? "primary" : "secondary"} icon="star" onClick={() => edit({ favorite: !item.favorite })}>
          {item.favorite ? "Favourite" : "Mark favourite"}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Tags (comma separated)" value={tags} onChange={(e) => setTags(e.target.value.slice(0, 400))} onBlur={() => edit({ tags: tags.split(",").map((t) => t.trim()).filter(Boolean) })} />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-muted">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
            onBlur={() => notes !== (item.notes ?? "") && edit({ notes })}
            className="well h-16 resize-none rounded-md p-2 text-xs text-fg focus-visible:border-accent/55 focus-visible:outline-none"
          />
        </label>
      </div>

      {/* parsed item */}
      {parsed.ok && (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-fg">Properties</h3>
            <ul className="space-y-0.5 text-xs">
              {parsed.item.itemLevel !== undefined && <Prop k="Item level" v={parsed.item.itemLevel} />}
              {parsed.item.quality !== undefined && <Prop k="Quality" v={`${parsed.item.quality}%`} />}
              {parsed.item.stackSize && <Prop k="Stack size" v={`${parsed.item.stackSize.current}${parsed.item.stackSize.max ? ` / ${parsed.item.stackSize.max}` : ""}`} />}
              {parsed.item.requirements && (
                <Prop
                  k="Requires"
                  v={[
                    parsed.item.requirements.level && `Level ${parsed.item.requirements.level}`,
                    parsed.item.requirements.str && `${parsed.item.requirements.str} Str`,
                    parsed.item.requirements.dex && `${parsed.item.requirements.dex} Dex`,
                    parsed.item.requirements.int && `${parsed.item.requirements.int} Int`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                />
              )}
              {parsed.item.sockets && <Prop k="Sockets" v={parsed.item.sockets} />}
              {parsed.item.properties.map((p, i) => (
                <Prop key={i} k={p.name} v={p.value} />
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-fg">Modifiers</h3>
            {parsed.item.mods.length === 0 ? (
              <p className="text-xs text-fg-subtle">None</p>
            ) : (
              <ul className="space-y-0.5 text-xs">
                {parsed.item.mods.map((m) => (
                  <li key={m.id} className="flex gap-2">
                    <span className="w-20 shrink-0 text-fg-subtle">{m.generation ?? m.kind}</span>
                    <span className="text-fg">
                      {m.text}
                      {m.tier !== undefined && <span className="text-fg-subtle"> (T{m.tier})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
      {warnings.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold text-fg">Parser notes</h3>
          <ul className="list-disc space-y-0.5 pl-4 text-2xs text-warning">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-fg">Original item text</h3>
          <Button
            size="sm"
            variant="ghost"
            icon="copy"
            onClick={() => navigator.clipboard.writeText(raw).then(() => notify("success", "Item text copied"), () => notify("warning", "Couldn't copy to the clipboard"))}
          >
            Copy
          </Button>
        </div>
        <pre className="well max-h-48 overflow-auto rounded-md p-2.5 text-2xs leading-relaxed whitespace-pre-wrap text-fg-muted">{raw.replaceAll(String.fromCharCode(13), "")}</pre>
      </section>
      <div className="flex justify-end border-t border-line pt-3">
        {confirmDelete ? (
          <span className="flex items-center gap-2 text-xs text-fg-muted">
            Delete this entry and its valuation history?
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" icon="trash" onClick={() => act(() => lootDelete(GAME, [item.id]), "Entry deleted").then(onDeleted)}>
              Delete
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
            Delete entry
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs text-fg-subtle">{label}</p>
      <p className="mt-0.5 text-fg">{children}</p>
    </div>
  );
}

function Prop({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <li className={cn("flex gap-2")}>
      <span className="w-28 shrink-0 text-fg-subtle">{k}</span>
      <span className="text-fg">{v}</span>
    </li>
  );
}
