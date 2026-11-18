-- 0.14: Loot Journal — items captured from Ctrl+C copies in the game (PoE 2).
-- Spec: docs/modules/loot-journal.md. `raw_text` is the copy exactly as read and
-- is never modified; user edits go to notes/tags/status/origin columns.

CREATE TABLE loot_items (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    game                 TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    fingerprint          TEXT NOT NULL,
    raw_text             TEXT NOT NULL,
    item_class           TEXT NOT NULL,
    rarity               TEXT NOT NULL,
    item_name            TEXT,
    base_type            TEXT NOT NULL,
    category             TEXT NOT NULL,
    icon                 TEXT,                                 -- from market data when the item is listed there
    item_level           INTEGER,
    stack_size           INTEGER,
    quality              INTEGER,
    corrupted            INTEGER NOT NULL DEFAULT 0 CHECK (corrupted IN (0, 1)),
    unidentified         INTEGER NOT NULL DEFAULT 0 CHECK (unidentified IN (0, 1)),
    parser_confidence    TEXT NOT NULL CHECK (parser_confidence IN ('high', 'medium', 'low')),
    parser_warnings      TEXT NOT NULL DEFAULT '[]',          -- JSON array of strings
    captured_at          INTEGER NOT NULL,                     -- first capture, unix s
    last_captured_at     INTEGER NOT NULL,
    capture_count        INTEGER NOT NULL DEFAULT 1 CHECK (capture_count >= 1),
    source               TEXT NOT NULL CHECK (source IN ('clipboard', 'import')),
    -- Where the copy happened (from Session Intelligence). Not where it dropped.
    session_id           INTEGER REFERENCES play_sessions (id) ON DELETE SET NULL,
    capture_area_name    TEXT,
    capture_area_kind    TEXT,
    session_elapsed_secs INTEGER,
    -- Drop origin: unknown unless the user says otherwise.
    origin_status        TEXT NOT NULL DEFAULT 'unknown' CHECK (origin_status IN ('unknown', 'user_confirmed_drop', 'user_not_a_drop')),
    origin_note          TEXT,
    status               TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured', 'kept', 'sold', 'discarded')),
    favorite             INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    notes                TEXT,
    tags                 TEXT NOT NULL DEFAULT '[]',           -- JSON array of strings
    -- Latest valuation (denormalised from loot_valuations for fast lists).
    value_status         TEXT NOT NULL DEFAULT 'pending' CHECK (value_status IN ('pending', 'priced', 'unsupported', 'no_market_data', 'manual')),
    value_total          REAL,                                 -- game base unit (PoE 2: exalted), whole stack
    value_checked_at     INTEGER,
    value_checks         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX loot_items_by_time ON loot_items (game, captured_at);
CREATE INDEX loot_items_by_fingerprint ON loot_items (game, fingerprint, last_captured_at);
CREATE INDEX loot_items_by_session ON loot_items (session_id);
CREATE INDEX loot_items_by_value ON loot_items (game, value_status, value_checked_at);

-- Valuation history: append-only, one row per change.
CREATE TABLE loot_valuations (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id          INTEGER NOT NULL REFERENCES loot_items (id) ON DELETE CASCADE,
    game             TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    at               INTEGER NOT NULL,
    status           TEXT NOT NULL CHECK (status IN ('priced', 'unsupported', 'no_market_data', 'manual')),
    unit_value       REAL,                                     -- per item, base unit
    quantity         INTEGER NOT NULL DEFAULT 1,
    total_value      REAL,
    unit             TEXT NOT NULL,                            -- base unit name, e.g. exalted
    source           TEXT NOT NULL,                            -- 'poe.ninja', 'you', …
    market_category  TEXT,
    league           TEXT,
    confidence       TEXT CHECK (confidence IN ('high', 'medium', 'low')),
    data_fetched_at  INTEGER,                                  -- age of the market data used
    note             TEXT
);
CREATE INDEX loot_valuations_by_item ON loot_valuations (item_id, at);

-- Capture log (recognised items, duplicates, errors). Never stores unrelated text.
CREATE TABLE loot_capture_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    game         TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    at           INTEGER NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('captured', 'duplicate', 'error')),
    fingerprint  TEXT,
    item_id      INTEGER REFERENCES loot_items (id) ON DELETE SET NULL,
    detail       TEXT
);
CREATE INDEX loot_capture_events_by_time ON loot_capture_events (game, at);
