/** Test-only fixtures built with the shared parser core (no game-module imports). */
import { parseWith, type ParserRules } from "@/shared/item-parser/core";
import type { ParsedItem } from "@/shared/item-parser/types";

const rules = (game: "poe1" | "poe2"): ParserRules => ({
  game,
  lineMarkers: { " (implicit)": "implicit", " (crafted)": "crafted", " (fractured)": "fractured", " (rune)": "rune" },
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
