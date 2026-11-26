import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useActiveGame } from "@/core/game-context/GameContext";
import type { SectionProps } from "@/core/game-context/sections";
import { useLeague } from "@/core/market/LeagueContext";
import { Button, PageHeader, Panel } from "@/shared/components";
import { Icon } from "@/shared/icons/Icon";
import type { IconName } from "@/shared/icons/icons";
import { LeagueSelect } from "./market-ui";

const encode = (s: string) => encodeURIComponent(s);

/** Shortcuts into the official Trade site for the selected league. */
export default function TradeView({ onNavigate }: SectionProps) {
  const game = useActiveGame();
  const { league } = useLeague();
  const site = game === "poe1" ? "https://www.pathofexile.com/trade" : "https://www.pathofexile.com/trade2";
  const realm = game === "poe2" ? "poe2/" : "";
  const searchUrl = league ? `${site}/search/${realm}${encode(league)}` : site;
  const exchangeUrl = league ? `${site}/exchange/${realm}${encode(league)}` : site;

  return (
    <div className="mx-auto max-w-page">
      <PageHeader title="Trade" description="Search and trade on the official site, scoped to your league." actions={<LeagueSelect />} />

      <div className="grid grid-cols-2 gap-4">
        <ActionCard
          icon="search"
          title="Item search"
          body="Open the official item search for this league in your browser."
          action={
            <Button variant="primary" iconRight="external" onClick={() => void openUrl(searchUrl)} disabled={!league}>
              Open Trade
            </Button>
          }
        />
        <ActionCard
          icon="swap"
          title="Bulk item exchange"
          body="Trade currency and bulk items with the official exchange."
          action={
            <Button iconRight="external" onClick={() => void openUrl(exchangeUrl)} disabled={!league}>
              Open exchange
            </Button>
          }
        />
      </div>

      <Panel className="mt-6" title="Price an item you own">
        <div className="flex items-center gap-4">
          <p className="flex-1 text-sm text-fg-muted">
            The Price Checker searches the official Trade API with the modifiers you choose and shows real listings, an estimate and seller status.
          </p>
          <Button icon="priceCheck" onClick={() => onNavigate("price-checker")}>
            Price Checker
          </Button>
        </div>
      </Panel>

      <p className="mt-4 text-xs text-fg-subtle">Saved searches and trade history are planned. Trading always happens in game and on the official site.</p>
    </div>
  );
}

function ActionCard({ icon, title, body, action }: { icon: IconName; title: string; body: string; action: ReactNode }) {
  return (
    <div className="panel flex flex-col gap-4 rounded-lg p-5">
      <span className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent-2">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="mt-1 text-sm text-fg-muted">{body}</p>
      </div>
      <div>{action}</div>
    </div>
  );
}
