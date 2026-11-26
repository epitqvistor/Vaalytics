/** Test-only fixtures built with the shared parser core (no game-module imports). */
import { parseWith, type ParserRules } from "@/shared/item-parser/core";
import type { ParsedItem } from "@/shared/item-parser/types";

const rules = (game: "poe1" | "poe2"): ParserRules => ({
  game,
  lineMarkers: { " (implicit)": "implicit", " (crafted)": "crafted", " (fractured)": "fractured", " (rune)": "rune", " (enchant)": "enchant" },
  flags: { Corrupted: (i) => (i.corrupted = true) },
  sections: [],
});

function parse(game: "poe1" | "poe2", text: string): ParsedItem {
  const r = parseWith(rules(game), text);
  if (!r.ok) throw new Error(r.error);
  return r.item;
}

// Real PoE 1 trade item text (see games/poe1/parser tests).
export const parsePoe1ItemForTest = () =>
  parse(
    "poe1",
    `Item Class: Rings
Rarity: Rare
Pain Turn
Two-Stone Ring
--------
Item Level: 40
--------
+15% to Fire and Cold Resistances
--------
Adds 3 to 7 Physical Damage to Attacks
+106 to Accuracy Rating
+78 to maximum Life
+27 to maximum Mana
`,
  );

export const parsePoe2ItemForTest = () =>
  parse(
    "poe2",
    `Item Class: Rings
Rarity: Rare
Sample Coil
Sapphire Ring
--------
Item Level: 79
--------
+22% to Cold Resistance (implicit)
--------
+89 to maximum Life
+31% to Lightning Resistance
`,
  );

/** The Taming (from a user report): reminder text + a two-line unique modifier. */
export const TAMING_TEXT = `Item Class: Rings
Rarity: Unique
The Taming
Prismatic Ring
--------
Requires: Level 30
--------
Item Level: 84
--------
{ Implicit Modifier — Elemental, Fire, Cold, Lightning, Resistance }
+10(8-10)% to all Elemental Resistances (implicit)
--------
{ Unique Modifier — Elemental, Fire, Cold, Lightning, Resistance }
+24(20-30)% to all Elemental Resistances
{ Unique Modifier — Elemental, Fire, Cold, Lightning, Ailment }
10% chance to Freeze, Shock and Ignite
(Freeze lowers Enemy Action Speed to zero, preventing them from acting. Duration is based on the Cold Damage of the Hit)
(Shock increases Damage taken by up to 50%, depending on the amount of Lightning Damage in the hit, for 2 seconds)
(Ignite deals Fire Damage over time, based on the base Fire Damage of the Skill, for 4 seconds)
{ Unique Modifier — Damage, Elemental }
31(30-40)% increased Elemental Damage with Hits and Ailments for
each type of Elemental Ailment on Enemy
--------
"Moon after moon did Berek make fools
Of the great and Untamed Three
Until malice for a Brother
Slew the hatred of the Other
And Berek did hunt
Alone and free."
- Berek and the Untamed
`;

export const parseTamingForTest = () => parse("poe1", TAMING_TEXT);

export const parseRareForTest = (lines: string) =>
  parse(
    "poe1",
    `Item Class: Rings
Rarity: Rare
Sample Band
Two-Stone Ring
--------
Item Level: 80
--------
${lines}
`,
  );

/** Transfigured gem (from a user report): Trade needs base gem + discriminator. */
export const parseTransfiguredGemForTest = () =>
  parse(
    "poe1",
    `Item Class: Skill Gems
Rarity: Gem
Static Strike of Gathering Lightning
--------
Attack, Melee, Strike, Duration, Lightning, Chaining
Level: 15
Cost: 9 Mana
Attack Damage: 280.1% of base
Effectiveness of Added Damage: 280%
Quality: +5% (augmented)
--------
Requirements:
Level: 59
Str: 83
Int: 58
--------
Attack with a melee weapon, gaining a Gathering Lightning buff for a duration if you hit an enemy.
--------
Experience: 4997158/9400731
--------
Place into an item socket to gain this skill. Right click to remove from a socket.
`,
  );

/**
 * Small Cluster Jewel (user report, Nov 2026: 0 results). Constructed in the PoE 1 copy format;
 * the enchant lines match the screenshot. `rarity`/`name` lines vary per test.
 */
