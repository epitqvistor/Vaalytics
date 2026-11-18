-- Campaign Intelligence (PoE 2) — per-character campaign progress derived
-- from Client.txt lines read by the Session Intelligence reader, plus the
-- player's manual marks. Spec: docs/modules/campaign-intelligence.md
-- Character names are stored locally only (needed to keep characters apart).

CREATE TABLE campaign_characters (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    game           TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    name           TEXT NOT NULL,
    class          TEXT NOT NULL,                 -- latest class seen (Ascendancy after ascending)
    base_class     TEXT NOT NULL,                 -- first class seen
    level          INTEGER NOT NULL,
    first_seen_at  INTEGER NOT NULL,
    last_seen_at   INTEGER NOT NULL,
    hidden         INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    UNIQUE (game, name)
);

-- Normalised campaign-relevant log events. `segment` = the client run / login
-- the event belongs to; events seen before the character is identified carry
-- character_id NULL and are assigned when the segment's character is known.
CREATE TABLE campaign_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    game          TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    character_id  INTEGER REFERENCES campaign_characters (id) ON DELETE CASCADE,
    segment       TEXT NOT NULL,
    at            INTEGER NOT NULL,               -- unix s
    kind          TEXT NOT NULL CHECK (kind IN ('zone', 'passive_points', 'weapon_set_points', 'level', 'ascended', 'death')),
    area_id       TEXT,
    area_name     TEXT,
    area_level    INTEGER,
    amount        INTEGER,
    detail        TEXT,
    log_key       TEXT NOT NULL,
    log_offset    INTEGER NOT NULL,
    UNIQUE (game, log_key, log_offset, kind)
);
CREATE INDEX campaign_events_by_character ON campaign_events (character_id, at);
CREATE INDEX campaign_events_pending ON campaign_events (game, segment) WHERE character_id IS NULL;

-- The player's own confirmations, skips and reverts (one row per objective).
CREATE TABLE campaign_marks (
    character_id  INTEGER NOT NULL REFERENCES campaign_characters (id) ON DELETE CASCADE,
    objective_id  TEXT NOT NULL,
    mark          TEXT NOT NULL CHECK (mark IN ('done', 'skipped', 'not-done')),
    choice        TEXT,
    at            INTEGER NOT NULL,
    PRIMARY KEY (character_id, objective_id)
);

-- Attribution state of the live reader, so a restart resumes the same segment.
CREATE TABLE campaign_state (
    game          TEXT PRIMARY KEY CHECK (game IN ('poe1', 'poe2')),
    segment       TEXT,
    character_id  INTEGER REFERENCES campaign_characters (id) ON DELETE SET NULL,
    client_tag    TEXT,
    client_tag_at INTEGER,
    updated_at    INTEGER NOT NULL
);

-- Reward Guardian: the player's own claim stage per reward, separate from the
-- objective (a boss can be defeated while its reward is still unclaimed).
CREATE TABLE campaign_reward_marks (
    character_id  INTEGER NOT NULL REFERENCES campaign_characters (id) ON DELETE CASCADE,
    reward_id     TEXT NOT NULL,
    stage         TEXT NOT NULL CHECK (stage IN ('not-claimed', 'boss-defeated', 'item-acquired', 'submitted', 'applied', 'complete')),
    choice        TEXT,
    at            INTEGER NOT NULL,
    PRIMARY KEY (character_id, reward_id)
);
