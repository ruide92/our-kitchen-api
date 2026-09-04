CREATE TABLE family_cookware (
  family_id uuid NOT NULL REFERENCES families(id),
  cookware_code text NOT NULL CHECK (cookware_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  PRIMARY KEY (family_id,cookware_code)
);
