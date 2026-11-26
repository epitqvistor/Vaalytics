import { Suspense, useState } from "react";
import type { GameConfig } from "@/core/game-context/config";
import type { SectionProps } from "@/core/game-context/sections";
import { useLeague } from "@/core/market/LeagueContext";
import { Button, Kbd, PageHeader, Panel, Spinner } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { ParsedItem, ParseResult } from "@/shared/item-parser/types";
import { DisplayCurrencySelect, LeagueSelect } from "./market-ui";
import { PriceCheckSession } from "./price-check/PriceCheckSession";
import { specialFor, type SpecialItemView } from "./price-check/special";

export interface PriceCheckerViewProps extends SectionProps {
  config: GameConfig;
  /** Game-specific parser (PoE 1 and PoE 2 formats differ). */
  parse: (text: string) => ParseResult;
  /** Items checked by a game-specific view instead of Trade (e.g. PoE 1 Inscribed Ultimatum). */
  special?: SpecialItemView[];
}

export function PriceCheckerView({ config, parse, special }: PriceCheckerViewProps) {
  const { league } = useLeague();
  const [text, setText] = useState("");
  const [item, setItem] = useState<ParsedItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (value: string) => {
    const r = parse(value);
    if (r.ok) {
      setItem(r.item);
      setError(null);
    } else {
      setError(r.error);
    }
  };

  return (
    <div className="mx-auto max-w-page">
      <PageHeader
        title="Price Checker"
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            In game: hover an item and press <Kbd>Ctrl</Kbd>
            <Kbd>D</Kbd> for the overlay. Here: paste copied item text.
          </span>
        }
        actions={
          <>
            <DisplayCurrencySelect />
            <LeagueSelect />
            {item && (
              <Button icon="plus" onClick={() => (setItem(null), setText(""))}>
                New check
              </Button>
            )}
          </>
        }
      />

      {!item ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Paste item text" className="lg:col-span-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (pasted.startsWith("Item Class:")) {
                  e.preventDefault();
                  setText(pasted);
                  run(pasted);
                }
              }}
              placeholder={"Item Class: Rings\nRarity: Rare\n…\n\nHover an item in game, press Ctrl+C, then paste here with Ctrl+V."}
              spellCheck={false}
              aria-label="Item text"
              className="well h-48 w-full resize-none rounded-md p-3 font-mono text-xs leading-5 text-fg transition-colors duration-120 placeholder:text-fg-subtle hover:border-line-strong focus-visible:border-copper focus-visible:outline-none"
            />
            <div className="mt-3 flex items-center gap-3">
              <Button variant="primary" icon="priceCheck" disabled={!text.trim() || !league} onClick={() => run(text)}>
                Price check
              </Button>
              {error && (
                <span className="flex items-center gap-1.5 text-xs text-danger">
                  <Icon name="error" size={13} /> {error}
                </span>
              )}
            </div>
          </Panel>
          <HowItWorks />
        </div>
      ) : league && specialFor(special, item) ? (
        <SpecialCheck view={specialFor(special, item)!} item={item} league={league} />
      ) : league ? (
        <PriceCheckSession item={item} league={league} config={config} />
      ) : null}
    </div>
  );
}

function SpecialCheck({ view, item, league }: { view: SpecialItemView; item: ParsedItem; league: string }) {
  return (
    <Suspense fallback={<Spinner />}>
      <view.Component item={item} league={league} />
    </Suspense>
  );
}

const STEPS: { title: string; body: string }[] = [
  {
    title: "In game",
    body: "Hover an item and press Ctrl+D. The overlay opens next to the game; the hotkey is active only while the game is focused.",
  },
  {
    title: "Or paste here",
    body: "Copy with Ctrl+C (Ctrl+Alt+C adds mod tiers) and paste above. The text is parsed on your PC.",
  },
  {
    title: "Live listings",
    body: "Results come from the official Trade site within its rate limits, converted with poe.ninja rates.",
  },
];

function HowItWorks() {
  return (
    <Panel title="How it works">
      <ol className="space-y-3.5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2">
            <span className="tabular text-sm font-semibold text-accent-2">{i + 1}</span>
            <span>
              <span className="block text-sm font-medium text-fg">{s.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
