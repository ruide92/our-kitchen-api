-- Meals (本餐菜单 - the real upstream for shopping/cooking/inventory)
CREATE TABLE meals (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  meal_date date NOT NULL,
  meal_type text NOT NULL CHECK (meal_type IN ('BREAKFAST','LUNCH','DINNER')),
  diners_count integer NOT NULL DEFAULT 2 CHECK (diners_count >= 1),
  status text NOT NULL DEFAULT 'PLANNING' CHECK (status IN ('PLANNING','CONFIRMED','COOKING','COMPLETED','CANCELLED')),
  source_weekly_plan_id uuid,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(family_id, meal_date, meal_type)
);
CREATE INDEX meals_family_date ON meals(family_id, meal_date);

-- Meal items (dishes in a meal)
CREATE TABLE meal_items (
  id uuid PRIMARY KEY,
  meal_id uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  recipe_id text NOT NULL REFERENCES recipes(id),
  servings integer NOT NULL DEFAULT 2 CHECK (servings >= 1),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','WEEKLY_PLAN','RECOMMENDATION')),
  selected_by_user_id uuid NOT NULL REFERENCES users(id),
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(meal_id, recipe_id)
);
CREATE INDEX meal_items_meal ON meal_items(meal_id);

-- Weekly plans (计划/推荐, NOT the same as meals)
CREATE TABLE weekly_plans (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  generated_by text NOT NULL DEFAULT 'MANUAL' CHECK (generated_by IN ('MANUAL','ENGINE','HYBRID')),
  created_by_user_id uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(family_id, week_start)
);

-- Weekly plan items (planned dishes for a day/meal slot)
CREATE TABLE weekly_plan_items (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  plan_date date NOT NULL,
  meal_type text NOT NULL CHECK (meal_type IN ('BREAKFAST','LUNCH','DINNER')),
  recipe_id text NOT NULL REFERENCES recipes(id),
  sort_order integer NOT NULL DEFAULT 0,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_id, plan_date, meal_type, recipe_id)
);
CREATE INDEX weekly_plan_items_plan ON weekly_plan_items(plan_id, plan_date);
