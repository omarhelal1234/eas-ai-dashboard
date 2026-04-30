-- ============================================================
-- EAS AI Adoption — Migration 057: Self-serve profile RPC.
-- Single SECURITY DEFINER entry point for the profile.html page.
-- Lets the authenticated caller update their own name, organization
-- (sector / department / practice), and GH licensed-tool active flag.
--
-- Deliberately scoped (per code review):
--   * `role` is NOT self-editable here. Role management stays in
--     admin.html to avoid privilege escalation via this endpoint.
--   * GH toggle drives copilot_users.github_copilot_status, not
--     copilot_users.status (which is the license-provisioning state
--     and is owned by the licensing workflow, not the user).
--   * Org changes mirror sector_id / department_id / practice into
--     copilot_users so the licensed-tool roster stays consistent
--     with users (Q4-B). The populate_sector_id trigger on
--     copilot_users keeps the chain aligned when any of those keys
--     change.
--
-- Password changes go through supabase.auth.updateUser, NOT this RPC.
-- ============================================================

CREATE OR REPLACE FUNCTION update_my_profile(p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          UUID;
  v_user_id      UUID;
  v_email        TEXT;
  v_applied      TEXT[] := ARRAY[]::TEXT[];
  v_warnings     TEXT[] := ARRAY[]::TEXT[];
  v_name         TEXT;
  v_practice     TEXT;
  v_sector_id    UUID;
  v_dept_id      UUID;
  v_gh_active    BOOLEAN;
  v_complete_res JSONB;
  v_copilot_hit  INTEGER;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT id, email INTO v_user_id, v_email FROM users WHERE auth_id = v_uid LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_users_row');
  END IF;

  -- ---- name ----
  IF p_changes ? 'name' THEN
    v_name := NULLIF(trim(p_changes->>'name'), '');
    IF v_name IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_name');
    END IF;
    UPDATE users SET name = v_name WHERE id = v_user_id;
    v_applied := array_append(v_applied, 'name');
  END IF;

  -- ---- organization (sector / department / practice) ----
  -- Reuse complete_profile for the chain validation. It writes
  -- users.sector_id, users.department_id, users.practice and flips
  -- profile_completed = true. Only call when at least one of the
  -- three keys is present in p_changes.
  IF (p_changes ? 'sector_id') OR (p_changes ? 'department_id') OR (p_changes ? 'practice') THEN
    -- Pull current values for any key the caller did NOT send so we
    -- pass a complete chain to complete_profile.
    SELECT
      COALESCE((p_changes->>'sector_id')::uuid,     sector_id),
      COALESCE((p_changes->>'department_id')::uuid, department_id),
      COALESCE(NULLIF(p_changes->>'practice',''),   practice)
    INTO v_sector_id, v_dept_id, v_practice
    FROM users WHERE id = v_user_id;

    IF v_sector_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'sector_required');
    END IF;

    v_complete_res := complete_profile(v_sector_id, v_dept_id, v_practice);
    IF (v_complete_res->>'success')::boolean IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'org_validation_failed',
        'detail', v_complete_res
      );
    END IF;

    -- Q4-B sync: mirror sector_id / department_id / practice into copilot_users
    -- (matched by lowercased email). Only the keys the caller actually changed
    -- are written. The populate_sector_id trigger on copilot_users keeps the
    -- chain consistent when any of these are set.
    IF p_changes ? 'sector_id' THEN
      UPDATE copilot_users SET sector_id = v_sector_id, updated_at = now()
       WHERE lower(email) = lower(v_email);
    END IF;
    IF p_changes ? 'department_id' THEN
      UPDATE copilot_users SET department_id = v_dept_id, updated_at = now()
       WHERE lower(email) = lower(v_email);
    END IF;
    IF p_changes ? 'practice' AND v_practice IS NOT NULL THEN
      UPDATE copilot_users SET practice = v_practice, updated_at = now()
       WHERE lower(email) = lower(v_email);
    END IF;

    v_applied := array_append(v_applied, 'organization');
  END IF;

  -- ---- GH licensed-tool active flag ----
  -- Drives copilot_users.github_copilot_status ('active' | 'inactive').
  -- copilot_users.status is the license-provisioning state and is owned
  -- by the licensing workflow, not editable here.
  IF p_changes ? 'gh_access_active' THEN
    v_gh_active := (p_changes->>'gh_access_active')::boolean;
    UPDATE copilot_users
       SET github_copilot_status = CASE WHEN v_gh_active THEN 'active' ELSE 'inactive' END,
           github_copilot_activated_at = CASE WHEN v_gh_active THEN COALESCE(github_copilot_activated_at, now()) ELSE github_copilot_activated_at END,
           updated_at = now()
     WHERE lower(email) = lower(v_email);
    GET DIAGNOSTICS v_copilot_hit = ROW_COUNT;
    IF v_copilot_hit = 0 THEN
      v_warnings := array_append(v_warnings, 'no_licensed_user_row');
    ELSE
      v_applied := array_append(v_applied, 'gh_access');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', to_jsonb(v_applied),
    'warnings', to_jsonb(v_warnings)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION update_my_profile(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_my_profile(jsonb) TO authenticated;

COMMENT ON FUNCTION update_my_profile(jsonb) IS
  'Self-serve profile update for the authenticated caller. Accepts JSONB with any of: name, sector_id, department_id, practice, gh_access_active. Returns {ok:true, applied[], warnings[]} on success or {ok:false, reason} on validation failure. Role changes are NOT supported here (admin-only). GH toggle drives copilot_users.github_copilot_status; copilot_users.status is owned by the licensing workflow.';
