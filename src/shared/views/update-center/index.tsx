/**
 * Update Center — central game-data synchronisation for both games: check, review, apply,
 * roll back; sources, league profiles, official patch notes and history.
 * Spec: docs/modules/update-center.md
 */
import { useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import { updatesRun, type UpdReport } from "@/core/ipc/commands";
import { useUpdateCenter } from "@/core/updates/hooks";
import { Button, EmptyState, PageHeader, SegmentedControl, useToast } from "@/shared/components";
import { GameDataTab } from "./GameDataTab";
import { HistoryTab } from "./HistoryTab";
import { LeaguesTab } from "./LeaguesTab";
import { OverviewTab } from "./OverviewTab";
import { PatchNotesTab } from "./PatchNotesTab";
import { ProgressStrip, ReportBanner } from "./Progress";
import { SettingsTab } from "./SettingsTab";
import { SourcesTab } from "./SourcesTab";
import { UpdatesTab } from "./UpdatesTab";

export type Tab = "overview" | "updates" | "patch-notes" | "history" | "data" | "leagues" | "sources" | "settings";

export default function UpdateCenterView(_props: SectionProps) {
  const uc = useUpdateCenter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [starting, setStarting] = useState<"check" | "sync" | null>(null);
  const running = uc.progress != null || starting != null;
  const o = uc.overview;

  const run = (mode: "check" | "sync") => {
    setStarting(mode);
    updatesRun(mode)
      .then((r: UpdReport) => {
        uc.setLastReport(r);
        uc.bump();
        if (mode === "check" && r.staged.length > 0) setTab("updates");
      })
      .catch((e) => toast("error", mode === "check" ? "Check for updates failed" : "Synchronisation failed", String(e)))
      .finally(() => setStarting(null));
  };

  const pending = o ? o.datasets.reduce((n, d) => n + d.pending, 0) : 0;

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        title="Update Center"
        description="Game data for Path of Exile 1 and 2 — discovered, validated and versioned before anything changes. Application updates are separate."
        actions={
          <>
            <Button variant="secondary" icon="download" disabled={running} loading={starting === "sync"} onClick={() => run("sync")} title="Check every enabled source and apply the updates that are safe to apply automatically">
              Synchronize all
            </Button>
            <Button icon="refresh" disabled={running} loading={starting === "check"} onClick={() => run("check")} title="Discover updates without changing installed data">
              Check for updates
            </Button>
          </>
        }
      />
      <ProgressStrip progress={uc.progress} />
      {uc.lastReport && !uc.progress && <ReportBanner report={uc.lastReport} labelOf={(id) => o?.datasets.find((d) => d.def.id === id)?.def.label ?? id} onDismiss={() => uc.setLastReport(null)} onReview={() => setTab("updates")} />}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Section"
          value={tab}
          onChange={(t: Tab) => setTab(t)}
          segments={[
            { value: "overview", label: "Overview" },
            { value: "updates", label: pending ? `Available updates · ${pending}` : "Available updates" },
            { value: "patch-notes", label: o?.articlesUnreviewed ? `Patch notes · ${o.articlesUnreviewed}` : "Patch notes" },
            { value: "history", label: "History" },
            { value: "data", label: "Game data" },
            { value: "leagues", label: "League profiles" },
            { value: "sources", label: "Sources" },
            { value: "settings", label: "Settings" },
          ]}
        />
      </div>
      {!o ? (
        <EmptyState icon={uc.error ? "error" : "refresh"} title={uc.error ?? "Loading the Update Center…"} loading={!uc.error} />
      ) : tab === "overview" ? (
        <OverviewTab uc={uc} onTab={setTab} onRun={run} running={running} />
      ) : tab === "updates" ? (
        <UpdatesTab uc={uc} onRun={() => run("check")} running={running} />
      ) : tab === "patch-notes" ? (
        <PatchNotesTab uc={uc} onRun={() => run("check")} running={running} />
      ) : tab === "history" ? (
        <HistoryTab uc={uc} />
      ) : tab === "data" ? (
        <GameDataTab uc={uc} />
      ) : tab === "leagues" ? (
        <LeaguesTab uc={uc} />
      ) : tab === "sources" ? (
        <SourcesTab uc={uc} />
      ) : (
        <SettingsTab uc={uc} />
      )}
    </div>
  );
}
