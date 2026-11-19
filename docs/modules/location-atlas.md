# Location Atlas (PoE 1)

Interactive campaign atlas for **Path of Exile 1, Acts 1–10**: real connections between areas, waypoints,
towns, quests and rewards, known layout variants and community navigation hints, routes, your own recorded
layouts, and the area you are in — in a separate Tauri window.

Scope (2026-11-19): **PoE 1 only.** No PoE 2 support and no game switch in this module. Shared building blocks
(SVG map viewer, route graph, source/verification model, window shell) live in `src/shared` / `src-tauri`
so PoE 2 can use them later; PoE 1 data lives only under `src/games/poe1/location-atlas` and in `game = 'poe1'`
rows.

## Phase 1 audit (2026-11-19)

| Area | Finding | Use |
| --- | --- | --- |
| Second window | The price-check overlay is a second Tauri window (`#overlay` route, own capability file, saved bounds, always-on-top). | Same pattern: window `atlas`, route `#atlas`, `capabilities/atlas.json` (local content only). |
| Location detection | The shared Client.txt reader + parser (`session/reader.rs`, `session/log_format.rs`) and the campaign hook (`campaign/hook.rs`, game-parameterised; tables already allow `poe1`). Session Intelligence itself is PoE 2-only. | PoE 1 runs the **same** parser and campaign hook (one engine); only a PoE 1 driver is added. No new detection method. |
| PoE 1 log | Real log (3.26–3.30.0c, full campaign runs): `Generating level N area "1_1_2"`, `is now level`, `has been slain`, `release/tags/3.30.0c`, login lines — same shapes as PoE 2. Passive points: `You have received a Passive Skill Point.` (also `2 Passive Skill Points`); respec / atlas lines must be ignored. | Parser extended for the singular form only; verified against the log. |
| Game data | RePoE fork `world_areas.json` (version 3.30.0.2.2, extracted from the game files; already the crafting source): per area act, level, town, waypoint, **connections**, boss metadata and **layout topologies** (the game's own layout graph ids). | Authoritative source for areas, connections, waypoints and the number of layout variants per area. |
| Community data | exile-leveling (HeartofPhos, **MIT**): `areas.json`, `quests.json` (quest names, rewards per class), route files with per-area **navigation hints** (`#sub`, compass `{dir|deg}`, 0° = up, clockwise). | Quests, rewards, hints — with attribution; hints are shown as community hints, never as verified layout. |
| Layout geometry | Not available from any source we may use: the game's `.tgr` layout graphs are not exported; community layout images are not licensed for redistribution. Client.txt has no position and no layout id. | **No invented maps.** Atlas = real connection map + topology variant list + hints + your own recorded layouts. Interior geometry: user-recorded only. |
| Visualisation | No map/graph library in the project. | SVG renderer in `src/shared` (no new dependency). |
| `/campaign-update` | Does not exist. | Added as a project command in the update stage (regenerates data from sources, diff report, no silent deletion). |

## Data model

- `CampaignArea` — id (game area id), act, name, areaLevel, kind (town / area / trial), hasWaypoint,
  connections (game data), bosses, `topologies` (layout variant ids from the game files), provenance.
- `NavigationHint` — area, step, text, optional direction (deg), league-start-only flag, source (exile-leveling).
- `Quest` / `QuestReward` — id, name, act, giver, rewards per class (exile-leveling), passive / respec points.
- `LayoutVariant` (user-recorded, DB) — area, topology id if known, normalised geometry (0–1 coordinates),
  markers (start, exit, waypoint, boss, quest, quest item, reward, optional area, treasure, custom), routes,
  confidence, revision history.
- Confidence: `verified` (game files / your log), `community` (licensed community source), `partial`,
  `estimated`, `unverified`, `outdated`; shown in the UI everywhere.

Generated data: `scripts/poe1-campaign-data.mjs` downloads the sources (cached, with a User-Agent) and writes one
JSON module per act to `src/games/poe1/location-atlas/data/<patch>/`, plus `sources.json`. Deterministic output;
regenerating shows a diff in git (revision history of shipped data). User data lives in SQLite (`game = 'poe1'`).

## Stage 1 — data foundation (2026-11-19)

- `scripts/poe1-campaign-data.mjs` → `src/games/poe1/location-atlas/data/3.30/act-01…10.json` + `meta.json`
  (156 KB, one chunk per act, lazy-loaded by `data/index.ts`, validated on load by `data/validate.ts`).
- **155 areas** (Acts 1–10, towns included), connections, waypoints, levels, boss count, layout topology ids
  (game files, RePoE 3.30.0.2.2); **166 navigation hints** and boss names, **82 quests** (exile-leveling, MIT,
  commit pinned in `meta.json`). Both sources agree on every connection (0 differences).
- Hints are attached to the area you are in at that route step (and `toward` the area a step leads to);
  `{dir|deg}` is kept as a minimap direction (0° = up, clockwise); league-start-only steps are flagged.
- Validator: act shape, ids, duplicates, unknown connections / towns / hint areas (errors), one-way connections
  and areas without topology (warnings), meta counts and source licences. It caught a generator bug (two hints
  attributed to the endgame town after Act 10) — fixed.
- **Real log check** (your PoE 1 Client.txt, 3.26–3.30.0c, opt-in test `VAALYTICS_POE1_LOG=… npx vitest run
  location-atlas`): 153 of 155 areas seen, **0 unknown ids, 0 area-level differences**. Consecutive area entries:
  1 042 walking transitions match the game connections, 578 are waypoint / town moves, 14 others are town-portal
  returns and new characters starting on the Strand — no missing connection. Not seen in the log: The Fetid Pool,
  Refinery Tunnels.
- Not in the sources: interior geometry, waypoint/exit positions inside an area, passive-point quest list (stage 6
  needs a licensed source), boss names beyond the community route.

## Stage 2 — location tracking for PoE 1 (2026-11-19)

One engine, two drivers. The PoE 2 Session Intelligence tracker feeds `CampaignHook`; for PoE 1 the new
`campaign::sync` drives the **same** shared reader (`session::reader`: rotation/truncation aware), parser
(`session::log_format`) and hook (same character attribution, same tables, `game = 'poe1'`).

- **When it reads:** only while the Atlas is visible — `atlas_sync` every 2 s (a file stat; reads only what was
  appended) and when the view becomes visible again. Closing the Atlas loses nothing: the position is stored
  (`campaign_state.log_key/log_offset`, migration `0009_campaign_sync`) and the next sync catches up; the first
  sync is the history import. Characters/events are re-read only when the status change token moves.
- **Log:** the player's choice (`atlas_set_log_path`, validated as a PoE 1 log by its User-Agent / login-host
  signature) or the first PoE 1 log found in Steam libraries / standard install folders.
