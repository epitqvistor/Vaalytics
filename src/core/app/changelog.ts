/**
 * Vaalytics release notes, bundled with the app (no network: the release repo is
 * private and there is no self-updater). Written from the release commits/tags.
 * Add an entry with every version bump (docs/development/release.md); keep the
 * newest first. `unreleased` marks changes on main that have no version yet.
 */
export interface ChangelogEntry {
  version: string;
  /** ISO date of the release (or of the last change while unreleased). */
  date: string;
  title: string;
  changes: string[];
  unreleased?: boolean;
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "0.21.0",
    date: "2026-11-26",
    title: "New look: Vaal / Obsidian",
    changes: [
      "Complete visual redesign: solid dark surfaces, aged-bronze accents, calmer controls and one type scale.",
      "Dashboard: key prices in one strip, price trend with period change, low and high, gainers and decliners side by side.",
      "Charts with precise axes, date labels that fit the width and a clear hover readout.",
      "Better contrast for secondary text; numbers aligned with tabular figures everywhere.",
      "Subtle animated background (off with Settings → Reduce motion) and this What's new panel.",
    ],
  },
  {
    version: "0.20.2",
    date: "2026-11-26",
    title: "Map Lab and Farming Lab removed",
    changes: ["The PoE 1 Map Lab and Farming Lab modules were removed. Stored data is left untouched."],
  },
  {
    version: "0.20.1",
    date: "2026-11-26",
    title: "Game selection artwork",
    changes: ["Illustrated PoE 1 and PoE 2 artwork on the game selection screen and in the sidebar."],
  },
  {
    version: "0.20.0",
    date: "2026-11-26",
    title: "Update Center",
    changes: [
      "Central, versioned game-data synchronisation for both games: check, review before and after, partial apply, rollback.",
      "Sync history, source health, league profiles and official patch-notes analysis.",
      "Deck Intelligence reads its Divination Card list from the Update Center.",
    ],
  },
  {
    version: "0.19.0",
    date: "2026-11-26",
    title: "Deck Intelligence (PoE 1)",
    changes: [
      "Stacked Deck opening sessions from Client.txt and one-shot ground screenshots read with Windows OCR.",
      "Review queue, duplicate protection, history with original valuations, statistics and card collection.",
      "Client.txt import and CSV / JSON export.",
    ],
  },
  {
    version: "0.18.1",
    date: "2026-11-25",
    title: "Divination cards priced from poe.ninja",
    changes: ["Cards show the poe.ninja price per card, full set and copied stack; Trade is searched only on request."],
  },
  {
    version: "0.18.0",
    date: "2026-11-25",
    title: "Ultimatum Checker (PoE 1)",
    changes: [
      "Check an Inscribed Ultimatum with the price-check hotkey: modifier ratings, risk verdict and trial planner.",
      "Sacrifice and reward valued from poe.ninja with a break-even rate; open the search on Trade.",
    ],
  },
  {
    version: "0.17.0",
    date: "2026-11-25",
    title: "Price Check rework",
    changes: [
      "Transparent valuation: every listing gets a verdict, outliers are excluded, confidence comes with reasons.",
      "Local weapon and armour stats, Quick / Advanced / Base type modes, more pseudo totals.",
      "Compact item summary and listing rows; copy price or whisper.",
    ],
  },
];

/** Compares dotted versions numerically ("0.20.10" > "0.20.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Entries relevant to the running build: everything released up to `appVersion`,
 * plus unreleased entries (they describe changes already in this build).
 * A released entry newer than the build is never shown.
 */
export function changelogFor(appVersion: string, entries: readonly ChangelogEntry[] = CHANGELOG): ChangelogEntry[] {
  return entries.filter((e) => e.unreleased || compareVersions(e.version, appVersion) <= 0);
}
