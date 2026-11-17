-- 0.9: base type of unique items (poe.ninja stash endpoints), used by Loot Intelligence
-- to rank unique bases. NULL for exchange categories.
ALTER TABLE market_items ADD COLUMN base_type TEXT;
