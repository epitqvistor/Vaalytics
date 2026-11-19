# Campaign Intelligence (PoE 2)

What to do next in the PoE 2 campaign, from your Client.txt progress and a verified 0.5.5 campaign dataset — permanent rewards, missed objectives and routes.

| | |
|---|---|
| Registry id | `campaign-intelligence` · group `character` · PoE 1 not offered · PoE 2 `ready` (stages 1–5 of 7 done) |
| UI | `src/games/poe2/campaign-intelligence/` — `index.tsx` (navigator page), `NextObjective.tsx`, `RouteTab.tsx`, `RewardsTab.tsx`, `RecoveryTab.tsx`, `SettingsTab.tsx`, `ui.tsx`, `settings.ts` (`campaign.config`), `hooks.ts` |
| Logic | `data/` (schema, 0.5.5 dataset, validator), `engine/graph.ts` (indexes), `engine/progress.ts` (progress state engine), `engine/version.ts` (dataset ↔ client), `engine/events.ts` (Rust rows → engine events), `engine/travel.ts` (logical routes), `engine/recommend.ts` (recommendation engine), `engine/rewards.ts` (Reward Guardian), `engine/recovery.ts` (missed objectives + return trip), `engine/plan.ts` (route planner), `engine/build.ts` (build-aware hints); Rust `campaign/build_stats.rs` — pure TS, tested in `campaign.test.ts`; Rust `src-tauri/src/campaign/` (`hook.rs` attribution, `store.rs`, `import.rs`) |
| Data | DataKind **game-data** (versioned campaign dataset with sources) and **user** (log-derived progress, manual marks) |
| Patch rules | the dataset's own `patch` vs the client tag in Client.txt (`engine/version.ts`) |

## Architecture (audit, 2026-11-17)

