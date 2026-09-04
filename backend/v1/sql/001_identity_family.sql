CREATE TABLE users (
  id uuid PRIMARY KEY,
  wechat_openid text NOT NULL UNIQUE CHECK (length(wechat_openid) > 0),
  wechat_unionid text,
  nickname text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE families (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  invite_code text NOT NULL UNIQUE CHECK (length(invite_code) > 0),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  photo_url text,
  header_mode text NOT NULL DEFAULT 'DUAL_AVATAR' CHECK (header_mode IN ('PHOTO','DUAL_AVATAR')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE family_members (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('OWNER','ADMIN','MEMBER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEFT','REMOVED')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(family_id,user_id)
);
CREATE INDEX family_members_user_active ON family_members(user_id,family_id) WHERE status='ACTIVE';

CREATE TABLE family_settings (
  family_id uuid PRIMARY KEY REFERENCES families(id),
  default_diners integer NOT NULL DEFAULT 2 CHECK (default_diners >= 1),
  breakfast_target_count integer NOT NULL DEFAULT 2 CHECK (breakfast_target_count >= 1),
  lunch_target_count integer NOT NULL DEFAULT 2 CHECK (lunch_target_count >= 1),
  dinner_target_count integer NOT NULL DEFAULT 3 CHECK (dinner_target_count >= 1),
  default_spiciness smallint CHECK (default_spiciness BETWEEN 0 AND 5),
  repeat_strong_days integer NOT NULL DEFAULT 7,
  repeat_penalty_days integer NOT NULL DEFAULT 14,
  repeat_recover_days integer NOT NULL DEFAULT 28,
  random_default_mode text NOT NULL DEFAULT 'BALANCED' CHECK (random_default_mode IN ('BALANCED','USE_INVENTORY','TRY_DIFFERENT')),
  prefer_expiring_inventory boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (repeat_strong_days >= 0 AND repeat_penalty_days >= repeat_strong_days AND repeat_recover_days >= repeat_penalty_days)
);
