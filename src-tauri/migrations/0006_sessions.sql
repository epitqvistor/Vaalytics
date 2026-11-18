-- 0.13: Session Intelligence — game sessions detected from the game process and
-- the client log (Client.txt). Spec: docs/modules/session-intelligence.md
-- Summary columns are recomputed from visits/events in the same transaction
-- that changes them (session_intel/store.rs), so they can't drift after a crash.

CREATE TABLE play_sessions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    game                TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    started_at          INTEGER NOT NULL,             -- unix s (game process start)
    ended_at            INTEGER,                      -- NULL while active
    last_activity_at    INTEGER NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('active', 'completed')),
    end_reason          TEXT CHECK (end_reason IN ('game_closed', 'recovered')),
    process_id          INTEGER,
    process_started_at  INTEGER,
    log_tracked         INTEGER NOT NULL DEFAULT 0 CHECK (log_tracked IN (0, 1)),
    maps_entered        INTEGER NOT NULL DEFAULT 0,
    areas_entered       INTEGER NOT NULL DEFAULT 0,
    map_secs            INTEGER NOT NULL DEFAULT 0,
    hideout_secs        INTEGER NOT NULL DEFAULT 0,
    town_secs           INTEGER NOT NULL DEFAULT 0,
    campaign_secs       INTEGER NOT NULL DEFAULT 0,
    content_secs        INTEGER NOT NULL DEFAULT 0,
    unknown_secs        INTEGER NOT NULL DEFAULT 0,
    loading_secs        INTEGER NOT NULL DEFAULT 0,
    afk_secs            INTEGER NOT NULL DEFAULT 0,
    deaths              INTEGER NOT NULL DEFAULT 0,
    level_ups           INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX play_sessions_by_start ON play_sessions (game, started_at);
-- At most one active session per game: a second detector can't create a duplicate.
CREATE UNIQUE INDEX play_sessions_one_active ON play_sessions (game) WHERE status = 'active';

CREATE TABLE play_area_visits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL REFERENCES play_sessions (id) ON DELETE CASCADE,
    game          TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    area_id       TEXT NOT NULL,                      -- internal id, e.g. MapRazedFields
    area_name     TEXT,                               -- display name from the log, when seen
    area_level    INTEGER,
    seed          INTEGER,                            -- same seed = same instance re-entered
    kind          TEXT NOT NULL CHECK (kind IN ('hideout', 'town', 'map', 'campaign', 'content', 'unknown')),
    entered_at    INTEGER NOT NULL,
    exited_at     INTEGER,
    loading_secs  REAL,
    log_key       TEXT NOT NULL,
    log_offset    INTEGER NOT NULL,
    UNIQUE (session_id, log_key, log_offset)
);
CREATE INDEX play_area_visits_by_session ON play_area_visits (session_id, entered_at);

CREATE TABLE play_session_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES play_sessions (id) ON DELETE CASCADE,
    game        TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    at          INTEGER NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN (
                    'game_started', 'game_closed', 'tracking_resumed', 'recovered',
                    'client_log_opened', 'death', 'level_up', 'afk_on', 'afk_off',
                    'disconnect', 'paused', 'resumed', 'log_reset', 'log_unavailable')),
    detail      TEXT,
    log_key     TEXT,
    log_offset  INTEGER,
    UNIQUE (session_id, log_key, log_offset)
);
CREATE INDEX play_session_events_by_session ON play_session_events (session_id, at);

-- Reader position and the user's manual log path, per game.
CREATE TABLE play_tracker_state (
    game          TEXT PRIMARY KEY CHECK (game IN ('poe1', 'poe2')),
    log_path      TEXT,                               -- manual path; NULL = auto-discover
    log_key       TEXT,
    log_offset    INTEGER NOT NULL DEFAULT 0 CHECK (log_offset >= 0),
    last_line_at  INTEGER,
    updated_at    INTEGER NOT NULL
);
