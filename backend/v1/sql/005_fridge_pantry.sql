-- 005: Fridge, Pantry, Inventory Movements
-- Normative: docs/DATA_MODEL_V4.md sections 20-22, 24

-- ========== FRIDGE_ITEMS ==========
CREATE TABLE IF NOT EXISTS fridge_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id),
  display_name_override TEXT,
  quantity DECIMAL(12,3),
  quantity_text TEXT,
  unit_code TEXT REFERENCES units(code),
  storage_location TEXT NOT NULL DEFAULT 'REFRIGERATED'
    CHECK (storage_location IN ('REFRIGERATED','FROZEN','ROOM_TEMP','OTHER')),
  purchase_date DATE,
  expiry_date DATE,
  note TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_fridge_items_family ON fridge_items(family_id);
CREATE INDEX IF NOT EXISTS idx_fridge_items_ingredient ON fridge_items(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_fridge_items_expiry ON fridge_items(expiry_date);

-- ========== PANTRY_STAPLES ==========
CREATE TABLE IF NOT EXISTS pantry_staples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id),
  quantity DECIMAL(12,3),
  quantity_text TEXT,
  unit_code TEXT REFERENCES units(code),
  assume_available BOOLEAN NOT NULL DEFAULT true,
  updated_by_user_id UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_pantry_staples_family ON pantry_staples(family_id);

-- ========== INVENTORY_MOVEMENTS ==========
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  fridge_item_id UUID REFERENCES fridge_items(id) ON DELETE SET NULL,
  ingredient_id UUID REFERENCES ingredients(id),
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('PURCHASE_IN','MANUAL_IN','COOK_OUT','MANUAL_ADJUST','WASTE_OUT')),
  quantity_delta DECIMAL(12,3) NOT NULL,
  unit_code TEXT REFERENCES units(code),
  meal_id UUID REFERENCES meals(id),
  shopping_item_id UUID,
  performed_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_family ON inventory_movements(family_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_ingredient ON inventory_movements(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type ON inventory_movements(movement_type);
