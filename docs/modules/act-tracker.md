# Act Tracker (PoE 1)

Live campaign assistant for **Path of Exile 1, Acts 1–10**: where you are, what to do now, what comes next, and
every permanent reward (above all the 24 quest Passive Skill Points) — from your Client.txt, in a small
always-on-top overlay and a full guide page.

| | |
|---|---|
| Registry id | `act-tracker` · group `character` · PoE 1 `ready` (Phases 1–7 complete) · PoE 2 not offered |
| UI | `src/games/poe1/act-tracker/` — `index.tsx` (page: overlay controls, route options, expanded guide), `GuardianPanel.tsx`, `TrackerWindow.tsx` (overlay window `act-tracker`, route `#act-tracker`), `hooks.ts`, `prefs.ts`, `ui.tsx`; Rust `src-tauri/src/act_tracker.rs` |
| Logic | pure TS in `src/games/poe1/act-tracker/{data,engine}` (tested) |
| Data | DataKind **game-data** (route, quests, rewards — versioned, with sources) and **user** (log-derived progress, manual marks, guide profiles) |
| Patch rules | the dataset's own `gameVersion` vs the client tag in Client.txt |

Functional reference: Lailloken's Exile UI Act-Tracker (wiki only — no code, data or graphics copied).

## Audit (2026-11-19)

| Area | Finding | Use |
| --- | --- | --- |
| Location detection | One Client.txt reader + parser (`session/reader.rs`, `session/log_format.rs`) and one campaign hook (`campaign/hook.rs`, character attribution, `game`-isolated rows). For PoE 1 it is driven by `campaign::sync` (Location Atlas, command `atlas_sync`, incremental, offset in `campaign_state`). | **No second reader.** The tracker calls the same sync while it is visible. |
| Stored progress | `campaign_events` (poe1 rows: `zone` entries with area id/level, `passive_points`, `level`, `ascended`, `death`), `campaign_characters`, `campaign_marks`, `campaign_reward_marks` (stages not-claimed → complete). Commands accept `poe1`. | Steps and rewards use these tables (ids prefixed `act.`); no new tables for Phases 1–2. |
| Area data | Location Atlas dataset `src/games/poe1/location-atlas/data/3.30` (RePoE game files 3.30.0.2.2: 155 areas, connections, waypoints, towns; 0 unknown ids vs the real log). | Imported read-only for area names/acts/waypoints; "Open in Atlas" via `atlas_open`. |
| Windows | Second-window pattern exists twice (price-check overlay, Location Atlas: own capability file, saved bounds, single instance, `ToolWindowBar`). | Overlay window follows the same pattern (Phase 2). |
| Route | exile-leveling (HeartofPhos, **MIT**, commit pinned) ships a maintained levelling route (`common/data/routes/act-N.txt`, updated 2026-11-12) with bandit branches (`BANDIT_KILL/ALIRA/KRAITYN/OAK`), league-start extras (trials, optional quests), the Library branch, every hand-in, waypoint and town trip. | Parsed by a generator into structured steps; our own priority categories, statuses and reward guardian on top. Attribution in the UI. |
| Passive points | **Real log:** typing `/passives` writes a per-quest breakdown to Client.txt: `23 Passive Skill Points from quests:` then `(1 from The Dweller of the Deep)` … in a fixed order. Absent quest = not done; `(0 from …)` = quest reached but no point yet (seen: `(0 from An End to Hunger)` followed 30 s later by `You have received 2 Passive Skill Points.`), or a helped bandit. Grants: `You have received a Passive Skill Point.` / `2 Passive Skill Points`. | The 22 point quests + bandit (23/24) are **VERIFIED** from the game's own output; `/passives` becomes an automatic, exact sync (the player types it — Vaalytics never sends input). |
| Respec points | `You have received a Passive Respec Point.` / `2 Passive Respec Points.` (also bursts of many at once, so not attributable by count). Quests (PoEDB): A Dirty Job, Fallen from Grace, Fastis Fortuna, No Love for Old Ghosts. | COMMUNITY_VERIFIED; amounts unverified; manual confirmation. |
| Ascendancy | Class change in the level-up line (`(Guardian) is now level`) = ascended (verified); `/passives` prints `N total Ascendancy Skill Points`; Labyrinth areas `1_Labyrinth_*` / `Aspirant's Trial`. Trial completion is **not** in the log. | Trials: area from the route, completion manual; ascension auto. |
| Pantheon | Not in the log; no readable source yet (poewiki.net blocks automated reads). | UNVERIFIED until a source is read (Phase 3); manual. |
| Quest completion | Not in the log (no quest start/finish, boss kill, item pickup lines). | AREA ENTERED is automatic; OBJECTIVE COMPLETED / QUEST TURNED IN are manual or inferred (labelled); REWARD CLAIMED is automatic only for passive points. |
| PoB | `campaign_build_stats` (PoE 2) reads a PoB build; PoE 1 gem lists not wired. | Build-aware gem routing = separate later module, not blocking. |
| Hotkeys | Price-check hotkey is registered only while the game is focused. | Overlay show/hide hotkey uses the same rule (Phase 2). |

