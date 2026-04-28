-- ============================================================
-- EAS AI Adoption — Migration 045: Phases 1–4 codex review fixes
-- Resolves the BLOCKER + HIGH findings from the second-pass codex
-- review of org-hierarchy phases 1–4.
--
--  B2  sync_user_role_from_org(UUID, TEXT) had default PUBLIC EXECUTE
--      after 043 recreated it. Anon callers could trigger promotions.
--      → REVOKE FROM PUBLIC, anon. Tighten the auth check so a NULL
--        auth.uid() also blocks the call (no anon path at all).
--  B3  move_unit/move_practice forbidden branch was skipped for callers
--      with no users row (NULL role → IF NULL → not entered).
--      → require non-NULL role + matching auth.uid().
--  P1  034 team_lead SELECT broadened to entire practice; restore
--      assignment-based scope via team_lead_assignments.
--  P1  036 prompt_library was skipped for sector_id backfill.
--      → backfill via best-effort author chain; keep orphan log.
--  P1  037 swallowed unique-constraint failure → ON CONFLICT can
--      fail at runtime. Promote duplicates to a hard error so the
--      operator resolves them before deploy.
--  P1  038 signup_contributor (now redefined in 043) skipped server-
--      side parent-child validation. Add chain validation here so
--      anon signups can't anchor to mismatched sector/unit/practice.
--  P1  039 unit summary excluded unit-direct (`practice IS NULL`)
--      tasks. Include them.
--  P1  populate_sector_id trigger preserved client sector_id when
--      practice/department couldn't resolve. Spec §5.2a says
--      override unconditionally when an anchor is supplied; an
--      unresolved anchor must error, not silently retain a stale
--      client value.
--  P3  approval label / sector_spoc pipeline split is JS-only.
--  P4  No SQL change required for orphan UI fixes (JS only).
--
-- Idempotent: every step is guarded so the migration can be re-run.
-- ============================================================

