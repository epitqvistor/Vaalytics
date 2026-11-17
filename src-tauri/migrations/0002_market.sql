-- Vaalytics schema v2: market data cache and price history.
-- All rows are scoped by game (CHECK-constrained) and league.
-- Values are stored in the game's base unit (PoE 1: chaos, PoE 2: exalted)
-- plus divine, converted with the rates the source reported in the same response.

-- Leagues as reported by the market source.
CREATE TABLE market_leagues (
    game          TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    name          TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    hardcore      INTEGER NOT NULL DEFAULT 0,
    indexed       INTEGER NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL,
    fetched_at    INTEGER NOT NULL,
    PRIMARY KEY (game, name)
);

-- One row per fetched resource: drives freshness, conditional requests and errors.
-- category '__leagues' tracks the league index itself.
CREATE TABLE market_fetches (
    game           TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    league         TEXT NOT NULL,
    category       TEXT NOT NULL,
    fetched_at     INTEGER,              -- last successful 200/304 (unix s)
    expires_at     INTEGER,              -- fetched_at + Cache-Control max-age
    etag           TEXT,
    last_error     TEXT,
    last_error_at  INTEGER,
    PRIMARY KEY (game, league, category)
);

-- Latest normalized snapshot per item.
CREATE TABLE market_items (
    game          TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    league        TEXT NOT NULL,
    category      TEXT NOT NULL,
    item_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    variant       TEXT,
    icon          TEXT,
    value         REAL NOT NULL,          -- base unit
    divine_value  REAL,
    change_7d     REAL,                   -- ratio, e.g. 0.042 = +4.2 %
    sparkline     TEXT,                   -- JSON array of % change vs 7 days ago (nullable points)
    volume_value  REAL,                   -- traded value in base unit (exchange categories)
    listings      INTEGER,                -- listing count (item categories)
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (game, league, category, item_id)
);

-- Locally recorded history: at most one point per item per hour.
CREATE TABLE price_history (
    game          TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    league        TEXT NOT NULL,
    category      TEXT NOT NULL,
    item_id       TEXT NOT NULL,
    ts            INTEGER NOT NULL,       -- hour bucket (unix s)
    value         REAL NOT NULL,
    divine_value  REAL,
    PRIMARY KEY (game, league, category, item_id, ts)
) WITHOUT ROWID;

CREATE INDEX price_history_ts ON price_history (ts);
