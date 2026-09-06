-- 010: User preferences schema
-- Aligns DATA_MODEL_V4 §7: user_preferences + association tables.
-- Allergen = recommendation hard constraint. Disliked = soft penalty.
-- Production apply requires Reviewer approval; this file is code-only.

-- ========== user_preferences ==========
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spiciness_preference INTEGER CHECK (spiciness_preference IS NULL OR spiciness_preference BETWEEN 0 AND 5),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences_family ON user_preferences(family_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);

-- ========== user_disliked_ingredients ==========
CREATE TABLE IF NOT EXISTS user_disliked_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_disliked_ingredients_family_user ON user_disliked_ingredients(family_id, user_id);
CREATE INDEX IF NOT EXISTS idx_disliked_ingredients_ingredient ON user_disliked_ingredients(ingredient_id);

-- ========== user_allergens ==========
CREATE TABLE IF NOT EXISTS user_allergens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allergen_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id, allergen_code)
);

CREATE INDEX IF NOT EXISTS idx_user_allergens_family_user ON user_allergens(family_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_allergens_allergen ON user_allergens(allergen_code);

-- ========== user_diet_tags ==========
CREATE TABLE IF NOT EXISTS user_diet_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, user_id, tag_code)
);

CREATE INDEX IF NOT EXISTS idx_user_diet_tags_family_user ON user_diet_tags(family_id, user_id);
