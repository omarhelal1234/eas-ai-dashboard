-- ============================================================
-- EAS AI Adoption — Migration 037: approver routing + role auto-promote
-- Spec: docs/superpowers/specs/2026-04-28-org-hierarchy-design.md §6.4, §9
--   * approver_resolution composite type
--   * resolve_approver(p_practice, p_department_id, p_sector_id)
--   * sync_user_role_from_org(p_user_id) — also upserts practice_spoc on practice match
--   * UPDATE triggers on *_spoc_email columns (sectors, departments, practices)
--   * revoke_org_role(p_user_id) admin RPC
--   * role_change_log audit table
-- ============================================================

-- 0. role_change_log
CREATE TABLE IF NOT EXISTS role_change_log (
  id BIGSERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prev_role  TEXT,
  new_role   TEXT,
  source     TEXT NOT NULL CHECK (source IN (
                'auto_promote_login','auto_promote_email_change',
                'admin_revoke','admin_assign'
              )),
  org_path   JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_change_log_user ON role_change_log(user_id, created_at DESC);

-- 1. Composite type for resolve_approver
DROP TYPE IF EXISTS approver_resolution CASCADE;
CREATE TYPE approver_resolution AS (
  assigned_user_id UUID,
  escalation_level TEXT
);

-- 2. UNIQUE constraint required for sync_user_role_from_org's ON CONFLICT (spoc_id, practice).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practice_spoc_user_practice_uq'
  ) THEN
    BEGIN
      ALTER TABLE practice_spoc
        ADD CONSTRAINT practice_spoc_user_practice_uq UNIQUE (spoc_id, practice);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'practice_spoc_user_practice_uq could not be added — duplicate (spoc_id, practice) rows exist; resolve manually.';
    END;
  END IF;
END$$;

-- 3. Clean legacy practice_spoc rows that cannot route (no spoc_id, no email match in users).
DELETE FROM practice_spoc
 WHERE spoc_id IS NULL
   AND (
     spoc_email IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM users u WHERE lower(u.email) = lower(practice_spoc.spoc_email)
     )
   );

-- 4. resolve_approver
CREATE OR REPLACE FUNCTION resolve_approver(
  p_practice      TEXT,
  p_department_id UUID,
  p_sector_id     UUID
) RETURNS approver_resolution
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT;
  v_user_id UUID;
BEGIN
  -- (1) Practice level — multi-SPOC preserved. Only linked active user rows count.
  IF p_practice IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM practice_spoc ps
      JOIN users u ON u.id = ps.spoc_id
     WHERE ps.practice = p_practice
       AND ps.is_active = true
       AND u.is_active = true;
    IF v_count > 0 THEN
      RETURN ROW(NULL::UUID, 'practice')::approver_resolution;
    END IF;
  END IF;

  -- (2) Unit (department) SPOC fallback (single owner)
  IF p_department_id IS NOT NULL THEN
    SELECT u.id INTO v_user_id
      FROM users u
      JOIN departments d ON lower(d.unit_spoc_email) = lower(u.email)
     WHERE d.id = p_department_id AND u.is_active
     LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      RETURN ROW(v_user_id, 'unit')::approver_resolution;
    END IF;
  END IF;

  -- (3) Sector SPOC fallback (single owner)
  IF p_sector_id IS NOT NULL THEN
    SELECT u.id INTO v_user_id
      FROM users u
      JOIN sectors s ON lower(s.sector_spoc_email) = lower(u.email)
     WHERE s.id = p_sector_id AND u.is_active
     LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      RETURN ROW(v_user_id, 'sector')::approver_resolution;
    END IF;
  END IF;

  -- (4) Admin fallback
  SELECT id INTO v_user_id
    FROM users WHERE role = 'admin' AND is_active
    ORDER BY created_at LIMIT 1;
  RETURN ROW(v_user_id, 'admin')::approver_resolution;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_approver(TEXT, UUID, UUID) TO authenticated;

