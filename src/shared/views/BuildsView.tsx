import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useActiveGame } from "@/core/game-context/GameContext";
import type { SectionProps } from "@/core/game-context/sections";
import { pobBuilds, pobLaunch, pobOpenBuildsFolder, pobStatus, type PobBuild, type PobStatus } from "@/core/ipc/commands";
import { Button, EmptyState, Input, PageHeader, Panel, useToast } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { formatRelative } from "@/shared/utilities/format";
import { VirtualRows } from "./market-ui";

/** Your local Path of Building builds for the active game (read-only listing). */
export default function BuildsView({ onNavigate }: SectionProps) {
  const game = useActiveGame();
  const notify = useToast();
  const [builds, setBuilds] = useState<PobBuild[] | null>(null);
  const [status, setStatus] = useState<PobStatus | null>(null);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    setBuilds(null);
    pobBuilds(game).then(setBuilds).catch(() => setBuilds([]));
    pobStatus(game).then(setStatus).catch(() => {});
  }, [game]);

  const rows = useMemo(() => (builds ?? []).filter((b) => !q || b.name.toLowerCase().includes(q) || b.folder.toLowerCase().includes(q)), [builds, q]);

  return (
    <div className="mx-auto flex h-[calc(100vh-var(--spacing-titlebar)-56px)] max-w-[1360px] flex-col">
      <PageHeader
        title="Builds"
        description={status?.buildsDir ? `Saved in ${status.buildsDir}` : "Builds saved by Path of Building on this PC"}
        actions={
          <>
            {status?.buildsDir && (
              <Button icon="external" onClick={() => pobOpenBuildsFolder(game).catch((e) => notify("warning", "Could not open folder", String(e)))}>
                Open folder
              </Button>
            )}
            {status?.install ? (
              <Button
                variant="primary"
                icon="builds"
                onClick={() =>
                  pobLaunch(game)
                    .then(() => notify("success", `Starting ${status.product}`))
                    .catch((e) => notify("warning", "Could not launch", String(e)))
                }
              >
                Open Path of Building
              </Button>
            ) : (
              <Button onClick={() => onNavigate("tools")}>Set up Path of Building</Button>
            )}
          </>
        }
      />

      <div className="mb-3">
        <Input icon="search" placeholder="Search builds" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search builds" containerClassName="w-72" />
      </div>

      <Panel flush className="flex min-h-0 flex-1 flex-col [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col">
        {builds === null ? (
          <EmptyState icon="refresh" title="Reading your builds…" loading />
        ) : builds.length === 0 ? (
          <EmptyState
            icon="builds"
            title="No builds found"
            body="Builds you save in Path of Building appear here. Vaalytics reads the folder only — it never changes your builds."
          />
        ) : rows.length === 0 ? (
          <EmptyState icon="search" title="No matches" />
        ) : (
          <VirtualRows
            className="flex-1"
            rows={rows}
            rowHeight={48}
            getKey={(b) => `${b.folder}/${b.name}`}
            header={
              <div className="grid h-9 grid-cols-[minmax(0,1fr)_200px_120px] items-center border-b border-line bg-surface px-4 text-xs text-fg-subtle">
                <span>Build</span>
                <span>Folder</span>
                <span className="text-right">Modified</span>
              </div>
            }
            renderRow={(b) => (
              <div className="grid h-full grid-cols-[minmax(0,1fr)_200px_120px] items-center border-b border-line px-4 text-sm transition-colors hover:bg-glass">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon name="builds" size={15} className="shrink-0 text-fg-subtle" />
                  <span className="truncate text-fg" data-selectable>
                    {b.name}
                  </span>
                </span>
                <span className="truncate text-xs text-fg-muted">{b.folder || "—"}</span>
                <span className="text-right text-xs text-fg-muted">{b.modified ? formatRelative(b.modified * 1000) : "—"}</span>
              </div>
            )}
          />
        )}
      </Panel>
      <p className="mt-2 text-2xs text-fg-subtle">Open a build from inside Path of Building. A build library with tags and notes is planned.</p>
    </div>
  );
}