## Plan

Modules (folders under `src/games/poe1/act-tracker/`): `data/` (campaign-data), `engine/route.ts`
(campaign-routing), `engine/quests.ts` (quest-intelligence), `engine/passives.ts` (passive-reward-guardian),
overlay window (campaign-overlay), `engine/timer.ts` (campaign-timer), `engine/profiles.ts` (guide-editor),
atlas link (location-atlas-integration).

1. **Foundation** — generator `scripts/poe1-act-tracker-data.mjs` (exile-leveling route → steps with
   conditions, quest refs, hints, area ids checked against the game data), hand-checked reward DB (passives,
   refunds, bandits, trials) with provenance, validator, step resolution per profile, progress/status engine.
2. **Live Act Tracker** — overlay window (always on top, move/resize, opacity, compact bar, hotkey only while
   PoE is focused, optional click-through with a safe way back), current objective + next steps, auto-advance on
   area entries, manual confirm/skip; module page.
3. **Passive Skill Guardian** — reward statuses, bandit choice, point counting, `/passives` parser (hook event +
   migration), mismatch warnings; Pantheon source.
4. **Route Intelligence** — priorities (CRITICAL … SKIP), "important only", Fast Campaign variant, merged visits,
   off-route handling and return suggestions.
5. **Timer & History** — campaign / act / zone / town / hideout time from log timestamps; per-run history.
6. **Atlas integration** — open current area in the Atlas, show route step markers there.
7. **Guide editor & polish** — profiles (default read-only "Fast campaign — all passive points"), reorder,
   custom steps, hide, priorities, import/export, `/campaign-update` command.

### Risks

- Shared files edited by other sessions (`commands.rs`, `lib.rs`, registry, sections, `campaign/*`): additive
  edits only; Location Atlas owns `campaign/sync.rs` and the atlas data — coordinated before any change there.
- Route position from area entries only: a zone entered twice (backtracking, town portals) is matched with a
  forward-looking window; never resets the guide.
- Exile-leveling route changes upstream: regenerated data shows as a git diff; the generator validates every area
  and quest id against the game data.

## Phase 1 — Foundation (2026-11-19) ✅

**Files:** `scripts/poe1-act-tracker-data.mjs` (generator), `src/games/poe1/act-tracker/data/` (`types.ts`,
`rewards.ts`, `validate.ts`, `index.ts`, generated `3.30/route.json` + `meta.json`), `engine/route.ts`,
`engine/progress.ts`, `engine/quests.ts`, `act-tracker.test.ts`; registry entry `act-tracker` (planned).

### Route (generated)

- 540 steps, Acts 1–10, from exile-leveling commit `d6951db0ca94` (2026-11-12). One step = one instruction with
  its kind (enter, waypoint, logout, portal, hand-in, kill, quest item, trial, Labyrinth, waypoint, crafting),
  the area it is done in, the area it leads to, quests (with the hand-in NPC), kills, quest items, minimap hints.
- 29 conditional blocks: bandits (4 branches), league-start extras, 12 trial detours, the Library. Labyrinth trips
  (normal / cruel / merciless) are tagged and follow the trials option.
- Generator checks: every area id against the game data (RePoE), every quest id, no nested blocks, and that
  alternative branches end in the same area (one branch is resolved by the following waypoint/logout). Town
  portals: a portal taken in town goes back to where it was opened.
- Quest data for all 82 Act 1–10 quests: NPCs, book reward (`Book-a1q7`…), gem / vendor gem counts, on the route.

### Rewards (hand-checked, `data/rewards.ts`)

| Reward | Entries | Verification |
| --- | --- | --- |
| Book of Skill | 22 quests, 23 points (An End to Hunger = 2) | **VERIFIED** — names, order and amounts as printed by `/passives` in your client; PoEDB and the quest data agree |
| Deal with the Bandits | +1 only with Kill all → 24 / 23 total | **VERIFIED** (`(0 from Deal with the Bandits)` after helping) |
| Book of Regrets | A Dirty Job, Fallen from Grace, Fastis Fortuna, No Love for Old Ghosts | COMMUNITY_VERIFIED (PoEDB + quest data); amount unknown; objectives of 3 of them PARTIALLY_VERIFIED / UNVERIFIED |

Each entry: act, quest, quest id, points, objective area, objective, NPC, requirements, required-for-points,
on-default-route, provenance (sources, status, last verified, game version, notes) for the reward and separately
for its details. The validator fails the dataset when totals ≠ 24/22, a name differs from the quest data, a
book quest is missing from the database (catches new books after a patch), or a reward has no hand-in on the route.

### Engine

- **Profiles** (`engine/route.ts`): options bandit, trials (+ Labyrinths), league-start extras, Library; built-in
  read-only profile **Fast campaign — all passive points** (Kill all, trials on). `resolveRoute` walks the
  position again per option set.
- **Progress** (`engine/progress.ts`): rules at the top of the file. Step evidence: `area-entered` (log),
  `confirmed` / `skipped` (your marks, `campaign_marks` ids `act.step.<id>`), `passed` (inferred, never shown as
  done). Position: on-route, town visit, off-route (guide kept), outside (hideout/map/Labyrinth).
