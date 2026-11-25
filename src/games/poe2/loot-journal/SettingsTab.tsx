/** Loot Journal settings: capture, valuation, notifications, storage. Persisted in Rust (`loot.config`). */
import { useState } from "react";
import { lootClear, lootExport, lootImport, lootSetConfig, type LootConfig } from "@/core/ipc/commands";
import { Button, Input, Modal, Panel, Select, Switch, useToast } from "@/shared/components";
import { TrackerSettings } from "./TrackerSettings";

const GAME = "poe2" as const;
const DUPES = [
  { value: "merge", label: "Same item again updates the entry (default)" },
  { value: "cooldown", label: "New entry after the cooldown" },
  { value: "always", label: "Every copy is a new entry" },
] as const;
const COOLDOWNS = ["5", "15", "30", "60", "240"].map((v) => ({ value: v, label: `${v} minutes` }));
const REVALUE = [
  { value: "0", label: "Off" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour (default)" },
  { value: "240", label: "Every 4 hours" },
  { value: "1440", label: "Once a day" },
];
const CONFIDENCE = [
  { value: "low", label: "Any (low and up)" },
  { value: "medium", label: "Medium and up" },
  { value: "high", label: "High only" },
] as const;
const REQUESTS = ["0", "2", "4", "8"].map((v) => ({ value: v, label: v === "0" ? "None (cached data only)" : `Up to ${v} categories` }));
const RETENTION = [
  { value: "0", label: "Keep forever" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

export function SettingsTab({ config, setConfig }: { config: LootConfig; setConfig: (c: LootConfig) => void }) {
  const notify = useToast();
  const [threshold, setThreshold] = useState(config.notifyThreshold ? String(config.notifyThreshold) : "");
  const [confirmClear, setConfirmClear] = useState(false);
  const save = async (patch: Partial<LootConfig>) => {
    try {
      setConfig(await lootSetConfig(GAME, { ...config, ...patch }));
    } catch (e) {
      notify("warning", "Couldn't save the setting", String(e));
    }
  };
  const pick = <T extends string>(v: T, opts: readonly { value: string }[]) => (opts.some((o) => o.value === v) ? v : (opts[0]!.value as T));

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title="Capture">
        <div className="flex flex-col gap-4">
          <Switch
            label="Capture items automatically"
            description="While a Path of Exile 2 window is active, an item copied with Ctrl+C is saved here. Works with Vaalytics minimised. Other copies (and other programs) are ignored."
            checked={config.enabled}
            onChange={(v) => save({ enabled: v })}
          />
          <Select label="Copying the same item again" value={config.duplicateMode} onChange={(v) => save({ duplicateMode: v })} options={DUPES} className="w-80" />
          {config.duplicateMode === "cooldown" && (
            <Select label="Cooldown" value={pick(String(config.cooldownMinutes), COOLDOWNS)} onChange={(v) => save({ cooldownMinutes: Number(v) })} options={COOLDOWNS} className="w-44" />
          )}
          <p className="text-2xs leading-relaxed text-fg-subtle">
            Identical copies are recognised by a fingerprint of the full item text (any different roll, stack size or quality is a different item). Repeated clipboard notifications within 3 seconds are
            always ignored. Items are categorised from their item class automatically, and the original text is always kept so it can be re-read by newer parser versions.
          </p>
        </div>
      </Panel>

      <Panel title="Valuation">
        <div className="flex flex-col gap-4">
          <Switch label="Price items automatically" description="From cached poe.ninja exchange data (currency, runes, essences, omens…). Rare, unique and other equipment isn't priced automatically." checked={config.autoValue} onChange={(v) => save({ autoValue: v })} />
          <Select label="Revaluation" value={pick(String(config.revalueMinutes), REVALUE)} onChange={(v) => save({ revalueMinutes: Number(v) })} options={REVALUE} className="w-56" />
          <Select label="Minimum pricing confidence" value={config.minConfidence} onChange={(v) => save({ minConfidence: v })} options={CONFIDENCE} className="w-56" />
          <Select label="Market refreshes per pass" value={pick(String(config.maxRequests), REQUESTS)} onChange={(v) => save({ maxRequests: Number(v) })} options={REQUESTS} className="w-56" />
          <p className="text-2xs leading-relaxed text-fg-subtle">
            Values use the market league chosen in Currency Tracker and are stored in Exalted Orbs; tables follow your “Prices in” choice. Refreshes go through the Market engine, which only
            downloads data whose cache has expired.
          </p>
        </div>
      </Panel>

      <TrackerSettings config={config} setConfig={setConfig} />

      <Panel title="Notifications">
        <div className="flex flex-col gap-4">
          <Switch label="Every captured item" checked={config.notifyCaptures} onChange={(v) => save({ notifyCaptures: v })} />
          <Switch label="Unique items" checked={config.notifyUnique} onChange={(v) => save({ notifyUnique: v })} />
          <div className="flex items-end gap-2">
            <Input label="Valuable items worth at least" type="number" min={0} placeholder="off" value={threshold} onChange={(e) => setThreshold(e.target.value)} suffix="ex" containerClassName="w-56" />
            <Button size="sm" variant="secondary" onClick={() => save({ notifyThreshold: threshold.trim() === "" ? 0 : Math.max(0, Number(threshold) || 0) })}>
              Save
            </Button>
          </div>
          <Switch label="Market value changed by 25% or more" checked={config.notifyValueChanges} onChange={(v) => save({ notifyValueChanges: v })} />
          <Switch label="Capture errors" checked={config.notifyErrors} onChange={(v) => save({ notifyErrors: v })} />
          <p className="text-2xs text-fg-subtle">In-app notifications; all off by default.</p>
        </div>
      </Panel>

      <Panel title="Storage">
        <div className="flex flex-col gap-4">
          <Select label="Keep items" value={pick(String(config.retentionDays), RETENTION)} onChange={(v) => save({ retentionDays: Number(v) })} options={RETENTION} className="w-44" />
          <p className="-mt-2 text-2xs text-fg-subtle">Favourites are always kept. Applied when Vaalytics starts.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon="download" onClick={() => lootExport(GAME, [], "json").then((ok) => ok && notify("success", "Loot Journal exported"), (e) => notify("warning", "Couldn't export", String(e)))}>
              Export (JSON)
            </Button>
            <Button size="sm" variant="secondary" icon="download" onClick={() => lootExport(GAME, [], "csv").then((ok) => ok && notify("success", "Loot Journal exported"), (e) => notify("warning", "Couldn't export", String(e)))}>
              Export (CSV)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                lootImport(GAME).then(
                  (r) => r && notify("success", "Import finished", `${r.imported} imported · ${r.skippedDuplicates} already present · ${r.rejected} not item text`),
                  (e) => notify("warning", "Couldn't import", String(e)),
                )
              }
            >
              Import (JSON)
            </Button>
            <Button size="sm" variant="danger" icon="trash" onClick={() => setConfirmClear(true)}>
              Clear Loot Journal
            </Button>
          </div>
          <p className="text-2xs text-fg-subtle">Delete selected items in the Library. Everything is stored only in Vaalytics' local database.</p>
        </div>
      </Panel>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        size="sm"
        title="Clear the Loot Journal?"
        description="Deletes every captured item, its valuation history and the capture log. This can't be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={() =>
                lootClear(GAME).then(
                  (n) => (notify("success", `Deleted ${n} item${n === 1 ? "" : "s"}`), setConfirmClear(false)),
                  (e) => notify("warning", "Couldn't clear", String(e)),
                )
              }
            >
              Clear
            </Button>
          </>
        }
      />
    </div>
  );
}
