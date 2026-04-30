-- ============================================================
-- EAS AI Adoption — Migration 057: Self-serve profile RPC.
-- Single SECURITY DEFINER entry point for the profile.html page.
-- Lets the authenticated caller update their own name and organization
-- (sector / department / practice).
--
-- Deliberately scoped (per code review):
--   * `role` is NOT self-editable here. Role management stays in
--     admin.html to avoid privilege escalation via this endpoint.
--   * GH/Copilot status is NOT user-editable. copilot_users.status is
--     the license-provisioning state owned by the licensing workflow,
--     and copilot_users.github_copilot_status is automatically derived
--     from IDE telemetry by refresh_copilot_users_ide_aggregates(), so
--     a user-set value would be silently overwritten by the next sync.
--     The Licensed Tools section on profile.html is read-only.
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
  v_complete_res JSONB;
  v_unknown      TEXT[];
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Strict-keys guard: reject unknown payload keys so legacy or buggy
  -- clients fail loud instead of getting a silent "saved" response.
  -- Specifically blocks the previously-supported but now-removed
  -- 'role' and 'gh_access_active' keys (see header for rationale).
  SELECT array_agg(k) INTO v_unknown
  FROM jsonb_object_keys(p_changes) AS k
  WHERE k NOT IN ('name','sector_id','department_id','practice');
  IF v_unknown IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'unsupported_keys',
      'detail', to_jsonb(v_unknown)
    );
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
    -- For each org key: if the caller sent it (even as JSON null), use the
    -- sent value; otherwise inherit from the current row. JSON null on a
    -- present key means "intentionally clear" (e.g. sector with no units).
    -- This distinction matters: COALESCE conflates null with missing.
    SELECT
      CASE WHEN p_changes ? 'sector_id'     THEN NULLIF(p_changes->>'sector_id','')::uuid     ELSE sector_id END,
      CASE WHEN p_changes ? 'department_id' THEN NULLIF(p_changes->>'department_id','')::uuid ELSE department_id END,
      CASE WHEN p_changes ? 'practice'      THEN NULLIF(p_changes->>'practice','')            ELSE practice END
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
    IF p_changes ? 'practice' THEN
      -- v_practice may be NULL here (intentional clear when the new sector/unit
      -- has no practices). The roster row must follow so it doesn't keep a
      -- stale practice that no longer matches the user's org.
      UPDATE copilot_users SET practice = v_practice, updated_at = now()
       WHERE lower(email) = lower(v_email);
    END IF;

    v_applied := array_append(v_applied, 'organization');
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
  'Self-serve profile update for the authenticated caller. Accepts JSONB with any of: name, sector_id, department_id, practice. Returns {ok:true, applied[], warnings[]} on success or {ok:false, reason} on validation failure. Role and GH/Copilot status are NOT supported here — role is admin-only (privilege-escalation risk) and GH status is auto-derived from IDE telemetry.';
