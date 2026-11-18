# Session Intelligence (PoE 2)

Your game sessions, recorded automatically from the game process and Client.txt: time, areas, maps and trends.

| | |
|---|---|
| Registry id | `session-intelligence` · group `tools` · PoE 1 not offered · PoE 2 `ready` |
| UI | `src/games/poe2/session-intelligence/` (tabs: Live, Timeline, History, Analytics, Settings, Diagnostics), app-level `SessionNotifier` |
| Logic | `stats.ts` (analytics, tested); Rust `src-tauri/src/session/` |
| Data | DataKind **user** (recorded on this PC). Tables `play_sessions`, `play_area_visits`, `play_session_events`, `play_tracker_state` (migration 0006); setting `sessions.config` (poe2) |
| Patch rules | none (Client.txt format, not league data) |

## How it works

One application-level background thread (`SessionService`, `session/mod.rs`) owns a `Tracker`
(`session/tracker.rs`, pure Rust, tested without Tauri):

1. **Process check** every `pollSecs` (default 5 s, 3–30): `sysinfo` process list (already a
   dependency) filtered to PoE client executable names, plus the owning window's title via
   `EnumWindows` (public window-manager API). PoE 1 and PoE 2 share executable names, so a client
   is PoE 2 when its window is titled `Path of Exile 2`, its folder is named `Path of Exile 2`,
   or it lives in the folder of the configured Client.txt. Vaalytics' own windows are skipped (reading
   their titles from the tracker thread could deadlock the UI thread). Nothing else runs while the
   game is closed; a check takes ~10 ms.
2. **Session** = one run of the PoE 2 client. Starts at the process start time, ends at the last
   moment the process was seen. At most one active session per game (partial unique index).
3. **Client.txt** is read only while the game runs, every 2 s, incrementally (`session/reader.rs`):
   complete lines only, offset persisted on a line boundary in the same transaction as the events
   it produced (no duplicates after a crash; visits/events also carry `UNIQUE(session, log_key,
   log_offset)`). File identity = creation time + hash of the first 48 bytes; size < offset →
   truncated, identity changed → replaced; both restart at byte 0 and log a `log_reset` event.
   Lossy UTF-8; over-long lines (>64 KB) are skipped and counted. The file is opened with the
   default share mode for each read and closed immediately — the game is never blocked.
4. **Where reading starts**: the stored position when it's on the same file and < 64 MB behind;
   otherwise the last `LOG FILE OPENING` within the last 32 MB if it belongs to this run (≥ process
   start − 3 min); otherwise the end of the file. A 300 MB history is never replayed.
5. **Restart / crash recovery** (first scan after Vaalytics starts): an active session whose
   process (pid + start time) still runs is **resumed**; otherwise the missed lines of that client
   run are read (stopping at another client's lines) and the session is closed at its last
   activity (`end_reason = recovered`).
6. Changes reach the UI as `session:updated` (≤ 1 per second); `session:completed` carries the
   notification preference.

Observation only: no memory reading, no injection, no input, no game-file changes, nothing launched.

## Verified Client.txt format

Checked against a real PoE 2 client log (client `poe2_production/tags/0.5.5g`, build 328873) on the
developer's machine, read-only. Sanitized samples (also in `log_format.rs` tests):

```
2026/11/17 14:07:45 ***** LOG FILE OPENING *****
2026/11/17 14:15:49 9562875 2caa22f9 [DEBUG Client 50980] Generating level 79 area "MapRazedFields" with seed 3682517103
2026/11/17 14:15:50 9563296 7fbd1225 [INFO Client 50980] [SCENE] Set Source [Razed Fields]
2026/11/17 14:15:53 9566765 4cba6a95 [INFO Client 50980] [LOADING SCREEN] (Razed Fields) Duration = 4.00466 seconds
2026/11/17 14:16:38 9611406 3ef23348 [INFO Client 50980] : <Character> has been slain.
... [INFO Client N] : <Character> (<Class>) is now level 92
... [INFO Client N] : AFK mode is now ON. Autoreply "This player is AFK."
... [INFO Client N] : AFK mode is now OFF.
... [INFO Client N] Abnormal disconnect: An unexpected disconnection occurred.
```

- Timestamps are local wall-clock time; converted with the Windows time-zone rules for that date
  (`TzSpecificLocalTimeToSystemTime`, `windows` feature `Win32_System_Time`).
- `Client 50980` is the client's process id (all observed values are multiples of 4, as Windows
  pids are); used to keep two client runs apart.
- Re-entering the same map instance logs the same seed again (observed: `MapAugury` seed
  2227745989 three times around hideout visits) → one **map instance** = area id + seed.
- System messages are `] : text` (empty sender). Chat lines always have a sender/channel, so a chat
  line quoting "has been slain" is never counted.
