-- 0.16: Loot Tracker — map records for the Loot Journal and its overlay (PoE 2).
-- Spec: docs/modules/loot-journal.md ("Maps").
--
-- A map record is NOT a second map tracker: an `auto` row only points at a map instance that
-- Session Intelligence detected from Client.txt (session + area id + seed; durations are read from
-- play_area_visits). `manual` rows are the user's own Start / Pause / Finish when automatic
-- detection isn't available or the user prefers it.
-- Additive only: existing tables keep their rows; removing this migration's effect means dropping
-- loot_map_runs and the two new loot_items columns (no existing data depends on them).

CREATE TABLE loot_map_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    game           TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    session_id     INTEGER REFERENCES play_sessions (id) ON DELETE SET NULL,
    source         TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
    area_id        TEXT,                                -- internal id (auto), e.g. MapRazedFields
    area_name      TEXT,
    area_level     INTEGER,
    seed           INTEGER,                             -- auto: the instance
    started_at     INTEGER NOT NULL,
    ended_at       INTEGER,                             -- NULL while open
    paused_at      INTEGER,                             -- manual: paused since
    paused_secs    INTEGER NOT NULL DEFAULT 0,          -- manual: total paused time
    status         TEXT NOT NULL CHECK (status IN ('active', 'paused', 'finished')),
    strategy       TEXT,                                -- user label (Breach, Expedition…)
    notes          TEXT,
    user_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (user_confirmed IN (0, 1)),
    created_at     INTEGER NOT NULL,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX loot_map_runs_by_start ON loot_map_runs (game, started_at);
CREATE INDEX loot_map_runs_by_session ON loot_map_runs (session_id);
-- One record per detected instance, and at most one open record per game.
CREATE UNIQUE INDEX loot_map_runs_auto ON loot_map_runs (game, session_id, area_id, seed) WHERE source = 'auto';
CREATE UNIQUE INDEX loot_map_runs_one_open ON loot_map_runs (game) WHERE status IN ('active', 'paused');

-- Which map a capture belongs to: 'auto' = copied inside that map (or during the user's open manual
-- map), 'user' = assigned by the user. NULL = not assigned (e.g. copied in the hideout).
ALTER TABLE loot_items ADD COLUMN map_run_id INTEGER REFERENCES loot_map_runs (id) ON DELETE SET NULL;
ALTER TABLE loot_items ADD COLUMN map_assignment TEXT CHECK (map_assignment IN ('auto', 'user'));
CREATE INDEX loot_items_by_map ON loot_items (map_run_id);

-- User verification and corrections. The raw copy never changes; the first correction keeps the
-- recognised value in original_* so it can be shown and restored.
ALTER TABLE loot_items ADD COLUMN verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1));
ALTER TABLE loot_items ADD COLUMN original_category TEXT;
ALTER TABLE loot_items ADD COLUMN original_stack_size INTEGER;
