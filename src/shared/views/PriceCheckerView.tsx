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
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
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
              className="well h-48 w-full resize-none rounded-md p-3 font-mono text-xs leading-5 text-fg transition-[border-color,box-shadow] placeholder:text-fg-subtle focus-visible:border-accent/55 focus-visible:shadow-[inset_0_1px_2px_rgb(0_0_0/0.35),0_0_0_3px_var(--color-accent-soft)] focus-visible:outline-none"
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

const STEPS: {
  icon: "cursor" | "copy" | "trade";
  title: string;
  body: string;
}[] = [
  {
    icon: "cursor",
    title: "In game",
    body: "Hover an item and press Ctrl+D. The overlay opens next to the game; the hotkey is active only while the game is focused.",
  },
  {
    icon: "copy",
    title: "Or paste here",
    body: "Copy with Ctrl+C (Ctrl+Alt+C adds mod tiers) and paste above. The text is parsed on your PC.",
  },
  {
    icon: "trade",
    title: "Live listings",
    body: "Results come from the official Trade site within its rate limits, converted with poe.ninja rates.",
  },
];

function HowItWorks() {
  return (
    <aside className="panel rounded-lg">
      <header className="flex h-11 items-center border-b border-line bg-gradient-to-b from-white/[0.025] to-transparent px-4">
        <h2 className="text-sm font-semibold text-fg">How it works</h2>
      </header>
      <ol className="space-y-4 px-4 py-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="relative flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-bg-2 text-accent-2">
              <Icon name={s.icon} size={15} />
              <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border border-line bg-elevated text-[9px] font-semibold text-fg-muted tabular">
                {i + 1}
              </span>
            </span>
            <span>
              <span className="block text-sm font-medium text-fg">{s.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