-- (B2) Lock the auth check inside sync_user_role_from_org so anon
-- can't bypass it via auth.uid() IS NULL, then strip default PUBLIC.
CREATE OR REPLACE FUNCTION sync_user_role_from_org(
  p_user_id UUID,
  p_source  TEXT DEFAULT 'auto_promote_login'
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email      TEXT;
  v_curr_role  TEXT;
  v_curr_name  TEXT;
  v_caller_uid UUID;
  v_caller_role TEXT;
  v_prac_name  TEXT;
  v_prac_id    UUID;
  v_prac_dept  UUID;
  v_dept_id    UUID;
  v_dept_sec   UUID;
  v_sec_id     UUID;
  v_target_role TEXT;
  v_target_path JSONB;
BEGIN
  v_caller_uid := auth.uid();

  -- Authorization. Allowed contexts:
  --   (a) trigger context (pg_trigger_depth() > 0) — internal *_spoc_email triggers
  --   (b) authenticated admin caller (acts on any user_id)
  --   (c) authenticated caller acting on their own user row
  -- Anything else (incl. anon) is rejected.
  IF pg_trigger_depth() = 0 THEN
    IF v_caller_uid IS NULL THEN
      RAISE EXCEPTION 'sync_user_role_from_org: anonymous calls are not allowed';
    END IF;
    SELECT role INTO v_caller_role FROM users WHERE auth_id = v_caller_uid;
    IF v_caller_role IS DISTINCT FROM 'admin' AND NOT EXISTS (
      SELECT 1 FROM users WHERE id = p_user_id AND auth_id = v_caller_uid
    ) THEN
      RAISE EXCEPTION 'sync_user_role_from_org: caller % cannot act on user %', v_caller_uid, p_user_id;
    END IF;
  END IF;

  IF p_source NOT IN ('auto_promote_login','auto_promote_email_change','admin_assign') THEN
    RAISE EXCEPTION 'invalid source: %', p_source;
  END IF;

  SELECT email, role, name INTO v_email, v_curr_role, v_curr_name
    FROM users WHERE id = p_user_id LIMIT 1;
  IF v_email IS NULL THEN RETURN 'no_user'; END IF;

  SELECT p.name, p.id, p.department_id
    INTO v_prac_name, v_prac_id, v_prac_dept
    FROM practices p
   WHERE lower(p.practice_spoc_email) = lower(v_email)
   LIMIT 1;

  IF v_prac_name IS NOT NULL THEN
    v_target_role := 'spoc';
    SELECT sector_id INTO v_dept_sec FROM departments WHERE id = v_prac_dept;
    v_target_path := jsonb_build_object('level','practice','practice', v_prac_name, 'department_id', v_prac_dept, 'sector_id', v_dept_sec);
  ELSE
    SELECT id, sector_id INTO v_dept_id, v_dept_sec
      FROM departments WHERE lower(unit_spoc_email) = lower(v_email) LIMIT 1;
    IF v_dept_id IS NOT NULL THEN
      v_target_role := 'dept_spoc';
      v_target_path := jsonb_build_object('level','unit','department_id', v_dept_id, 'sector_id', v_dept_sec);
    ELSE
      SELECT id INTO v_sec_id FROM sectors WHERE lower(sector_spoc_email) = lower(v_email) LIMIT 1;
      IF v_sec_id IS NOT NULL THEN
        v_target_role := 'sector_spoc';
        v_target_path := jsonb_build_object('level','sector','sector_id', v_sec_id);
      END IF;
    END IF;
  END IF;

  IF v_target_role IS NULL THEN RETURN 'no_match'; END IF;
  IF v_curr_role IN ('admin','executive') THEN RETURN 'protected_role'; END IF;
  IF v_curr_role = 'sector_spoc' AND v_target_role <> 'sector_spoc' THEN RETURN 'no_demote'; END IF;
  IF v_curr_role = 'dept_spoc'   AND v_target_role NOT IN ('dept_spoc','sector_spoc') THEN RETURN 'no_demote'; END IF;
  IF v_curr_role = 'spoc'        AND v_target_role NOT IN ('spoc','dept_spoc','sector_spoc') THEN RETURN 'no_demote'; END IF;

  IF v_target_role = 'spoc' THEN
    UPDATE users SET role='spoc', practice=v_prac_name, department_id=v_prac_dept, sector_id=v_dept_sec, profile_completed=true WHERE id=p_user_id;
    INSERT INTO practice_spoc (practice, spoc_id, spoc_name, spoc_email, sector_id, is_active)
    VALUES (v_prac_name, p_user_id, v_curr_name, v_email, v_dept_sec, true)
    ON CONFLICT (spoc_id, practice) DO UPDATE SET is_active=true, spoc_name=EXCLUDED.spoc_name, spoc_email=EXCLUDED.spoc_email, sector_id=EXCLUDED.sector_id;
  ELSIF v_target_role = 'dept_spoc' THEN
    UPDATE users SET role='dept_spoc', department_id=v_dept_id, sector_id=v_dept_sec, profile_completed=true WHERE id=p_user_id;
  ELSIF v_target_role = 'sector_spoc' THEN
    UPDATE users SET role='sector_spoc', sector_id=v_sec_id, profile_completed=true WHERE id=p_user_id;
  END IF;

  INSERT INTO role_change_log (user_id, prev_role, new_role, source, org_path)
  VALUES (p_user_id, v_curr_role, v_target_role, p_source, v_target_path);

  RETURN v_target_role;
END;
$$;

REVOKE EXECUTE ON FUNCTION sync_user_role_from_org(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION sync_user_role_from_org(UUID, TEXT) TO authenticated;

-- (B3) move_unit / move_practice — require an authenticated caller with
-- a users row whose role is admin/sector_spoc/dept_spoc. NULL role no
-- longer slips through the IF NULL gate.
CREATE OR REPLACE FUNCTION move_unit(p_unit_id UUID, p_new_sector_id UUID)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_my_sector   UUID;
  v_old_sector  UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  SELECT role, sector_id INTO v_caller_role, v_my_sector
    FROM users WHERE auth_id = auth.uid() LIMIT 1;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin','sector_spoc') THEN
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
    IF v_my_sector IS NULL OR v_old_sector <> v_my_sector OR p_new_sector_id <> v_my_sector THEN
      RETURN jsonb_build_object('success', false, 'error', 'sector_spoc can only move within own sector');
    END IF;
  END IF;

  UPDATE departments SET sector_id = p_new_sector_id WHERE id = p_unit_id;
  RETURN jsonb_build_object('success', true, 'unit_id', p_unit_id, 'new_sector_id', p_new_sector_id);
END;
$$;

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
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  SELECT role, sector_id, department_id INTO v_caller_role, v_my_sector, v_my_dept
    FROM users WHERE auth_id = auth.uid() LIMIT 1;

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin','sector_spoc','dept_spoc') THEN
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
    IF v_my_sector IS NULL OR v_old_sector <> v_my_sector OR v_new_sector <> v_my_sector THEN
      RETURN jsonb_build_object('success', false, 'error', 'sector_spoc can only move within own sector');
    END IF;
  ELSIF v_caller_role = 'dept_spoc' THEN
    IF v_my_dept IS NULL OR v_old_dept <> v_my_dept OR p_new_department_id <> v_my_dept THEN
      RETURN jsonb_build_object('success', false, 'error', 'dept_spoc can only move within own unit');
    END IF;
  END IF;

  UPDATE practices SET department_id = p_new_department_id WHERE id = p_practice_id;
  RETURN jsonb_build_object('success', true, 'practice_id', p_practice_id, 'new_department_id', p_new_department_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION move_unit(UUID, UUID)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION move_practice(UUID, UUID)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION move_unit(UUID, UUID)         TO authenticated;
GRANT  EXECUTE ON FUNCTION move_practice(UUID, UUID)     TO authenticated;

-- (P1 / 034) Restore assignment-based team_lead SELECT scope on
-- submission_approvals — broadened to whole practice in 034.
-- team_lead_assignments stores member_email (not user_id) per sql/020.
DROP POLICY IF EXISTS "submission_approvals_team_lead_select" ON submission_approvals;
CREATE POLICY "submission_approvals_team_lead_select" ON submission_approvals
  FOR SELECT USING (
    get_user_role() = 'team_lead'
    AND submitted_by_email IN (
      SELECT member_email
        FROM team_lead_assignments
       WHERE team_lead_id = get_current_user_id()
    )
  );

-- (P1 / 033 trigger) Override sector_id when an anchor resolves; raise
-- when the anchor is supplied but invalid. Honour client sector_id only
-- when both anchors are NULL (true sector-direct write).
CREATE OR REPLACE FUNCTION populate_sector_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved UUID;
  v_has_dept BOOLEAN;
  v_dept_id  UUID;
BEGIN
  IF NEW.practice IS NOT NULL THEN
    SELECT d.sector_id INTO v_resolved
      FROM practices p
      JOIN departments d ON d.id = p.department_id
     WHERE p.name = NEW.practice
     LIMIT 1;
    IF v_resolved IS NULL THEN
      RAISE EXCEPTION 'populate_sector_id: practice "%" does not resolve to a sector', NEW.practice;
    END IF;
    NEW.sector_id := v_resolved;
    RETURN NEW;
  END IF;

  v_has_dept := EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = TG_TABLE_SCHEMA
       AND table_name   = TG_TABLE_NAME
       AND column_name  = 'department_id'
  );
  IF v_has_dept THEN
    EXECUTE 'SELECT ($1).department_id::uuid' INTO v_dept_id USING NEW;
    IF v_dept_id IS NOT NULL THEN
      SELECT sector_id INTO v_resolved FROM departments WHERE id = v_dept_id LIMIT 1;
      IF v_resolved IS NULL THEN
        RAISE EXCEPTION 'populate_sector_id: department_id % does not resolve to a sector', v_dept_id;
      END IF;
      NEW.sector_id := v_resolved;
      RETURN NEW;
    END IF;
  END IF;

  -- Both anchors NULL → trust client-supplied sector_id (flat-sector write).
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION populate_sector_id() FROM PUBLIC, anon, authenticated;

-- (P1 / 037) Fail loud when the unique constraint required by ON CONFLICT
-- in sync_user_role_from_org is missing. Operators must resolve duplicates
-- before deploy; runtime ON CONFLICT failure is the worse outcome.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'practice_spoc_user_practice_uq'
  ) THEN
    BEGIN
      ALTER TABLE practice_spoc
        ADD CONSTRAINT practice_spoc_user_practice_uq UNIQUE (spoc_id, practice);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION
        'practice_spoc_user_practice_uq cannot be added — duplicate (spoc_id, practice) rows exist. Resolve manually before re-running migration 045.';
    END;
  END IF;
END$$;

-- (P1 / 036) Backfill prompt_library.sector_id where the author's sector
-- can be derived. Idempotent: only updates rows where sector_id IS NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'prompt_library' AND column_name = 'sector_id'
  ) THEN
    -- prompt_library.created_by references auth.users(id), so join on
    -- public.users.auth_id (not public.users.id). Verified against
    -- sql/005_prompt_library.sql.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'prompt_library' AND column_name = 'created_by'
    ) THEN
      UPDATE prompt_library pl
         SET sector_id = u.sector_id
        FROM users u
       WHERE pl.created_by = u.auth_id
         AND pl.sector_id IS NULL
         AND u.sector_id IS NOT NULL;
    END IF;

    -- Anything still unresolved → log to migration_orphans (de-duplicated by source_id).
    INSERT INTO migration_orphans (source_table, source_id, reason)
    SELECT 'prompt_library', pl.id, 'sector_id unresolved post-backfill'
      FROM prompt_library pl
     WHERE pl.sector_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM migration_orphans mo
          WHERE mo.source_table = 'prompt_library' AND mo.source_id = pl.id
       );
  END IF;