- **One log reader.** Client.txt is already read incrementally by Session Intelligence (`src-tauri/src/session`,
  one background thread, offsets persisted, crash recovery, log rotation). Campaign Intelligence adds **no** second
  reader: the session tracker's `apply_event` calls `campaign::CampaignHook::on_event` for every parsed line, inside
  the same transaction (so the stored reader offset and the campaign events can't disagree after a crash).
- **Character identity**: Session Intelligence deliberately doesn't store character names. Per-character campaign
  progress needs them, so `campaign_characters` (campaign-owned) keeps them locally — never sent anywhere.
- **UI refresh**: campaign hooks reload on the existing `session:updated` event (≤ 1/s); no new emitter, no polling.
- **Engine in pure TS**: the dataset is small (98 zones, 78 objectives, 32 rewards); deriving progress from a character's
  events is a single pass. It runs in the view's hooks, not inside components, and is unit-tested without Tauri.

## Verified Client.txt signals

All from a real PoE 2 log on the developer's machine (read-only, sanitized; client tags 4.4.0 – 4.5.4f and 0.5.5g):

| Signal | Line | Used for |
|---|---|---|
| Zone entered | `Generating level 15 area "G1_15" with seed …` + `[SCENE] Set Source [Ogham Manor]` | current zone, area level, zones visited; zone gates → inferred completions |
| Passive points | `: You have received 2 Passive Skill Points.` followed by `: You have received 2 Weapon Set Passive Skill Points.` | a passive reward was **applied** (confirmed); which one = the objective claimed in that zone (inferred) |
| Level / class | `: <Name> (<Class>) is now level N` | level; class change Monk → Invoker = an Ascendancy was taken (inferred trial) |
| Death | `: <Name> has been slain.` | deaths |
| NPC / boss dialogue | `<Speaker>: <text>` in a campaign zone | not used yet; would prove at most "encountered", never a kill or a claim (speakers are recorded in the dataset as `encounterSpeakers`) |
| Login | `Async connecting to <x>.login.pathofexile2.com:<port>` | the active character may change only here (log in / character select) |
| Other players | `: <Name> has joined the area.` / `has left the area.` | that name is never the player |
| Client version | `User agent: PoE poe2_production/tags/0.5.5g` | dataset compatibility warning |

Where the reward lines appeared in real runs (0.4–0.5.x): Hunting Grounds, Clearfell Encampment, Keth, Ardura
Caravan, Jungle Ruins, Aggorat, Kingsmarch (twice: Dark Mists, then The Hooded One after the Interludes), Trial of
the Ancestors, Wolvenhold, The Glade, Khari Bazaar — 12 grants × 2 = 24 points, matching the published total.

**Not in the log** (checked): quest start/finish, boss kills, Spirit/resistance/Life/Mana rewards, item pickups,
NPC interactions, choices. These objectives need manual confirmation; the UI will say why.

## Dataset (`data/0.5.5/`)

- Parts: Acts 1–4, Interludes I–III (open together after Act 4, any order). No Cruel repeat.
- Zones: 98, each with log area ids (when seen), observed area levels (several values = level scales with the order
  zones are done), and observed walking transitions. Act 2 Desert Map and Act 4 islands are `hubTravel`.
- Objectives: main vs optional, categories (passive, spirit, resistance, life-mana, charm, choice, ascendancy,
  unlock, optional-boss, quest-item), hard `requires` (game gates) vs `recommendedAfter` (community route order),
  steps, why, common mistakes, quest items needed/produced, detection signal.
- Rewards: category, amount, choices (+ swappable), claim kind and exact claim condition.
- Every entry has provenance: `confirmed` (≥ 2 sources, or a guide plus the real log), `unverified` (one source) or
  `conflict` (disagreement recorded, never shown as fact).

Sources (read 2026-11-17): pathofexile.gg campaign walkthrough (0.5.5), WDGuide walkthrough (0.5.5 preview),
Metabot campaign + permanent bonuses (verified 0.5.5f), and the real client log.

### Recorded conflicts

| Entry | Disagreement |
|---|---|
| Ignagduk (+30 Spirit) | claim: boss kill vs consume vs spear to Servi |
| Halls of the Dead tattoos | three attribute-or-resistance choices vs one all-res-or-all-attributes choice |
| Great White One lesson | second option wording (Deflection/ES vs lesser Armour/Evasion/ES) |
| Dark Mists (+2 points) | boss kill vs turn-in to Tujen — the log shows the grant in Kingsmarch |
| Molten Shrine (5% Life) | Skullmaw Stairway vs The Khari Crossing |
| Djinn Barya for the first trial | Balbala vs Deshar vultures |
| Azarian | "The Heart of Keth" vs Buried Shrines (log) |
| Yeti / Rakkar | the brief credits Rakkar; guides and the log say the Yeti's Icy Tusks to Hilda |
| Yama + Trial of the Ancestors | the brief lists two +2 rewards; sources and the log show one |

## Automatic tracking (stage 2)

> Since 2026-11-19 the same hook also stores **PoE 1** campaign events for the Location Atlas (driven by
> `campaign::sync`, see location-atlas.md). Rows are isolated by `game`; nothing here changed for PoE 2.

### Character attribution (`campaign/hook.rs`)

Checked against the real log: of 5 changes of the levelling name, 3 followed a login-server connect and 2 did not
(party members); 150 level-ups were by players who had joined the area. Rules:

1. A level-up by a name that joined/left the area during this client run is a party member.
2. The character can only change at a client start or login connect (a new *segment*). The first remaining
   level-up of a segment identifies it; a different name later in the same segment is a party member.
3. Events before that first level-up are stored with `character_id NULL` and assigned when it arrives.
   Segments without any level-up stay unassigned (counted in `campaign_status.unassignedEvents`).
4. Ascension = a newer level-up line with a different class (`Monk → Invoker`). Older lines (crash re-read,
   import) never change the class back.
5. Stored per character: campaign/town zone entries (with display name and area level), the first non-campaign
   area after the campaign (e.g. hideout — maps are not stored), passive / weapon-set point grants, level-ups,
   ascension, deaths of that character in the campaign.

### Storage (migration `0008_campaign.sql`)

`campaign_characters` (game, name, class, base class, level, first/last seen, hidden; unique per game+name),
`campaign_events` (game CHECK, character, segment, time, kind CHECK, area, amount, detail, `UNIQUE(game, log_key,
log_offset, kind)` → no duplicates from re-reads or imports), `campaign_marks` (one per character + objective:
`done | skipped | not-done`, optional choice), `campaign_state` (live segment, active character, client tag), `campaign_reward_marks` (one per character + reward:
`not-claimed | boss-defeated | item-acquired | submitted | applied | complete`, optional choice).
Deleting a character cascades to its events and marks.

### History import

`campaign_import_log` reads the whole Client.txt once, on the player's request (the live reader starts at the
current client run and never replays history). Same parser and attribution, streamed, commits every 50 000 lines,
idempotent (same log key + offsets). The real 327 MB / 2 M-line log imports in ~0.3 s (release) → 11 characters.
Run against the real log with the engine: the character with a finished campaign has all 12 point grants attributed
to the right 12 objectives, no unattributed grants, no unknown areas.

