import type { CampaignSource, Provenance, SourceId } from "./types";

/** Sources read for the 0.5.5 dataset (2026-11-17). */
export const SOURCES_0_5_5: CampaignSource[] = [
  {
    id: "pathofexile-gg",
    label: "PathofExile.gg — PoE 2 Campaign Full Walkthrough (0.5.5)",
    url: "https://pathofexile.gg/campaign/",
    patch: "0.5.5",
    checked: "2026-11-17",
    kind: "community-guide",
  },
  {
    id: "wdguide",
    label: "WDGuide — PoE 2 campaign walkthrough (0.5.5 preview)",
    url: "https://wdguide.com/poe2/guides/campaign-walkthrough",
    patch: "0.5.5",
    checked: "2026-11-17",
    kind: "community-guide",
  },
  {
    id: "metabot",
    label: "Metabot — PoE 2 campaign overview and Act 4 (verified for 0.5.5f)",
    url: "https://metabot.gg/en/path-of-exile-2/campaign",
    patch: "0.5.5f",
    checked: "2026-11-17",
    kind: "community-guide",
  },
  {
    id: "metabot-bonuses",
    label: "Metabot — PoE 2 permanent bonuses (verified for 0.5.5f)",
    url: "https://metabot.gg/en/path-of-exile-2/permanent-bonuses",
    patch: "0.5.5f",
    checked: "2026-11-17",
    kind: "community-guide",
  },
  {
    id: "client-log",
    label: "Real PoE 2 Client.txt (developer machine, read-only): area ids, names, levels, transitions, NPC speakers, “You have received … Passive Skill Points.” lines",
    url: null,
    patch: "client tags 4.4.0 – 4.5.4f (Dec 2025 – Jul 2026); no 0.5.5 campaign run in the sample",
    checked: "2026-11-17",
    kind: "observed-log",
  },
];

/** Shorthands for provenance records. */
export const confirmed = (sources: SourceId[], note?: string): Provenance => ({ verification: "confirmed", sources, note });
export const unverified = (source: SourceId, note?: string): Provenance => ({ verification: "unverified", sources: [source], note });
export const conflict = (sources: SourceId[], conflicts: Provenance["conflicts"], note?: string): Provenance => ({
  verification: "conflict",
  sources,
  conflicts,
  note,
});

/** Zone seen in the real log (id, display name, level) and named by the guides. */
export const LOGGED: Provenance = confirmed(["client-log", "pathofexile-gg"]);
