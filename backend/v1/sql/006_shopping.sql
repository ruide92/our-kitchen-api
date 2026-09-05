-- Shopping lists (购物清单)
CREATE TABLE shopping_lists (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  meal_id uuid REFERENCES meals(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED','CANCELLED')),
  generated_at timestamptz,
  completed_at timestamptz,
  created_by_user_id uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shopping_lists_family_open ON shopping_lists(family_id) WHERE status = 'OPEN';

-- Shopping list items
CREATE TABLE shopping_list_items (
  id uuid PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  ingredient_id text REFERENCES ingredients(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  category text NOT NULL DEFAULT 'OTHER',
  source text NOT NULL DEFAULT 'GENERATED' CHECK (source IN ('GENERATED','MANUAL')),
  required_quantity numeric(12,3),
  required_quantity_text text,
  unit_code text,
  inventory_deducted numeric(12,3) NOT NULL DEFAULT 0,
  pantry_deducted numeric(12,3) NOT NULL DEFAULT 0,
  missing_quantity numeric(12,3),
  missing_quantity_text text,
  purchased_quantity numeric(12,3),
  is_purchased boolean NOT NULL DEFAULT false,
  needs_unit_confirmation boolean NOT NULL DEFAULT false,
  note text,
  calculation_evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shopping_list_items_list ON shopping_list_items(list_id);