- **Shared changes (small, tested):** `areas::classify` knows PoE 1 campaign ids (`1_1_2`, `2_8_7_1_`, not
  `1_Labyrinth_…`); `discover` gained `poe1_candidates` / `is_poe1_log`; the parser reads the PoE 1 client tag
  (`release/tags/3.30.0c`); the hook's PoE 2-only guard became game isolation (every row carries its game);
  campaign storage commands accept both games (import and build stats stay PoE 2-only).
- **Location (`tracking.ts`, pure):** the latest area entered → `in-area` (with the logged area level),
  `outside` (hideout / map / Labyrinth, keeping the last campaign area — never a guess) or `unknown`; visited
  areas, highest act, level, unknown campaign ids (patch drift). Client.txt names the area entered, never a
  position inside it.
- **Real PoE 1 log** (ignored test `live_poe1_sync`, release build): 436 142 lines read in **0.17 s** on the first
  sync, 3 674 campaign events, 11 characters; the next sync with nothing new takes **0.1 ms**. Finished campaign
  characters show 19–23 passive points from quest lines. Known oddity: one level-2 character got 103 area entries
  and 4 points — events of a login segment whose only level-up came from that character; attribution rules are
  unchanged from PoE 2 and will be revisited with the character view (stage 3).
- Verified lines: passive points (`a Passive Skill Point` = 1; respec and atlas points ignored), level-up
  (`(Shadow) is now level 2`), party members (`has joined the area`), deaths, login, client tag.

