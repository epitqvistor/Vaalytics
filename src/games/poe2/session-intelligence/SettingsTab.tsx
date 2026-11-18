/** Session Intelligence settings: tracking, Client.txt, notifications, data, performance. */
import { useState } from "react";
import { sessionChooseLog, sessionClearLog, sessionExport, sessionReset, sessionSetConfig, sessionDelete, sessionList, type SessionConfig, type SessionStatus } from "@/core/ipc/commands";
import { Button, Modal, Panel, Select, Switch, useToast } from "@/shared/components";

const GAME = "poe2" as const;

const POLL = [
  { value: "3", label: "Every 3 s" },
  { value: "5", label: "Every 5 s (default)" },
  { value: "10", label: "Every 10 s" },
  { value: "15", label: "Every 15 s" },
  { value: "30", label: "Every 30 s" },
] as const;
const RETENTION = [
  { value: "0", label: "Keep forever" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
] as const;

export function SettingsTab({ status, setStatus }: { status: SessionStatus; setStatus: (s: SessionStatus) => void }) {
  const notify = useToast();
  const c = status.config;
  const [confirm, setConfirm] = useState<"history" | "reset" | null>(null);

  const save = async (patch: Partial<SessionConfig>) => {
    try {
      setStatus(await sessionSetConfig(GAME, { ...c, ...patch }));
    } catch (e) {
      notify("warning", "Couldn't save the setting", String(e));
    }
  };
  const run = async (f: () => Promise<SessionStatus | null>, ok?: string) => {
    try {
      const s = await f();
      if (s) {
        setStatus(s);
        if (ok) notify("success", ok);
      }
    } catch (e) {
      notify("warning", "That didn't work", String(e));
    }
  };
  const exportAll = async (format: "json" | "csv") => {
    try {
      if (await sessionExport(GAME, [], format)) notify("success", "Sessions exported", format.toUpperCase());
    } catch (e) {
      notify("warning", "Couldn't export", String(e));
    }
  };
  const deleteHistory = async () => {
    try {
      const all = await sessionList(GAME, { limit: 5000 });
      const n = await sessionDelete(GAME, all.filter((s) => s.status === "completed").map((s) => s.id));
      notify("success", `Deleted ${n} session${n === 1 ? "" : "s"}`);
    } catch (e) {
      notify("warning", "Couldn't delete", String(e));
    }
    setConfirm(null);
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Panel title="Tracking">
        <div className="flex flex-col gap-4">
          <Switch label="Detect the game automatically" description="Checks the process list for Path of Exile 2. Nothing else runs while the game is closed." checked={c.autoDetect} onChange={(v) => save({ autoDetect: v })} />
          <Switch label="Track sessions automatically" description="Start a session when the game starts and save it when the game closes." checked={c.autoTrack} onChange={(v) => save({ autoTrack: v })} disabled={!c.autoDetect} />
          <Switch label="Start when the game is already running" description="If Path of Exile 2 is open when Vaalytics starts, track that run (from the start of its Client.txt entries)." checked={c.attachToRunning} onChange={(v) => save({ attachToRunning: v })} />
          <Switch label="Keep sessions shorter than 2 minutes" description="Off: quick launches without any map are not saved." checked={c.keepShortSessions} onChange={(v) => save({ keepShortSessions: v })} />
        </div>
      </Panel>

      <Panel title="Client.txt">
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-line bg-bg-2/60 px-3 py-2.5 text-xs">
            <p className="text-fg">{status.log.found ? status.log.label : "Not found"}</p>
            <p className="mt-0.5 text-fg-subtle">
              {status.log.found ? (status.log.manual ? "Chosen by you" : "Found automatically") : (status.log.error ?? "Choose the file below.")}
              {status.log.found && !status.log.confirmedPoe2 && " · no PoE 2 entries yet (fine for a fresh log)"}
            </p>
          </div>
          <Switch label="Find Client.txt automatically" description="Looks in the running game's folder, your Steam libraries and the standalone install folder." checked={c.autoDiscover} onChange={(v) => save({ autoDiscover: v })} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => run(() => sessionChooseLog(GAME), "Client.txt set")}>
              Choose Client.txt…
            </Button>
            {status.log.manual && (
              <Button size="sm" variant="ghost" onClick={() => run(() => sessionClearLog(GAME), "Using auto-discovery")}>
                Use auto-discovery
              </Button>
            )}
          </div>
          <p className="text-2xs leading-relaxed text-fg-subtle">
            Usually <span className="text-fg-muted">…\steamapps\common\Path of Exile 2\logs\Client.txt</span> (Steam) or{" "}
            <span className="text-fg-muted">…\Grinding Gear Games\Path of Exile 2\logs\Client.txt</span> (standalone). The file is only read — never changed or opened in another program.
          </p>
        </div>
      </Panel>

      <Panel title="Notifications">
        <Switch
          label="Notify when a session ends"
          description="Shows an in-app notification with the session summary when the game closes (Vaalytics must be open)."
          checked={c.notifyOnSummary}
          onChange={(v) => save({ notifyOnSummary: v })}
        />
      </Panel>

      <Panel title="Performance">
        <div className="flex flex-col gap-4">
          <Select label="Game detection interval" value={String(c.pollSecs) as (typeof POLL)[number]["value"]} onChange={(v) => save({ pollSecs: Number(v) })} options={POLL} className="w-56" />
          <p className="-mt-2 text-2xs text-fg-subtle">While the game runs, new Client.txt lines are read every 2 seconds.</p>
          <Switch label="Debug logging" description="Writes every recognised log event to the Vaalytics log file (for troubleshooting)." checked={c.debugLogging} onChange={(v) => save({ debugLogging: v })} />
        </div>
      </Panel>

      <Panel title="Data" className="xl:col-span-2">
        <div className="flex flex-wrap items-end gap-4">
          <Select label="Keep history" value={String(c.retentionDays) as (typeof RETENTION)[number]["value"]} onChange={(v) => save({ retentionDays: Number(v) })} options={RETENTION} className="w-44" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon="download" onClick={() => exportAll("json")}>
              Export all (JSON)
            </Button>
            <Button size="sm" variant="secondary" icon="download" onClick={() => exportAll("csv")}>
              Export all (CSV)
            </Button>
            <Button size="sm" variant="danger" icon="trash" onClick={() => setConfirm("history")}>
              Delete history
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirm("reset")}>
              Reset Session Intelligence
            </Button>
          </div>
        </div>
        <p className="mt-3 text-2xs text-fg-subtle">Sessions are stored only in Vaalytics' local database on this PC.</p>
      </Panel>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm === "reset" ? "Reset Session Intelligence?" : "Delete all session history?"}
        description={
          confirm === "reset"
            ? "Deletes every completed session, forgets the chosen Client.txt and the read position, and restores default settings. A session in progress continues. This can't be undone."
            : "Deletes every completed session with its areas and events. A session in progress continues. This can't be undone."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => (confirm === "reset" ? run(() => sessionReset(GAME), "Session Intelligence reset").then(() => setConfirm(null)) : deleteHistory())}
            >
              {confirm === "reset" ? "Reset" : "Delete"}
            </Button>
          </>
        }
      />
    </div>
  );
}
