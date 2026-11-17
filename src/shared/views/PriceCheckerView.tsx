import { useState } from "react";
import type { GameConfig } from "@/core/game-context/config";
import type { SectionProps } from "@/core/game-context/sections";
import { useLeague } from "@/core/market/LeagueContext";
import { Button, Kbd, PageHeader, Panel } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { ParsedItem, ParseResult } from "@/shared/item-parser/types";
import { LeagueSelect } from "./market-ui";
import { PriceCheckSession } from "./price-check/PriceCheckSession";

export interface PriceCheckerViewProps extends SectionProps {
  config: GameConfig;
  /** Game-specific parser (PoE 1 and PoE 2 formats differ). */
  parse: (text: string) => ParseResult;
}

export function PriceCheckerView({ config, parse }: PriceCheckerViewProps) {
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
    <div className="mx-auto max-w-7xl">
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
        <Panel title="Paste item text">
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
            className="h-56 w-full resize-none rounded-md border border-line bg-elevated p-3 font-mono text-xs text-fg placeholder:text-fg-subtle focus-visible:border-accent/60"
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
      ) : league ? (
        <PriceCheckSession item={item} league={league} config={config} />
      ) : null}
    </div>
  );
}
