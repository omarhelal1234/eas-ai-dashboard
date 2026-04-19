-- ============================================================
-- Migration 024: signup_contributor — UPSERT instead of INSERT
-- When a new user signs up, if a copilot_users row already
-- exists for their email (seeded by Grafana/IDE sync), update
-- the profile fields and preserve all ide_* stats.
-- If no row exists, insert fresh as before.
-- ============================================================

CREATE OR REPLACE FUNCTION public.signup_contributor(
  p_auth_id     uuid,
  p_name        text,
  p_email       text,
  p_practice    text,
  p_skill       text,
  p_has_copilot boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id    UUID;
  v_copilot_id UUID;
  v_status     TEXT;
BEGIN
  -- Determine copilot status based on has_copilot flag
  v_status := CASE WHEN p_has_copilot THEN 'access granted' ELSE 'pending' END;

  -- Create users row
  INSERT INTO public.users (auth_id, email, name, role, practice, is_active)
  VALUES (p_auth_id, p_email, p_name, 'contributor', p_practice, true)
  RETURNING id INTO v_user_id;

  -- Upsert copilot_users row:
  -- If a row already exists for this email (e.g. seeded from Grafana/IDE sync),
  -- update the profile columns and preserve all ide_* statistics.
  -- If no row exists, insert a fresh one.
  INSERT INTO public.copilot_users (practice, name, email, role_skill, status, has_logged_task)
  VALUES (p_practice, p_name, p_email, p_skill, v_status, false)
  ON CONFLICT (email) DO UPDATE SET
    practice        = EXCLUDED.practice,
    name            = EXCLUDED.name,
    role_skill      = EXCLUDED.role_skill,
    status          = EXCLUDED.status,
    has_logged_task = COALESCE(copilot_users.has_logged_task, false)
  RETURNING id INTO v_copilot_id;

  RETURN jsonb_build_object(
    'success',    true,
    'user_id',    v_user_id,
    'copilot_id', v_copilot_id,
    'status',     v_status
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM
  );
END;
$$;