END$$;

-- (P1 / 039) Unit summary must include unit-direct (`practice IS NULL`)
-- tasks logged by a contributor whose department_id matches the unit.
CREATE OR REPLACE FUNCTION get_unit_summary(p_sector_id UUID, p_quarter_id TEXT DEFAULT NULL)
RETURNS TABLE (
  department_id   UUID,
  department_name TEXT,
  unit_spoc       TEXT,
  contributors    INT,
  tasks           INT,
  hours_saved     NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    d.id,
    d.name,
    d.unit_spoc_name,
    (SELECT count(DISTINCT cu.email)::INT
       FROM copilot_users cu
      WHERE cu.department_id = d.id
         OR cu.practice IN (SELECT name FROM practices WHERE department_id = d.id)),
    (SELECT count(*)::INT FROM tasks t
       WHERE t.sector_id = p_sector_id
         AND t.approval_status = 'approved'
         AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
         AND (
           t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
           OR (
             t.practice IS NULL
             AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id)
           )
         )),
    COALESCE((SELECT sum(t.time_saved) FROM tasks t
       WHERE t.sector_id = p_sector_id
         AND t.approval_status = 'approved'
         AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
         AND (
           t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
           OR (
             t.practice IS NULL
             AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id)
           )
         )), 0)
  FROM departments d
 WHERE d.sector_id = p_sector_id
   AND d.is_active
 ORDER BY d.name;
