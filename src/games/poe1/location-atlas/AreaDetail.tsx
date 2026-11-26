/** One campaign area: facts from the game files, community hints, and what is not known. */
import { Badge, Panel } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { ATLAS_META } from "./data";
import type { CampaignArea, NavigationHint } from "./data/types";
import { ConfidenceBadge, SectionLabel } from "./ui";

const DIR_WORD = ["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"];

export function DirectionArrow({ deg, className }: { deg: number; className?: string }) {
  return (
    <span className={cn("inline-flex size-5 items-center justify-center rounded-sm border border-line bg-bg-2 text-accent", className)} title={`Minimap direction: ${DIR_WORD[Math.floor(deg / 45) % 8]}`}>
      <span className="inline-flex" style={{ transform: `rotate(${deg}deg)` }}>
        <Icon name="arrowUp" size={12} />
      </span>
    </span>
  );
}

export function AreaDetail({
  area,
  areas,
  hints,
  here,
  visited,
  favorite,
  compact,
  onSelect,
  onToggleFavorite,
}: {
  area: CampaignArea;
  areas: ReadonlyMap<string, CampaignArea>;
  hints: NavigationHint[];
  /** You are in this area (from Client.txt). */
  here: boolean;
  visited: boolean;
  favorite: boolean;
  compact: boolean;
  onSelect: (id: string) => void;
  onToggleFavorite: () => void;
}) {
  const town = area.town && area.town !== area.id ? areas.get(area.town) : null;
  const into = [...areas.values()].filter((a) => a.connections.includes(area.id) && !area.connections.includes(a.id));
  const own = hints.filter((h) => h.area === area.id);
  const toHere = hints.filter((h) => h.toward === area.id && h.area !== area.id);
  const repoe = ATLAS_META.sources.find((s) => s.id === "repoe");
  const el = ATLAS_META.sources.find((s) => s.id === "exile-leveling");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-fg-muted">
            Act {area.act} · {area.kind === "town" ? "Town" : "Area"}
          </p>
          <h1 className="mt-0.5 font-display text-xl leading-tight font-semibold text-fg">{area.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {here && <Badge tone="accent" dot>You are here</Badge>}
          {!here && visited && <Badge tone="neutral">Visited</Badge>}
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-pressed={favorite}
            title={favorite ? "Remove from favourites" : "Add to favourites"}
            className={cn("flex size-7 items-center justify-center rounded-md transition-colors", favorite ? "text-accent" : "text-fg-subtle hover:text-fg")}
          >
            <Icon name="star" size={15} />
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
        <Fact label="Area level" value={String(area.level)} />
        <Fact label="Waypoint" value={area.waypoint ? "Yes" : "No"} icon={area.waypoint ? "waypoint" : undefined} />
        <Fact label="Bosses (game data)" value={area.bossCount ? String(area.bossCount) : "None"} />
        <Fact label="Layout graphs" value={area.topologies.length ? String(area.topologies.length) : "—"} hint="Layout graph ids listed for this area in the game files. More than one = the layout varies between instances." />
      </dl>

      <section>
        <SectionLabel>Connections</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {area.connections.map((id) => {
            const a = areas.get(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-2 px-2 py-1 text-xs text-fg transition-colors hover:border-line-strong hover:bg-elevated"
              >
                <Icon name={a?.kind === "town" ? "town" : "chevronRight"} size={12} className="text-fg-subtle" />
                {a?.name ?? id}
                {a && a.act !== area.act && <span className="text-fg-subtle">Act {a.act}</span>}
                {a?.waypoint && <Icon name="waypoint" size={11} className="text-info" />}
              </button>
            );
          })}
          {area.connections.length === 0 && <span className="text-xs text-fg-muted">No walking connections in the game data.</span>}
        </div>
        {into.length > 0 && (
          <p className="mt-2 text-2xs text-fg-subtle">One-way entry from: {into.map((a) => a.name).join(", ")}.</p>
        )}
        {area.otherConnections.length > 0 && <p className="mt-1 text-2xs text-fg-subtle">Also leads to non-campaign content ({area.otherConnections.length}).</p>}
        {town && (
          <p className="mt-2 text-xs text-fg-muted">
            Town for this act:{" "}
            <button type="button" className="text-fg underline-offset-2 hover:underline" onClick={() => onSelect(town.id)}>
              {town.name}
            </button>
          </p>
        )}
      </section>

      {(area.bossNames?.length ?? 0) > 0 && (
        <section>
          <SectionLabel>Bosses named in the community route</SectionLabel>
          <p className="text-xs text-fg">{area.bossNames!.join(" · ")}</p>
        </section>
      )}

      <section>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="-mb-1.5"><SectionLabel>Navigation hints</SectionLabel></span>
          <ConfidenceBadge confidence="community" />
        </div>
        {own.length + toHere.length === 0 ? (
          <p className="text-xs text-fg-muted">No community hint for this area.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...own, ...toHere].map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                {h.direction !== undefined ? <DirectionArrow deg={h.direction} className="mt-px shrink-0" /> : <Icon name="info" size={13} className="mt-0.5 shrink-0 text-fg-subtle" />}
                <span className="min-w-0 flex-1">
                  <span className="text-fg">{h.text}</span>
                  <span className="mt-0.5 block text-2xs text-fg-subtle">
                    {h.area !== area.id ? `On the way from ${areas.get(h.area)?.name ?? h.area} · ` : ""}
                    {h.step}
                    {h.toward && h.area === area.id ? ` → ${areas.get(h.toward)?.name ?? h.toward}` : ""}
                    {h.leagueStartOnly ? " · league-start route" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-2xs text-fg-subtle">Hints describe what usually works; layouts vary, so they are not guarantees. Directions are minimap directions.</p>
      </section>

      {!compact && (
        <section>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="-mb-1.5"><SectionLabel>Layout</SectionLabel></span>
            <ConfidenceBadge confidence="unverified" label="No recorded layout" />
          </div>
          <p className="text-xs text-fg-muted">
            No map of this area's interior is available: the game's layout files aren't exported by any source Vaalytics may use, and community layout
            images aren't licensed for redistribution. Client.txt names the area you enter, not where you stand in it. You will be able to record your own
            layout variants in a later stage.
          </p>
        </section>
      )}

      {!compact && area.craftingRecipes.length > 0 && (
        <section>
          <SectionLabel>Crafting recipes unlocked here</SectionLabel>
          <p className="text-xs text-fg">{area.craftingRecipes.join(" · ")}</p>
        </section>
      )}

      <p className="border-t border-line pt-3 text-2xs text-fg-subtle">
        Area facts: {repoe?.name} ({repoe?.version}, extracted from the game files). Hints and boss names: {el?.name}, {el?.license}. Patch {ATLAS_META.patch}.
      </p>
    </div>
  );
}

function Fact({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: "waypoint" }) {
  return (
    <div>
      <dt className="text-2xs text-fg-subtle" title={hint}>
        {label}
      </dt>
      <dd className="mt-0.5 flex items-center gap-1.5 text-sm text-fg tabular-nums">
        {icon && <Icon name={icon} size={13} className="text-info" />}
        {value}
      </dd>
    </div>
  );
}

export function EmptyArea() {
  return (
    <Panel>
      <p className="text-sm text-fg-muted">Choose an area on the left, or play — the Atlas follows the area you enter.</p>
    </Panel>
  );
}
