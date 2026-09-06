-- 009: Rating identity seal
-- Family-scoped rating identity: general (meal_id IS NULL) and meal-specific are distinct.
-- Prevents cross-family overwrite and general/meal rating collision.

-- Legacy duplicate precheck (run before applying in production):
-- A. meal_id IS NULL duplicates:
--    SELECT family_id, user_id, recipe_id, COUNT(*)
--    FROM recipe_ratings WHERE meal_id IS NULL
--    GROUP BY family_id, user_id, recipe_id HAVING COUNT(*) > 1;
-- B. meal_id IS NOT NULL duplicates:
--    SELECT family_id, user_id, recipe_id, meal_id, COUNT(*)
--    FROM recipe_ratings WHERE meal_id IS NOT NULL
--    GROUP BY family_id, user_id, recipe_id, meal_id HAVING COUNT(*) > 1;
-- If either returns rows, STOP and resolve manually before applying.

-- General rating: family + user + recipe, meal_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_general_unique
  ON recipe_ratings (family_id, user_id, recipe_id)
  WHERE meal_id IS NULL;

-- Meal-specific rating: family + user + recipe + meal
CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_meal_unique
  ON recipe_ratings (family_id, user_id, recipe_id, meal_id)
  WHERE meal_id IS NOT NULL;
