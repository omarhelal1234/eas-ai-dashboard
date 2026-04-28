-- ============================================================
-- EAS AI Adoption — Migration 044: Phase 4 — complete_profile RPC, sector branding,
-- and reparent RPCs. Resolves codex review findings on profile-completion-modal.js
-- and admin-org-tree.js (client trust + reparent enforcement).
-- ============================================================

-- 1. complete_profile RPC — only the authenticated user can complete their own profile.
--    Replaces the client-side `users.update().eq('id', profile.id)` in
--    js/profile-completion-modal.js so a malicious script can't dispatch
--    `eas:profile-incomplete` with another user's id.
CREATE OR REPLACE FUNCTION complete_profile(
  p_sector_id     UUID,
  p_department_id UUID DEFAULT NULL,
  p_practice      TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       UUID;
  v_user_id   UUID;
  v_dept_sec  UUID;
  v_pra_dept  UUID;
  v_pra_dsec  UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  SELECT id INTO v_user_id FROM users WHERE auth_id = v_uid LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no users row for caller');
  END IF;

  -- Validate the sector→department→practice chain server-side (codex finding:
  -- client validateCascade is UX-only).
  IF p_sector_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'sector_id required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sectors WHERE id = p_sector_id AND is_active) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid sector_id');
  END IF;

  IF p_department_id IS NOT NULL THEN
    SELECT sector_id INTO v_dept_sec FROM departments WHERE id = p_department_id AND is_active LIMIT 1;
    IF v_dept_sec IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid department_id');
    END IF;
    IF v_dept_sec <> p_sector_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'department does not belong to sector');
    END IF;
  END IF;

  IF p_practice IS NOT NULL THEN
    -- Scope the practice lookup by the caller-supplied department/sector so duplicate
    -- practice names across the org don't resolve to the wrong row. Also filter to
    -- active departments + active practices.
    SELECT p.department_id, d.sector_id INTO v_pra_dept, v_pra_dsec
      FROM practices p
      JOIN departments d ON d.id = p.department_id
     WHERE p.name = p_practice
       AND p.is_active
       AND d.is_active
       AND (p_department_id IS NULL OR p.department_id = p_department_id)
       AND d.sector_id = p_sector_id
     LIMIT 1;
    IF v_pra_dept IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid practice for this sector/department');
    END IF;
    -- Defensive re-check (the WHERE clause above already enforces this, but make the
    -- error message specific if the chain is somehow broken).
    IF p_department_id IS NOT NULL AND v_pra_dept <> p_department_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'practice does not belong to department');
    END IF;
    IF v_pra_dsec <> p_sector_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'practice does not belong to sector');
    END IF;
  END IF;

  UPDATE users SET
    sector_id          = p_sector_id,
    department_id      = p_department_id,
    practice           = p_practice,
    profile_completed  = true
  WHERE id = v_user_id;

  -- Re-sync role in case the user's email matches a *_spoc_email row
  PERFORM sync_user_role_from_org(v_user_id, 'auto_promote_login');

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION complete_profile(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_profile(UUID, UUID, TEXT) TO authenticated;

-- 2. sectors.brand_color — hex string for per-sector tinting in the drill-down landing.
--    Idempotent: ADD COLUMN doesn't re-add a CHECK if the column already exists, so the
--    constraint is added separately via DO block + named conname guard.
ALTER TABLE sectors
  ADD COLUMN IF NOT EXISTS brand_color TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sectors_brand_color_chk') THEN
    ALTER TABLE sectors
      ADD CONSTRAINT sectors_brand_color_chk
      CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END$$;

COMMENT ON COLUMN sectors.brand_color IS 'Optional 6-digit hex color (e.g. #7c3aed) for sector tile/breadcrumb tinting.';

-- 3. move_unit RPC — reparent a unit to a different sector. Wraps the destination check
--    so a sector_spoc can ONLY move units INTO their own sector (not OUT of it, since
--    the existing departments_sector_spoc_update USING clause already restricts source
--    rows to their sector). admin can move any unit anywhere.
CREATE OR REPLACE FUNCTION move_unit(p_unit_id UUID, p_new_sector_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_my_sector   UUID;
  v_old_sector  UUID;
BEGIN
  SELECT role, sector_id INTO v_caller_role, v_my_sector
    FROM users WHERE auth_id = auth.uid() LIMIT 1;

  IF v_caller_role NOT IN ('admin','sector_spoc') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT sector_id INTO v_old_sector FROM departments WHERE id = p_unit_id;
  IF v_old_sector IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unit not found');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM sectors WHERE id = p_new_sector_id AND is_active) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid destination sector');
  END IF;

  IF v_caller_role = 'sector_spoc' THEN
    IF v_old_sector <> v_my_sector OR p_new_sector_id <> v_my_sector THEN
      RETURN jsonb_build_object('success', false, 'error', 'sector_spoc can only move within own sector');
    END IF;
  END IF;

  UPDATE departments SET sector_id = p_new_sector_id WHERE id = p_unit_id;
  RETURN jsonb_build_object('success', true, 'unit_id', p_unit_id, 'new_sector_id', p_new_sector_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION move_unit(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION move_unit(UUID, UUID) TO authenticated;

-- 4. move_practice RPC — reparent a practice to a different unit. admin or
--    sector_spoc within their own sector or dept_spoc within their own unit.
CREATE OR REPLACE FUNCTION move_practice(p_practice_id UUID, p_new_department_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_my_sector   UUID;
  v_my_dept     UUID;
  v_old_dept    UUID;
  v_old_sector  UUID;
  v_new_sector  UUID;
BEGIN
  SELECT role, sector_id, department_id INTO v_caller_role, v_my_sector, v_my_dept
    FROM users WHERE auth_id = auth.uid() LIMIT 1;

  IF v_caller_role NOT IN ('admin','sector_spoc','dept_spoc') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT department_id INTO v_old_dept FROM practices WHERE id = p_practice_id;
  IF v_old_dept IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'practice not found');
  END IF;

  SELECT sector_id INTO v_old_sector FROM departments WHERE id = v_old_dept;
  SELECT sector_id INTO v_new_sector FROM departments WHERE id = p_new_department_id AND is_active;
  IF v_new_sector IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid destination unit');
  END IF;

  IF v_caller_role = 'sector_spoc' THEN
    IF v_old_sector <> v_my_sector OR v_new_sector <> v_my_sector THEN
      RETURN jsonb_build_object('success', false, 'error', 'sector_spoc can only move within own sector');
    END IF;
  ELSIF v_caller_role = 'dept_spoc' THEN
    IF v_old_dept <> v_my_dept OR p_new_department_id <> v_my_dept THEN
      RETURN jsonb_build_object('success', false, 'error', 'dept_spoc can only move within own unit');
    END IF;
  END IF;

  UPDATE practices SET department_id = p_new_department_id WHERE id = p_practice_id;
  RETURN jsonb_build_object('success', true, 'practice_id', p_practice_id, 'new_department_id', p_new_department_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION move_practice(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION move_practice(UUID, UUID) TO authenticated;
