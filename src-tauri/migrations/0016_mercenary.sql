-- Mercenary Intelligence (PoE 1): market evidence for Mercenary Warrants.
-- Every row carries game, league, platform, source, game version and catalog version, and
-- leagues are never mixed (league is part of every key and query). Seller account names are
-- never stored. docs/modules/mercenary-intelligence.md

-- One official Trade search run (one comparison level of one warrant).
CREATE TABLE mercenary_snapshots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game            TEXT NOT NULL CHECK (game = 'poe1'),
    league          TEXT NOT NULL,
    platform        TEXT NOT NULL DEFAULT 'pc',
    source          TEXT NOT NULL,           -- 'trade-api'
    game_version    TEXT NOT NULL,
    catalog_version TEXT NOT NULL,
    query_hash      TEXT NOT NULL,           -- hash of the exact query sent
    query_json      TEXT NOT NULL,
    level           INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),
    label           TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('ok', 'error')),
    error           TEXT,
    search_id       TEXT,
    total           INTEGER,
    fetched         INTEGER NOT NULL DEFAULT 0,
    complexity      INTEGER,
    trade_url       TEXT,
    rates_json      TEXT,                    -- conversion rates used (currency -> chaos)
    created_at      INTEGER NOT NULL
);
CREATE INDEX idx_merc_snapshots_query ON mercenary_snapshots (game, league, query_hash, created_at);

-- Listings returned by a snapshot (asking prices, not sales).
CREATE TABLE mercenary_observations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id   INTEGER NOT NULL REFERENCES mercenary_snapshots (id) ON DELETE CASCADE,
    game          TEXT NOT NULL CHECK (game = 'poe1'),
    league        TEXT NOT NULL,
    listing_id    TEXT NOT NULL,
    amount        REAL,
    currency      TEXT,
    price_type    TEXT,
    amount_chaos  REAL,                      -- converted with rates_json of the snapshot
    indexed_at    TEXT,
    instant_buyout INTEGER NOT NULL DEFAULT 0,
    build         TEXT,
    level         INTEGER,
    skills_json   TEXT NOT NULL              -- [{stat, name, supports:[{stat, name, tier}]}]
);
CREATE INDEX idx_merc_observations_snapshot ON mercenary_observations (snapshot_id);
CREATE INDEX idx_merc_observations_listing ON mercenary_observations (game, league, listing_id);

-- A valuation the user ran (history per warrant fingerprint and league).
CREATE TABLE mercenary_valuations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game            TEXT NOT NULL CHECK (game = 'poe1'),
    league          TEXT NOT NULL,
    platform        TEXT NOT NULL DEFAULT 'pc',
    game_version    TEXT NOT NULL,
    catalog_version TEXT NOT NULL,
    rules_version   TEXT NOT NULL,
    fingerprint     TEXT NOT NULL,           -- canonical warrant key (family, skills, bound supports)
    family          TEXT NOT NULL,
    title           TEXT NOT NULL,
    category        TEXT NOT NULL,
    confidence      TEXT NOT NULL,
    level           INTEGER,                 -- comparison level used for the estimate
    count           INTEGER NOT NULL DEFAULT 0,
    p25_chaos       REAL,
    median_chaos    REAL,
    p75_chaos       REAL,
    divine_rate     REAL,                    -- chaos per divine used
    summary_json    TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);
CREATE INDEX idx_merc_valuations_fp ON mercenary_valuations (game, league, fingerprint, created_at);

-- Rule changes found by controlled with/without comparisons. Staged first; only the user
-- promotes or rejects them. Active bundled rules are never rewritten.
CREATE TABLE mercenary_rule_candidates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    game            TEXT NOT NULL CHECK (game = 'poe1'),
    league          TEXT NOT NULL,
    game_version    TEXT NOT NULL,
    catalog_version TEXT NOT NULL,
    rule_key        TEXT NOT NULL,           -- family:feature
    family          TEXT NOT NULL,
    title           TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('staged', 'validated', 'promoted', 'rejected')),
    evidence_json   TEXT NOT NULL,
    with_count      INTEGER NOT NULL,
    without_count   INTEGER NOT NULL,
    created_at      INTEGER NOT NULL,
    reviewed_at     INTEGER,
    UNIQUE (game, league, rule_key)
);