- **Quest Intelligence** (`engine/quests.ts`): passive / refund / main (on the levelling route) / gem / optional;
  "important only" keeps passive, refund and route quests.

### Tests (20, all pass) and real-log check

- Dataset: 22 books, 24/23 points per bandit choice, the exact `/passives` order, provenance complete, quest
  classification.
- All 32 option combinations: every "→ area" step is a real walking connection in the game data; every book
  reward is handed in in a town; bandit hand-in only with Kill all; 12 trials and 3 Labyrinths only with trials.
- Progress: full route followed to the end (travel steps detected, objectives only passed), entering an area
  doesn't complete its objective, town visits don't move the guide, skipping ahead, backtracking (off route,
  resumes), hideout = outside, log starting mid-campaign, marks (done / skip / reopen), unknown step marks
  ignored, deterministic re-derivation (restart / resume), each bandit branch to the end of Act 2.
- **Your PoE 1 Client.txt** (opt-in: `VAALYTICS_POE1_LOG=<Client.txt> npx vitest run act-tracker`): current
  numbers in Phase 2 (the matching rules were tightened there).

### Limitations

- (At the time) no UI yet. Objectives, hand-ins and rewards can't be read from the log: only area entries, passive
  grants and `/passives` (Phase 3) are facts; everything else is inferred or confirmed by you.
- Pantheon has no source yet (poewiki.net blocks automated reads) — Phase 3.
- The route is a community route (exile-leveling); our priorities, Fast variant and editor come in Phases 4 and 7.

## Phase 2 — Live Act Tracker (2026-11-19) ✅

**Files:** `src-tauri/src/act_tracker.rs`, `src-tauri/capabilities/act-tracker.json`, `TrackerWindow.tsx`,
`index.tsx`, `hooks.ts`, `prefs.ts`, `ui.tsx`, `engine/view.ts`. Shared edits (additive): `overlay/mod.rs`
(second foreground-only hotkey), `commands.rs` + `lib.rs` (6 commands), `src/core/ipc/commands.ts` (wrappers),
`src/main.tsx` (`#act-tracker` route), `sections.ts`, `registry.ts` (ready), `scripts/cdp.mjs`
(`CDP_TARGET=act-tracker`).

### Overlay window (`act_tracker.rs`)

- Label `act-tracker`, frameless, transparent, always on top, no taskbar entry, resizable (min 260 × 44),
  draggable header, one instance, own capability (local content; drag, resize, position/size only).
- **Never takes focus from the game.** Not focusable (`WS_EX_NOACTIVATE`); each show and click-through change
  runs in `keep_focus`, which hands the focus back to the window that had it if Windows activated the overlay.
  Checked with the foreground window title: unchanged after create, hide → show and click-through on/off.
  Only Tauri's show/hide are used: a raw `ShowWindow(SW_SHOWNOACTIVATE)` desynchronised Tauri's window state and
  the next style update (click-through) hid the window (found in QA).
- **Show / hide**: page button, the overlay's own button, and a hotkey (`actTracker.hotkey`, PoE 1 setting,
  default `Ctrl+Shift+T`, empty = off) registered **only while Path of Exile 1 is the foreground window**, next to
  the price-check key (`overlay::on_foreground`). A failure to register is logged and never blocks price check.
- **Click-through** (app setting `actTracker.clickThrough`): clicks go to the game; the overlay shows a cursor
  icon. Only the page can turn it off, so the overlay can never lock itself.
- **Saved**: position and size (`actTracker.window`, restored only onto a monitor that still exists, implausible
  bounds ignored), click-through, hotkey, and in `actTracker.prefs` (validated on load): compact, opacity
  50–100 %, hints, followed character, route options.
- Hidden = nothing runs: the overlay unmounts its body while hidden, so it doesn't read Client.txt.

### What it shows

- **Current objective**: the area and the steps of this visit, from the current step to the move to the next
  location (`engine/view.ts`), community minimap hints for the current step, **NEXT LOCATION**, Done / Skip.
- **Next steps**: five steps tagged `[CURRENT]`, `[NEXT]`, `[UPCOMING]`.
- **Progress**: act (steps done / total), campaign % (rounded down), done / left, the followed character.
- **Position**: On route / Town visit / Off route ("the guide continues in …") / Outside the campaign (hideout,
  map, Labyrinth).
- **Compact bar**: one line with act, current step and next location; the window shrinks to 44 px and grows back.
- Timers and the reward tracker come in Phases 5 and 3; the overlay shows no placeholders for them.

### Page (main window)

