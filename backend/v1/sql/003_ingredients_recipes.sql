-- 003: Ingredients, Units, Aliases, Recipes, Recipe relations
-- Normative: docs/DATA_MODEL_V4.md sections 8-15

-- ========== UNITS ==========
CREATE TABLE IF NOT EXISTS units (
  code TEXT PRIMARY KEY,
  dimension TEXT NOT NULL CHECK (dimension IN ('MASS','VOLUME','COUNT','TEXT')),
  to_base_factor DECIMAL(12,6),
  display_name TEXT NOT NULL
);

INSERT INTO units (code, dimension, to_base_factor, display_name) VALUES
  ('g', 'MASS', 1.0, '克'),
  ('kg', 'MASS', 1000.0, '千克'),
  ('jin', 'MASS', 500.0, '斤'),
  ('ml', 'VOLUME', 1.0, '毫升'),
  ('l', 'VOLUME', 1000.0, '升'),
  ('piece', 'COUNT', NULL, '个'),
  ('root', 'COUNT', NULL, '根'),
  ('clove', 'COUNT', NULL, '瓣'),
  ('spoon', 'COUNT', NULL, '勺'),
  ('pinch', 'TEXT', NULL, '少许'),
  ('appropriate', 'TEXT', NULL, '适量')
ON CONFLICT (code) DO NOTHING;

-- ========== INGREDIENTS ==========
CREATE TABLE IF NOT EXISTS ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category_code TEXT,
  default_unit_code TEXT REFERENCES units(code),
  nutrition_reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== INGREDIENT_ALIASES ==========
CREATE TABLE IF NOT EXISTS ingredient_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  alias_name TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  UNIQUE (normalized_alias, locale)
);
CREATE INDEX IF NOT EXISTS idx_ingredient_aliases_ingredient ON ingredient_aliases(ingredient_id);

-- ========== RECIPES ==========
CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('BASE','FAMILY')),
  family_id UUID REFERENCES families(id) ON DELETE CASCADE,
  parent_recipe_id UUID REFERENCES recipes(id),
  source_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source_type IN ('SEED','MANUAL','BASE_VARIANT','KRP_IMPORT','COMMUNITY_FORK')),
  name TEXT NOT NULL,
  description TEXT,
  category_code TEXT,
  cuisine_code TEXT,
  base_servings INTEGER NOT NULL DEFAULT 2,
  cook_time_minutes INTEGER,
  difficulty INTEGER CHECK (difficulty BETWEEN 1 AND 5),
  spiciness INTEGER CHECK (spiciness BETWEEN 0 AND 5),
  sweetness INTEGER CHECK (sweetness BETWEEN 0 AND 5),
  saltiness INTEGER CHECK (saltiness BETWEEN 0 AND 5),
  sourness INTEGER CHECK (sourness BETWEEN 0 AND 5),
  oiliness INTEGER CHECK (oiliness BETWEEN 0 AND 5),
  cooking_method_code TEXT,
  protein_source_code TEXT,
  suggested_kiss INTEGER CHECK (suggested_kiss >= 0),
  visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC','PRIVATE','FAMILY')),
  created_by_user_id UUID REFERENCES users(id),
  updated_by_user_id UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT recipes_base_family_null CHECK (
    (kind = 'BASE' AND family_id IS NULL AND visibility = 'PUBLIC')
    OR (kind = 'FAMILY' AND family_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_recipes_family ON recipes(family_id) WHERE kind = 'FAMILY';
CREATE INDEX IF NOT EXISTS idx_recipes_kind ON recipes(kind);
CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category_code);

-- ========== RECIPE MULTI-VALUE RELATIONS ==========
CREATE TABLE IF NOT EXISTS recipe_meal_types (
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST','LUNCH','DINNER','SNACK')),
  PRIMARY KEY (recipe_id, meal_type)
);

CREATE TABLE IF NOT EXISTS recipe_tags (
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_code TEXT NOT NULL,
  PRIMARY KEY (recipe_id, tag_code)
);

CREATE TABLE IF NOT EXISTS recipe_cookware (
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  cookware_code TEXT NOT NULL,
  PRIMARY KEY (recipe_id, cookware_code)
);

CREATE TABLE IF NOT EXISTS recipe_allergens (
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  allergen_code TEXT NOT NULL,
  PRIMARY KEY (recipe_id, allergen_code)
);

-- ========== RECIPE_INGREDIENTS ==========
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id),
  display_name_override TEXT,
  quantity DECIMAL(12,3),
  quantity_text TEXT,
  unit_code TEXT REFERENCES units(code),
  type TEXT NOT NULL DEFAULT 'MAIN' CHECK (type IN ('MAIN','SIDE','SEASONING','GARNISH')),
  required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_ingredient ON recipe_ingredients(ingredient_id);

-- ========== RECIPE_STEPS ==========
CREATE TABLE IF NOT EXISTS recipe_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL,
  title TEXT,
  operation TEXT NOT NULL,
  duration_seconds INTEGER,
  duration_text TEXT,
  heat_code TEXT CHECK (heat_code IN ('NO_HEAT','LOW','MEDIUM_LOW','MEDIUM','MEDIUM_HIGH','HIGH','CUSTOM')),
  doneness_cue TEXT,
  tip TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_recipe_steps_recipe ON recipe_steps(recipe_id);

-- ========== RECIPE_MEDIA ==========
CREATE TABLE IF NOT EXISTS recipe_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('COVER_IMAGE','IMAGE','VIDEO')),
  asset_url TEXT,
  asset_id TEXT,
  generation_prompt TEXT,
  source_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ========== FAVORITES / RATINGS ==========
CREATE TABLE IF NOT EXISTS recipe_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, recipe_id)
);

CREATE TABLE IF NOT EXISTS recipe_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  meal_id UUID,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recipe_ratings_user_recipe ON recipe_ratings(user_id, recipe_id);

-- Deferred normative schema (business logic in later phase)
CREATE TABLE IF NOT EXISTS recipe_nutrition (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  serving_size DECIMAL(10,3),
  serving_unit TEXT,
  calories_kcal DECIMAL(10,2),
  protein_g DECIMAL(10,2),
  fat_g DECIMAL(10,2),
  carbs_g DECIMAL(10,2),
  fiber_g DECIMAL(10,2),
  sodium_mg DECIMAL(10,2),
  source TEXT DEFAULT 'ESTIMATED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id)
);

CREATE TABLE IF NOT EXISTS recipe_nutrition_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, tag_code)
);

CREATE TABLE IF NOT EXISTS recipe_traditional_diet_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, tag_code)
);

CREATE TABLE IF NOT EXISTS recipe_ingredient_alternatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_ingredient_id UUID NOT NULL REFERENCES recipe_ingredients(id) ON DELETE CASCADE,
  alternative_ingredient_id UUID REFERENCES ingredients(id),
  alternative_name TEXT,
  ratio DECIMAL(10,3),
  note TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_step_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_step_id UUID NOT NULL REFERENCES recipe_steps(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'IMAGE',
  url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_vegetable_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  category_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, category_code)
);