export const CLUSTER_TEXT = (rarity: "Rare" | "Magic") => `Item Class: Jewels
Rarity: ${rarity}
${rarity === "Rare" ? "Sample Spark\nSmall Cluster Jewel" : "Lustrous Small Cluster Jewel of the Sample"}
--------
Requirements:
Level: 54
--------
Item Level: 84
--------
Adds 2 Passive Skills (enchant)
Added Small Passive Skills grant: 15% increased Armour (enchant)
--------
{ Prefix Modifier "Fervent" (Tier: 1) — Life }
Added Small Passive Skills also grant: +10 to Maximum Life
--------
Place into an allocated Medium or Large Jewel Socket on the Passive Skill Tree. Added passives do not interact with jewel radiuses. Right click to remove from the Socket.
`;
export const parseClusterForTest = (rarity: "Rare" | "Magic" = "Rare") => parse("poe1", CLUSTER_TEXT(rarity));

/** Necropolis corpse — real item text from the PoE 1 Trade API (item.extended.text, Covens, Nov 2026). */
export const CORPSE_TEXT = `Item Class: Corpses
Rarity: Currency
Perfect Serpent Warrior
--------
Corpse Level: 83
Monster Category: Eldritch
--------
Item Level: 83
--------
Attacks with swords when not Defensive
Fires Mortars when Defensive
Inflicts Withered for 2 seconds on Hit
Creates Aura of Chaos when hitting Poisoned enemies
--------
Right click this item to create this corpse.
`;
export const parseCorpseForTest = () => parse("poe1", CORPSE_TEXT);

/** Rare boots — real item text from the PoE 1 Trade API (Covens, 2026-11-25). Its "39% increased Evasion Rating" is local. */
export const REAL_BOOTS_TEXT = `Item Class: Boots
Rarity: Rare
Glyph Track
Shagreen Boots
--------
Evasion Rating: 272 (augmented)
--------
Requirements:
Level: 62
Dex: 97
--------
Sockets: W-W-W-W
--------
Item Level: 79
--------
+40 to Dexterity
39% increased Evasion Rating
+96 to maximum Life
+42% to Lightning Resistance
30% increased Movement Speed
17% increased Stun and Block Recovery
--------
Note: ~b/o 1 alch
`;
export const parseRealBootsForTest = () => parse("poe1", REAL_BOOTS_TEXT);

/** Synthesised unique — real item text from the PoE 1 Trade API (Covens, 2026-11-25). User report: "Unknown item base type". */
export const NEBULIS_TEXT = `Item Class: Sceptres
Rarity: Unique
Nebulis
Synthesised Void Sceptre
--------
Sceptre
Physical Damage: 50-76
Critical Strike Chance: 7.30%
Attacks per Second: 1.25
Weapon Range: 1.1 metres
--------
Requirements:
Level: 68
Str: 104
Int: 122
--------
Sockets: R-W W 
--------
Item Level: 87
--------
+22 to Dexterity
25% increased Cast Speed
Regenerate 0.6% of Mana per second
--------
109% increased Implicit Modifier magnitudes
18% increased Cast Speed
7% increased Elemental Damage per 1% Fire, Cold, or Lightning Resistance above 75%
--------
The vastness of the cosmos holds energies beyond comprehension,
should one have the fortitude to grasp them.
--------
Synthesised Item
--------
Note: ~b/o 1 chaos
`;
/** The same item as an in-game advanced copy marks the synthesis implicit "— Unscalable Value". */
export const NEBULIS_ADVANCED_TEXT = NEBULIS_TEXT.replace("109% increased Implicit Modifier magnitudes", "109% increased Implicit Modifier magnitudes — Unscalable Value");
export const parseNebulisForTest = (advanced = false) => parse("poe1", advanced ? NEBULIS_ADVANCED_TEXT : NEBULIS_TEXT);

/** Divination card in the in-game copy layout (constructed; the reward line is not checked). */
export const DIV_CARD_TEXT = `Item Class: Divination Cards
Rarity: Divination Card
The Dragon's Heart
--------
Stack Size: 1/11
--------
Level 4 Empower Support
Corrupted
--------
A long time ago, in a cave far away.
`;
export const parseDivCardForTest = (game: "poe1" | "poe2" = "poe1") => parse(game, DIV_CARD_TEXT);

/** Tattoo in the in-game copy layout (constructed from the user's screenshot; effect text not checked). */
export const TATTOO_TEXT = `Item Class: Stackable Currency
Rarity: Currency
Tattoo of the Arohongui Warrior
--------
Stack Size: 1/10
--------
Replaces a Small Attribute Passive Skill
--------
Place into an allocated Small Attribute Passive Skill to replace it.
`;
export const parseTattooForTest = () => parse("poe1", TATTOO_TEXT);
