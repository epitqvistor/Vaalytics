-- Act Tracker (PoE 1): two more campaign event kinds, written by the campaign hook for game = 'poe1' only.
--   passives       one line of the player's `/passives` output (amount = the number, detail = which line:
--                  'total:<allocated>', 'ascendancy:<allocated>', 'level', 'quests', 'quest:<Quest name>')
--   respec_points  "You have received a/N Passive Respec Point(s)." (amount)
-- SQLite can't change a CHECK constraint, so the table is rebuilt with the same columns, ids, constraints and
-- indexes (ids are copied, so the status change token MAX(rowid) is unchanged). Nothing references this table.

CREATE TABLE campaign_events_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    game          TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    character_id  INTEGER REFERENCES campaign_characters (id) ON DELETE CASCADE,
    segment       TEXT NOT NULL,
    at            INTEGER NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('zone', 'passive_points', 'weapon_set_points', 'level', 'ascended', 'death', 'passives', 'respec_points')),
    area_id       TEXT,
    area_name     TEXT,
    area_level    INTEGER,
    amount        INTEGER,
    detail        TEXT,
    log_key       TEXT NOT NULL,
    log_offset    INTEGER NOT NULL,
    UNIQUE (game, log_key, log_offset, kind)
);

INSERT INTO campaign_events_new (id, game, character_id, segment, at, kind, area_id, area_name, area_level, amount, detail, log_key, log_offset)
    SELECT id, game, character_id, segment, at, kind, area_id, area_name, area_level, amount, detail, log_key, log_offset FROM campaign_events;

DROP TABLE campaign_events;
ALTER TABLE campaign_events_new RENAME TO campaign_events;

CREATE INDEX campaign_events_by_character ON campaign_events (character_id, at);
CREATE INDEX campaign_events_pending ON campaign_events (game, segment) WHERE character_id IS NULL;
