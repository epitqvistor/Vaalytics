-- 0.22: Deck Intelligence — decks opened, entered by the user (ground openings aren't in Client.txt and
-- screenshots can miss labels). NULL = not entered: confirmed cards count instead. Additive only.
ALTER TABLE deck_sessions ADD COLUMN opened_decks INTEGER CHECK (opened_decks IS NULL OR opened_decks >= 0);
