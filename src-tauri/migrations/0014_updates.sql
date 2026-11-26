-- Vaalytics schema v14: Update Center (docs/modules/update-center.md).
-- Versioned game-data datasets, detected changes, synchronisation history,
-- source health, league profiles and official patch-note articles.
-- Game-scoped rows carry a CHECK-constrained `game` column; PoE 1 and PoE 2 never share rows.

-- Provider (source) state. Static metadata lives in code; this is health + the user's switch.
CREATE TABLE update_sources (
    provider_id       TEXT PRIMARY KEY,
    enabled           INTEGER NOT NULL DEFAULT 1,
    status            TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (status IN ('unknown', 'ok', 'warning', 'error')),
    last_attempt_at   INTEGER,
    last_success_at   INTEGER,
    last_error        TEXT,
    last_error_kind   TEXT,
    last_duration_ms  INTEGER,
    last_bytes        INTEGER
);

-- Per-dataset source state (conditional requests, last check).
CREATE TABLE update_datasets (
    dataset_id        TEXT PRIMARY KEY,
    game              TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    etag              TEXT,
    source_modified   TEXT,
    last_checked_at   INTEGER,
    last_error        TEXT
);

-- One row per stored version of a dataset. Exactly one `installed` row per dataset
-- (partial unique index). `content` is the normalized entry list (JSON); it is set to
-- NULL when the retention policy prunes an old version (metadata is kept for history).
CREATE TABLE update_versions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id        TEXT NOT NULL,
    game              TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    league            TEXT,
    format            INTEGER NOT NULL,
    label             TEXT NOT NULL,
    content_hash      TEXT NOT NULL,
    entry_count       INTEGER NOT NULL,
    content           TEXT,
    provider_id       TEXT NOT NULL,
    source_url        TEXT,
    source_version    TEXT,
    retrieved_at      INTEGER NOT NULL,
    created_at        INTEGER NOT NULL,
    installed_at      INTEGER,
    status            TEXT NOT NULL CHECK (status IN ('staged', 'installed', 'previous', 'discarded')),
    origin            TEXT NOT NULL CHECK (origin IN ('source', 'partial', 'imported')),
    validation        TEXT NOT NULL CHECK (validation IN ('passed', 'warnings', 'review', 'failed')),
    validation_notes  TEXT NOT NULL DEFAULT '[]',
    parent_id         INTEGER,
    check_id          INTEGER
);
CREATE UNIQUE INDEX update_versions_installed ON update_versions (dataset_id) WHERE status = 'installed';
CREATE INDEX update_versions_dataset ON update_versions (dataset_id, id);

-- One synchronisation run (check, sync-all, scheduled run, apply, rollback).
CREATE TABLE update_checks (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    kind              TEXT NOT NULL CHECK (kind IN ('check', 'sync', 'apply', 'rollback')),
    trigger           TEXT NOT NULL CHECK (trigger IN ('user', 'startup', 'schedule', 'module')),
    started_at        INTEGER NOT NULL,
    finished_at       INTEGER,
    status            TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed', 'interrupted')),
    summary           TEXT
);

-- Entry-level changes detected between the installed version and a staged one.
CREATE TABLE update_changes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id          INTEGER NOT NULL REFERENCES update_checks (id),
    version_id        INTEGER REFERENCES update_versions (id) ON DELETE SET NULL,
    dataset_id        TEXT NOT NULL,
    game              TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    entry_key         TEXT NOT NULL,
    entry_name        TEXT NOT NULL,
    change_type       TEXT NOT NULL CHECK (change_type IN ('added', 'modified', 'removed', 'deprecated', 'reclassified',
                          'price_updated', 'description_updated', 'metadata_updated', 'structural', 'unknown')),
    fields            TEXT NOT NULL DEFAULT '[]',
    before            TEXT,
    after             TEXT,
    after_hash        TEXT,
    confidence        TEXT NOT NULL CHECK (confidence IN ('confirmed', 'high', 'review', 'unverified')),
    requires_review   INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'applied', 'ignored', 'superseded')),
    reviewed          INTEGER NOT NULL DEFAULT 0,
    detected_at       INTEGER NOT NULL,
    resolved_at       INTEGER
);
CREATE INDEX update_changes_status ON update_changes (status, dataset_id);

-- Permanent history (never pruned automatically).
CREATE TABLE update_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ts                INTEGER NOT NULL,
    check_id          INTEGER,
    kind              TEXT NOT NULL CHECK (kind IN ('check_started', 'check_finished', 'source_ok', 'source_failed',
                          'no_changes', 'changes_detected', 'validation_failed', 'applied', 'auto_applied', 'ignored',
                          'reviewed', 'rollback', 'imported', 'articles_discovered', 'article_processed', 'interrupted',
                          'source_toggled', 'pruned')),
    game              TEXT CHECK (game IS NULL OR game IN ('poe1', 'poe2')),
    league            TEXT,
    dataset_id        TEXT,
    provider_id       TEXT,
    modules           TEXT NOT NULL DEFAULT '[]',
    from_version      INTEGER,
    to_version        INTEGER,
    status            TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'error', 'info')),
    message           TEXT NOT NULL,
    duration_ms       INTEGER
);
CREATE INDEX update_events_ts ON update_events (ts);

-- Leagues per game as seen in the league index. Never deleted: an ended league keeps its
-- profile (historical prices and sessions stay attached to their league name).
CREATE TABLE league_profiles (
    game              TEXT NOT NULL CHECK (game IN ('poe1', 'poe2')),
    league            TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    hardcore          INTEGER NOT NULL DEFAULT 0,
    first_seen_at     INTEGER NOT NULL,
    last_seen_at      INTEGER NOT NULL,
    ended_detected_at INTEGER,
    status            TEXT NOT NULL CHECK (status IN ('active', 'ended')),
    provider_id       TEXT NOT NULL,
    PRIMARY KEY (game, league)
);

-- Official articles (patch notes, announcements). `game` is NULL when the article
-- doesn't say which game it is about.
CREATE TABLE patch_articles (
    provider_id       TEXT NOT NULL,
    article_id        TEXT NOT NULL,
    game              TEXT CHECK (game IS NULL OR game IN ('poe1', 'poe2')),
    kind              TEXT NOT NULL CHECK (kind IN ('patch_notes', 'hotfix', 'announcement', 'news')),
    title             TEXT NOT NULL,
    url               TEXT NOT NULL,
    published_at      INTEGER,
    discovered_at     INTEGER NOT NULL,
    processed_at      INTEGER,
    process_error     TEXT,
    analysis          TEXT,
    reviewed          INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (provider_id, article_id)
);
CREATE INDEX patch_articles_published ON patch_articles (published_at);