Stat tiles (act, campaign %, quest passive points for your bandit choice, character), "Now", overlay controls
(show/hide, click-through, compact, hints, opacity, hotkey with its live registration state), the expanded
guide (every step of an act grouped by area, status dot and evidence — "Area entered (Client.txt)", "Confirmed
by you", "Skipped by you", "Passed — not confirmed" — with Done / Skip / Not done / Undo on hover), route options
(bandits, trials + Labyrinths, league-start extras, Library, character) and data sources. Marks and preferences
changed in one window update the other (`act-tracker:changed` event).

### Progress engine changes (found with the real log)

- **Far-ahead jumps need confirmation.** One entry far ahead (a login segment attributed to a level-19
  character: Karui Shores before The Twilight Strand) put the guide at Act 10. Now the next entry into a
  *different* campaign area must be in that act or later.
- **Back in the current step's area** (after a town visit) never skips ahead to a later step in that area.
- **Shortcuts by waypoint** count only when coming from a town or hideout; walking in must come from the step's
  area. Otherwise a revisited area is off route.
- Mark ids are `act.step.<id>`: the shared store accepts `[A-Za-z0-9.-]` and rejected the first `act:step:` form
  (found in QA).

### Tests and checks

- 24 Act Tracker tests (new: going back to the current area, a repeated far-ahead entry, the overlay view and
  preferences) and Rust `hotkeys_are_validated`. `npm run check:all`: 305 TS + 131 Rust pass; `cargo check`
  clean.
- **Real log**: 5 full campaign runs (264–475 area entries), all followed to the end of the route; **70–89 % of the
  route's area moves are detected from the log**, 9–20 % of entries are off route (your own order).
- **In the app** (dev build, throwaway database, your real PoE 1 log read-only): page and overlay for a finished
  character (Act 10, hideout) and a mid-campaign one (Shadow 19: Act 2, The Western Forest, on route); Done in the
  overlay moved the guide and the page followed; compact bar 44 px and back; click-through on/off; hide/show; focus
  never moved to the overlay. Dev processes stopped afterwards.

### Limitations

- The hotkey wasn't pressed in game (Path of Exile wasn't running); it uses the price-check key's registration
  path.
- Kills, quest items and hand-ins still need your Done; "passed" steps are never counted as done.
- Off-route areas get a "the guide continues in …" note, not yet a suggested way back (Phase 4, using the Atlas'
  pathfinding).

## Phase 3 — Passive Skill Point Guardian (2026-11-19) ✅

**Files:** `engine/guardian.ts`, `GuardianPanel.tsx`, `data/rewards.ts` (+ Pantheon), migration
`0010_campaign_passives.sql`. Shared edits (additive): `session/log_format.rs` (`PassiveBreakdown`,
`RespecPoints`), `session/tracker.rs` (the two new events are never session events), `campaign/hook.rs` (stores them
for `game = 'poe1'` only), `db.rs`, `src/core/ipc/commands.ts` (two event kinds), `registry.ts` (summary).

### `/passives` sync (verified in your log)

- The player types `/passives` in game chat; the game writes the answer to Client.txt and the shared reader picks
  it up. Vaalytics sends nothing to the game.
- Parsed lines: `N total Passive Skill Points (M allocated)`, `N total Ascendancy Skill Points (M allocated)`,
  `N Passive Skill Points from character level`, `N Passive Skill Points from quests:`, `(n from <Quest>)`; plus
  `You have received a/N Passive Respec Point(s).` (Atlas / Genesis tree lines are ignored). Chat lines quoting
  them are never system lines.
- Stored as `campaign_events` kinds `passives` (amount + `detail` = which line) and `respec_points`, attributed to
  the character like every event, no duplicates on re-read. **PoE 1 only**: the PoE 2 format wasn't verified, and
  PoE 2 rows are unchanged.
- **Migration 0010** rebuilds `campaign_events` with the wider kind CHECK (same columns, ids, UNIQUE and indexes).
  Checked on a QA copy with real data: v9 → v10, 3 689 events, max id and sequence unchanged.

### Statuses

| Status | Meaning |
| --- | --- |
| COMPLETED | `/passives` lists it with points, or a point line in the hand-in town matches it, or you marked it claimed |
| AVAILABLE | not started yet, or `/passives` lists it with 0 (quest done, point not taken — talk to the NPC) |
| IN PROGRESS | you entered the objective area, or marked the objective done |
| NEEDS CONFIRMATION | the guide is past it, but nothing proves the reward (Pantheon kills, log gaps, a point line missing) |
| MISSED | your newest `/passives` (taken after the guide passed the hand-in) doesn't list it |

Four separate stages per reward, each with how it is known (`/passives`, Client.txt, you, route):
**AREA ENTERED**, **OBJECTIVE COMPLETED**, **QUEST TURNED IN**, **REWARD CLAIMED**. Entering an area never completes
anything.

- **Matching point lines to quests**: "You have received a Passive Skill Point" in the town where the route hands a
  reward in, after its objective area was entered, earliest in route order; a 2-point line only matches An End to
  Hunger. Labelled as matched.
- **Why a missing point line is not MISSED**: checked against your real `/passives` outputs, two full runs had
  22 claimed quest points but only 18 and 20 point lines in the log. Only `/passives` can prove a point is
  missing.

### Bandits, Pantheon, Ascendancy

- **Bandits**: the route option decides the expected total (24 Kill all / 23 help). With Kill all, a `/passives`
  showing `0 from Deal with the Bandits` gives one warning ("change the bandit option").
