-- 0.16: Loot Journal — inventory snapshots from one-shot screenshots (PoE 2).
-- Spec: docs/modules/loot-journal.md ("Inventory snapshots"). Additive only; dropping these two tables
-- reverses it. The original recognition (recognized_*) is kept next to the user's corrections.

CREATE TABLE loot_inventory_snapshots (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    game                TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    taken_at            INTEGER NOT NULL,
    source              TEXT NOT NULL CHECK (source IN ('hotkey', 'file')),
    -- review: waiting for the user; confirmed: checked by the user; cancelled: discarded (kept for history)
    status              TEXT NOT NULL CHECK (status IN ('review', 'confirmed', 'cancelled')),
    is_baseline         INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1)),
    session_id          INTEGER REFERENCES play_sessions (id) ON DELETE SET NULL,
    map_run_id          INTEGER REFERENCES loot_map_runs (id) ON DELETE SET NULL,
    map_assignment      TEXT CHECK (map_assignment IN ('auto', 'user')),
    screen_w            INTEGER NOT NULL,
    screen_h            INTEGER NOT NULL,
    grid                TEXT NOT NULL,                 -- JSON {left, top, cell, score} in screenshot pixels
    image_file          TEXT,                          -- inventory crop (PNG) in <data dir>/loot-snapshots
    recognizer_version  INTEGER NOT NULL,
    league              TEXT,
    note                TEXT,
    confirmed_at        INTEGER
);
CREATE INDEX loot_inventory_snapshots_by_time ON loot_inventory_snapshots (game, taken_at);

CREATE TABLE loot_inventory_entries (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id          INTEGER NOT NULL REFERENCES loot_inventory_snapshots (id) ON DELETE CASCADE,
    game                 TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    col                  INTEGER NOT NULL,
    row                  INTEGER NOT NULL,
    recognized_name      TEXT,
    recognized_category  TEXT,
    icon_score           REAL NOT NULL,
    tier_strokes         INTEGER NOT NULL,
    recognized_quantity  INTEGER,
    quantity_confidence  REAL NOT NULL,
    confidence           TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
    alternatives         TEXT NOT NULL DEFAULT '[]',   -- JSON array of names
    -- What counts: the recognised values until the user corrects them.
    name                 TEXT,
    quantity             INTEGER,
    excluded             INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0, 1)),
    corrected            INTEGER NOT NULL DEFAULT 0 CHECK (corrected IN (0, 1)),
    UNIQUE (snapshot_id, col, row)
);
CREATE INDEX loot_inventory_entries_by_snapshot ON loot_inventory_entries (snapshot_id);
