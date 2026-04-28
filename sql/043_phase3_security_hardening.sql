-- ============================================================
-- EAS AI Adoption — Migration 043: Phase 1-3 security hardening
-- Resolves the high/medium severity issues raised by codex review:
--   1. sync_user_role_from_org callable by any authenticated user with
--      arbitrary p_user_id → privilege-escalation. Restrict to admin or self.
--   2. signup_contributor doesn't verify p_auth_id = auth.uid() →
--      anon caller can spoof identity. Verify when auth.uid() is non-null;
--      anon path keeps existing behaviour but never lets the inserted
--      users.auth_id diverge from a session that's actually present.
--   3. departments_dept_spoc_update recursive subquery on departments →
--      potential RLS recursion. Replace with a SECURITY DEFINER helper.
--   4. revoke_org_role didn't clear sector_id/department_id/practice/
--      practice_spoc rows that drive auto-re-promotion → user got
--      re-promoted on next login. Now nulls all anchors and sets
--      profile_completed=false (forces the completion modal).
--   5. sync_user_role_from_org always logged source='auto_promote_login'
--      even from the email-change trigger. Add p_source param defaulting
--      to 'auto_promote_login'; the trigger passes 'auto_promote_email_change'.
-- ============================================================

-- ---------- (3) helper for non-recursive dept_spoc UPDATE WITH CHECK ----------

CREATE OR REPLACE FUNCTION get_user_department_sector_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.sector_id
    FROM users u
    JOIN departments d ON d.id = u.department_id
   WHERE u.auth_id = auth.uid()
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION get_user_department_sector_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_department_sector_id() TO authenticated;

DROP POLICY IF EXISTS "departments_dept_spoc_update" ON departments;
CREATE POLICY "departments_dept_spoc_update" ON departments
  FOR UPDATE USING (
    get_user_role() = 'dept_spoc' AND id = get_user_department_id()
  )
  WITH CHECK (
    get_user_role() = 'dept_spoc'
    AND id = get_user_department_id()
    AND sector_id = get_user_department_sector_id()
  );

-- ---------- (5) sync_user_role_from_org: parameterise source for accurate audit ----------

-- Drop the old 1-arg signature so the 2-arg DEFAULT version is unambiguous.
DROP FUNCTION IF EXISTS public.sync_user_role_from_org(uuid);

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
  v_target_uid UUID;
  v_prac_name  TEXT;
  v_prac_id    UUID;
  v_prac_dept  UUID;
  v_dept_id    UUID;
  v_dept_sec   UUID;
  v_sec_id     UUID;
  v_target_role TEXT;
  v_target_path JSONB;
BEGIN
  -- (1) Authorization: allowed contexts are
  --     (a) trigger context (pg_trigger_depth() > 0 — the *_spoc_email change triggers),
  --     (b) caller is admin (acts on any user_id),
  --     (c) caller is acting on their own user row.
  --   Use IS DISTINCT FROM 'admin' so a NULL caller_role (no users row) is treated as not-admin.
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NOT NULL AND pg_trigger_depth() = 0 THEN
    SELECT role INTO v_caller_role FROM users WHERE auth_id = v_caller_uid;
    IF v_caller_role IS DISTINCT FROM 'admin' AND NOT EXISTS (
      SELECT 1 FROM users WHERE id = p_user_id AND auth_id = v_caller_uid
    ) THEN
      RAISE EXCEPTION 'sync_user_role_from_org: caller % cannot act on user %', v_caller_uid, p_user_id;
    END IF;
  END IF;

  -- Validate source
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

-- Old 1-arg signature keeps working (defaults p_source='auto_promote_login')
GRANT EXECUTE ON FUNCTION sync_user_role_from_org(UUID, TEXT) TO authenticated;

-- Trigger: pass 'auto_promote_email_change' as the source for *_spoc_email UPDATEs
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
    PERFORM sync_user_role_from_org(v_user_id, 'auto_promote_email_change');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION trigger_sync_user_on_email_change() FROM PUBLIC, anon, authenticated;

-- ---------- (4) revoke_org_role: full reset so the user isn't auto-re-promoted ----------

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
  IF v_curr_role NOT IN ('spoc','dept_spoc','sector_spoc') THEN RETURN 'no_op'; END IF;

  -- Demote + null all anchors that drive auto-promotion + force profile-completion modal
  UPDATE users SET
    role = 'contributor',
    practice = NULL,
    department_id = NULL,
    sector_id = NULL,
    profile_completed = false
  WHERE id = p_user_id;

  -- Deactivate every practice_spoc row for this user
  UPDATE practice_spoc SET is_active = false WHERE spoc_id = p_user_id AND is_active = true;

  -- Clear any *_spoc_email rows pointing at this user's email so the next login /
  -- email-change trigger doesn't immediately re-promote them. Admin still reassigns
  -- the email through the Org Hierarchy admin tree if needed.
  UPDATE practices  SET practice_spoc_email = NULL
   WHERE practice_spoc_email IS NOT NULL
     AND lower(practice_spoc_email) = (SELECT lower(email) FROM users WHERE id = p_user_id);
  UPDATE departments SET unit_spoc_email = NULL
   WHERE unit_spoc_email IS NOT NULL
     AND lower(unit_spoc_email) = (SELECT lower(email) FROM users WHERE id = p_user_id);
  UPDATE sectors SET sector_spoc_email = NULL
   WHERE sector_spoc_email IS NOT NULL
     AND lower(sector_spoc_email) = (SELECT lower(email) FROM users WHERE id = p_user_id);

  INSERT INTO role_change_log (user_id, prev_role, new_role, source)
  VALUES (p_user_id, v_curr_role, 'contributor', 'admin_revoke');

  RETURN 'revoked';
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_org_role(UUID) TO authenticated;

-- ---------- (1) (2) signup_contributor: spoof check + identity verification ----------

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
BEGIN
  v_caller_uid := auth.uid();

  -- Identity verification:
  --   * Authenticated caller MUST be the same auth.users row claimed.
  --   * Anon caller is allowed for the email-confirmation flow, but the
  --     supplied p_auth_id must exist in auth.users with a matching email.
  IF v_caller_uid IS NOT NULL THEN
    IF v_caller_uid <> p_auth_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'auth_id mismatch — caller must match the signing-up user');
    END IF;
    -- Authenticated callers also must claim their own auth.users.email
    SELECT email INTO v_auth_email FROM auth.users WHERE id = v_caller_uid LIMIT 1;
    IF v_auth_email IS NULL OR lower(v_auth_email) <> lower(p_email) THEN
      RETURN jsonb_build_object('success', false, 'error', 'email mismatch — must match auth.users.email');
    END IF;
  ELSE
    -- Anon path: p_auth_id must exist in auth.users with matching email.
    SELECT email INTO v_auth_email FROM auth.users WHERE id = p_auth_id LIMIT 1;
    IF v_auth_email IS NULL OR lower(v_auth_email) <> lower(p_email) THEN
      RETURN jsonb_build_object('success', false, 'error', 'auth_id/email pair not found');
    END IF;
  END IF;

  -- Idempotency: if a users row already exists for this auth_id, return it.
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
    -- Surface the SQLSTATE so operations can distinguish RLS / FK / constraint failures.
    RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'sqlstate', SQLSTATE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.signup_contributor(uuid, text, text, text, text, boolean, uuid, uuid) TO anon, authenticated;
