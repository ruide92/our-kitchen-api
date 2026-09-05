-- 006: Shopping Lists
-- Normative: docs/DATA_MODEL_V4.md sections 22-23

-- ========== SHOPPING_LISTS ==========
CREATE TABLE IF NOT EXISTS shopping_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  meal_id UUID REFERENCES meals(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED','ARCHIVED')),
  generated_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_family ON shopping_lists(family_id);
CREATE INDEX IF NOT EXISTS idx_shopping_lists_status ON shopping_lists(status);

-- ========== SHOPPING_LIST_ITEMS ==========
CREATE TABLE IF NOT EXISTS shopping_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopping_list_id UUID NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredients(id),
  display_name_override TEXT,
  required_quantity DECIMAL(12,3),
  required_quantity_text TEXT,
  unit_code TEXT REFERENCES units(code),
  inventory_deducted DECIMAL(12,3),
  pantry_deducted DECIMAL(12,3),
  missing_quantity DECIMAL(12,3),
  purchased_quantity DECIMAL(12,3),
  is_purchased BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'GENERATED' CHECK (source IN ('GENERATED','MANUAL')),
  needs_unit_confirmation BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shopping_list_items_list ON shopping_list_items(shopping_list_id);
CREATE INDEX IF NOT EXISTS idx_shopping_list_items_ingredient ON shopping_list_items(ingredient_id);