- **Pantheon** (new, COMMUNITY_VERIFIED): 4 major + 8 minor gods from PoEDB "The Pantheon" with the unlocking quest,
  cross-checked with the route's boss kills and its "Select Pantheons" step. Kills aren't in the log, so a passed
  boss is NEEDS CONFIRMATION until you mark it unlocked.
- **Ascendancy**: trials 6 / 3 / 3 per Labyrinth from the route; Labyrinths done = `/passives` Ascendancy points ÷ 2
  (or the class change for the first). A finished Labyrinth implies its trials (they open it); otherwise trials are
  marked by hand.
- **Respec books** (4): statuses from your marks and the route. The log's respec point total is shown, but not matched
  to quests, because it includes other sources.

### Warnings

Missed point, unclaimed reward (talk to the NPC), hand-in needs a return to town, `/passives` vs tracker count
mismatch, bandit choice vs `/passives`, no `/passives` yet, `/passives` older than the last point, and point lines
that couldn't be matched.

### UI

- **Overlay**: a one-line reward row under the instructions, with points done / expected, the `/passives` value,
  missed and to-confirm counts, and up to three urgent warnings. It never sits above the objective.
- **Page**: the "Passive Skill Point Guardian" panel. It shows four figures (completed / expected, `/passives` with
  its time, point lines in the log, respec points in the log), the warnings, and tabs for Passive points, Respec,
  Pantheon and Ascendancy. Each row has status, reason, objective, NPC and town, the reward's and details'
  verification, the four stages, and on hover *Objective done* / *Claimed* / *Unlocked* / *Undo*
  (`campaign_reward_marks`).

### Tests and checks

- Rust: `poe1_passives_output_and_respec_points` (parser, real line shapes incl. Atlas lines and chat),
  `poe1_passives_output_and_respec_points_are_stored` (hook, attribution, no duplicates, PoE 2 not stored),
  `migration_keeps_events_and_their_ids`.
- TS: 11 guardian tests (fresh character; area ≠ completion; point matched in town; `/passives` claimed / 0 /
  missing; NEEDS CONFIRMATION vs MISSED; marks; Pantheon never from the log; bandits; mismatch and stale warnings;
  the 2-point grant; snapshot grouping; Ascendancy implied trials).
- **Real log, guardian vs `/passives`** (opt-in test): for the runs followed by a `/passives`, all 18 and 20 point
  lines were matched to quests that `/passives` lists as claimed, with **0 false MISSED**.
- `npm run check:all`: 316 TS + 135 Rust pass; `cargo check` clean.
- **In the app** (dev build, fresh throwaway database, your real log read-only): the full log was read with the new
  parser (437 695 lines, 5 261 events) and `/passives` rows were stored per character. CastOnWife showed `/passives`
  23, tracker 23 / 24 with Kill all plus the bandit warning; with Help Oak it showed 23 / 23 and no warning.
  Pantheon (Brine King: needs confirmation) and Ascendancy (4 points = 2 Labyrinths, their trials implied) were
  checked. The overlay reward row showed for a mid-campaign character; Claimed → Completed → Undo worked. Dev
  processes were stopped.

### Limitations

- **The schema is now v10.** A dev build started on your real database migrates it, and an older release build
  (v9) then refuses to start until it is rebuilt.
- Without a `/passives`, point lines are matched by town and route order. A missing line is never treated as proof.
- Respec amounts per quest aren't in our sources. Pantheon details are a community source (PoEDB).
- PoE 1 character attribution: the shared parser used to ignore PoE 1 login lines (`*.login.pathofexile.com`).
  The Location Atlas session fixed it (2026-11-19). Rows stored before the fix stay misattributed until re-synced
  into a fresh database; only QA databases are affected.

## Phase 4 — Route Intelligence (2026-11-19) ✅

**Files:** `engine/priorities.ts`, `engine/recovery.ts`, `engine/view.ts` (filter, town visit), `prefs.ts`
(`importantOnly`, older stored preferences are completed with defaults instead of being reset), UI in
`TrackerWindow.tsx`, `index.tsx`, `GuardianPanel.tsx`, `ui.tsx`. No Rust or shared-file changes. Read-only import
of the Location Atlas planner (`location-atlas/routes.ts` → `src/shared/map/route.ts`), as agreed with that session.

### Step priorities (`engine/priorities.ts`)

Each step of the resolved route gets one category. When several apply, the most valuable wins.

| Priority | Steps |
| --- | --- |
| PERMANENT_POWER | hand-ins of Book of Skill / Regrets quests, and the kill / item steps in that reward's objective area |
| ASCENDANCY | Trials of Ascendancy, Labyrinth runs and the trips to them |
| IMPORTANT | the bandit branch, Pantheon bosses and the Pantheon choice |
| CRITICAL | everything that moves you on or that the route needs (the default) |
| BUILD_OPTIONAL | hand-ins whose only reward is a skill gem, league-start extras |
| SKIP | crafting recipes |

League-start route: 308 critical, 57 permanent power, 22 ascendancy, 17 important, 33 build optional, 43 skip.
Steps carry a small mark: PASSIVE, ASC, !, OPT or SKIP, with the reason on hover.