-- 5. sync_user_role_from_org — auto-promote based on email match, never demote.
CREATE OR REPLACE FUNCTION sync_user_role_from_org(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email      TEXT;
  v_curr_role  TEXT;
  v_curr_name  TEXT;
  v_prac_name  TEXT;
  v_prac_id    UUID;
  v_prac_dept  UUID;
  v_dept_id    UUID;
  v_dept_sec   UUID;
  v_sec_id     UUID;
  v_target_role TEXT;
  v_target_path JSONB;
BEGIN
  SELECT email, role, name INTO v_email, v_curr_role, v_curr_name
    FROM users WHERE id = p_user_id LIMIT 1;
  IF v_email IS NULL THEN RETURN 'no_user'; END IF;

  -- Highest-scope match wins: practice > unit > sector
  SELECT p.name, p.id, p.department_id
    INTO v_prac_name, v_prac_id, v_prac_dept
    FROM practices p
   WHERE lower(p.practice_spoc_email) = lower(v_email)
   LIMIT 1;

  IF v_prac_name IS NOT NULL THEN
    v_target_role := 'spoc';
    SELECT sector_id INTO v_dept_sec FROM departments WHERE id = v_prac_dept;
    v_target_path := jsonb_build_object(
      'level','practice','practice', v_prac_name,
      'department_id', v_prac_dept, 'sector_id', v_dept_sec
    );
  ELSE
    SELECT id, sector_id INTO v_dept_id, v_dept_sec
      FROM departments WHERE lower(unit_spoc_email) = lower(v_email)
      LIMIT 1;

    IF v_dept_id IS NOT NULL THEN
      v_target_role := 'dept_spoc';
      v_target_path := jsonb_build_object(
        'level','unit','department_id', v_dept_id, 'sector_id', v_dept_sec
      );
    ELSE
      SELECT id INTO v_sec_id
        FROM sectors WHERE lower(sector_spoc_email) = lower(v_email)
        LIMIT 1;

      IF v_sec_id IS NOT NULL THEN
        v_target_role := 'sector_spoc';
        v_target_path := jsonb_build_object('level','sector','sector_id', v_sec_id);
      END IF;
    END IF;
  END IF;

  IF v_target_role IS NULL THEN
    RETURN 'no_match';
  END IF;

  -- Don't touch admin/executive
  IF v_curr_role IN ('admin','executive') THEN RETURN 'protected_role'; END IF;

  -- Don't demote: only promote when target is broader-or-equal scope.
  -- Order: contributor/team_lead/viewer < spoc < dept_spoc < sector_spoc
  IF v_curr_role = 'sector_spoc' AND v_target_role <> 'sector_spoc' THEN RETURN 'no_demote'; END IF;
  IF v_curr_role = 'dept_spoc'   AND v_target_role NOT IN ('dept_spoc','sector_spoc') THEN RETURN 'no_demote'; END IF;
  IF v_curr_role = 'spoc'        AND v_target_role NOT IN ('spoc','dept_spoc','sector_spoc') THEN RETURN 'no_demote'; END IF;

  -- Apply promotion
  IF v_target_role = 'spoc' THEN
    UPDATE users SET
      role = 'spoc',
      practice = v_prac_name,
      department_id = v_prac_dept,
      sector_id = v_dept_sec,
      profile_completed = true
    WHERE id = p_user_id;

    -- Mirror of js/db.js syncPracticeSpoc(): preserve multi-SPOC routing.
    INSERT INTO practice_spoc (practice, spoc_id, spoc_name, spoc_email, sector_id, is_active)
    VALUES (v_prac_name, p_user_id, v_curr_name, v_email, v_dept_sec, true)
    ON CONFLICT (spoc_id, practice) DO UPDATE SET
      is_active  = true,
      spoc_name  = EXCLUDED.spoc_name,
      spoc_email = EXCLUDED.spoc_email,
      sector_id  = EXCLUDED.sector_id;
  ELSIF v_target_role = 'dept_spoc' THEN
    UPDATE users SET
      role = 'dept_spoc',
      department_id = v_dept_id,
      sector_id = v_dept_sec,
      profile_completed = true
    WHERE id = p_user_id;
  ELSIF v_target_role = 'sector_spoc' THEN
    UPDATE users SET
      role = 'sector_spoc',
      sector_id = v_sec_id,
      profile_completed = true
    WHERE id = p_user_id;
  END IF;

  INSERT INTO role_change_log (user_id, prev_role, new_role, source, org_path)
  VALUES (p_user_id, v_curr_role, v_target_role, 'auto_promote_login', v_target_path);

  RETURN v_target_role;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_user_role_from_org(UUID) TO authenticated;

-- 6. revoke_org_role admin RPC
CREATE OR REPLACE FUNCTION revoke_org_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_curr_role   TEXT;
  v_caller_role TEXT;
BEGIN
  SELECT role INTO v_caller_role FROM users WHERE auth_id = auth.uid();
  IF v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'revoke_org_role requires admin';
  END IF;

  SELECT role INTO v_curr_role FROM users WHERE id = p_user_id;
  IF v_curr_role NOT IN ('spoc','dept_spoc','sector_spoc') THEN
    RETURN 'no_op';
  END IF;

  UPDATE users SET role = 'contributor' WHERE id = p_user_id;
  UPDATE practice_spoc SET is_active = false WHERE spoc_id = p_user_id AND is_active = true;
  INSERT INTO role_change_log (user_id, prev_role, new_role, source)
  VALUES (p_user_id, v_curr_role, 'contributor', 'admin_revoke');
  RETURN 'revoked';
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_org_role(UUID) TO authenticated;

-- 7. UPDATE triggers on *_spoc_email columns — re-sync the new email holder
CREATE OR REPLACE FUNCTION trigger_sync_user_on_email_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_email   TEXT;
BEGIN
  IF TG_TABLE_NAME = 'sectors'         THEN v_email := NEW.sector_spoc_email;
  ELSIF TG_TABLE_NAME = 'departments'  THEN v_email := NEW.unit_spoc_email;
  ELSIF TG_TABLE_NAME = 'practices'    THEN v_email := NEW.practice_spoc_email;
  END IF;

  IF v_email IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_user_id FROM users WHERE lower(email) = lower(v_email) AND is_active LIMIT 1;
  IF v_user_id IS NOT NULL THEN
    PERFORM sync_user_role_from_org(v_user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sector_email     ON sectors;
DROP TRIGGER IF EXISTS trg_sync_department_email ON departments;
DROP TRIGGER IF EXISTS trg_sync_practice_email   ON practices;

CREATE TRIGGER trg_sync_sector_email
  AFTER UPDATE OF sector_spoc_email ON sectors
  FOR EACH ROW EXECUTE FUNCTION trigger_sync_user_on_email_change();
CREATE TRIGGER trg_sync_department_email
  AFTER UPDATE OF unit_spoc_email ON departments
  FOR EACH ROW EXECUTE FUNCTION trigger_sync_user_on_email_change();
CREATE TRIGGER trg_sync_practice_email
  AFTER UPDATE OF practice_spoc_email ON practices
  FOR EACH ROW EXECUTE FUNCTION trigger_sync_user_on_email_change();
