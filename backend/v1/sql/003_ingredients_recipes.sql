-- Ingredients (canonical ingredient dictionary)
CREATE TABLE ingredients (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  category_code text NOT NULL DEFAULT 'OTHER',
  default_unit_code text,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingredients_name ON ingredients(name);

-- Recipes (BASE = public/system, FAMILY = family-owned variant)
CREATE TABLE recipes (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('BASE','FAMILY')),
  family_id uuid REFERENCES families(id),
  parent_recipe_id text REFERENCES recipes(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  category_code text NOT NULL DEFAULT 'HOT_DISH',
  cuisine_code text,
  meal_types jsonb NOT NULL DEFAULT '["LUNCH","DINNER"]'::jsonb,
  base_servings integer NOT NULL DEFAULT 2 CHECK (base_servings >= 1),
  cook_time_minutes integer,
  difficulty smallint CHECK (difficulty BETWEEN 1 AND 5),
  spiciness smallint CHECK (spiciness BETWEEN 0 AND 5),
  sweetness smallint CHECK (sweetness BETWEEN 0 AND 5),
  saltiness smallint CHECK (saltiness BETWEEN 0 AND 5),
  sourness smallint CHECK (sourness BETWEEN 0 AND 5),
  oiliness smallint CHECK (oiliness BETWEEN 0 AND 5),
  cookware jsonb NOT NULL DEFAULT '[]'::jsonb,
  cooking_method_code text,
  suggested_kiss smallint CHECK (suggested_kiss BETWEEN 1 AND 5),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  allergens jsonb NOT NULL DEFAULT '[]'::jsonb,
  cover_image_url text,
  source_type text NOT NULL DEFAULT 'SYSTEM' CHECK (source_type IN ('SYSTEM','MANUAL','BASE_VARIANT','COMMUNITY_FORK')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (kind = 'FAMILY' OR family_id IS NULL),
  CHECK (kind = 'BASE' OR family_id IS NOT NULL)
);
CREATE INDEX recipes_family_kind ON recipes(family_id, kind) WHERE deleted_at IS NULL;
CREATE INDEX recipes_category ON recipes(category_code) WHERE deleted_at IS NULL;

-- Recipe ingredients (flat list, type = MAIN/SIDE/SEASONING/GARNISH)
CREATE TABLE recipe_ingredients (
  id uuid PRIMARY KEY,
  recipe_id text NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id text REFERENCES ingredients(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  quantity numeric(12,3),
  quantity_text text,
  unit_code text,
  type text NOT NULL DEFAULT 'MAIN' CHECK (type IN ('MAIN','SIDE','SEASONING','GARNISH')),
  required boolean NOT NULL DEFAULT true,
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX recipe_ingredients_recipe ON recipe_ingredients(recipe_id, sort_order);

-- Recipe steps
CREATE TABLE recipe_steps (
  id uuid PRIMARY KEY,
  recipe_id text NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  step_no integer NOT NULL CHECK (step_no >= 1),
  title text,
  operation text NOT NULL,
  duration_seconds integer,
  duration_text text,
  heat_code text NOT NULL DEFAULT 'NO_HEAT',
  doneness_cue text,
  tip text,
  media jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(recipe_id, step_no)
);

-- Family recipe favorites (per user, per family context)
CREATE TABLE recipe_favorites (
  family_id uuid NOT NULL REFERENCES families(id),
  user_id uuid NOT NULL REFERENCES users(id),
  recipe_id text NOT NULL REFERENCES recipes(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(family_id, user_id, recipe_id)
);

-- Recipe ratings (per user, per meal context)
CREATE TABLE recipe_ratings (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  user_id uuid NOT NULL REFERENCES users(id),
  recipe_id text NOT NULL REFERENCES recipes(id),
  meal_id uuid,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(family_id, user_id, recipe_id, meal_id)
);
