/**
 * Inscribed Ultimatum (PoE 1) — parser for the item text the game copies with
 * Ctrl+C. Format verified against a real copy (fixture in ultimatum.test.ts):
 *
 *   Item Class: Misc Map Items
 *   Rarity: Currency
 *   Inscribed Ultimatum
 *   --------
 *   Challenge: Survive
 *   Area Level: 83
 *   Requires Sacrifice: Chaos Orb x10
 *   Reward: Doubles sacrificed Currency
 *   --------
 *   Totem of Costly Potency
 *   (description, may span several lines)
 *   …
 *   --------
 *   Can be used in a personal map device …
 */
import { findModifier, type ModifierKind } from "./data/modifiers";

export const ULTIMATUM_BASE = "Inscribed Ultimatum";

export interface UltimatumModifier {
  name: string;
  /** Game text in parentheses, joined with spaces (empty when the copy has none). */
  description: string;
  /** From the modifier catalogue; null when the name is not in it. */
  family: string | null;
  tier: number | null;
  kind: ModifierKind | null;
}

/** Trade-site option ids (`ultimatum_filters`), verified from /api/trade/data/filters. */
export type ChallengeId = "Exterminate" | "Survival" | "Defense" | "Conquer";
export type RewardKind = "DoubleCurrency" | "DoubleDivCards" | "MirrorRare" | "ExchangeUnique";

export interface Ultimatum {
  challenge: string;
  challengeId: ChallengeId | null;
  areaLevel: number | null;
  sacrifice: { name: string; count: number } | null;
  reward: string;
  rewardKind: RewardKind | null;
  /** Reward unique name (only for ExchangeUnique). */
  rewardItem: string | null;
  modifiers: UltimatumModifier[];
  corrupted: boolean;
}

const CHALLENGES: Record<string, ChallengeId> = {
  survive: "Survival",
  "defeat waves of enemies": "Exterminate",
  "protect the altar": "Defense",
  "stand in the stone circles": "Conquer",
};

/** "Doubles sacrificed Currency" is verified; the other reward texts are matched by keyword. */
export function rewardKindOf(reward: string): RewardKind | null {
  const r = reward.trim().toLowerCase();
  if (!r) return null;
  if (r.includes("currency")) return "DoubleCurrency";
  if (r.includes("divination")) return "DoubleDivCards";
  if (r.includes("mirror")) return "MirrorRare";
  return "ExchangeUnique";
}

/** "Chaos Orb x10" → { Chaos Orb, 10 }; a unique ("Headhunter") → count 1. */
export function parseSacrifice(value: string): { name: string; count: number } | null {
  const v = value.trim();
  if (!v) return null;
  const m = /^(.*?)\s+x\s?(\d+)$/i.exec(v);
  return m ? { name: (m[1] ?? "").trim(), count: Number(m[2]) } : { name: v, count: 1 };
}

const SEP = /^-{8,}$/;
const HELP = /^(Can be used in|Place into|While viewing|Right-click)/i;

/** Parses Inscribed Ultimatum text; null when the text is something else. */
export function parseUltimatum(raw: string): Ultimatum | null {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim());
  const sections: string[][] = [[]];
  for (const l of lines) {
    if (SEP.test(l)) sections.push([]);
    else if (l) sections[sections.length - 1]!.push(l);
  }
  if (!sections[0]!.some((l) => l === ULTIMATUM_BASE)) return null;

  const props = new Map<string, string>();
  let propIdx = -1;
  sections.forEach((s, i) => {
    if (propIdx < 0 && s.some((l) => /^(Challenge|Reward|Requires Sacrifice):/.test(l))) propIdx = i;
  });
  if (propIdx < 0) return null;
  for (const l of sections[propIdx]!) {
    const at = l.indexOf(": ");
    if (at > 0) props.set(l.slice(0, at), l.slice(at + 2).trim());
  }

  const modifiers: UltimatumModifier[] = [];
  let corrupted = false;
  for (const s of sections.slice(propIdx + 1)) {
    if (s.length === 1 && s[0] === "Corrupted") {
      corrupted = true;
      continue;
    }
    if (s.some((l) => HELP.test(l)) || s.some((l) => /^(Item Level|Note):/.test(l))) continue;
    modifiers.push(...parseModifierSection(s));
  }

  const challenge = props.get("Challenge") ?? "";
  const reward = props.get("Reward") ?? "";
  const rewardKind = rewardKindOf(reward);
  const area = Number(props.get("Area Level"));
  return {
    challenge,
    challengeId: CHALLENGES[challenge.toLowerCase()] ?? null,
    areaLevel: Number.isFinite(area) && area > 0 ? area : null,
    sacrifice: parseSacrifice(props.get("Requires Sacrifice") ?? ""),
    reward,
    rewardKind,
    rewardItem: rewardKind === "ExchangeUnique" ? reward : null,
    modifiers,
    corrupted,
  };
}

/** Name lines followed by an optional "(…)" description that may span lines. */
function parseModifierSection(lines: string[]): UltimatumModifier[] {
  const out: UltimatumModifier[] = [];
  let desc: string[] | null = null;
  for (const l of lines) {
    if (desc) {
      desc.push(l);
      if (l.endsWith(")")) finish();
      continue;
    }
    if (l.startsWith("(") && out.length > 0) {
      desc = [l];
      if (l.endsWith(")")) finish();
      continue;
    }
    const ref = findModifier(l);
    out.push({
      name: l,
      description: "",
      family: ref?.family.family ?? null,
      tier: ref?.tier ?? null,
      kind: ref?.family.kind ?? null,
    });
  }
  if (desc) finish();
  return out;

  function finish() {
    const text = desc!.join(" ").replace(/^\(/, "").replace(/\)$/, "").trim();
    out[out.length - 1]!.description = text;
    desc = null;
  }
}
