/** Overview: capture status, headline numbers and the latest captures. */
import { useEffect, useMemo, useState } from "react";
import { lootEvents, type LootCaptureEventRow, type LootCaptureStatus, type LootItem } from "@/core/ipc/commands";
import { EmptyState, Panel, StatTile } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { Price } from "@/shared/views/common";
import { POE2_CONFIG } from "../config";
import { useLootUpdates } from "./hooks";
import { capturedSince, categoryLabel, displayName, lootTotals, startOfWeek } from "./stats";
import { CaptureBadge, fmtDateTime, ValueCell } from "./ui";

export function OverviewTab({ items, status, onOpen }: { items: LootItem[]; status: LootCaptureStatus | null; onOpen: (id: number) => void }) {
  const [now] = useState(() => Date.now());
  const t = useMemo(() => lootTotals(items), [items]);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const [events, setEvents] = useState<LootCaptureEventRow[]>([]);
  const loadEvents = () => {
    lootEvents("poe2", 8)
      .then(setEvents)
      .catch(() => setEvents([]));
  };
  useEffect(loadEvents, []);
  useLootUpdates(loadEvents);
  const errors = events.filter((e) => e.kind === "error");

  return (
    <div className="flex flex-col gap-5">
      <Panel title={<span className="flex items-center gap-2">Automatic capture {status && <CaptureBadge listening={status.listening} enabled={status.enabled} />}</span>}>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-2 text-xs text-fg-muted">
          <p className="max-w-xl leading-relaxed">
            Hover an item in Path of Exile 2 and press <span className="text-fg">Ctrl+C</span>. Vaalytics reads the clipboard only right after a copy while the game window is active, keeps
            only item text, and saves it here — no Save button needed.
          </p>
          <div>
            <p className="text-2xs text-fg-subtle">Last capture</p>
            <p className="mt-0.5 text-sm text-fg">{status?.lastCaptureAt ? `${status.lastItemName ?? "Item"} · ${fmtDateTime(status.lastCaptureAt)}` : "None yet in this run"}</p>
          </div>
          {status && !status.available && (
            <p className="flex items-center gap-1.5 text-warning">
              <Icon name="warning" size={13} /> The clipboard listener couldn't start; see the Vaalytics log.
            </p>
          )}
          {status?.lastError && (
            <p className="flex items-center gap-1.5 text-warning">
              <Icon name="warning" size={13} /> {status.lastError}
            </p>
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Captured items" value={t.items} caption={`${capturedSince(items, today.getTime())} today · ${capturedSince(items, startOfWeek(now))} this week`} />
        <StatTile label="Captured value" value={<Price amount={t.value} unit={POE2_CONFIG.baseUnit} />} caption={`${t.valued} priced item${t.valued === 1 ? "" : "s"} — captured only, not all loot`} />
        <StatTile label="Unpriced" value={t.unpriced} caption="manual valuation or no market data" />
        <StatTile label="Top category" value={t.topCategory ? categoryLabel(t.topCategory.category) : "—"} caption={t.topCategory ? `${t.topCategory.count} item${t.topCategory.count === 1 ? "" : "s"}` : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Latest captures" flush>
          {items.length === 0 ? (
            <EmptyState icon="journal" title="Nothing captured yet" body="Copy an item in Path of Exile 2 with Ctrl+C while Vaalytics is running — it appears here automatically." />
          ) : (
            <ul className="divide-y divide-line">
              {items.slice(0, 10).map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onOpen(i.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-white/[0.02]">
                    <span className="flex size-6 shrink-0 items-center justify-center">{i.icon ? <img src={i.icon} alt="" className="size-6 object-contain" /> : <Icon name="journal" size={14} className="text-fg-subtle" />}</span>
                    <span className="min-w-0 flex-1 truncate text-fg">
                      {displayName(i)}
                      {i.stackSize && i.stackSize > 1 && <span className="text-fg-subtle"> ×{i.stackSize}</span>}
                    </span>
                    <span className="hidden text-xs text-fg-subtle sm:inline">{categoryLabel(i.category)}</span>
                    <span className="w-28 text-right">
                      <ValueCell item={i} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Most valuable capture">
          {t.mostValuable ? (
            <button type="button" onClick={() => onOpen(t.mostValuable!.id)} className="flex w-full flex-col items-start gap-1 text-left">
              <span className="font-display text-base font-semibold text-fg">{displayName(t.mostValuable)}</span>
              <span className="text-xs text-fg-muted">
                {categoryLabel(t.mostValuable.category)} · captured {fmtDateTime(t.mostValuable.capturedAt)}
              </span>
              <span className="mt-1 text-lg">
                <ValueCell item={t.mostValuable} strong />
              </span>
            </button>
          ) : (
            <p className="text-xs text-fg-muted">No priced captures yet.</p>
          )}
          {errors.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1 text-xs font-semibold text-fg">Recent capture errors</p>
              <ul className="space-y-0.5 text-2xs text-warning">
                {errors.slice(0, 4).map((e, k) => (
                  <li key={k}>
                    {fmtDateTime(e.at)} · {e.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
