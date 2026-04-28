-- ============================================================
-- EAS AI Adoption — Migration 038: extend signup_contributor for hierarchy
-- Spec: docs/superpowers/specs/2026-04-28-org-hierarchy-design.md §7
--   * extend signup_contributor RPC with p_sector_id, p_department_id
--   * write sector_id/department_id onto users + copilot_users
--   * call sync_user_role_from_org at the end (auto-promotion on signup)
-- NOTE: actual function name is signup_contributor (not signup_contributor_upsert_grafana_stats);
--       the file 024 was named historically — we update the deployed function name.
-- ============================================================

-- 1. copilot_users.department_id may not exist (sql/001 created it without). Add nullable.
ALTER TABLE copilot_users
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_copilot_users_department ON copilot_users(department_id);

-- 1a. Extend the populate_sector_id trigger on copilot_users to also fire on department_id changes.
DROP TRIGGER IF EXISTS trg_populate_sector_copilot_users ON copilot_users;
CREATE TRIGGER trg_populate_sector_copilot_users
  BEFORE INSERT OR UPDATE OF practice, department_id, sector_id ON copilot_users
  FOR EACH ROW EXECUTE FUNCTION populate_sector_id();

-- 2. Replace signup_contributor RPC with the 8-arg signature.
--    Defaults preserve backwards compatibility for the existing 6-arg callers.
--    Drop the old 6-arg overload first to avoid ambiguous-function errors when
--    both signatures coexist (CREATE OR REPLACE only matches by full signature).
DROP FUNCTION IF EXISTS public.signup_contributor(uuid, text, text, text, text, boolean);

CREATE OR REPLACE FUNCTION public.signup_contributor(
  p_auth_id       uuid,
  p_name          text,
  p_email         text,
  p_practice      text,
  p_skill         text,
  p_has_copilot   boolean,
  p_sector_id     uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id     UUID;
  v_copilot_id  UUID;
  v_status      TEXT;
  v_promoted_to TEXT;
BEGIN
  v_status := CASE WHEN p_has_copilot THEN 'access granted' ELSE 'pending' END;

  -- users insert. Trigger populate_sector_id() canonicalises sector_id from practice/department chain.
  INSERT INTO public.users (
    auth_id, email, name, role, practice, department_id, sector_id, is_active, profile_completed
  )
  VALUES (
    p_auth_id, p_email, p_name, 'contributor',
    p_practice, p_department_id, p_sector_id,
    true,
    -- profile_completed if at least one anchor is set (practice OR department OR sector)
    (p_practice IS NOT NULL OR p_department_id IS NOT NULL OR p_sector_id IS NOT NULL)
  )
  RETURNING id INTO v_user_id;

  -- copilot_users upsert. Email-keyed (preserves the existing Grafana-sync seed semantics).
  INSERT INTO public.copilot_users (
    practice, name, email, role_skill, status, has_logged_task,
    department_id, sector_id
  )
  VALUES (
    p_practice, p_name, p_email, p_skill, v_status, false,
    p_department_id, p_sector_id
  )
  ON CONFLICT (email) DO UPDATE SET
    practice        = EXCLUDED.practice,
    name            = EXCLUDED.name,
    role_skill      = EXCLUDED.role_skill,
    status          = EXCLUDED.status,
    department_id   = COALESCE(EXCLUDED.department_id, copilot_users.department_id),
    sector_id       = COALESCE(EXCLUDED.sector_id, copilot_users.sector_id),
    has_logged_task = COALESCE(copilot_users.has_logged_task, false)
  RETURNING id INTO v_copilot_id;

  -- Auto-promote if the new user's email matches a *_spoc_email row (no-op otherwise).
  v_promoted_to := sync_user_role_from_org(v_user_id);

  RETURN jsonb_build_object(
    'success',     true,
    'user_id',     v_user_id,
    'copilot_id',  v_copilot_id,
    'status',      v_status,
    'promoted_to', v_promoted_to
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.signup_contributor(uuid, text, text, text, text, boolean, uuid, uuid) TO anon, authenticated;