$$;

GRANT EXECUTE ON FUNCTION get_unit_summary(UUID, TEXT) TO authenticated;

-- (P1 / 038) signup_contributor: add server-side parent-child validation
-- so anon callers can't anchor to mismatched sector/unit/practice. Every
-- other safeguard from 043 (identity + email check, idempotency,
-- structured errors, sync_user_role_from_org) is preserved.
DROP FUNCTION IF EXISTS public.signup_contributor(uuid, text, text, text, text, boolean, uuid, uuid);

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
  v_caller_uid  UUID;
  v_auth_email  TEXT;
  v_dept_sec    UUID;
  v_pra_dept    UUID;
  v_pra_dsec    UUID;
BEGIN
  v_caller_uid := auth.uid();

  IF v_caller_uid IS NOT NULL THEN
    IF v_caller_uid <> p_auth_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'auth_id mismatch — caller must match the signing-up user');
    END IF;
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_caller_uid LIMIT 1;
    IF v_auth_email IS NULL OR lower(v_auth_email) <> lower(p_email) THEN
      RETURN jsonb_build_object('success', false, 'error', 'email mismatch — must match auth.users.email');
    END IF;
  ELSE
    SELECT email INTO v_auth_email FROM auth.users WHERE id = p_auth_id LIMIT 1;
    IF v_auth_email IS NULL OR lower(v_auth_email) <> lower(p_email) THEN
      RETURN jsonb_build_object('success', false, 'error', 'auth_id/email pair not found');
    END IF;
  END IF;

  -- Hierarchy chain validation. sector_id is required for any non-NULL
  -- anchor (signup must always pick a sector at minimum). Department/
  -- practice, when supplied, must roll up to the same sector.
  IF p_sector_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sectors WHERE id = p_sector_id AND is_active) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid sector_id');
  END IF;

  IF p_department_id IS NOT NULL THEN
    SELECT sector_id INTO v_dept_sec FROM departments WHERE id = p_department_id AND is_active LIMIT 1;
    IF v_dept_sec IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid department_id');
    END IF;
    IF p_sector_id IS NOT NULL AND v_dept_sec <> p_sector_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'department does not belong to sector');
    END IF;
  END IF;

  IF p_practice IS NOT NULL THEN
    SELECT p.department_id, d.sector_id INTO v_pra_dept, v_pra_dsec
      FROM practices p
      JOIN departments d ON d.id = p.department_id
     WHERE p.name = p_practice
       AND p.is_active
       AND d.is_active
       AND (p_department_id IS NULL OR p.department_id = p_department_id)
       AND (p_sector_id IS NULL OR d.sector_id = p_sector_id)
     LIMIT 1;
    IF v_pra_dept IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid practice for this sector/department');
    END IF;
  END IF;

  -- Idempotency
  SELECT id INTO v_user_id FROM users WHERE auth_id = p_auth_id LIMIT 1;
  IF v_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'user_id', v_user_id, 'idempotent', true);
  END IF;

  v_status := CASE WHEN p_has_copilot THEN 'access granted' ELSE 'pending' END;

  INSERT INTO public.users (
    auth_id, email, name, role, practice, department_id, sector_id, is_active, profile_completed
  )
  VALUES (
    p_auth_id, p_email, p_name, 'contributor',
    p_practice, p_department_id, p_sector_id,
    true,
    (p_practice IS NOT NULL OR p_department_id IS NOT NULL OR p_sector_id IS NOT NULL)
  )
  RETURNING id INTO v_user_id;

  INSERT INTO public.copilot_users (
    practice, name, email, role_skill, status, has_logged_task, department_id, sector_id
  )
  VALUES (
    p_practice, p_name, p_email, p_skill, v_status, false, p_department_id, p_sector_id
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

  v_promoted_to := sync_user_role_from_org(v_user_id, 'auto_promote_login');

  RETURN jsonb_build_object(
    'success', true, 'user_id', v_user_id, 'copilot_id', v_copilot_id,
    'status', v_status, 'promoted_to', v_promoted_to
  );

EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'duplicate signup');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.signup_contributor(uuid, text, text, text, text, boolean, uuid, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.signup_contributor(uuid, text, text, text, text, boolean, uuid, uuid) TO anon, authenticated;

-- (P3 / 039) Extend get_org_leaderboard with efficiency_pct + quality_avg
-- columns (§10.2). Efficiency = approved_hours / submitted_hours · 100 over
-- the scope. Quality_avg = mean(quality_rating) over approved tasks where the
-- column is populated. Backwards-compatible: the existing 5 columns remain.
DROP FUNCTION IF EXISTS get_org_leaderboard(TEXT, TEXT);

CREATE OR REPLACE FUNCTION get_org_leaderboard(p_level TEXT, p_quarter_id TEXT DEFAULT NULL)
RETURNS TABLE (
  scope_id        UUID,
  scope_name      TEXT,
  contributors    INT,
  tasks           INT,
  hours_saved     NUMERIC,
  efficiency_pct  NUMERIC,
  quality_avg     NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_has_quality BOOLEAN;
BEGIN
  v_has_quality := EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tasks' AND column_name='quality_rating'
  );

  IF p_level = 'sector' THEN
    RETURN QUERY
      SELECT
        s.id,
        s.name,
        (SELECT count(DISTINCT cu.email)::INT FROM copilot_users cu WHERE cu.sector_id = s.id),
        (SELECT count(*)::INT FROM tasks t
           WHERE t.sector_id = s.id
             AND t.approval_status = 'approved'
             AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)),
        COALESCE((SELECT sum(t.time_saved) FROM tasks t
           WHERE t.sector_id = s.id
             AND t.approval_status = 'approved'
             AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)), 0),
        (SELECT CASE WHEN sum(t.time_saved) > 0
                 THEN round(100.0 * sum(CASE WHEN t.approval_status='approved' THEN t.time_saved ELSE 0 END) / NULLIF(sum(t.time_saved),0), 1)
                 ELSE NULL END
           FROM tasks t
          WHERE t.sector_id = s.id
            AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)),
        CASE WHEN v_has_quality THEN
          (SELECT round(avg(t.quality_rating)::numeric, 2)
             FROM tasks t
            WHERE t.sector_id = s.id
              AND t.approval_status = 'approved'
              AND t.quality_rating IS NOT NULL
              AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id))
        ELSE NULL END
      FROM sectors s
      WHERE s.is_active
      ORDER BY 5 DESC NULLS LAST;
  ELSIF p_level = 'unit' THEN
    RETURN QUERY
      SELECT
        d.id,
        d.name,
        (SELECT count(DISTINCT cu.email)::INT FROM copilot_users cu
           WHERE cu.department_id = d.id
              OR cu.practice IN (SELECT name FROM practices WHERE department_id = d.id)),
        (SELECT count(*)::INT FROM tasks t
           WHERE t.approval_status = 'approved'
             AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
             AND (
               t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
               OR (t.practice IS NULL AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id))
             )),
        COALESCE((SELECT sum(t.time_saved) FROM tasks t
           WHERE t.approval_status = 'approved'
             AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
             AND (
               t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
               OR (t.practice IS NULL AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id))
             )), 0),
        (SELECT CASE WHEN sum(t.time_saved) > 0
                 THEN round(100.0 * sum(CASE WHEN t.approval_status='approved' THEN t.time_saved ELSE 0 END) / NULLIF(sum(t.time_saved),0), 1)
                 ELSE NULL END
           FROM tasks t
          WHERE (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
            AND (
              t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
              OR (t.practice IS NULL AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id))
            )),
        CASE WHEN v_has_quality THEN
          (SELECT round(avg(t.quality_rating)::numeric, 2)
             FROM tasks t
            WHERE t.approval_status = 'approved'
              AND t.quality_rating IS NOT NULL
              AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
              AND (
                t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
                OR (t.practice IS NULL AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id))
              ))
        ELSE NULL END
      FROM departments d
      WHERE d.is_active
      ORDER BY 5 DESC NULLS LAST;
  ELSIF p_level = 'practice' THEN
    RETURN QUERY
      SELECT
        p.id,
        p.name,
        (SELECT count(DISTINCT cu.email)::INT FROM copilot_users cu WHERE cu.practice = p.name),
        (SELECT count(*)::INT FROM tasks t
           WHERE t.practice = p.name
             AND t.approval_status = 'approved'
             AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)),
        COALESCE((SELECT sum(t.time_saved) FROM tasks t
           WHERE t.practice = p.name
             AND t.approval_status = 'approved'
             AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)), 0),
        (SELECT CASE WHEN sum(t.time_saved) > 0
                 THEN round(100.0 * sum(CASE WHEN t.approval_status='approved' THEN t.time_saved ELSE 0 END) / NULLIF(sum(t.time_saved),0), 1)
                 ELSE NULL END
           FROM tasks t
          WHERE t.practice = p.name
            AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)),
        CASE WHEN v_has_quality THEN
          (SELECT round(avg(t.quality_rating)::numeric, 2)
             FROM tasks t
            WHERE t.practice = p.name
              AND t.approval_status = 'approved'
              AND t.quality_rating IS NOT NULL
              AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id))
        ELSE NULL END
      FROM practices p
      WHERE p.is_active
      ORDER BY 5 DESC NULLS LAST;
  ELSE
    RAISE EXCEPTION 'p_level must be one of sector|unit|practice (got %)', p_level;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_org_leaderboard(TEXT, TEXT) TO authenticated;

-- ---------- end migration 045 ----------