- PoE 1 logs differ: `User agent: PoE release` and `login.pathofexile.com` vs PoE 2's
  `poe2_production` / `login.pathofexile2.com`. Manual selection rejects a PoE 1 log.

### Area classification (`areas.rs`, from ids seen in the real log)

| Kind | Rule | Examples |
|---|---|---|
| hideout | id starts with `Hideout` | HideoutShrine, HideoutLimestone |
| town | id ends with `_town` (any case) | G1_town … G4_town, P1_Town … P3_Town, G_Endgame_Town |
| map | id starts with `Map` | MapRazedFields, MapVaalFactory, MapUberBoss_Ritual |
| campaign | `G<n>_…` / `P<n>_…` | G1_4, G3_10_Airlock, P2_1 |
| content | league areas outside maps | Abyss_Depths1, ExpeditionLogBook_*, RitualLeagueBoss, BreachDomain_01, IncursionTemple, Sanctum_*, Delirium_*, ChayulaLeague |
| unknown | anything else | — |

Only `map` counts as a map. Hideout and town visits are never maps.

### Not available (and shown as such)

- **Map completion**: no verified log line says a map was finished. Every map run has
  `completed: null`, shown as "Unavailable". Entering and leaving are recorded separately.
- **Whose death / level-up**: the log names the character but not whether it's the player or a
  party member. Shown as "Deaths*" with that note.
- Loot, profit, currency: not in Client.txt; this module shows none.

## Calculations (`stats.ts`)

- Maps entered = distinct map instances. Maps per hour = maps ÷ session hours (needs ≥ 1 min).
- Avg time in a map = time inside map areas ÷ maps entered (re-entries add to the same instance).
- Downtime = hideout + town time. AFK = paired AFK ON/OFF lines (an open ON lasts to session end).
- Time per area kind = sum of visits (a visit ends when the next area is generated or the session ends).
- Day/week buckets use local time (weeks start Monday); a session over midnight is split.
- Map figures only use sessions where Client.txt was read (`log_tracked`); otherwise "—".
- Trends need ≥ 2 sessions, else an honest empty state.

## Settings (`sessions.config`, written only through `session_set_config`)

`autoDetect`, `autoTrack`, `autoDiscover`, `attachToRunning` (on), `keepShortSessions` (off: runs
< 2 min without maps are dropped), `pollSecs` (5), `debugLogging` (off), `notifyOnSummary` (off),
`retentionDays` (0 = forever). The manual log path lives in `play_tracker_state.log_path`
(validated, set only through the file dialog command), not in generic settings.

## IPC

`session_status`, `session_diagnostics`, `session_list(query)`, `session_detail(id)` (+ previous
session), `session_delete(ids)`, `session_set_config`, `session_set_paused`, `session_check_now`,
`session_choose_log` (dialog), `session_clear_log`, `session_reset`, `session_export(ids, json|csv)`
(save dialog). All require `game = poe2`.

The same reader also feeds Campaign Intelligence: `apply_event` calls `campaign::CampaignHook::on_event`
for every parsed line in the same transaction (a campaign failure is logged and never stops session
tracking). For it the parser also recognises the client tag, login-server connects, passive-point grants
and players joining/leaving, and keeps the name/class of level-up and slain lines in memory; Session
Intelligence's own tables still store no character names (docs/modules/campaign-intelligence.md).

Read interfaces for other modules: `useSessionStatus`, `useSessionHistory`, `useSessionDetail`,
`useSessionUpdates` (`hooks.ts`); Rust `session::store::{list, detail, map_runs, get_session}`.

## Notifications

Only the existing in-app toast system (no OS notifications exist in the app). Off by default.

## Privacy

The normal UI shows the log path masked (`…\Path of Exile 2\logs\Client.txt`); the full path
appears only on the Diagnostics tab. Character names, chat and server IPs are never stored.

## Tests

Rust (`cargo test session`): parser on sanitized real samples, malformed/foreign/chat lines, CRLF,
lossy UTF-8; reader incremental/partial lines/limits/truncation/replacement/missing file/over-long
lines/last client start; process name + PoE 1 vs 2 classification; area rules; store summary,
duplicates, one-active constraint, history filter/sort/search/LIKE escaping, cascade delete,
retention, tracker state; tracker lifecycle (start, areas, maps, finish), short sessions, resume
after restart, crash recovery with catch-up, attach to running game, missing log → reconnect,
replaced log, pause, process-list errors, foreign client lines; export CSV/JSON; migrations.
Ignored live check: `VAALYTICS_POE2_LOG=<path> cargo test -- --ignored live_client_log --nocapture`.
Frontend (`stats.test.ts`): rates, totals with untracked sessions, midnight split, weeks, period and
session comparisons, formatting.

## Not yet

- Map completion, kill counts, loot (not in Client.txt).
- PoE 1 session tracking (the schema is game-scoped; the tracker runs for PoE 2 only).
- A session's area data depends on Client.txt being readable; without it only the duration is recorded.
