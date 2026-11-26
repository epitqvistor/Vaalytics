/** Update Center settings (schedules, auto-apply, retention) and the separate application-update status. */
import { useEffect, useState } from "react";
import { updatesAppInfo, updatesSetSettings, type UpdAppInfo, type UpdSettings } from "@/core/ipc/commands";
import type { UpdateCenter } from "@/core/updates/hooks";
import { Badge, Button, Input, Panel, Select, Switch, useToast } from "@/shared/components";
import { scheduleLabel } from "@/core/updates/logic";
import { Field } from "./ui";

const MODES = ["manual", "startup", "6h", "12h", "24h"];

function ScheduleSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const isCustom = !MODES.includes(value);
  const [custom, setCustom] = useState(isCustom ? value.replace(/h$/, "") : "48");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        label={label}
        size="sm"
        value={isCustom ? "custom" : value}
        onChange={(v) => onChange(v === "custom" ? `${custom}h` : v)}
        options={[...MODES.map((m) => ({ value: m, label: scheduleLabel(m) })), { value: "custom", label: "Custom interval" }]}
      />
      {isCustom && (
        <Input
          size="sm"
          type="number"
          min={1}
          max={168}
          value={custom}
          suffix="hours"
          containerClassName="w-32"
          aria-label={`${label} custom interval in hours`}
          onChange={(e) => {
            setCustom(e.target.value);
            const n = Math.round(Number(e.target.value));
            if (n >= 1 && n <= 168) onChange(`${n}h`);
          }}
        />
      )}
    </div>
  );
}

export function SettingsTab({ uc }: { uc: UpdateCenter }) {
  const toast = useToast();
  const [s, setS] = useState<UpdSettings>(uc.overview!.settings);
  const [app, setApp] = useState<UpdAppInfo | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    updatesAppInfo()
      .then(setApp)
      .catch(() => setApp(null));
  }, []);
  const dirty = JSON.stringify(s) !== JSON.stringify(uc.overview!.settings);

  const save = () => {
    setSaving(true);
    updatesSetSettings(s)
      .then((v) => {
        setS(v);
        uc.bump();
        toast("success", "Update settings saved");
      })
      .catch((e) => toast("error", "Couldn't save", String(e)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel
        title="Game data updates"
        actions={
          <Button size="sm" disabled={!dirty} loading={saving} onClick={save}>
            Save
          </Button>
        }
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-fg-muted">
            Scheduled runs never block startup (the first one waits 20 s), never run twice at once, and retry failed sources with growing back-off (15 min, 30 min, 1 h … up to the
            interval). Nothing is checked while Vaalytics is closed. Market prices aren’t scheduled here: the Market engine refreshes them only while a view shows them.
          </p>
          <ScheduleSelect label="Game data (Divination Cards)" value={s.schedules.gameData} onChange={(v) => setS({ ...s, schedules: { ...s.schedules, gameData: v } })} />
          <ScheduleSelect label="League index (both games)" value={s.schedules.leagues} onChange={(v) => setS({ ...s, schedules: { ...s.schedules, leagues: v } })} />
          <ScheduleSelect label="Official patch notes and news" value={s.schedules.patchNotes} onChange={(v) => setS({ ...s, schedules: { ...s.schedules, patchNotes: v } })} />
          <Switch
            checked={s.autoApply}
            onChange={(v) => setS({ ...s, autoApply: v })}
            label="Apply safe updates automatically"
            description="Scheduled runs and Synchronize all install updates from established sources that pass validation and need no review. Structure changes, mass removals and unverified sources always wait for you."
          />
          <Input
            label="Previous versions kept per dataset"
            hint="Older versions keep their history entry but lose their data, so they can no longer be restored."
            size="sm"
            type="number"
            min={1}
            max={50}
            value={s.retention}
            containerClassName="w-60"
            onChange={(e) => setS({ ...s, retention: Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))) })}
          />
        </div>
      </Panel>

      <Panel title="Application updates" actions={<Badge tone="warning">Not configured</Badge>}>
        <dl>
          <Field label="Installed version">{app?.version ?? "—"}</Field>
          <Field label="Distribution">{app?.distribution ?? "—"}</Field>
          <Field label="Automatic updates">Not available in this version.</Field>
        </dl>
        <div className="mt-3 space-y-2 text-xs leading-relaxed text-fg-muted">
          <p>
            Application updates are a separate system from game data: game data never needs a reinstall, and installing a new Vaalytics version keeps your settings, league profiles,
            history and sessions (they live in your app-data folder, not in the install folder).
          </p>
          <p>A safe self-updater needs infrastructure that doesn’t exist yet:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>a public release source the app can read without a token (the release repository is private, and a token must never be built into the app);</li>
            <li>signed update packages (Tauri updater signature) with a public key in the app and the private key kept only by the maintainer;</li>
            <li>an explicit “Download and install” step — never an automatic install.</li>
          </ul>
          <p>Until then, install new versions from the installer you receive. Details: docs/development/release.md → “Application updates”.</p>
        </div>
      </Panel>
    </div>
  );
}
