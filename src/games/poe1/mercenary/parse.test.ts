import { describe, expect, it } from "vitest";
import { catalogIndex, CATALOG } from "./catalog";
import { applyCorrections, bindingCheck, fingerprint, looksLikeWarrant, parseWarrant, warrantFromListing } from "./parse";
import fixtures from "./fixtures/warrants-3.30.json";

const REAL: Record<string, string> = fixtures.warrants;

// Real Ctrl+C text (Trade extended.text, Covens, 2026-11-26), Note removed.
const KINETICIST = `Item Class: Map Fragments
Rarity: Normal
Mercenary Warrant
--------
Tavielle, the Exquisite
--------
Build: Kineticist
Mercenary Level: 83
--------
Elemental Weakness
Greater Curse Effect (Tier: 3)
Lesser Spell Cascade (Tier: 1)
--------
Flame Wall
Greater Area of Effect (Tier: 3)
Greater More Duration (Tier: 3)
Elemental Focus (Tier: 2)
--------
Kinetic Bolt
Critical Chance (Tier: 2)
Added Lightning (Tier: 2)
Added Cold (Tier: 2)
Elemental Damage with Attacks (Tier: 2)
Critical Damage (Tier: 2)
--------
Kinetic Blast of Clustering
Greater Multiple Projectiles (Tier: 3)
Return (Tier: 3)
Added Cold (Tier: 2)
Chain (Tier: 2)
Critical Chance (Tier: 2)
--------
Frostblink
Increased Area of Effect (Tier: 2)
Greater Cooldown Recovery (Tier: 3)
--------
Inspiring Cry
Greater More Duration (Tier: 3)
Increased Area of Effect (Tier: 2)
--------
Right click this item to view Mercenary details.
Open a portal to the Proving Grounds by using this item in a personal Map Device. This previously fought Mercenary will reappear in the area for a rematch. While viewing your Atlas, Right-click this item to pinpoint its location.
--------
Note: ~b/o 100 chaos
`;

describe("catalog", () => {
  it("has the verified 3.30 counts", () => {
    expect(CATALOG.meta.gameVersion).toBe("3.30.0");
    expect(CATALOG.meta.counts.families).toBe(37);
    expect(CATALOG.meta.counts.skills).toBe(272);
    expect(CATALOG.meta.counts.warrantTypes).toBe(65);
    expect(CATALOG.meta.counts.variants).toBe(65);
    expect(CATALOG.meta.counts.officialSkillStats).toBe(273);
    expect(CATALOG.meta.counts.officialSupportStats).toBe(266);
  });

  it("gives every skill and every rollable support tier an official stat id", () => {
    const idx = catalogIndex();
    for (const f of CATALOG.families) {
      for (const v of f.variants) {
        for (const [skillId, rule] of Object.entries(idx.skillRules(f, v))) {
          expect(idx.skillStat(f, v, skillId), `${f.id}/${skillId}`).toMatch(/^mercenary\.skill_\d+$/);
          for (const a of idx.allowedSupports(rule)) {
            for (const t of a.tiers) expect(idx.supportStat(f, v, skillId, a.support, t), `${f.id}/${skillId}/${a.support}/T${t}`).toMatch(/^mercenary\.support_\d+$/);
          }
        }
      }
    }
  });

  it("keeps per-skill stats for texts that share a name (verified live)", () => {
    const idx = catalogIndex();
    const chaplain = idx.familyById.get("chaplain_of_the_well")!;
    const thunder = idx.familyById.get("thunderquiver")!;
    const eruptor = idx.familyById.get("eruptor")!;
    expect(idx.skillStat(chaplain, null, "herald_of_ash")).toBe("mercenary.skill_31201");
    expect(idx.skillStat(eruptor, null, "herald_of_ash")).toBe("mercenary.skill_44334");
    expect(idx.supportStat(chaplain, null, "smite", "gilded_extra_targets", 3)).toBe("mercenary.support_37259");
    expect(idx.supportStat(chaplain, null, "vaal_smite", "gilded_extra_targets", 3)).toBe("mercenary.support_37259");
    expect(idx.supportStat(thunder, null, "lightning_arrow", "gilded_extra_targets", 3)).toBe("mercenary.support_58471");
  });

  it("keeps normal and Infamous as separate variants with their own warrant types", () => {
    const k = catalogIndex().familyById.get("kineticist")!;
    expect(k.variants.map((v) => v.warrantType)).toEqual(["MiscScionWandAttacks", "MiscScionWandAttacksNoble"]);
    expect(catalogIndex().familyById.get("warpriest_of_the_ruckus")!.variants.map((v) => v.infamous)).toEqual([true]);
  });
});