## Stage 3 — Atlas window and location browser (2026-11-19)

- **Window** (`src-tauri/src/atlas.rs`, command `atlas_open`): label `atlas`, route `#atlas`, own capability
  `capabilities/atlas.json` (local content; minimise / maximise / close / drag / always-on-top / fullscreen /
  position+size only). One instance: opening it again focuses it and, with an area, emits `atlas:select`
  (area ids validated before they reach a URL or event). Closing destroys it (no hidden webview, no background
  reading); position/size (debounced, not while maximised/fullscreen) and always-on-top are kept in the app
  setting `atlas.window` and restored on the next open — only onto a monitor that still exists.
- **Shared chrome** (`src/shared/window/ToolWindow.tsx`, game-agnostic): `ToolWindowBar` (title, slot, always on
  top, full screen, minimise / maximise / close) and `useToolWindow(key)`; for later reuse by PoE 2.
- **Atlas window** (`AtlasWindow.tsx`): toolbar with current act · area, search (all acts), compact toggle;
  location browser on the left (acts 1–10 and filters All / Towns / Waypoints / Bosses / With hints / Visited /
  Favourites / Recent — generated from the dataset, `browser.ts`, pure and tested); area detail on the right
  (level, waypoint, boss count, layout graph count, clickable connections incl. one-way entries and the act town,
  community boss names and hints with minimap direction arrows, crafting recipes, "No recorded layout", sources).
  Status strip: who you are and where (from Client.txt), "Follow my location" (choosing an area by hand turns it
  off; "Show where I am" jumps back). Preferences (act, area, filter, favourites, recent, compact, follow) in the
  PoE 1 setting `atlas.prefs`, validated on load.
- **Main window** module page (`index.tsx`, nav: Character → Location Atlas, PoE 1 only): the LOCATION ATLAS
  button (opens it on the area you are in), where you are, Client.txt choice, data sources.
- Concurrent reads from the page and the window are serialised in Rust (`SYNC_LOCK`).
- Checked in the app (dev build, QA database, your real PoE 1 log read-only): the page found the log and the
  character (Guardian 86, outside the campaign, last area The Bridge Encampment, 147 areas visited); two clicks
  opened one window; act / area selection, compact mode, always on top; close → window gone; reopen → area,
  compact and always-on-top restored.
- Not yet: compact mode changes the layout, not the window size; following the area while playing was not seen
  live (the character was outside the campaign) — covered by the location tests.

## Stage 4 — SVG map viewer (2026-11-19)

- **Shared, game-agnostic** (`src/shared/map/`): `layeredLayout` (deterministic layered graph layout: columns by
  walking distance from a root, barycentre ordering against crossings, normalised 0–1 positions),
  `viewport.ts` (zoom around a point, pan, fit, clamped 0.25–4×), `MapViewport` (SVG; wheel zoom at the cursor,
  drag to pan with a 4 px click threshold, +/−/0 keys and buttons, fit on first show / act change / resize until
  the user moves the map; only one transform changes while panning; a 200 ms transform transition for button
  zoom/fit, off with reduced motion).
- **Act map** (`actMap.ts`, pure; `ActMapView.tsx`): every area of the act and every walking connection from the
  game data, drawn once; one-way connections with an arrow; neighbouring acts as dashed "ghost" nodes. The act's
  entrance (lowest-level area reached from the previous act) is the first column. PoE 1 acts are long chains
  (Act 1 is 14 steps deep), so columns wrap into bands like a snake (≤ 5 per band, every other band reversed, each
  band as tall as its own tallest column) — the map fits a normal window at ~0.8× instead of 0.25×.
- **Markers / layers**: labels, area levels, waypoints (cyan), bosses (crimson), community hint count (amber),
  visited; the area you are in has a dashed amber ring, the selected one an amber border; towns and ghosts are
  distinct. Click (or Enter) on a node selects the area and opens its details on the right; tooltips give name,
  level, waypoint, boss, hints. The map says what it is: "Schematic: connections from the game files, not
  distances or directions."
