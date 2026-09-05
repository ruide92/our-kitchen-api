-- 004: Weekly Plans and Meals
-- Normative: docs/DATA_MODEL_V4.md sections 16-19

-- ========== WEEKLY_PLANS ==========
CREATE TABLE IF NOT EXISTS weekly_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  generation_mode TEXT,
  created_by_user_id UUID REFERENCES users(id),
  confirmed_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Partial unique: only one ACTIVE plan per family+week; DRAFT candidates allowed
CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_plans_active
  ON weekly_plans(family_id, week_start_date)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_weekly_plans_family ON weekly_plans(family_id);

-- ========== WEEKLY_PLAN_ITEMS ==========
CREATE TABLE IF NOT EXISTS weekly_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weekly_plan_id UUID NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST','LUNCH','DINNER')),
  recipe_id UUID NOT NULL REFERENCES recipes(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  locked BOOLEAN NOT NULL DEFAULT false,
  added_by_user_id UUID REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'GENERATED' CHECK (source IN ('GENERATED','MANUAL','SWAP')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_items_plan ON weekly_plan_items(weekly_plan_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_items_date ON weekly_plan_items(plan_date, meal_type);

-- ========== MEALS ==========
CREATE TABLE IF NOT EXISTS meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  meal_date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('BREAKFAST','LUNCH','DINNER')),
  diners_count INTEGER NOT NULL DEFAULT 2 CHECK (diners_count >= 1),
  status TEXT NOT NULL DEFAULT 'PLANNING' CHECK (status IN ('PLANNING','CONFIRMED','COOKING','COMPLETED','CANCELLED')),
  source_weekly_plan_id UUID REFERENCES weekly_plans(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, meal_date, meal_type)
);
CREATE INDEX IF NOT EXISTS idx_meals_family_date ON meals(family_id, meal_date);

-- ========== MEAL_ITEMS ==========
CREATE TABLE IF NOT EXISTS meal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES recipes(id),
  selected_by_user_id UUID REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('WEEKLY_PLAN','MANUAL','RANDOM','WISH')),
  servings DECIMAL(6,2) NOT NULL DEFAULT 2,
  sort_order INTEGER NOT NULL DEFAULT 0,
  recipe_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meal_id, recipe_id)
);
CREATE INDEX IF NOT EXISTS idx_meal_items_meal ON meal_items(meal_id);