### IPC

`campaign_status`, `campaign_characters`, `campaign_events(characterId)`, `campaign_marks(characterId)`,
`campaign_set_mark(characterId, objectiveId, mark|null, choice)`, `campaign_set_hidden`, `campaign_delete_character`,
`campaign_import_log` — all require `game = poe2`. TS hooks: `useCampaignStatus` (with dataset compatibility),
`useCampaignCharacters`, `useCharacterProgress` (events + marks → memoised `deriveProgress`, `setMark`).

## Navigator (stage 3)

### Recommendation engine (`engine/recommend.ts`)

Pure function `recommend(graph, progress, { settings, previous })` → one primary objective, the other objectives
at the same destination ("also here"), up to four alternatives, warnings and a plain explanation.

- Candidates: only `available` objectives (prerequisites, part and zone open). Locked objectives are never shown.
- Value per mode and category (`WEIGHTS`): Full Completion values every permanent reward; Fast keeps main quest,
  passive points, Spirit and Ascendancy high, drops optional content worth < 30 and doubles the travel penalty;
  Power Leveling adds +15 to optional content ≤ 2 steps away when the area is `levelGap` (default 3) levels above
  the character; Custom uses only the categories the player picks. Quest-item steps are worth 90% of the
  objective they feed. Leftover main objectives of a part that is already closed (e.g. Act 4 after the
  Interludes open) count only for their rewards.
- Score = value − travel steps × penalty (6, Fast 12) + 20 if you're there (+8 if one step away) − 15 per unmet
  community route-order item − 15 (Fast 40) for optional content in an earlier act; pinned / "Do this next" +1000.
- Stability: the previous primary stays while it's still available and within 12 points, or while you're at its
  destination; a change comes with the reason (done, skipped, unavailable, clearly better).
- Every entry: destination, hand-in zone, steps, why, rewards (with verification), common mistakes, missing quest
  items, what comes after, travel steps, and how completion is known (auto-detected / partly / inferred from a
  later zone / confirm yourself).
- Warnings: missing quest items, guides disagreeing about the objective, level gap before the next main zone
  (states the fact, never says "grind"), unattributed passive grants, unknown areas.

### Travel (`engine/travel.ts`)

Logical steps only — no distances, coordinates or directions. Edges: observed walking transitions (both ways),
town → first zones (frequent town → zone transitions in the real log), hub travel (Desert Map caravan, Kingsmarch
ship), waypoint/portal to visited zones and towns, Interlude hubs once open. One Dijkstra run per recommendation.

### Page

Character selector (characters with campaign zones; the one the log shows in game is marked), campaign mode, a
dataset/client compatibility banner, the next-objective card (route, numbered steps, rewards, mistakes, after,
Mark done / Skip for now, optional choice for choice rewards, detection badge), "Also in <zone>", "Other options"
(Done / Skip / Do this next), "Where you are" (zone, part, character vs area level, main-quest count, Ascendancy),
"Why this objective", warnings, data provenance, and "Import history". Refreshes on `session:updated` only.
Measured on real characters: a recommendation takes 0.05–0.7 ms.

## Rewards and recovery (stage 4)

### Permanent Reward Guardian (`engine/rewards.ts`, tab "Rewards")

Every reward has its own state, never collapsed into the objective's:

