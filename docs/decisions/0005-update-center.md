# ADR 0005 — Update Center: central, versioned game-data synchronisation

Date: 2026-11-26 · Status: accepted

## Context
Modules fetched their own game data (Deck Intelligence downloaded RePoE `base_items` into its own
cache; Crafting does the same for mod data; the Market engine owns prices). Nothing was versioned,
reviewable or restorable, and nothing told the user what changed or which modules were affected.
The user asked for one place that discovers, validates and safely applies game-data updates for both
games, with history and rollback, separate from application updates.

## Decision
1. A Rust `updates` module is the single pipeline for **versioned** datasets: provider → normalized
   entries → diff → validation → staging → transactional apply → version record → notification.
   SQLite (migration 0014) stores versions (one `installed` per dataset via a partial unique index),
   entry-level changes with before/after, checks, a permanent event history, source health, league
   profiles and official articles.
2. Existing engines with their own cache policy (Market engine, Crafting service) stay owners of their
   data. The Update Center registers them as **managed** datasets (status + "refresh" delegating to the
   engine). Re-implementing their caches would create competing copies.
3. Data with no verified structured source (Ultimatum modifiers, campaign data) is registered as
   **bundled**: shown honestly, changed only by app releases.
4. Module → dataset dependencies are declared in a static registry; affected modules are derived from it.
5. Deck Intelligence is the first consumer: its card list is now the `poe1.divination-cards` dataset.
6. Patch notes are discovered from official pathofexile.com pages and classified by deterministic rules.
   They are information only and never change data or code. No AI is used.
7. Application updates are not part of this system. A self-updater is not implemented because the
   release repository is private (an embedded token is not acceptable) and no update-signing key exists.

## Consequences
- New sources need only a `DatasetProvider` + registry entries; modules read through the store.
- Old versions are restorable until the retention policy prunes their content (history kept).
- The Market engine gained `refresh_leagues` / `leagues_meta` (thin, reuse its client and backoff).
- `decks::cards::CardService` no longer downloads; it only reads the old cache for a one-time import.