- Window layout: browser | map | area details (compact mode: details only). Map layers are kept in `atlas.prefs`.
- **Fixed during QA:** Windows reports a minimised window at −32000 with a 160×28 size; that was being saved and the
  Atlas then reopened at its minimum size. Bounds are no longer saved while minimised / maximised / fullscreen,
  and Rust ignores implausible saved bounds.
- Checked in the app: Acts 1 and 9 laid out readably (fit 0.82×), node click selects the area, layer toggles,
  wheel zoom around the cursor, fit button.
- Tests: shared layout/viewport (6), act map (4: entrances, every area/connection of all ten acts drawn once,
  ghosts, no overlaps and inside bounds).

## Stage 5 — Route Intelligence (2026-11-19)

- **Shared router** (`src/shared/map/route.ts`, game-agnostic, pure): Dijkstra over a neighbour function the
  caller supplies, so the router never adds a move of its own; deterministic ties (node id). Act Tracker imports it
  read-only.
- **PoE 1 planner** (`routes.ts`, pure): moves are only (a) walking along the game's `connections` (one-way exits
  respected, cross-act links included) and (b) waypoint jumps. Cost = loading screens; a jump costs a hair more
  than one walked area, so ties prefer walking. No logout, town portal or travel time is modelled — times aren't in
  any source, and portals aren't connections (exile-leveling's `{portal|use}` returns to where the portal was
  opened).
- **Options**: start = where you are (follows you while you play) or a chosen area; goal = a chosen area, the
  nearest waypoint, or the act town; travel = *My waypoints* (waypoints of areas you've entered, from Client.txt),
  *All waypoints*, or *Walk only*. A boss route = choose the boss area (browser filter "Bosses").
- **Confidence**: walking only → Verified (game files); using a waypoint inferred from visits → Estimated (the log
  doesn't record clicking a waypoint); assuming every waypoint → Unverified. One-way exits on the route are noted.
  No route in the data → an honest "No way from … to …" with a suggestion, never an invented path.
- **UI**: a Route panel above the area details (steps with walk / waypoint, act changes, area levels; click a step
  to show it); the map draws walked steps in amber along their edges, waypoint jumps as dashed cyan lines, and
  numbers the steps. The planner is not saved — a route is planned for now.
- **Scope change**: the levelling route (ordered steps, quests, passive points, bandits) belongs to the PoE 1
  Act Tracker module (`src/games/poe1/act-tracker`); the old stage 6 is dropped here and the Atlas will later show
  Act Tracker's per-area guide. The "quest" route profile was dropped for the same reason.
- Checked in the app: Prisoner's Gate → The Coast is one waypoint jump (Estimated) or 7 walked areas (Verified),
  drawn on the Act 1 map.
- Tests (7): shared router (cheapest route, unreachable, deterministic ties); PoE 1 walking route, every walked step
  is a real connection across acts, unlocked vs all waypoints and their confidence, nearest waypoint and act
  town, refusal when the data has no way.

## Stages

1. **Data foundation** — generator, Acts 1–10 dataset (areas, connections, waypoints, topologies, quests, hints),
   validator, verification against the real PoE 1 log. ✅
2. **Location tracking** for PoE 1 on the shared reader + campaign hook; current area, character, history import. ✅
3. **Atlas window** (`#atlas`, always-on-top, compact, fullscreen, saved state, single instance) + location browser. ✅
4. **SVG map viewer**: act connection map, area detail, markers, layers, zoom/pan, marker details. ✅
5. **Route Intelligence**: shortest route over real connections + waypoints (walk only / my / all waypoints;
   to an area, nearest waypoint, act town), confidence, drawn on the map. ✅
6. ~~Quest Intelligence + Reward Guardian~~ — moved to the PoE 1 Act Tracker module; the Atlas will show its
   per-area guide (`areaGuide`) when that lands.
7. Layout editor: your own variants, markers, routes, confidence, revision history (migration 0011; 0010 is Act
   Tracker's).
8. `/campaign-update`, tests, profiling, polish, final report.
