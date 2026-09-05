-- 007: Shopping evidence sources persistence
-- Add sources JSONB to shopping_list_items for audit trail of recipe origins.
-- This is an incremental migration so existing 006 installs get it via 007,
-- and fresh Neon installs get 001->007 all at once.

ALTER TABLE shopping_list_items
ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'::jsonb;
