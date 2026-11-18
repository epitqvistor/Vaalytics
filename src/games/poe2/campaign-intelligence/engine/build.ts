/**
 * Build-aware hints (pure). Numbers come from the player's Path of Building
 * build — a *planned* character with its intended gear, not the live character
 * (Vaalytics can't see live stats). Hints only re-rank objectives and say why;
 * nothing about the build or the character is changed.
 */
import type { CampaignBuildStats } from "@/core/ipc/commands";
import type { CampaignGraph } from "./graph";

export interface BuildBoost {
  bonus: number;
  reason: string;
}

export interface BuildHints {
  /** Plain-language findings, shown on the page. */
  lines: string[];
  /** Score bonus per objective id. */
  boosts: Map<string, BuildBoost>;
}

const ELEMENTS = [
  { key: "FireResist", name: "Fire", reward: /fire resistance/i },
  { key: "ColdResist", name: "Cold", reward: /cold resistance/i },
  { key: "LightningResist", name: "Lightning", reward: /lightning resistance/i },
] as const;
const ATTRS = [
  { have: "Str", need: "ReqStr", name: "Strength" },
  { have: "Dex", need: "ReqDex", name: "Dexterity" },
  { have: "Int", need: "ReqInt", name: "Intelligence" },
] as const;
const RES_TARGET = 75;

export function buildHints(g: CampaignGraph, build: CampaignBuildStats, characterClass: string | null): BuildHints {
  const s = build.stats;
  const lines: string[] = [];
  const boosts = new Map<string, BuildBoost>();
  const boost = (id: string, bonus: number, reason: string) => {
    const prev = boosts.get(id);
    if (!prev || prev.bonus < bonus) boosts.set(id, { bonus, reason });
  };
  const withReward = (test: (label: string, category: string) => boolean) =>
    g.dataset.rewards.filter((r) => test(r.label, r.category)).map((r) => r.objective);

  // Spirit: reserved = total − unreserved.
  if (s.Spirit != null && s.SpiritUnreserved != null) {
    const reserved = Math.round(s.Spirit - s.SpiritUnreserved);
    if (reserved > 0) {
      const tight = s.SpiritUnreserved < 30;
      lines.push(`Your build reserves ${reserved} of ${Math.round(s.Spirit)} Spirit${tight ? ` (${Math.round(s.SpiritUnreserved)} left)` : ""}; the campaign gives up to 100.`);
      for (const id of withReward((_l, c) => c === "spirit")) boost(id, tight ? 25 : 15, "Your build relies on Spirit.");
    }
  }

  // Resistances: the weakest element below the cap gets its campaign reward pushed up.
  const res = ELEMENTS.filter((e) => s[e.key] != null).map((e) => ({ ...e, value: s[e.key]! }));
  const weak = res.filter((e) => e.value < RES_TARGET).sort((a, b) => a.value - b.value);
  for (const e of weak) {
    lines.push(`Your build's ${e.name} resistance is ${Math.round(e.value)}% with its planned gear.`);
    for (const id of withReward((l, c) => c === "resistance" && e.reward.test(l))) boost(id, 20, `Your build is short on ${e.name} resistance.`);
  }

  // Attributes: requirements above what the build has.
  const short = ATTRS.filter((a) => s[a.have] != null && s[a.need] != null && s[a.need]! > s[a.have]!);
  for (const a of short) lines.push(`Your build needs ${Math.round(s[a.need]! - s[a.have]!)} more ${a.name} than it has.`);
  if (short.length) {
    for (const id of ["a4.tattoos", "i2.qimah-boon"]) if (g.objective.has(id)) boost(id, 10, `Offers +5 ${short.map((a) => a.name).join("/")} — your build is short.`);
  }

  if (characterClass && build.ascendClassName && characterClass !== build.ascendClassName && characterClass !== build.className) {
    lines.push(`This build is for a ${build.ascendClassName}; the character is a ${characterClass}.`);
  }
  if (!lines.length) lines.push("Nothing in this build changes the campaign priorities.");
  return { lines, boosts };
}
