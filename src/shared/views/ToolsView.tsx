import { openUrl } from "@tauri-apps/plugin-opener";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useActiveGame } from "@/core/game-context/GameContext";
import { GAMES, GAME_IDS, type GameId } from "@/core/game-context/games";
import type { SectionProps } from "@/core/game-context/sections";
import { pobChooseExe, pobClearPath, pobLaunch, pobStatus, type PobStatus } from "@/core/ipc/commands";
import { Badge, Button, PageHeader, Spinner, useToast } from "@/shared/components";
import { variants } from "@/shared/design/motion";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { cn } from "@/shared/utilities/cn";

/** Path of Building for both games + other external tools. */
export default function ToolsView(_props: SectionProps) {
  const game = useActiveGame();
  // Current game first; the other game's PoB stays manageable here too.
  const order: GameId[] = [game, ...GAME_IDS.filter((g) => g !== game)];

  return (
    <div className="mx-auto max-w-[1360px]">
      <PageHeader title="Path of Building & Tools" description="Launch Path of Building for each game and open the official trading sites." />

      <h2 className="mb-3 text-xs font-semibold tracking-[0.14em] text-fg-subtle uppercase">Path of Building</h2>
      <div className="flex flex-col gap-3">
        {order.map((g, i) => (
          <motion.div key={g} variants={variants.rise} initial="hidden" animate="visible" transition={{ delay: i * 0.05 }}>
            <PobCard game={g} current={g === game} />
          </motion.div>
        ))}
      </div>
      <p className="mt-3 text-xs text-fg-subtle">
        Path of Building is free, open-source software by the Path of Building Community (MIT licence). Vaalytics only detects and launches your
        installation; it does not bundle or modify it, and Path of Building keeps updating itself as usual.
      </p>

      <h2 className="mt-9 mb-3 text-xs font-semibold tracking-[0.14em] text-fg-subtle uppercase">Websites</h2>
      <div className="grid grid-cols-3 gap-3">
        <LinkTile icon="trade" title="Official Trade" host={game === "poe1" ? "pathofexile.com/trade" : "pathofexile.com/trade2"} url={game === "poe1" ? "https://www.pathofexile.com/trade" : "https://www.pathofexile.com/trade2"} />
        <LinkTile icon="currency" title="poe.ninja" host={game === "poe1" ? "poe.ninja" : "poe.ninja/poe2"} url={game === "poe1" ? "https://poe.ninja/" : "https://poe.ninja/poe2"} />
        <LinkTile icon="external" title="Awakened PoE Trade" host="github.com/SnosMe" url="https://github.com/SnosMe/awakened-poe-trade" />
      </div>
    </div>
  );
}

function PobCard({ game, current }: { game: GameId; current: boolean }) {
  const notify = useToast();
  const [status, setStatus] = useState<PobStatus | null>(null);
  const [busy, setBusy] = useState<"detect" | "choose" | "launch" | null>(null);

  const refresh = useCallback(async () => {
    setBusy("detect");
    try {
      setStatus(await pobStatus(game));
    } catch (e) {
      notify("error", "Detection failed", String(e));
    } finally {
      setBusy(null);
    }
  }, [game, notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const launch = async () => {
    setBusy("launch");
    try {
      await pobLaunch(game);
      notify("success", `Starting ${status?.product ?? "Path of Building"}`);
      window.setTimeout(() => void refresh(), 4000);
    } catch (e) {
      notify("warning", "Could not launch", String(e));
    } finally {
      setBusy(null);
    }
  };

  const choose = async () => {
    setBusy("choose");
    try {
      const s = await pobChooseExe(game);
      if (s) {
        setStatus(s);
        notify("success", "Path saved", s.install?.exe);
      }
    } catch (e) {
      notify("warning", "That file can't be used", String(e));
    } finally {
      setBusy(null);
    }
  };

  const install = status?.install;
  const sourceLabel = install?.source === "configured" ? "Chosen by you" : install?.source === "registry" ? "Found via Windows" : "Found in a standard folder";

  return (
    <div className={cn("panel flex items-center gap-5 rounded-lg px-5 py-4", current && "ring-1 ring-accent/25")}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-line bg-gradient-to-b from-white/[0.06] to-transparent">
        <Icon name="builds" size={20} className={install ? "text-accent-2" : "text-fg-subtle"} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-fg">{status?.product ?? "Path of Building"}</span>
          <Badge tone="neutral">{GAMES[game].shortTitle}</Badge>
          {!status ? (
            <Spinner size={12} className="text-fg-subtle" />
          ) : install ? (
            <Badge tone={status.running ? "info" : "success"} dot>
              {status.running ? "Running" : "Installed"}
            </Badge>
          ) : (
            <Badge tone="warning" dot>
              Not found
            </Badge>
          )}
          {install?.version && <span className="tabular text-xs text-fg-muted">v{install.version}</span>}
          {install?.branch && install.branch !== "master" && <Badge tone="neutral">{install.branch}</Badge>}
        </div>
        {install ? (
          <p className="mt-1 truncate font-mono text-2xs text-fg-subtle" title={install.exe} data-selectable>
            {install.exe} <span className="font-sans">· {sourceLabel}</span>
          </p>
        ) : status ? (
          <p className="mt-1 text-xs text-fg-muted">Not installed, or installed somewhere Vaalytics didn't look. Choose its executable or get it from the official release page.</p>
        ) : null}
        {status?.configuredProblem && <p className="mt-1 text-xs text-warning">{status.configuredProblem}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {install ? (
          <>
            <Button size="sm" variant="ghost" onClick={choose} loading={busy === "choose"} title="Use a different installation">
              Change
            </Button>
            {install.source === "configured" && (
              <Button size="sm" variant="ghost" onClick={() => pobClearPath(game).then(setStatus)} title="Forget the chosen path and auto-detect">
                Reset
              </Button>
            )}
            <Button variant="primary" icon="external" onClick={launch} loading={busy === "launch"} disabled={status?.running}>
              {status?.running ? "Running" : "Launch"}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" icon="refresh" onClick={refresh} loading={busy === "detect"}>
              Detect
            </Button>
            <Button size="sm" onClick={choose} loading={busy === "choose"}>
              Choose executable…
            </Button>
            {status && (
              <Button size="sm" variant="primary" iconRight="external" onClick={() => openUrl(status.downloadUrl)}>
                Official download
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LinkTile({ icon, title, host, url }: { icon: IconName; title: string; host: string; url: string }) {
  return (
    <button
      type="button"
      onClick={() => void openUrl(url)}
      className="group panel flex items-center gap-3 rounded-lg px-4 py-3.5 text-left transition-[transform,border-color] duration-150 hover:-translate-y-px"
    >
      <span className="flex size-9 items-center justify-center rounded-md bg-accent-soft text-accent-2">
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block truncate text-2xs text-fg-subtle">{host}</span>
      </span>
      <Icon name="external" size={14} className="text-fg-subtle transition-colors group-hover:text-fg-muted" />
    </button>
  );
}