describe("parseWarrant", () => {
  it("parses a real warrant with supports bound to their own skill", () => {
    const w = parseWarrant(KINETICIST)!;
    expect(w.mercName).toBe("Tavielle, the Exquisite");
    expect(w.family).toMatchObject({ value: "kineticist", status: "confirmed" });
    expect(w.variant.value).toBe("kineticist");
    expect(w.infamous.value).toBe(false);
    expect(w.warrantType).toBe("MiscScionWandAttacks");
    expect(w.level).toMatchObject({ value: 83, status: "confirmed" });
    expect(w.skills.map((s) => s.skill.value)).toEqual(["elemental_weakness", "flame_wall", "kinetic_bolt", "kinetic_blast_of_clustering", "frostblink", "inspiring_cry"]);
    const kboc = w.skills[3]!;
    expect(kboc.category).toBe("secondary");
    expect(kboc.stat).toBe("mercenary.skill_16356");
    expect(kboc.supports.map((p) => `${p.support.value}:${p.tier.value}`)).toEqual(["multiple_projectiles:3", "return:3", "added_cold:2", "chain:2", "critical_chance:2"]);
    expect(kboc.supports[1]!.stat).toBe("mercenary.support_5293");
    // Kinetic Bolt's supports are its own: Return is not on it.
    expect(w.skills[2]!.supports.some((p) => p.support.value === "return")).toBe(false);
    expect(w.ignored).toContain("Note: ~b/o 100 chaos");
    expect(w.unparsed).toEqual([]);
    expect(bindingCheck(w).certain).toBe(true);
  });

  it("parses one real warrant of every family available on Trade, all fields confirmed", () => {
    expect(Object.keys(REAL).length).toBeGreaterThanOrEqual(37);
    for (const [variantId, text] of Object.entries(REAL)) {
      const w = parseWarrant(text)!;
      expect(w, variantId).not.toBeNull();
      expect(w.variant.value, variantId).toBe(variantId);
      expect(w.level.status, variantId).toBe("confirmed");
      expect(w.skills.length, variantId).toBeGreaterThanOrEqual(3);
      const check = bindingCheck(w);
      expect(check.reasons, variantId).toEqual([]);
      expect(w.unparsed, variantId).toEqual([]);
      expect(w.problems, variantId).toEqual([]);
    }
  });

  it("never reads Area Level, Item Tier or Item Level as the mercenary level", () => {
    const text = KINETICIST.replace("Mercenary Level: 83", "Mercenary Level: 84\nArea Level: 83\nItem Tier: 16\nItem Level: 0\nLimit: 1\nPortal: The Proving Grounds");
    const w = parseWarrant(text)!;
    expect(w.level.value).toBe(84);
    expect(w.ignored).toEqual(expect.arrayContaining(["Area Level: 83", "Item Tier: 16", "Item Level: 0", "Limit: 1", "Portal: The Proving Grounds"]));
    const noLevel = parseWarrant(KINETICIST.replace("Mercenary Level: 83\n", "Area Level: 83\n"))!;
    expect(noLevel.level.status).toBe("unknown");
    expect(bindingCheck(noLevel).certain).toBe(false);
  });

  it("reads Infamous from the Build line", () => {
    const w = parseWarrant(REAL["kineticist.infamous"]!)!;
    expect(w.infamous).toMatchObject({ value: true, status: "confirmed" });
    expect(w.warrantType).toBe("MiscScionWandAttacksNoble");
  });

  it("joins wrapped skill and support names", () => {
    const text = KINETICIST.replace("Kinetic Blast of Clustering\n", "Kinetic Blast of\nClustering\n").replace("Greater Cooldown Recovery (Tier: 3)", "Greater Cooldown\nRecovery (Tier: 3)");
    const w = parseWarrant(text)!;
    expect(w.skills[3]!.skill.value).toBe("kinetic_blast_of_clustering");
    expect(w.skills[3]!.supports).toHaveLength(5);
    expect(w.skills[4]!.supports.map((p) => p.support.value)).toEqual(["increased_area_of_effect", "cooldown_recovery"]);
    expect(bindingCheck(w).certain).toBe(true);
  });

  it("accepts roman and short tier forms", () => {
    const w = parseWarrant(KINETICIST.replace("Return (Tier: 3)", "Return (III)").replace("Chain (Tier: 2)", "Chain (2)"))!;
    expect(w.skills[3]!.supports.map((p) => `${p.support.value}:${p.tier.value}:${p.tier.status}`)).toContain("return:3:confirmed");
    expect(w.skills[3]!.supports.map((p) => `${p.support.value}:${p.tier.value}`)).toContain("chain:2");
  });

  it("flags supports that can't roll on their skill instead of trusting them", () => {
    // Return can't roll on Frostblink per the catalog.
    const w = parseWarrant(KINETICIST.replace("Greater Cooldown Recovery (Tier: 3)", "Return (Tier: 3)"))!;
    const bad = w.skills[4]!.supports[1]!;
    expect(bad.support.status).toBe("ambiguous");
    expect(bad.stat).toBeNull();
    expect(bindingCheck(w).certain).toBe(false);
  });

  it("flags a wrong tier for a tier-specific name", () => {
    const w = parseWarrant(KINETICIST.replace("Greater Multiple Projectiles (Tier: 3)", "Greater Multiple Projectiles (Tier: 2)"))!;
    expect(w.skills[3]!.supports[0]!.support.status).toBe("ambiguous");
  });

  it("marks unknown skills and supports as unknown", () => {
    const w = parseWarrant(KINETICIST.replace("Frostblink\n", "Frostblinkk\n").replace("Chain (Tier: 2)", "Chian (Tier: 2)"))!;
    expect(w.skills[4]!.skill.status).toBe("unknown");
    expect(w.skills[3]!.supports[3]!.support.status).toBe("unknown");
    expect(bindingCheck(w).certain).toBe(false);
  });

  it("flags skills outside the family pool", () => {
    const w = parseWarrant(KINETICIST.replace("Inspiring Cry\n", "Frost Blades\n"))!;
    expect(w.skills[5]!.skill).toMatchObject({ value: "frost_blades", status: "ambiguous" });
  });

  it("infers the family when the Build line is missing, but leaves Infamous ambiguous", () => {
    const w = parseWarrant(KINETICIST.replace("Build: Kineticist\n", ""))!;
    expect(w.family).toMatchObject({ value: "kineticist", status: "inferred" });
    expect(w.variant.status).toBe("ambiguous");
    expect(bindingCheck(w).certain).toBe(false);
  });

  it("does not treat other items or huge text as warrants", () => {
    expect(looksLikeWarrant("Item Class: Currency\nRarity: Currency\nDivine Orb")).toBe(false);
    expect(parseWarrant("Build: release\ncargo build --release")).toBeNull();
    expect(looksLikeWarrant("Mercenary Warrant ".repeat(5000))).toBe(false);
  });

  it("revalues after corrections: fixing an ambiguous support confirms it", () => {
    const w = parseWarrant(KINETICIST.replace("Return (Tier: 3)", "Retrun (Tier: 3)"))!;
    expect(bindingCheck(w).certain).toBe(false);
    const fixed = applyCorrections(w, { skills: { 3: { supports: { 1: { support: "return", tier: 3 } } } } });
    expect(fixed.skills[3]!.supports[1]!).toMatchObject({ support: { value: "return", status: "confirmed", corrected: true }, stat: "mercenary.support_5293" });
    expect(bindingCheck(fixed).certain).toBe(true);
    const removed = applyCorrections(w, { skills: { 3: { supports: { 1: null } } } });
    expect(removed.skills[3]!.supports).toHaveLength(4);
  });

  it("corrects the variant and re-checks every binding", () => {
    const w = parseWarrant(KINETICIST.replace("Build: Kineticist\n", ""))!;
    const fixed = applyCorrections(w, { variant: "kineticist.infamous" });
    expect(fixed.variant).toMatchObject({ value: "kineticist.infamous", status: "confirmed" });
    expect(fixed.warrantType).toBe("MiscScionWandAttacksNoble");
    expect(bindingCheck(fixed).certain).toBe(true);
  });

  it("gives the same fingerprint regardless of order, and a different one for a different binding", () => {
    const a = parseWarrant(KINETICIST)!;
    const reordered = parseWarrant(KINETICIST.replace("Return (Tier: 3)\nAdded Cold (Tier: 2)", "Added Cold (Tier: 2)\nReturn (Tier: 3)"))!;
    expect(fingerprint(a)).toBe(fingerprint(reordered));
    // Same skills, Return moved from KBoC to Kinetic Bolt: a different warrant.
    const moved = parseWarrant(KINETICIST.replace("Return (Tier: 3)\n", "").replace("Critical Damage (Tier: 2)", "Critical Damage (Tier: 2)\nReturn (Tier: 3)"))!;
    expect(fingerprint(moved)).not.toBe(fingerprint(a));
  });
});

describe("warrantFromListing", () => {
  it("maps listing stat hashes to catalog ids exactly", () => {
    const w = warrantFromListing({
      id: "x",
      amount: 100,
      currency: "chaos",
      priceType: "~b/o",
      amountChaos: 100,
      indexed: null,
      instantBuyout: true,
      build: "Infamous Kineticist",
      level: 83,
      skills: [{ stat: "mercenary.skill_16356", name: "Kinetic Blast of Clustering", supports: [{ stat: "mercenary.support_5293", name: "Return", tier: 3 }] }],
    });
    expect(w.variant.value).toBe("kineticist.infamous");
    expect(w.skills[0]!).toMatchObject({ skill: { value: "kinetic_blast_of_clustering", status: "confirmed" }, category: "secondary" });
    expect(w.skills[0]!.supports[0]!.support.value).toBe("return");
  });
});
