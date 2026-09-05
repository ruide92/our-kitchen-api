-- 008 POST-APPLICATION VERIFICATION (read-only)
-- Run AFTER applying 008_full_closeout.sql to Neon production.
-- Any count > 0 means data integrity issue — investigate before marking 008 complete.

-- A. Frozen meals missing snapshot after 008
SELECT COUNT(*) AS frozen_meals_missing_snapshot
FROM meals
WHERE status IN ('CONFIRMED', 'COOKING', 'COMPLETED')
  AND recipe_snapshot IS NULL;

-- B. Custom pantry items with empty/missing display_name_override
SELECT COUNT(*) AS custom_pantry_invalid_name
FROM pantry_staples
WHERE ingredient_id IS NULL
  AND NULLIF(BTRIM(display_name_override), '') IS NULL;

-- C. Verify 008 tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = current_schema()
  AND table_name IN ('cooking_sessions', 'kiss_ledger', 'recipe_imports', 'wishes')
ORDER BY table_name;
