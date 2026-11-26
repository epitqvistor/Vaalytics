/** Game data: every dataset a module depends on, its installed and previous versions, rollback. */
import { useEffect, useState } from "react";
import type { GameId } from "@/core/game-context/games";
import { updatesRefreshManaged, updatesRollback, updatesVersions, type UpdDatasetStatus, type UpdVersion } from "@/core/ipc/commands";
import type { UpdateCenter } from "@/core/updates/hooks";
import { freshness } from "@/core/updates/logic";
import { Badge, Button, Modal, Panel, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { Field, FreshnessBadge, moduleLabel, stamp, Time, ValidationBadge } from "./ui";

const KIND: Record<UpdDatasetStatus["def"]["kind"], string> = {
  versioned: "Versioned by the Update Center",
  managed: "Kept by an existing engine",
  bundled: "Ships with the app",
};

export function GameDataTab({ uc }: { uc: UpdateCenter }) {
  const o = uc.overview!;
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {(["poe1", "poe2"] as GameId[]).map((g) => (
        <Panel key={g} title={g === "poe1" ? "Path of Exile 1" : "Path of Exile 2"} flush>
          <ul className="divide-y divide-line">
            {o.datasets
              .filter((d) => d.def.game === g)
              .map((d) => (
                <li key={d.def.id}>
                  <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-glass" onClick={() => setOpen(open === d.def.id ? null : d.def.id)} aria-expanded={open === d.def.id}>
                    <Icon name={open === d.def.id ? "chevronDown" : "chevronRight"} size={14} className="text-fg-subtle" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-fg">{d.def.label}</span>
                      <span className="block truncate text-xs text-fg-subtle">{KIND[d.def.kind]} · {d.consumers.map(moduleLabel).join(", ") || "no module"}</span>
                    </span>
                    {d.pending > 0 && <Badge tone="accent">{d.pending} pending</Badge>}
                    {d.installed && <span className="text-xs text-fg-subtle">v {d.installed.label}</span>}
                    <FreshnessBadge f={freshness(d, o.now)} />
                  </button>
                  {open === d.def.id && <DatasetDetail d={d} uc={uc} />}
                </li>
              ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

function DatasetDetail({ d, uc }: { d: UpdDatasetStatus; uc: UpdateCenter }) {
  const toast = useToast();
  const [versions, setVersions] = useState<UpdVersion[] | null>(null);
  const [confirm, setConfirm] = useState<UpdVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const source = uc.overview!.sources.find((s) => s.meta.id === d.def.providerId);

  useEffect(() => {
    if (d.def.kind !== "versioned") return;
    updatesVersions(d.def.id)
      .then(setVersions)
      .catch(() => setVersions([]));
  }, [d.def.id, d.def.kind, uc.revision]);

  const refresh = () => {
    setBusy(true);
    updatesRefreshManaged(d.def.id)
      .then((m) => {
        toast("info", d.def.label, m);
        uc.bump();
      })
      .catch((e) => toast("error", "Refresh failed", String(e)))
      .finally(() => setBusy(false));
  };

  const restore = (v: UpdVersion) => {
    setBusy(true);
    updatesRollback(d.def.id, v.id)
      .then(() => {
        toast("success", `${d.def.label} restored to ${v.label}`, "The version you replaced is kept and can be restored again.");
        uc.bump();
      })
      .catch((e) => toast("error", "Restore failed", String(e)))
      .finally(() => {
        setBusy(false);
        setConfirm(null);
      });
  };

  return (
    <div className="border-t border-line bg-bg-2/40 px-4 py-3">
      <div className="grid gap-6 lg:grid-cols-2">
        <dl>
          <Field label="About">{d.def.description}</Field>
          <Field label="Source">{d.def.kind === "bundled" ? "Bundled with Vaalytics (no verified structured source)" : (source?.meta.name ?? d.def.providerId)}</Field>
          <Field label="Used by">{d.consumers.map(moduleLabel).join(", ") || "—"}</Field>
          {d.def.kind === "versioned" && (
            <>
              <Field label="Update policy">{d.def.policy === "auto" ? "Automatic when validation passes and nothing needs review" : "Always reviewed"}</Field>
              <Field label="Last checked">
                <Time ts={d.state.lastCheckedAt} />
                {d.state.lastError && <span className="text-danger"> · last error: {d.state.lastError}</span>}
              </Field>
              <Field label="Source version">{d.state.sourceModified ?? "the source reports none"}</Field>
            </>
          )}
          {d.market && (
            <>
              <Field label="League">{d.market.league}</Field>
              <Field label="Prices cached">
                {d.market.items} items in {d.market.categories} categories · newest <Time ts={d.market.newestFetch} /> · oldest <Time ts={d.market.oldestFetch} />
              </Field>
              {d.market.errors > 0 && <Field label="Errors">{d.market.errors} categories · {d.market.lastError}</Field>}
              <Field label="How it updates">The Market engine refreshes a category while a view shows it, following poe.ninja’s cache time. History stays with its league.</Field>
            </>
          )}
          {d.def.id === "poe1.crafting-data" && (
            <Field label="Cache written">
              <Time ts={d.cacheWrittenAt} /> · the Crafting service re-checks RePoE at most once a day while Crafting or REGEX is used.
            </Field>
          )}
          {d.def.kind === "bundled" && <Field label="How it updates">Only with a new Vaalytics version. Patch notes that touch it are flagged “Needs developer implementation”.</Field>}
        </dl>
        {d.def.kind === "managed" && (
          <div>
            <Button size="sm" variant="secondary" icon="refresh" loading={busy} onClick={refresh}>
              {d.market ? "Refresh expired prices" : "Re-check crafting data"}
            </Button>
          </div>
        )}
        {d.def.kind === "versioned" && (
          <div>
            <p className="mb-2 text-xs font-medium text-fg-muted">Versions</p>
            {!versions ? (
              <p className="text-xs text-fg-subtle">Loading…</p>
            ) : versions.length === 0 ? (
              <p className="text-xs text-fg-subtle">No version stored yet. Check for updates to install the first one.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody className="divide-y divide-line">
                  {versions.map((v) => (
                    <tr key={v.id}>
                      <td className="py-1.5 pr-2 text-fg">
                        #{v.id} · {v.label}
                      </td>
                      <td className="py-1.5 pr-2 text-fg-subtle" title={stamp(v.installedAt ?? v.createdAt)}>
                        {v.entryCount} entries · {v.origin === "partial" ? "partial update" : v.origin === "imported" ? "imported" : "from source"} · <Time ts={v.installedAt ?? v.createdAt} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <Badge tone={v.status === "installed" ? "success" : v.status === "staged" ? "accent" : "neutral"}>{v.status}</Badge>
                      </td>
                      <td className="py-1.5 pr-2">
                        <ValidationBadge v={v.validation} />
                      </td>
                      <td className="py-1.5 text-right">
                        {v.status !== "installed" && v.status !== "staged" && v.hasContent && v.format === d.def.format ? (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(v)}>
                            Restore
                          </Button>
                        ) : v.status === "previous" && !v.hasContent ? (
                          <span className="text-fg-subtle" title="Removed by the retention policy (Settings)">data pruned</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
      <Modal
        open={confirm != null}
        onClose={() => setConfirm(null)}
        title={`Restore ${d.def.label} ${confirm?.label ?? ""}?`}
        description="The stored version is validated again and installed. The current version is kept, so you can switch back. Pending updates for this dataset are discarded; check again to see them."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => confirm && restore(confirm)}>
              Restore
            </Button>
          </>
        }
      />
    </div>
  );
}