### Show only important steps

The route option **Show only important steps** hides BUILD_OPTIONAL and SKIP steps from the overlay, the current
objective, the next steps, the town hand-in line and the guide. The guide shows "N optional steps hidden". Moves
are never hidden, and the hidden steps stay in the route and the data; progress tracking is unchanged.

### Merged visits and town trips

The route (exile-leveling) already plans visits so that nothing needs backtracking. The tracker shows them as such:
- the current objective is one visit, every step in the area up to the move on;
- when the visit ends in a town, the overlay lists what is handed in there on that one trip ("In Lioneye's Watch,
  hand in: The Dweller of the Deep + …"). Passive point hand-ins are highlighted.

### Getting back (`engine/recovery.ts`)

- **Way back**: when you are off route, in a town or in your hideout, the shortest way to the area the guide
  continues in comes from the Atlas planner. It uses the game's connections plus waypoints of areas you have
  entered; from a town or hideout, a waypoint jump comes first. Shown as "Way back: A → B · 1 loading screen". It
  counts loading screens, not travel time. Its confidence is *estimated* when it relies on waypoints, because the
  log can't see a waypoint being clicked.
- **Worth going back for**: return trips only for quest passive points in an act you've left, and only when the
  evidence says one is needed:
  - `/passives` lists the quest with 0 → go to the hand-in town and talk to the NPC;
  - an objective you finished but haven't handed in → hand it in;
  - `/passives` says it's missing → go to the objective area.

  "Needs confirmation" never gets a trip, only "type /passives". Each trip has a way from where you are.

### Fast Campaign

The built-in profile **Fast campaign — all passive points** is the fast variant: Kill all, trials and Labyrinths
on, league-start extras and the Library off. "Important only" makes it faster still to read. More profiles come
with the guide editor (Phase 7).

### Tests and checks

- 6 new tests: priorities, the important-only filter (hides only optional steps, never a move; the full route is
  still followed to the end), the town hand-in line, the way back (off route, from the hideout), return trips (only
  for evidence; none for needs-confirmation), and older preferences.
- 42 Act Tracker tests (real-log ones included: 5 runs still followed to the end; guardian vs `/passives` still 0
  false MISSED). `npm run check:all`: 322 TS + Rust pass; `cargo check` clean.
- **In the app** (dev build, QA database, your real log read-only):
  - The Shadow 19, off route in The Western Forest, showed "Way back: The Western Forest → The Weaver's Chambers ·
    1 loading screen" and "In The Forest Encampment, hand in: Sharp and Cruel".
  - Turning on "Show only important steps" hid 4 Act 2 steps on the page and removed the gem hand-in from the
    overlay, with no reload.
  - Dev processes were stopped afterwards.

### Limitations

- **Build-aware gem routing (PoB)** is not done. The project's PoB import reads PoE 2 builds only
  (`campaign_build_stats`). PoE 1 gem planning needs a PoB 1 reader plus gem/quest/vendor data, so it will be a
  separate module and doesn't block the tracker. Gem hand-ins are BUILD_OPTIONAL in the meantime.
- Priorities are rules on the route data, not a new route. The order of steps is exile-leveling's.
- The way back doesn't use logout or town portals; the planner counts only connections and waypoints.

## Phase 5 — Timer & History (2026-11-19) ✅

**Files:** `engine/timer.ts`, `TimerPanels.tsx`, `hooks.ts` (`times`, `useRunHistory`), overlay footer clock, page
panels. No Rust, migration or shared-file changes: everything is derived from the stored campaign events. The
history is the log itself, so it is always consistent with it and is never invented or filled in.

### How time is measured (estimate, labelled "Estimate" everywhere)

- Active time is the sum of gaps between consecutive log events of the character, the same rule as Campaign
  Intelligence. A gap of more than **30 minutes** is a break (client closed, AFK) and isn't counted; the number of
  breaks is shown.
- **Campaign**: from the first campaign area to Karui Shores entered from Act 10. "From The Twilight Strand" when
  the log starts with a new character; otherwise "log starts mid-campaign".
- **Act**: from the first entry into one of its areas to the first entry into a later act. Towns and time away
  during the act count towards it. An act is **comparable** only when the log covers it from start to finish
  without a jump (Act 1 from The Twilight Strand, every later act right after a comparable one). Only those are
  compared between runs.
- **Areas**: time and visits per area, the average non-town area visit, and the six areas with the most time.
- **Towns**: time in act towns. **Hideout / away**: after you leave the campaign, the shared hook keeps only the
  first area outside it, so all the time away is attributed there ("hideout" when it is one, "away" otherwise —
  Labyrinth, maps). The page says so.
- **Live**: the overlay and page add the time since the last log line only while that line is recent (under the
  break gap). The clock ticks once a second only while it is visible and running.

### What is shown

- **Overlay footer**: `≈ campaign time · A<n> act time`.
- **Page, "Campaign timer"**: campaign, current act, towns + average area visit, hideout · away + breaks, a per-act
  table (time, in town, comparable), and the areas with the most time.
- **Page, "Run history"**: one row per character (a character's campaign is one run). Columns: campaign time
  (only for whole campaigns in the log, otherwise "partial" / "in progress"), the ten act times (grey when not
  comparable, the fastest comparable time per act highlighted), quest points (`/passives` when available,
  otherwise point lines in the log), deaths, and steps you skipped. Loaded once for the page, refreshed when new log
  events arrive.

### Tests and checks

- 6 timer tests: a whole run (every act comparable; act times add up to the total), a break gap, hideout vs away
  attribution, a log starting mid-campaign (not comparable), the live timer and formatting, and best act times
  across runs. One opt-in real-log test.
- **Real log** (zone entries only, 5 full runs): 5:04 – 12:10 active, 10/10 acts timed each, 1–4 breaks.
- `npm run check:all`: 328 TS + Rust pass; `cargo check` clean.
- **In the app** (QA database, your real log read-only):
  - CastOnWife: campaign 10:55:11 from The Twilight Strand, Act 1 58:29 … Act 10 22:11, all comparable, towns
    2:05:19, hideout 29:40, away 15:51, 3 breaks.
  - The history listed 11 characters: four full campaigns timed (4:35:40 – 11:44:10), level-2 characters "in
    progress", and `/passives` points per character.
  - The overlay footer showed `≈ 10:55:11`.

### Limitations

- These are estimates: the log has no "stopped playing" line, and AFK time under 30 minutes counts as play.
- Time away from the campaign is attributed to the first area outside it (the hook stores only that one).
- Runs are per character: a character that plays the campaign twice isn't possible in PoE 1, so this isn't a
  limit. Partial logs (a character started before the log) aren't compared.
- Rows stored before the PoE 1 login fix may still be attributed to the wrong character until the log is synced
  into a fresh database.

## Phase 6 — Location Atlas integration (2026-11-19) ✅

**Files:** `engine/area.ts`, `AreaGuideSection.tsx`, `hooks.ts` (`useTrackerWith`), overlay header button, page
"CURRENT AREA … OPEN LOCATION ATLAS" and area headers in the guide. No Rust or shared-file changes: the existing
`atlas_open` command opens or moves the Atlas window (an area id is validated in Rust before it reaches the window).

### Agreed split with the Location Atlas session

The Atlas owns maps, connections, waypoints, navigation hints and pathfinding. The Act Tracker owns the levelling
route, quests and rewards, and exposes them per area. Both read the same area data (RePoE game files via the Atlas
dataset) and the same location (the shared Client.txt reader and campaign hook), so they always agree on where you
are.

### What works

- **Open from the tracker**: the overlay's map button, the page's **OPEN LOCATION ATLAS** and the map icon next to
  every area in the guide open the Atlas on that area, or move it there if it is already open. The overlay and page
  open it on the area you're in (a campaign area), otherwise where the guide continues.
- **`areaGuide(areaId, …)`** (pure): the route's steps in that area with their status, priority and the current
  step; the route's ways into and out of it; the rewards whose objective is there or that are handed in there, with
  their Guardian status; whether the guide is there; steps left.
- **`<ActTrackerAreaGuide areaId tracking />`**: a ready section for the Atlas area details. It reuses the Atlas'
  own tracking (`useTrackerWith`), so it starts no second log sync.

### Inside the Atlas window

The Location Atlas session added the section to `AtlasWindow.tsx` below the area details. It shows "Act Tracker —
your route here": steps left, the rewards whose objective or hand-in is in the area (with status), the route's
steps with priority marks, and where the route comes from and goes. It follows the character the Atlas follows.
Map markers for objectives belong to Atlas stage 7 (layout editor). Nothing in the tracker invents positions:
Client.txt names the area, never a place inside it.

**Fixed while checking it:** bandit kills in The Western Forest were marked PASSIVE (that area is also The Way
Forward's objective). Killing or helping a bandit is now IMPORTANT, and Captain Arteri / the Thaumetic Seal stay
PASSIVE (test added).

### Tests and checks

- `areaGuide` test: the guide's current area and step, objective vs hand-in rewards, route moves in, and an
  off-route area that only has a reward (The Fetid Pool → A Dirty Job).
- `npm run check:all`: 329 TS + Rust pass; `cargo check` clean.
- **In the app** (QA database): the overlay's map button opened the Atlas on The Western Forest
  (`#atlas?area=1_2_9`); the guide's map icon for The Crossroads moved the open Atlas to The Crossroads; the Atlas
  window showed the Act Tracker section (The Way Forward completed, the area's steps with marks, route in/out).
  Dev processes were stopped.

## Phase 7 — Guide editor, `/campaign-update` and polish (2026-11-19) ✅

**Files:** `engine/profiles.ts`, `GuideEditor.tsx`, guide list editing in `index.tsx`, `hooks.ts` (`useProfiles`,
profiles applied in `useTrackerWith`), `prefs.ts` (`profileId`), `scripts/campaign-update.mjs`,
`.claude/commands/campaign-update.md`, report `docs/reports/campaign-update-2026-11-19.md`. No Rust, migration or
shared-file changes.

### Guide profiles

- **Built in, read-only:** *Fast campaign — all passive points*. Its steps can't be edited, so the shipped guide
  can never be overwritten. Its route options (bandits, trials, extras, Library) are your settings for it.
- **Your guides** (up to 12, PoE 1 setting `actTracker.profiles`, validated on read): *Duplicate to edit* copies the
  built-in guide or one of yours. Each has its own route options and edits. You can rename it or delete it (with a
  confirmation; your progress and marks stay).
- **Edits** are stored as a short list of changes, never as a copy of the route, so a new route version still
  applies them. Edits whose step is gone are counted ("N edits point at steps that aren't in this route") and
  ignored, never silently dropped.
  - **Hide** a step: it stays in the route. Moves can't be hidden, because they track your position.
  - **Reorder**: ↑ / ↓ within the same visit (between two moves), so your position and progress tracking never
    change.
  - **Your own step**: *+ step* inserts an instruction after a step (≤ 200 characters). It is marked with an accent
    edge and can be removed.
  - **Priority**: per step, *auto* or any of the six categories. It overrides the automatic one (marks, "important
    only" filter).
- **Export / import:**
  - *Export (copy)* puts the guide's JSON on the clipboard, only when you press it.
  - *Import* takes pasted JSON and checks everything before saving: format, game (PoE 1 only), 64 KB, every id
    pattern, text lengths, counts and options. A guide made on another route version imports with a warning.
- While editing, hidden steps stay listed (greyed) so they can be shown again. The overlay and the Atlas section
  show your guide.

### `/campaign-update` (shared with the Location Atlas)

`node scripts/campaign-update.mjs [--dry-run] [--restore <backup>]`, run through the project command
`/campaign-update`:
1. backs up both generated datasets (Atlas acts/meta, Act Tracker route/meta);
2. re-downloads the sources into a fresh cache and runs both generators;
3. diffs source versions, areas (level, waypoint, connections, name, added / removed), route steps and quests;
4. flags **book reward changes for manual review**. The hand-checked `rewards.ts` (verified from `/passives`) is
   never changed automatically — a change needs a second source or the game's own output;
5. runs the validators and tests (act-tracker + location-atlas);
6. writes `docs/reports/campaign-update-<date>.md` with the undo command (`--restore`). `--dry-run` restores the old
   data automatically.

A dry run on 2026-11-19 found no changes (RePoE 3.30.0.2.2, exile-leveling d6951db0ca94) and 82 passing tests; the
data files were byte-identical afterwards. The Location Atlas session was told it can reuse and extend it.

### Polish found during the phases

Bandit kills now count as bandit choices, not passive-point objectives. A stray backspace character in a regular
expression came from a shell edit; every Act Tracker file was scanned for control characters. Older stored
preferences are completed with defaults instead of being reset. Percentages are rounded down (no "100 %" with
steps left). Hideout ids read as "your hideout".

### Tests and checks

- 5 guide-editor tests: no edits = the built-in route; the shipped route stays untouched; moves stay within a visit
  and the edited route is still followed to the end; custom steps keep positions consistent; moves can't be
  hidden; stale edits are counted; export → import round trip; invalid, oversized, other-game and malformed imports
  are rejected; stored profiles are read defensively.
- `npm run check:all`: 334 TS + Rust pass; `cargo check` clean. 52 Act Tracker tests plus 3 opt-in real-log tests
  (5 runs followed to the end; guardian vs `/passives` 0 false MISSED; timer).
- **In the app** (QA database):
  - *Duplicate to edit* created "My guide".
  - *Hide* greyed "Hand in Sharp and Cruel"; *+ step* added "Pick up the Maligaro spike before logging out" after the
    current step. The overlay showed it as step 2 and no longer showed the hidden hand-in.
  - Import of a valid guide created "Imported test" (Help Oak) and made it active; an invalid one was refused with a
    message.
  - *Delete* removed it and went back to the built-in guide.
  - Export wasn't clicked in QA, because it writes your real clipboard; it is covered by the round-trip test.

## Status (all 7 phases)

| Phase | State |
| --- | --- |
| 1 Foundation (route, rewards, statuses) | ✅ |
| 2 Live overlay | ✅ (hotkey not pressed in a running game) |
| 3 Passive Skill Point Guardian (`/passives`, bandits, Pantheon, Ascendancy) | ✅ |
| 4 Route Intelligence (priorities, important only, town trips, way back, return trips) | ✅ (PoB gem routing: separate module, not started) |
| 5 Timer & history | ✅ (estimates) |
| 6 Location Atlas integration | ✅ |
| 7 Guide editor, `/campaign-update`, polish | ✅ |

### Open points

- **PoB build-aware gem routing**: needs a PoB 1 reader and gem / quest / vendor data — a separate module.
- **Schema v10** (migration 0010): a dev build on your real database migrates it; the older release build (v9)
  then needs rebuilding. Build the installer from this code before using the dev build on your real data.
- The hotkey and click-through have not been tried during a real PoE session.
- Nothing is committed.
