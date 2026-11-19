-- Location Atlas (PoE 1): the campaign hook is fed by an on-demand reader for PoE 1 (the
-- Session Intelligence tracker only runs for PoE 2). It resumes from the stored log position;
-- events stay keyed by (game, log_key, log_offset, kind), so re-reading never duplicates.
ALTER TABLE campaign_state ADD COLUMN log_path TEXT;
ALTER TABLE campaign_state ADD COLUMN log_key TEXT;
ALTER TABLE campaign_state ADD COLUMN log_offset INTEGER;
