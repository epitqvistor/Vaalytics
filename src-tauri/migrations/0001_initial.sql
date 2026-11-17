-- Vaalytics schema v1: application + per-game settings.
-- Every game-scoped table carries a `game` column constrained to known game ids,
-- so PoE 1 and PoE 2 data can never be mixed by accident.

CREATE TABLE app_settings (
    key         TEXT PRIMARY KEY NOT NULL,
    value       TEXT NOT NULL,           -- JSON-encoded
    updated_at  INTEGER NOT NULL          -- unix seconds
);

CREATE TABLE game_settings (
    game        TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,           -- JSON-encoded
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (game, key)
);
