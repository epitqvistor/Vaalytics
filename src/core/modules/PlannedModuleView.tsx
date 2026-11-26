import type { SectionProps } from "@/core/game-context/sections";
import { Badge, PageHeader, Panel, usePageContext } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { useActiveGame } from "@/core/game-context/GameContext";
import { usePatch } from "@/core/game-data";
import { useLeague } from "@/core/market/LeagueContext";
import { moduleMeta, type ModuleId } from "./registry";

/**
 * Page for a registered module that isn't built yet. States what the module
 * will do and which data it will use — no sample numbers, nothing simulated.
 */
export default function PlannedModuleView({ onNavigate }: SectionProps) {
  const { moduleId } = usePageContext();
  const game = useActiveGame();
  const { league } = useLeague();
  const patch = usePatch(game);
  const meta = moduleId ? moduleMeta(moduleId as ModuleId) : undefined;
  if (!meta) return null;
  const rules = patch.definition
    ? `${patch.definition.patch} ${patch.definition.name}${patch.assumed ? " (assumed: league not recognised)" : patch.permanent ? " (permanent league, current rules)" : ""}`
    : "no game-data definition for this game yet";
  return (
    <div className="mx-auto max-w-page">
      <PageHeader title={meta.label} description={meta.summary} actions={<Badge tone="neutral">Planned · not built yet</Badge>} />
      <div className="grid max-w-4xl grid-cols-1 gap-5 md:grid-cols-2">
        <Panel title="What it will do">
          <List items={meta.plan?.scope ?? []} icon="check" />
        </Panel>
        <Panel title="Data it will use">
          <List items={meta.plan?.data ?? []} icon="info" />
        </Panel>
      </div>
      <p className="mt-5 flex max-w-4xl items-center gap-2 text-xs text-fg-muted">
        <Icon name="info" size={14} className="text-fg-subtle" />
        League {league ?? "—"} · rules: {rules}
      </p>
      <p className="mt-2 max-w-4xl text-xs leading-relaxed text-fg-subtle">
        This module has its own place in navigation so it can be built and tested on its own. It shows nothing until it works with real
        data. Hide planned modules in Settings → General.{" "}
        <button type="button" className="text-accent-2 hover:underline" onClick={() => onNavigate("settings")}>
          Open Settings
        </button>
      </p>
    </div>
  );
}

function List({ items, icon }: { items: string[]; icon: "check" | "info" }) {
  if (!items.length) return <p className="text-xs text-fg-subtle">Not specified yet.</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((t) => (
        <li key={t} className="flex gap-2.5 text-sm text-fg-muted">
          <Icon name={icon} size={15} className="mt-0.5 shrink-0 text-fg-subtle" />
          {t}
        </li>
      ))}
    </ul>
  );
}
