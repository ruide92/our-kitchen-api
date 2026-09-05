-- 008: Full product closeout extensions
-- pantry custom items, cooking sessions, kiss ledger, recipe imports, favorites/ratings/wishes

-- ===== Pantry custom items =====
ALTER TABLE pantry_staples ADD COLUMN IF NOT EXISTS display_name_override TEXT;
-- Drop old unique constraint that blocks multiple null ingredient_id
ALTER TABLE pantry_staples DROP CONSTRAINT IF EXISTS pantry_staples_family_id_ingredient_id_key;
-- Partial unique: only canonical ingredients must be unique per family; custom items use display_name
CREATE UNIQUE INDEX IF NOT EXISTS idx_pantry_canonical_unique
  ON pantry_staples(family_id, ingredient_id)
  WHERE ingredient_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pantry_custom_unique
  ON pantry_staples(family_id, COALESCE(display_name_override, ''))
  WHERE ingredient_id IS NULL;

-- ===== Cooking sessions =====
CREATE TABLE IF NOT EXISTS cooking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  meal_id UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
  started_by_user_id UUID REFERENCES users(id),
  completed_by_user_id UUID REFERENCES users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cooking_sessions_family ON cooking_sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_cooking_sessions_meal ON cooking_sessions(meal_id);

-- ===== Kiss ledger =====
CREATE TABLE IF NOT EXISTS kiss_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES users(id),
  to_user_id UUID NOT NULL REFERENCES users(id),
  meal_id UUID REFERENCES meals(id),
  recipe_id UUID REFERENCES recipes(id),
  suggested_amount INTEGER,
  actual_amount INTEGER NOT NULL DEFAULT 0 CHECK (actual_amount >= 0),
  rating_id UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kiss_ledger_family ON kiss_ledger(family_id);
CREATE INDEX IF NOT EXISTS idx_kiss_ledger_from ON kiss_ledger(from_user_id);
CREATE INDEX IF NOT EXISTS idx_kiss_ledger_to ON kiss_ledger(to_user_id);

-- ===== Recipe imports =====
CREATE TABLE IF NOT EXISTS recipe_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id),
  schema_version TEXT NOT NULL DEFAULT '2.0',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB,
  status TEXT NOT NULL DEFAULT 'PARSED' CHECK (status IN ('PARSED','NEEDS_REVIEW','VALIDATED','IMPORTED','REJECTED')),
  inferred_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  uncertain_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_recipe_id UUID REFERENCES recipes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recipe_imports_family ON recipe_imports(family_id);

-- ===== Favorites / Ratings already exist in 003 as recipe_favorites / recipe_ratings =====
-- ===== Wishes =====
CREATE TABLE IF NOT EXISTS wishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FULFILLED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wishes_user ON wishes(user_id);

-- ===== Meal snapshot for confirm =====
ALTER TABLE meals ADD COLUMN IF NOT EXISTS recipe_snapshot JSONB;