| State | When |
|---|---|
| Not available yet | its objective is locked |
| Available / Visited, not confirmed | objective open; you have / haven't been to its zone |
| Boss defeated · Item acquired · Handed in | your own mark (the log shows none of these) |
| Applied | passive points seen in Client.txt in the claim zone, or the class change for the first Ascendancy |
| Confirmed | you marked the objective done, or set the reward to complete/applied |
| Uncertain | objective inferred from a later zone or a requirement — the reward claim isn't shown |
| Skipped | you skipped the objective |

Totals per track (passive points, Spirit, each resistance, flat/% Life, % Mana, charm slots, Ascendancy points,
permanent choices) split into earned / uncertain / in progress / missing / later; they add up to the published
0.5.5f totals (tested). Choice rewards store the option you picked (on the objective or the reward); other options
are never assumed. "Unfinished claims" warns when you marked a boss defeated or an item acquired but not the claim.

### Missed objectives (`engine/recovery.ts`, tab "Missed & recovery")

Reward-bearing objectives not done that you **skipped**, that belong to a **finished part** (a part it gates is open),
or whose zone you **left behind** (visited, then reached areas of a higher level in that part). Each shows why,
the rewards, missing prerequisites, the route from where you are and advice (≤ 3 logical steps → "do it now",
else "later"). Passive points, Spirit and Ascendancy come first. "Already done" confirms it (it's never insisted
upon — the log can't prove most claims); "Un-skip" puts a skipped one back into the navigator.

The return trip visits the zones of all listed objectives whose prerequisites are met, nearest-next by logical
travel steps, grouping objectives in the same zone into one stop.

## Modes, routes and builds (stage 5)

### Modes

`modeValuer` (shared by the navigator and the planner) decides what a mode pursues: Full Completion (every
permanent reward), Fast (main quest + optional worth ≥ 30, i.e. passive points / Spirit / Ascendancy; double travel
penalty), Power Leveling (Full + nearby optional when under-levelled), Custom (main quest + chosen reward types,
Settings tab). Pinned objectives are always pursued. Changing mode never touches progress or marks.

### Route planner (`engine/plan.ts`, tab "Route")

Plans everything the mode still pursues in the current part — or across all open Interludes — as trips. A trip is
one outing to a hub stop (Act 2 Desert Map destination, Act 4 island) or a zone, doing every ready objective there,
including chains that become ready on the way (Torn Map → island boss). Trips are chosen nearest-next by logical
steps, +3 for switching part (finish one Interlude before the next), only once prerequisites are met (all four
Torn Maps before Plunder's Point; gates before what they open). Areas with no known route (not in logged
transitions) come last with an honest note. Notes: Torn Map count, island order freedom, Desert Map level
scaling, Interlude levels rising with order (from real logs) and the resistance penalty.

### Build-aware hints (`engine/build.ts`, `campaign/build_stats.rs`, Settings tab)

The player links a Path of Building (PoE 2) build per character. Rust reads it (only inside the PoB builds folder
it computes; the frontend sends "folder/name"; ≤ 8 MB) and returns `<Build className/ascendClassName/level>` and
these `<PlayerStat>` values — shapes checked on real PoB PoE 2 files: Spirit, SpiritUnreserved, Life, Mana,
EnergyShield, Fire/Cold/Lightning/Chaos resist, Str/Dex/Int, ReqStr/ReqDex/ReqInt. They describe the **planned**
build with its intended gear, never the live character; the page says so.

- Spirit reserved > 0 → Spirit rewards +15 (+25 if < 30 unreserved).
- Each elemental resistance below 75% → that element's campaign resistance reward +20.
- Attribute requirement above the build's attribute → tattoos and the Qimah boon +10.
- Build class differs from the character's → a note. No build → "generic recommendation" note.
Bonuses only re-rank (with the reason shown); nothing is written to the build.

## Journal, zones and history (stage 6)

### Zone intelligence (`ZonePanel.tsx`, navigator)
For the zone you are in (or, outside the campaign, the next objective's zone): part, area level(s) seen in real
logs vs your level, where it leads and where it is reached from (dataset transitions; Desert Map / ship for hub
stops), every objective there with its status, quest items made or used there, and your own history in it
(visits, estimated active time, deaths).

### Quest journal (tab "Journal")
Every objective by part, filterable (all / open / done / skipped / marked by you), with status, how it was set
(inferred from the log / marked by you) and the evidence. Actions: Done, Skip (optional objectives), **Not done**
(overrides a wrong inference) and **Undo** (removes your mark → back to automatic detection). "Your recent marks"
lists the last 15 marks with Undo. Undo restores automatic detection, not an earlier mark (marks are replaced, not
versioned).

### History and performance (`engine/history.ts`, tab "History")
- **Active time** is an estimate from Client.txt timestamps: the gaps between consecutive campaign events while in
  a campaign area; a gap over 30 min (`BREAK_GAP_S`) is a break (client closed / AFK) and not counted. Time outside
  the campaign (hideout, maps) is never counted. Shown with an `estimate` provenance tag.
- **Part finished**: Acts 1–3 when the next act's gate is credited, Act 4 when the Interludes open
  (`a4.tavakai`), an Interlude when all its main objectives are done. A finish known only from your mark or from a
  requirement has no time (the click is not the play time); the part still counts as finished.
- **Fully logged** (`timed`): a part is compared only if the log covers it start to finish — Act 1 from a new
  character (first level-up ≤ 2), later parts only after the previous part was timed and its finish seen. On the
  real log this removed fake bests (an Act 2 "in 11 min" from a history that starts at level 62 in Act 2, an
  Act 4 "in 37 min" with no Act 3). Untimed finished parts say "partly logged".
- Per part: level in → out, active time, deaths, personal best. Acts 1–4 and Interlude totals once all are timed.
- Timeline levels: only level-ups reached in a campaign area (mapping levels after the campaign are left out).
- **This run**: time in towns; backtracking (active time in an area you had moved on from and came back to — a
  town portal trip is not backtracking); optional objectives done; permanent rewards earned; possibly missed;
  breaks. Not shown: XP/hour (no experience lines in Client.txt) and league comparison (league isn't recorded with
  campaign events).
- **Timeline**: parts entered, objectives credited (at the moment the log proved them), Ascendancy, deaths (with
  zone), every 5th level. Same-second objectives sort before the zone entry that proved them.
- **Runs compared**: every visible character with campaign data (events and marks loaded once per visit to the
  tab), finished parts only; personal bests highlighted.
- Real log (11 characters): history for all characters derives in ≤ 0.5 ms each; four characters have fully
  logged Acts 1–4 (≈ 6 h 54 min – 12 h 54 min active), three with all Interludes.

## Validation and performance (stage 7)

### Change token, no needless re-reads
Only `campaign_status` listens to the shared reader's `session:updated`. It returns `revision` (newest
`campaign_events` rowid — O(1)); the page re-reads characters and events only when `revision`, the unassigned
count or the active character changes. Map runs, hideout visits and trade traffic store nothing for the campaign,
so they cost one small query and no re-derivation. A reload whose content is unchanged keeps the old object, so
memoised progress/recommendations don't rerun. Marks are re-read only after you save one.

### Profile (real log, 11 characters, ≤ 589 events each; Node, worst character)
| Step | Time |
| --- | --- |
| Graph build (once per app run) / dataset validation (tests only) | 0.33 ms / 0.19 ms |
| Events → engine events | 0.01 ms |
| Progress derivation | 0.09 ms |
| Recommendation (any mode) | ≤ 0.12 ms |
| Route plan | 1.5 ms |
| Reward statuses / missed objectives | 0.005 ms / 0.10 ms |
| Run stats / timeline | 0.06 ms / 0.03 ms |
| Unchanged-reload comparison | 0.12 ms |
| Full Client.txt import (327 MB, Rust, release) | ≈ 0.3 s |

Live tracking adds one or two indexed SQLite statements per campaign log line inside the reader's existing
transaction; the UI never scans the event table.

### Reliability
Game crash / client restart → new login segment, character re-identified on the next level-up (Rust tests);
log rotation and duplicate lines → handled by the shared reader's file key + offset and the
`UNIQUE(game, log_key, log_offset, kind)` constraint; app restart resumes the stored segment and character;
unknown campaign areas and unattributed passive grants are shown in the navigator's Data panel; patch mismatch →
banner from the client tag.

### Spec test scenarios → tests
| # | Scenario | Test(s) |
| --- | --- | --- |
| 1 | New character | `a new character starts with only the first objective available`; recommend `a new character is told to defeat The Bloated Miller`; Rust `identifies_the_character_and_assigns_earlier_events` |
| 2 | Current zone | `follows the current zone through towns, the hideout and a re-entry`; `matches by area id, then by display name` |
| 3 | Character switching | Rust `character_changes_only_after_a_login`, `party_members_are_never_the_player` |
| 4 | Entering/leaving zones | `entering a zone never completes objectives inside it`, `leaving a zone does not complete it`; Rust `leaving_the_campaign_is_recorded_once_and_maps_are_not_stored` |
| 5 | Duplicate events | `duplicate events don't double-credit or double-count`; Rust `passive_points_ascension_and_duplicates`, `import_reads_a_file_once_and_is_idempotent` |
| 6 | Quest progression | real-log grant sequences (Crowbell, Una), Kingsmarch grants, zone gates |
| 7 | Optional boss | `killing a boss without a points line does not claim its reward`; Crowbell grant attribution |
| 8 | Reward acquired, not applied | `a boss defeated is not a reward claimed (regression)`, `an item in hand but not handed in is warned about` |
| 9 | Manual confirmation | `manual marks: done, skipped, and reverting a wrong inference`, `the latest manual mark wins`; Rust marks tests |
| 10 | Skipped objectives | `skipped objectives are remembered and explained with their prerequisites`; `a skipped Dark Mists…` |
| 11 | Recovery route | `builds one return trip that groups objectives by zone, nearest first` |
| 12 | Act 2 branching | `Act 2 branches…`; plan `Act 2: Desert Map stops…` |
| 13 | Act 4 islands | `Act 4 islands open in any order…`, `Plunder's Point needs all four Torn Maps…`; plan + recommend island tests |
| 14 | Interludes in any order | `Interludes open together…`; recommend `Interludes: any order…`; plan `Interludes are planned together…` |
| 15 | Permanent choices | `stores the chosen option of a choice reward and never assumes the others` |
| 16 | Missing prerequisites | `a missing prerequisite keeps an objective locked`; `never recommends a locked objective` |
| 17 | Unknown zones | `unknown campaign areas are reported, not guessed` |
| 18 | Outdated dataset | `reads the client tag and flags a mismatch` |
| 19 | Application restart | Rust `restart_resumes_the_same_segment_and_character` |
| 20 | Multiple historical runs | history `personal bests…`, `a run whose log starts mid-campaign is not timed`; Rust import + identification; live import of 11 real characters |

Real samples vs synthetic: Rust and TS tests use synthetic lines in the exact verified shapes; the ignored live
test (`live_campaign_import`) and the dumps used for profiling come from the real Client.txt and are never
committed.

## Progress engine (`engine/progress.ts`)

Input: one character's events in order + manual marks. Output: per objective `locked | available | done | skipped`
with confidence `inferred | manual` (and `confirmed`, reserved for direct signals — no verified line names a quest).

- Entering a zone marks it visited; its `opensAfter` gates and its part's gates become **inferred** done. Entering
  never completes anything inside the zone; leaving never completes it either.
- Passive grants: the regular line is attributed (the Weapon Set line is its twin). Candidates = not-yet-credited
  objectives whose detection lists the current zone, ranked (1) requirements done + objective zone visited, (2)
  objective zone and its requirements' zones visited, (3) part open; ties by dataset order. No candidate →
  "unattributed grant" (shown, never guessed).
- Ascension: first class change → the trial visited most recently, else the first open trial.
- Hard requirements of a done objective are inferred done (main objectives may only require main ones — validated).
- Manual marks (`done`, `skipped`, `not-done` to revert a wrong inference) win; latest mark per objective. A manual
  `done` also implies that objective's hard requirements (inferred).
- Unknown `G…`/`P…` area ids are reported (patch drift), never mapped by guesswork.

## Tests

Rust (`cargo test campaign`, 14 + 1 ignored, incl. the change token not moving on map runs, incl. PoB build parsing and path containment, incl. reward marks separate from objective marks; tracker `campaign_events_come_from_the_same_reader`): identification
and late assignment, party members (joined / no login), character switch after login, passive grants + ascension +
duplicate re-read, leaving the campaign without storing maps, restart resumes segment and character, unassigned
events, PoE 1 rejected, marks validation/replace/remove + cascade delete, import idempotent + incomplete last line +
live state untouched. Parser: new shapes incl. chat lines quoting system text and PoE 1 login hosts. Ignored live
import: `VAALYTICS_POE2_LOG=<path> cargo test --release -- --ignored live_campaign_import --nocapture`.

TypeScript (`history.test.ts`, 10): active time per part with breaks and time outside the campaign excluded,
act finish from the next gate with levels in/out, Act 4 finishing where the Interludes open (regression: Interludes
borrowed Act 1's empty gate and Act 4 never finished), log starting mid-campaign is not timed (no fake bests), visits/deaths per zone, manual finish has no time, timeline
order, personal bests, town time vs backtracking, duration format.

TypeScript (`plan.test.ts`, 10): Torn Maps before Plunder's Point with one trip per island, island order from
where you are, Act 2 relics before the altar and Jamanra last, Interludes together without needless switching,
Fast mode excludes low-value content, plan scope; build hints for weak resistance (and its reason in the
navigator), Spirit, attribute shortfall, no data → no claims, class mismatch.

TypeScript (`rewards.test.ts`, 11): applied/confirmed/uncertain/skipped/locked, boss defeated ≠ reward claimed
(regression), held item warning, choice stored, totals = published totals; missed in finished act sorted by value,
left-behind area, skipped with prerequisites, confirmed never listed, return trip grouping and order.

TypeScript (`recommend.test.ts`, 14): first objective, reward-where-you-stand, Fast mode skips, locked never
recommended, Act 4 island grouping, hub/walk travel, Custom categories, pinned + missing items, stability kept and
replaced with reasons, level-gap warning without grinding, Interludes in any order then The Hooded One,
completion, Power Leveling boost.


`campaign.test.ts` (26, incl. Rust row mapping): dataset validation; current zone through towns and hideout; totals cross-check (24 points, 100 Spirit, 3 × 10% res); parts; conflicts
never `confirmed`; broken refs/cycles detected; zone lookup by id and by name (trailing spaces); new character;
zone entry/exit never completes; real-log grant sequences (Crowbell, Una); boss without a log signal stays open;
Kingsmarch double grant (Dark Mists vs The Hooded One, including a skipped Dark Mists); Act 4 islands in any order;
four Torn Maps for Plunder's Point; Interludes in any order; Act 2 branching; ascension attribution; manual marks and
reverts; duplicate events; unknown zones; missing prerequisites; client-tag compatibility.

## Stages

1. **Foundation** — audit, schema, versioning, dependency graph, 0.5.5 dataset, validator, progress engine. ✅
2. **Automatic tracking** — reader extension, character attribution, per-character storage, manual marks, history import, IPC, hooks. ✅
3. **Navigator** — recommendation engine (modes, travel, grouping by destination, stability, explanations), first page. ✅
4. **Reward Guardian + missed-objective recovery** — per-reward claim states, totals, unfinished-claim warnings, missed list, return trip. ✅
5. **Modes, route planning, build-aware hints** — shared mode valuation, Custom settings, Act 2 / Act 4 / Interlude planner, PoB build hints, character hide/delete. ✅
6. **Journal, zones, history** — zone intelligence panel, quest journal with Not done / Undo, timeline, time per part, deaths, personal bests, run comparison. ✅
7. **Validation and polish** — change-token reloads, profiling, scenario coverage, unknown-area / unattributed-grant notices, run summary, error states. ✅

## Not yet

- Undo goes back to automatic detection, not to a previous mark.
- Active time is an estimate (no "game closed" line among campaign events); party play counts as your time.
- Party play: a party member who levels first after a login (before the player) would be taken as the character for that segment; the UI will let the player hide such characters.
- Zones not seen in the real log (The Molten Vault, Skullmaw Stairway, Isle of Decay, Brinerot Cove) match by name only.
- The sample log has no 0.5.5 campaign run; zone ids/levels come from 0.4–0.5.x runs. A 0.5.5 run should be checked
  with the live test added in stage 2.
- Act 4: whether every island boss is strictly required is not verified; only the Torn Maps gate Plunder's Point.
