/**
 * Ultimatum Checker (PoE 1): Inscribed Ultimatums checked with the Price
 * Checker hotkey, a trial planner for modifiers you see in an Ultimatum
 * encounter, and your per-build modifier ratings.
 * Spec: docs/modules/ultimatum-checker.md
 */
import { useMemo, useState } from "react";
import type { SectionProps } from "@/core/game-context/sections";
import type { JsonValue } from "@/core/ipc/commands";
import { useLeague } from "@/core/market/LeagueContext";
import { useGameSetting } from "@/core/settings/useGameSetting";
import { Badge, Button, EmptyState, Input, Kbd, PageHeader, Panel, ProvenanceTag } from "@/shared/components";
import { cn } from "@/shared/utilities/cn";
import { formatRelative } from "@/shared/utilities/format";
import { DisplayCurrencySelect, LeagueSelect } from "@/shared/views/market-ui";
import { ALL_MODIFIERS, findModifier, MODIFIER_FAMILIES, MODIFIER_SOURCE } from "./data/modifiers";
import type { UltimatumModifier } from "./parse";
import { assessRisk, nextRating, RATING_LABEL, setRating } from "./ultimatum";
import { isLastCheck, LAST_CHECK_KEY, ModifierList, RATING_TONE, UltimatumCard, useRatings, VERDICT, type LastCheck } from "./UltimatumCard";

const anyJson = (_v: unknown): _v is JsonValue => true;

export default function UltimatumChecker(_props: SectionProps) {
  const { league } = useLeague();
  const [stored, , loaded] = useGameSetting<JsonValue>("poe1", LAST_CHECK_KEY, null, anyJson);
  const last: LastCheck | null = isLastCheck(stored) ? stored : null;

  return (
    <div className="mx-auto max-w-page">
      <PageHeader
        title="Ultimatum Checker"
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            Hover an Inscribed Ultimatum in game and press <Kbd>Ctrl</Kbd>
            <Kbd>D</Kbd> (the Price Checker hotkey). Rate modifiers once for your build.
          </span>
        }
        actions={
          <>
            <DisplayCurrencySelect />
            <LeagueSelect />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {!loaded ? (
            <Panel title="Last checked">
              <EmptyState icon="boss" loading title="Loading…" />
            </Panel>
          ) : last && league ? (
            <>
              <p className="-mb-3 text-xs text-fg-subtle">Last checked {formatRelative(last.at)}</p>
              <UltimatumCard ultimatum={last.ultimatum} league={league} />
            </>
          ) : (
            <Panel title="Last checked">
              <EmptyState
                icon="priceCheck"
                title="No Inscribed Ultimatum checked yet"
                body="In game, hover an Inscribed Ultimatum and press the Price Checker hotkey. The overlay shows the check, and it appears here too."
              />
            </Panel>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <TrialPlanner />
          <RatingsPanel />
        </div>
      </div>
    </div>
  );
}

/** Modifiers offered in an Ultimatum encounter can't be copied — pick them here. */
function TrialPlanner() {
  const [ratings, setRatings] = useRatings();
  const [picked, setPicked] = useState<UltimatumModifier[]>([]);
  const [query, setQuery] = useState("");
  const risk = useMemo(() => assessRisk(picked, ratings), [picked, ratings]);

  const add = (name: string) => {
    const ref = findModifier(name);
    if (!ref || picked.length >= 20) return;
    setPicked([
      ...picked,
      {
        name: ref.name,
        description: "",
        family: ref.family.family,
        tier: ref.tier,
        kind: ref.family.kind,
      },
    ]);
    setQuery("");
  };
  const v = VERDICT[risk.verdict];

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Trial planner" actions={picked.length > 0 ? <Badge tone={v.tone}>{v.label}</Badge> : undefined}>
        <p className="mb-3 text-xs text-fg-muted">
          The modifiers you're offered inside an Ultimatum encounter can't be copied from the game. Pick the ones on screen to see your verdict.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Add modifier"
              placeholder="e.g. Ruin II, Drought, Stormcaller Runes III"
              value={query}
              list="ultimatum-modifiers"
              onChange={(e) => {
                const val = e.target.value.slice(0, 60);
                if (findModifier(val) && ALL_MODIFIERS.some((m) => m.name === val)) add(val);
                else setQuery(val);
              }}
              onKeyDown={(e) => e.key === "Enter" && add(query)}
            />
            <datalist id="ultimatum-modifiers">
              {ALL_MODIFIERS.map((m) => (
                <option key={m.name} value={m.name} />
              ))}
            </datalist>
          </div>
          {picked.length > 0 && (
            <Button size="md" onClick={() => setPicked([])}>
              Clear
            </Button>
          )}
        </div>
        {picked.length > 0 && <p className="mt-3 text-xs text-fg-muted">{v.body}</p>}
      </Panel>
      {picked.length > 0 && (
        <ModifierList
          modifiers={picked}
          ratings={ratings}
          risk={risk}
          onRate={(m) => m.family && setRatings(setRating(ratings, m.family, nextRating(ratings[m.family])))}
          onRemove={(i) => setPicked(picked.filter((_, j) => j !== i))}
        />
      )}
    </div>
  );
}

function RatingsPanel() {
  const [ratings, setRatings] = useRatings();
  const [filter, setFilter] = useState("");
  const families = MODIFIER_FAMILIES.filter((f) => f.kind === "penalty" && f.family.toLowerCase().includes(filter.trim().toLowerCase()));
  const rated = Object.keys(ratings).length;

  return (
    <Panel
      title={`Your ratings · ${rated} rated`}
      flush
      actions={
        <ProvenanceTag
          provenance={{
            kind: "game-data",
            source: MODIFIER_SOURCE.source,
            at: Date.parse(MODIFIER_SOURCE.read),
            note: "Modifier names and tiers. Ratings are yours (saved per game).",
          }}
        />
      }
    >
      <div className="border-b border-line px-4 py-3">
        <Input placeholder="Filter modifiers" value={filter} onChange={(e) => setFilter(e.target.value.slice(0, 40))} aria-label="Filter modifiers" />
        <p className="mt-2 text-2xs text-fg-subtle">
          A rating applies to every tier of the modifier. Bonus modifiers (Harsh Lessons, Splintershot…) never count against a trial.
        </p>
      </div>
      <ul className="max-h-[460px] divide-y divide-line overflow-y-auto">
        {families.map((f) => {
          const r = ratings[f.family];
          return (
            <li key={f.family} className="flex items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-fg">
                {f.family}
                {f.tiers.length > 1 && <span className="ml-2 text-2xs text-fg-subtle">{f.tiers.length} tiers</span>}
              </span>
              <div className="flex gap-1" role="group" aria-label={`Rating for ${f.family}`}>
                {(["ok", "danger", "forbidden"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={r === opt}
                    onClick={() => setRatings(setRating(ratings, f.family, r === opt ? undefined : opt))}
                    className={cn(
                      "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                      r !== opt && "opacity-45 hover:opacity-80",
                    )}
                  >
                    <Badge tone={r === opt ? RATING_TONE[opt] : "neutral"}>{RATING_LABEL[opt]}</Badge>
                  </button>
                ))}
              </div>
            </li>
          );
        })}
        {families.length === 0 && <li className="px-4 py-4 text-sm text-fg-muted">No modifier matches.</li>}
      </ul>
    </Panel>
  );
}
