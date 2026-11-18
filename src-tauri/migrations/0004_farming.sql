-- 0.10: Farming Lab — farming sessions recorded by the user, per game and league.
-- `data` holds the session's cost and loot lines (with the unit prices used at
-- save time and their source time) and notes, as JSON (≤ 64 KB, validated in farming.rs).
CREATE TABLE farming_sessions (
    game           TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    id             TEXT NOT NULL,
    league         TEXT NOT NULL,
    strategy       TEXT NOT NULL,
    started_at     INTEGER NOT NULL,   -- unix s
    duration_secs  INTEGER NOT NULL CHECK (duration_secs >= 0),
    maps           INTEGER NOT NULL CHECK (maps >= 0),
    data           TEXT NOT NULL,
    saved_at       INTEGER NOT NULL,
    PRIMARY KEY (game, id)
);

CREATE INDEX farming_sessions_by_league ON farming_sessions (game, league, started_at);
