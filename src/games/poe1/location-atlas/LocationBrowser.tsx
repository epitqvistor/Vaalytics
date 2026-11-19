/** Act / area list with filters; generated from the dataset. */
import { useMemo } from "react";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utilities/cn";
import { browseAreas, FILTERS, type AtlasFilter } from "./browser";
import type { CampaignArea } from "./data/types";

export function LocationBrowser({
  areas,
  acts,
  act,
  query,
  filter,
  selected,
  current,
  visited,
  favorites,
  recent,
  hintCount,
  onAct,
  onFilter,
  onSelect,
}: {
  areas: CampaignArea[];
  acts: number[];
  act: number;
  query: string;
  filter: AtlasFilter;
  selected: string | null;
  current: string | null;
  visited: ReadonlySet<string>;
  favorites: string[];
  recent: string[];
  hintCount: ReadonlyMap<string, number>;
  onAct: (act: number) => void;
  onFilter: (f: AtlasFilter) => void;
  onSelect: (id: string) => void;
}) {
  const list = useMemo(
    () => browseAreas(areas, { act, query, filter, favorites, recent, visited, hintCount }),
    [areas, act, query, filter, favorites, recent, visited, hintCount],
  );
  const wide = query.trim() !== "" || filter === "favorites" || filter === "recent";

  return (
    <nav aria-label="Locations" className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-5 gap-1 p-3 pb-2">
        {acts.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={a === act}
            onClick={() => onAct(a)}
            className={cn(
              "h-7 rounded-md text-xs tabular-nums transition-colors",
              a === act ? "bg-accent-soft font-semibold text-accent" : "text-fg-muted hover:bg-glass-strong hover:text-fg",
            )}
          >
            Act {a}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 border-b border-line px-3 pb-2.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={f.value === filter}
            onClick={() => onFilter(f.value)}
            className={cn(
              "h-6 rounded-full border px-2 text-2xs transition-colors",
              f.value === filter ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {list.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-fg-muted">
            {filter === "favorites" ? "No favourites yet — star an area." : filter === "recent" ? "No areas viewed yet." : "Nothing matches."}
          </li>
        )}
        {list.map((a) => {
          const hints = hintCount.get(a.id) ?? 0;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                aria-current={a.id === selected ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
                  a.id === selected ? "bg-elevated text-fg" : "text-fg-muted hover:bg-glass-hover hover:text-fg",
                )}
              >
                <span className="flex w-4 justify-center">
                  {a.id === current ? (
                    <span className="size-2 rounded-full bg-accent" title="You are here" />
                  ) : a.kind === "town" ? (
                    <Icon name="town" size={13} className="text-fg-subtle" />
                  ) : visited.has(a.id) ? (
                    <Icon name="check" size={12} className="text-fg-subtle" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {a.name}
                  {wide && <span className="ml-1.5 text-2xs text-fg-subtle">Act {a.act}</span>}
                </span>
                {a.waypoint && <Icon name="waypoint" size={12} className="text-info" label="Waypoint" />}
                {a.kind === "area" && (a.bossNames?.length ?? 0) > 0 && <Icon name="boss" size={12} className="text-danger/80" label="Boss" />}
                {hints > 0 && <span className="text-2xs text-fg-subtle tabular-nums" title={`${hints} navigation hint${hints === 1 ? "" : "s"}`}>{hints}</span>}
                <span className="w-6 text-right text-2xs text-fg-subtle tabular-nums" title="Area level">
                  {a.level}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
