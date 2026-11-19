/**
 * Location Atlas (PoE 1) page in the main window: opens the Atlas window and shows
 * what it knows. Spec: docs/modules/location-atlas.md
 */
import { useMemo, useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import { atlasOpen, atlasSetLogPath } from "@/core/ipc/commands";
import { Button, Input, PageHeader, Panel, ProvenanceTag, StatTile, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { ATLAS_META } from "./data";
import { useAtlasDataset, useAtlasTracking } from "./hooks";
import { SectionLabel } from "./ui";

const GAME = "poe1" as const;

export default function LocationAtlasPage(_props: SectionProps) {
  const notify = useToast();
  const { dataset, areas, issues } = useAtlasDataset();
  const tracking = useAtlasTracking(areas);
  const [logPath, setLogPath] = useState("");
  const [opening, setOpening] = useState(false);
  const loc = tracking.location?.location;
  const here = loc?.kind === "in-area" ? loc.area : null;
  const counts = useMemo(() => {
    const all = dataset?.acts.flatMap((a) => a.areas) ?? [];
    return { areas: all.length, waypoints: all.filter((a) => a.waypoint).length, hints: dataset?.acts.reduce((n, a) => n + a.hints.length, 0) ?? 0 };
  }, [dataset]);

  const open = async (area: string | null = null) => {
    setOpening(true);
    try {
      await atlasOpen(GAME, area);
    } catch (e) {
      notify("warning", "Couldn't open the Location Atlas", String(e));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader
        title="Location Atlas"
        description="The Path of Exile campaign, Acts 1–10, in its own window: real connections between areas, waypoints, community navigation hints and the area you are in."
        actions={
          <Button variant="primary" icon="atlas" disabled={opening} onClick={() => open(here?.id ?? null)}>
            LOCATION ATLAS
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Campaign areas" value={counts.areas} caption={`Acts 1–10 · patch ${ATLAS_META.patch}`} />
        <StatTile label="With waypoint" value={counts.waypoints} caption="game data" />
        <StatTile label="Navigation hints" value={counts.hints} caption="community (MIT)" />
        <StatTile label="Areas you visited" value={tracking.location?.visited.size ?? "—"} caption={tracking.character ? tracking.character.name : "no character yet"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Where you are" actions={<ProvenanceTag provenance={{ kind: "user", source: "Your PoE 1 Client.txt (read-only)", at: null, note: "Read only while the Atlas or this page is visible; nothing leaves this PC." }} />}>
          {tracking.error ? (
            <p className="flex items-start gap-2 text-xs text-warning">
              <Icon name="warning" size={13} className="mt-px shrink-0" />
              {tracking.error}
            </p>
          ) : !tracking.character ? (
            <p className="text-xs text-fg-muted">No campaign character in your PoE 1 log yet — it appears after its first level-up.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-fg">
                  {tracking.character.name} · {tracking.character.class} · level {tracking.character.level}
                </p>
                <p className="mt-0.5 text-xs text-fg-muted">
                  {here
                    ? `In ${here.name} (Act ${here.act})`
                    : loc?.kind === "outside"
                      ? `Outside the campaign${loc.last ? ` — last campaign area: ${loc.last.name}` : ""}`
                      : "No area entered yet"}
                </p>
              </div>
              {here && (
                <Button size="sm" variant="secondary" onClick={() => open(here.id)}>
                  Show in Atlas
                </Button>
              )}
            </div>
          )}
          {(tracking.location?.unknownAreas.length ?? 0) > 0 && (
            <p className="mt-3 text-2xs text-warning">
              Your log has campaign areas the {ATLAS_META.patch} data doesn't know ({tracking.location!.unknownAreas.slice(0, 4).join(", ")}) — the data may be
              outdated for your game version.
            </p>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <SectionLabel>Client.txt</SectionLabel>
            <p className="mb-2 text-xs text-fg-muted">Found automatically in Steam libraries and the standard install folders. Choose it here if yours is elsewhere.</p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input size="sm" placeholder="…\Path of Exile\logs\Client.txt" value={logPath} onChange={(e) => setLogPath(e.target.value)} aria-label="Path to the PoE 1 Client.txt" />
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!logPath.trim()}
                onClick={() =>
                  atlasSetLogPath(GAME, logPath.trim())
                    .then(() => notify("success", "Log saved", "The Atlas reads this Client.txt from now on."))
                    .catch((e) => notify("warning", "Couldn't use that file", String(e)))
                }
              >
                Use this log
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Data">
          <ul className="flex flex-col gap-3">
            {ATLAS_META.sources.map((s) => (
              <li key={s.id} className="text-xs">
                <p className="text-fg">
                  {s.name} <span className="text-fg-subtle">· {s.version}</span>
                </p>
                <p className="text-fg-muted">
                  {s.provides.join(", ")} · {s.license}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-2xs text-fg-subtle">
            Interior layouts are not included: no source Vaalytics may use has them, and Client.txt doesn't say where you stand inside an area. The Atlas
            never invents one.
          </p>
          {issues.some((i) => i.severity === "error") && <p className="mt-2 text-2xs text-danger">The campaign data has problems; parts of the Atlas may be missing.</p>}
        </Panel>
      </div>
    </div>
  );
}
