-- 0.12: REGEX module — the user's saved search strings and quick slots, per game.
-- Names are unique per game (case-insensitive); `tags` is a JSON array of strings.
CREATE TABLE regex_library (
    game        TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    id          TEXT NOT NULL,
    name        TEXT NOT NULL COLLATE NOCASE,
    category    TEXT NOT NULL,
    regex       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',
    notes       TEXT NOT NULL DEFAULT '',
    favorite    INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    created_at  INTEGER NOT NULL,   -- unix s
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (game, id),
    UNIQUE (game, name)
);

-- Eight quick slots per game. A slot keeps its own copy of the string, so it
-- still works if the library entry it came from is deleted.
CREATE TABLE regex_slots (
    game       TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    slot       INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
    label      TEXT NOT NULL,
    regex      TEXT NOT NULL,
    library_id TEXT,
    PRIMARY KEY (game, slot)
);
