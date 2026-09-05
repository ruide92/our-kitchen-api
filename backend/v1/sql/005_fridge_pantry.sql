-- Fridge inventory items (冰箱库存)
CREATE TABLE fridge_items (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  ingredient_id text REFERENCES ingredients(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  quantity numeric(12,3),
  quantity_text text,
  unit_code text,
  storage_location text NOT NULL DEFAULT 'REFRIGERATED' CHECK (storage_location IN ('REFRIGERATED','FROZEN','PANTRY','OTHER')),
  purchase_date date,
  expiry_date date,
  note text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fridge_items_family ON fridge_items(family_id);
CREATE INDEX fridge_items_expiry ON fridge_items(family_id, expiry_date) WHERE expiry_date IS NOT NULL;

-- Pantry staples (常备食材 - assumed usually available)
CREATE TABLE pantry_staples (
  family_id uuid NOT NULL REFERENCES families(id),
  ingredient_id text REFERENCES ingredients(id),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  quantity numeric(12,3),
  unit_code text,
  assume_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(family_id, ingredient_id)
);

-- Inventory movements (audit trail for all inventory changes)
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  fridge_item_id uuid REFERENCES fridge_items(id),
  ingredient_id text REFERENCES ingredients(id),
  movement_type text NOT NULL CHECK (movement_type IN ('PURCHASE','CONSUME','WASTE','ADJUSTMENT','SHOPPING_COMPLETE')),
  quantity_delta numeric(12,3),
  unit_code text,
  reference_type text,
  reference_id uuid,
  note text,
  created_by_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_family ON inventory_movements(family_id, created_at);
