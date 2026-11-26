-- 0.19: Deck Intelligence — Stacked Deck opening sessions (PoE 1).
-- Spec: docs/modules/deck-intelligence.md. Additive only; dropping these tables reverses it.
-- Every card is one deck_events row (one Stacked Deck = one card). The recognised text and the
-- user's correction are kept side by side; finished sessions keep their valuation snapshot.

CREATE TABLE deck_sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    game              TEXT NOT NULL CHECK (game = 'poe1'),
    name              TEXT NOT NULL,
    league            TEXT,
    created_at        INTEGER NOT NULL,
    opened_on         TEXT,                         -- YYYY-MM-DD the user gave (optional)
    -- running: tracking; paused: kept, not tracking; finished: read-only, valued
    status            TEXT NOT NULL CHECK (status IN ('running', 'paused', 'finished')),
    -- live: tracked in Vaalytics; import: built from a Client.txt import
    origin            TEXT NOT NULL DEFAULT 'live' CHECK (origin IN ('live', 'import')),
    started_at        INTEGER NOT NULL,
    ended_at          INTEGER,
    active_secs       INTEGER NOT NULL DEFAULT 0,   -- time spent running (pauses excluded)
    resumed_at        INTEGER,                      -- start of the current running stretch
    planned_decks     INTEGER,
    acquisition       TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (acquisition IN ('individual', 'bulk', 'farmed', 'free', 'unknown')),
    cost_total        REAL,                         -- chaos; NULL = unknown
    notes             TEXT,
    -- Client.txt position for live tracking (only new lines are read)
    log_key           TEXT,
    log_offset        INTEGER
);
CREATE INDEX deck_sessions_by_time ON deck_sessions (game, started_at);

CREATE TABLE deck_captures (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL REFERENCES deck_sessions (id) ON DELETE CASCADE,
    game          TEXT NOT NULL CHECK (game = 'poe1'),
    taken_at      INTEGER NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('hotkey', 'file')),
    image_file    TEXT,                             -- PNG of the captured region in <data dir>/deck-captures
    width         INTEGER NOT NULL,
    height        INTEGER NOT NULL,
    region        TEXT NOT NULL,                    -- JSON {x, y, w, h} as fractions of the game window
    ocr_lines     INTEGER NOT NULL DEFAULT 0,
    ignored_lines INTEGER NOT NULL DEFAULT 0,       -- OCR text that matched no card (other ground items)
    recognizer    INTEGER NOT NULL,
    error         TEXT
);
CREATE INDEX deck_captures_by_session ON deck_captures (session_id);

CREATE TABLE deck_events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       INTEGER NOT NULL REFERENCES deck_sessions (id) ON DELETE CASCADE,
    game             TEXT NOT NULL CHECK (game = 'poe1'),
    at               INTEGER NOT NULL,
    source           TEXT NOT NULL CHECK (source IN ('ocr', 'log', 'manual', 'import')),
    -- Stable identity of the physical observation: log lines "log:<file key>:<byte offset>"
    -- (so a live-tracked line is never imported twice), OCR "ocr:<capture>:<n>", manual "man:<uuid-ish>".
    source_uid       TEXT NOT NULL,
    capture_id       INTEGER REFERENCES deck_captures (id) ON DELETE SET NULL,
    recognized_text  TEXT,                          -- OCR line as read (NULL for log / manual)
    recognized_card  TEXT,                          -- best match before any correction
    confidence       REAL NOT NULL DEFAULT 1,       -- 0–1
    bbox             TEXT,                          -- JSON {x, y, w, h} in capture pixels
    card             TEXT,                          -- current card name (user's correction wins); NULL = unrecognized
    status           TEXT NOT NULL CHECK (status IN ('confirmed', 'review', 'unrecognized', 'removed')),
    review_reason    TEXT,                          -- why it needs review (low confidence, possible duplicate…)
    corrected        INTEGER NOT NULL DEFAULT 0 CHECK (corrected IN (0, 1)),
    corrected_at     INTEGER
);
CREATE UNIQUE INDEX deck_events_uid ON deck_events (game, source_uid);
CREATE INDEX deck_events_by_session ON deck_events (session_id, at);

-- Valuation snapshot written when a session is finished (and when the user re-values it).
-- kind 'final' is the original valuation and is never overwritten.
CREATE TABLE deck_valuations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    INTEGER NOT NULL REFERENCES deck_sessions (id) ON DELETE CASCADE,
    game          TEXT NOT NULL CHECK (game = 'poe1'),
    kind          TEXT NOT NULL CHECK (kind IN ('final')),
    valued_at     INTEGER NOT NULL,
    league        TEXT,
    prices_at     INTEGER,                          -- poe.ninja fetch time of the prices used
    total_value   REAL NOT NULL,                    -- chaos, priced confirmed cards only
    priced_cards  INTEGER NOT NULL,
    unpriced_cards INTEGER NOT NULL,
    lines         TEXT NOT NULL                     -- JSON [{card, qty, unit, source}] unit NULL = unknown
);
CREATE UNIQUE INDEX deck_valuations_final ON deck_valuations (session_id, kind);

-- The user's own price for a card in a league (shown as "manual", never as market data).
CREATE TABLE deck_price_overrides (
    game        TEXT NOT NULL CHECK (game = 'poe1'),
    league      TEXT NOT NULL,
    card        TEXT NOT NULL,
    value       REAL NOT NULL CHECK (value >= 0),
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (game, league, card)
);
