/** League profiles per game: current, Standard, ended leagues and where historical data lives. */
import { useEffect, useState } from "react";
import { useActiveGame } from "@/core/game-context/GameContext";
import { useLeague } from "@/core/market/LeagueContext";
import { patchFor } from "@/core/game-data";
import type { GameId } from "@/core/game-context/games";
import { setGameSetting, updatesLeagues, type UpdLeagueProfile, type UpdLeagues } from "@/core/ipc/commands";
import type { UpdateCenter } from "@/core/updates/hooks";
import { Badge, Button, EmptyState, Panel, useToast } from "@/shared/components";
import { stamp, Time } from "./ui";

export function LeaguesTab({ uc }: { uc: UpdateCenter }) {
  const toast = useToast();
  const active = useActiveGame();
  const { setLeague } = useLeague();
  const [data, setData] = useState<UpdLeagues | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    updatesLeagues()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  useEffect(() => void load(), [uc.revision]);

  // The active game's league goes through its LeagueProvider so open views follow at once.
  const select = (p: UpdLeagueProfile) =>
    (p.game === active ? Promise.resolve(setLeague(p.league)) : setGameSetting(p.game, "market.league", p.league))
      .then(() => {
        toast("success", `${p.game === "poe1" ? "PoE 1" : "PoE 2"} league set to ${p.displayName}`, "Prices and history for other leagues are kept.");
        uc.bump();
        return load();
      })
      .catch((e) => toast("error", "Couldn't change the league", String(e)));

  if (error) return <EmptyState icon="error" title="Couldn't load league profiles" body={error} />;
  if (!data) return <EmptyState icon="refresh" title="Loading…" loading />;

  return (
    <div className="space-y-4">
      <Panel>
        <p className="text-xs leading-relaxed text-fg-muted">
          Leagues come from the poe.ninja league index (installed as the “Leagues” dataset). A league that disappears from the index is marked ended — never deleted — and its prices,
          price history and session valuations stay attached to its name. Start and end dates are when Vaalytics first and last saw the league; the official dates aren’t in this source.
        </p>
      </Panel>
      {(["poe1", "poe2"] as GameId[]).map((g) => {
        const profiles = data.profiles.filter((p) => p.game === g);
        const withData = data.withData.filter((w) => w.game === g);
        const selected = data.selected[g];
        return (
          <Panel key={g} title={g === "poe1" ? "Path of Exile 1" : "Path of Exile 2"} actions={<span>Selected: {selected ?? "none"}</span>} flush>
            {profiles.length === 0 ? (
              <p className="px-4 py-6 text-sm text-fg-subtle">No league profiles yet — check for updates (Leagues) to create them.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-fg-subtle">
                    <th className="px-4 py-2 font-normal">League</th>
                    <th className="px-2 py-2 font-normal">Status</th>
                    <th className="px-2 py-2 font-normal">Patch rules</th>
                    <th className="px-2 py-2 font-normal">First seen</th>
                    <th className="px-2 py-2 font-normal">Last seen / ended</th>
                    <th className="px-2 py-2 font-normal">Local price history</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {profiles.map((p) => {
                    const patch = patchFor(g, p.league);
                    const hist = withData.find((w) => w.league === p.league);
                    return (
                      <tr key={p.league}>
                        <td className="px-4 py-2 text-fg">
                          {p.displayName}
                          {p.hardcore && <span className="ml-2 text-xs text-fg-subtle">HC</span>}
                        </td>
                        <td className="px-2 py-2">
                          <Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status === "active" ? "Active" : "Ended"}</Badge>
                        </td>
                        <td className="px-2 py-2 text-xs text-fg-muted">{patch.definition ? `${patch.definition.patch}${patch.assumed ? " (assumed)" : ""}` : "no definition"}</td>
                        <td className="px-2 py-2 text-xs text-fg-subtle" title={stamp(p.firstSeenAt)}>
                          <Time ts={p.firstSeenAt} />
                        </td>
                        <td className="px-2 py-2 text-xs text-fg-subtle">{p.endedDetectedAt ? <>ended <Time ts={p.endedDetectedAt} /></> : <Time ts={p.lastSeenAt} />}</td>
                        <td className="px-2 py-2 text-xs text-fg-subtle">{hist ? `${hist.historyPoints} points` : "—"}</td>
                        <td className="px-4 py-2 text-right">
                          {selected === p.league ? (
                            <Badge tone="accent">Selected</Badge>
                          ) : p.status === "ended" ? (
                            <span className="text-xs text-fg-subtle" title="No live prices for an ended league; its stored history and sessions stay available in each module.">history only</span>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => select(p)}>
                              Select
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {withData.filter((w) => !profiles.some((p) => p.league === w.league)).length > 0 && (
              <p className="border-t border-line px-4 py-2 text-xs text-fg-subtle">
                Historical data also kept for:{" "}
                {withData
                  .filter((w) => !profiles.some((p) => p.league === w.league))
                  .map((w) => `${w.league} (${w.historyPoints} points)`)
                  .join(", ")}
              </p>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
