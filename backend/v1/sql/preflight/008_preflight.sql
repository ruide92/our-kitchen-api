-- 008 PRE-APPLICATION PREFLIGHT (read-only)
-- Run BEFORE applying 008_full_closeout.sql to Neon production.
-- Any count > 0 means STOP and get Reviewer decision on backfill strategy.

-- A. Legacy frozen meals without snapshot (008 has no recipe_snapshot column yet,
--    so ALL CONFIRMED/COOKING/COMPLETED meals are legacy snapshot risk).
SELECT COUNT(*) AS legacy_frozen_meals
FROM meals
WHERE status IN ('CONFIRMED', 'COOKING', 'COMPLETED');

-- B. Custom pantry items without display_name_override
--    (008 has no display_name_override column yet, so all ingredient_id IS NULL
--     pantry items would violate the new CHECK constraint).
SELECT COUNT(*) AS custom_pantry_without_name
FROM pantry_staples
WHERE ingredient_id IS NULL;
