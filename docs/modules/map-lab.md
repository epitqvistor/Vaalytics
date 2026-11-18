# Map Lab (PoE 1)

Paste a map to see its modifiers grouped by your own risk rules and its reward
properties; compare the maps you pasted.

| | |
|---|---|
| Registry id | `map-lab` · group `endgame` · PoE 1 ready · PoE 2 not offered |
| UI | `src/games/poe1/map-lab/index.tsx` |
| Logic | `maplab.ts` (mod keys, rules, verdict, rewards) — tested in `maplab.test.ts` with `fixtures.ts` |
| Data | the pasted map (PoE 1 item parser); rules = user data (`maplab.rules`, per game) |
| Patch rules | none — mods are matched by their text, so new 3.30 map mods work without a data update |

## Behaviour

- **Paste**: copy a map in game (Ctrl+C, or Ctrl+Alt+C for prefix/suffix) and press Ctrl+V anywhere
  in the section. Non-maps are refused with a message.
- **Map card**: verdict ("Don't run with these rules" / "Runnable — watch out" / "Fine by your
  rules"), tier, corrupted, and the reward properties exactly as the map lists them (Item Quantity,
  Item Rarity, Monster Pack Size, Quality, any "More …" property; 3.30 "Atlas Drops" too).
- **Mods**: each with Can't run / Dangerous / Fine. Changing it saves a rule for that mod *type*:
  the key replaces numbers with `#`, so the rule applies to every roll of the mod.
- **Defaults**: a short list of common build-stoppers (reflect, no regeneration, no leech) and
  dangers (less recovery, lower maximum resistances, player curses, extra damage), shown as
  "default". Any rule you set wins; setting a default mod to Fine stores an override.
- **Pasted maps**: the last 12 maps with tier, quantity, rarity, pack size and verdict; click to
  open. Kept in memory until Vaalytics closes.

## Data integrity

- Nothing is estimated: no "map value", no drop expectations. Rewards are the map's own numbers.
- Severities are opinions — yours, or the clearly marked defaults.

## Not yet

- Map setups (Threads, map device, Atlas) — needs verified 3.30 Thread data (Thread Planner).
- Map check in the in-game overlay (Ctrl+D on a map).
- Rule import/export and per-build rule sets.
