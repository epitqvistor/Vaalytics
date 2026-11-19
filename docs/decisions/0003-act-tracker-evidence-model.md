# 0003 — Act Tracker: evidence model, `/passives` sync and campaign_events rebuild

Date: 2026-11-19 · Status: accepted · Module: Act Tracker (PoE 1), docs/modules/act-tracker.md

## Context

The Act Tracker has to say where the player is in the PoE 1 campaign and which permanent rewards (24 quest passive
points) are done. Client.txt shows area entries, level-ups, deaths and "You have received … Passive Skill Point(s)"
lines. It doesn't show quest progress, boss kills or hand-ins. A real-log check showed that some claimed points
have no "You have received" line at all (18–20 lines for 22 claimed points in two full runs). The game's own
`/passives` chat command prints an exact per-quest breakdown into Client.txt.

## Decision

1. **One reader.** The tracker reuses the shared Client.txt reader, parser and campaign hook (via the Location
   Atlas' `atlas_sync`). It adds no second detector and does no memory reading.
2. **Evidence levels**, always shown with the value: game output (`/passives`), Client.txt lines, the player's
   marks, and route inference ("passed"). Entering an area never completes anything. A missing log line is never
   proof that a point was missed; only `/passives` can make a reward MISSED.
3. **`/passives` sync.** The parser reads the PoE 1 `/passives` lines and "Passive Respec Point(s)". The hook stores
   them as new `campaign_events` kinds for PoE 1 only. The player types the command; Vaalytics never sends input to
   the game.
4. **Migration 0010** rebuilds `campaign_events` to widen the kind CHECK. It keeps the same columns, ids (so the
   change token is unchanged), UNIQUE constraint and indexes. Nothing references the table.
5. **Data:** the route is generated from exile-leveling (MIT) and checked against the game's area data. The reward
   database is hand-checked and never generated or auto-updated; `/campaign-update` only flags book changes.

## Consequences

- The schema is v10. Older builds refuse a v10 database, so the installer must be rebuilt before a dev build
  migrates the real database.
- Some rewards stay "needs confirmation" until the player types `/passives` or marks them. This is deliberate: the
  tracker would rather ask than claim.
- PoE 2 is unaffected: its `/passives` format wasn't verified, so nothing is stored for it.
