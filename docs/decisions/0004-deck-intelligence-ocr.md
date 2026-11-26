# 0004 — Deck Intelligence: Client.txt first, one-shot screenshots with Windows OCR

Date: 2026-11-26 · Status: accepted · Module: Deck Intelligence (PoE 1), docs/modules/deck-intelligence.md

## Context

The user opens Stacked Decks by dropping the cards on the ground and wants every card recorded without changing
that habit. PoE 1 writes `Card drawn from the deck: <divination>{Name}` to Client.txt (checked on a real log), but it
is unknown whether ground drops are included. The fallback is reading the ground labels from a screenshot.

## Decision

1. **Client.txt is the primary source** and reuses the shared reader (`session::reader`) and the PoE 1 log
   resolution of the Location Atlas. It reads only while a session runs; otherwise the thread sleeps on a condition
   variable. Each line gets a stable id (file key + byte offset) so live tracking, restarts and imports never count a
   line twice.
2. **Screenshots only on the user's key**, registered only while PoE 1 is in the foreground (same rule as the
   price-check key). One GDI copy of the game window (generalised `loot::inventory::capture`), cropped to a
   user-set region. No continuous capture, no memory reading, no input, nothing uploaded.
3. **OCR = Windows.Media.Ocr** through the existing `windows` crate (features `Media_Ocr`, `Graphics_Imaging`,
   `Storage_Streams`, `Globalization`, `Foundation*`). Local, part of Windows, no new crate and no model download.
   Loot Journal found it poor for one- and two-digit stack numbers; card names are whole words, which it reads well
   (synthetic test: all labels exact). Alternatives considered: Tesseract (large native dependency + language data),
   cloud OCR (uploads screenshots — rejected).
4. **Matching, not trusting OCR**: names are matched by edit distance against the card list; thresholds decide
   confirmed / review / unrecognized; ambiguous or possibly duplicated reads always go to the user.

## Consequences

- First real screenshot (25 cards, a blue-label loot filter): all 25 found, none wrong, 2 sent to review, no false
  entries after raising the "unrecognized" default to 60 %. More filters / resolutions still to test; the UI never
  treats an uncertain read as confirmed.
- Verified 2026-11-26: ground drops are NOT logged, so screenshots are the only way to track ground openings; Client.txt covers inventory openings.
- Schema v13 (migration 0013, additive). Older builds refuse a v13 database.
