-- ============================================================
-- EAS AI Adoption — Migration 034: sector_spoc role + RLS
--   * extend role CHECK on users + role_view_permissions
--   * get_user_sector_id() helper (mirror of get_user_department_id)
--   * DROP open submission_approvals SELECT and replace with role-scoped policies
--   * sector_spoc SELECT on every sector_id-bearing data table
--   * sector_spoc fallback UPDATE on submission_approvals (escalation_level='sector')
--   * contributor sector-only INSERT policies
--   * role_view_permissions seed for sector_spoc
-- Spec: docs/superpowers/specs/2026-04-28-org-hierarchy-design.md §6
-- ============================================================

-- 1. Extend role CHECK on users
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin','spoc','team_lead','contributor','viewer','executive','dept_spoc','sector_spoc'));

-- 2. Extend role CHECK on role_view_permissions
ALTER TABLE role_view_permissions DROP CONSTRAINT IF EXISTS role_view_permissions_role_check;
ALTER TABLE role_view_permissions
  ADD CONSTRAINT role_view_permissions_role_check
    CHECK (role IN ('admin','spoc','team_lead','contributor','viewer','executive','dept_spoc','sector_spoc'));

-- 3. get_user_sector_id() helper
CREATE OR REPLACE FUNCTION get_user_sector_id()
RETURNS UUID AS $$
  SELECT sector_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER
   SET search_path = public;

-- 4. Drop the over-broad SELECT policy on submission_approvals (sql/002:120) and
--    replace with role-scoped SELECT policies. Admin still has FOR ALL via 002:117.
DROP POLICY IF EXISTS "submission_approvals_read_all_authenticated" ON submission_approvals;

DROP POLICY IF EXISTS "submission_approvals_dept_spoc_select" ON submission_approvals;
CREATE POLICY "submission_approvals_dept_spoc_select" ON submission_approvals
  FOR SELECT USING (
    get_user_role() = 'dept_spoc'
    AND practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

DROP POLICY IF EXISTS "submission_approvals_spoc_select" ON submission_approvals;
CREATE POLICY "submission_approvals_spoc_select" ON submission_approvals
  FOR SELECT USING (
    get_user_role() = 'spoc' AND practice = get_user_practice()
  );

DROP POLICY IF EXISTS "submission_approvals_contributor_select" ON submission_approvals;
CREATE POLICY "submission_approvals_contributor_select" ON submission_approvals
  FOR SELECT USING (
    get_user_role() = 'contributor' AND submitted_by = get_current_user_id()
  );

DROP POLICY IF EXISTS "submission_approvals_team_lead_select" ON submission_approvals;
CREATE POLICY "submission_approvals_team_lead_select" ON submission_approvals
  FOR SELECT USING (
    get_user_role() = 'team_lead' AND practice = get_user_practice()
  );

DROP POLICY IF EXISTS "submission_approvals_executive_select" ON submission_approvals;
CREATE POLICY "submission_approvals_executive_select" ON submission_approvals
  FOR SELECT USING (
    get_user_role() = 'executive'
  );

DROP POLICY IF EXISTS "submission_approvals_viewer_select" ON submission_approvals;
CREATE POLICY "submission_approvals_viewer_select" ON submission_approvals
  FOR SELECT USING (
    get_user_role() = 'viewer' AND practice = get_user_practice()
  );

-- 4b. NEW: sector_spoc SELECT — full sector pipeline read-only
DROP POLICY IF EXISTS "submission_approvals_sector_spoc_select" ON submission_approvals;
CREATE POLICY "submission_approvals_sector_spoc_select" ON submission_approvals
  FOR SELECT USING (
    get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id()
  );

-- 4c. NEW: sector_spoc fallback UPDATE only when escalation_level = 'sector'
DROP POLICY IF EXISTS "submission_approvals_sector_spoc_update" ON submission_approvals;
CREATE POLICY "submission_approvals_sector_spoc_update" ON submission_approvals
  FOR UPDATE USING (
    get_user_role() = 'sector_spoc'
    AND sector_id = get_user_sector_id()
    AND escalation_level = 'sector'
    AND approval_status = 'spoc_review'
  )
  WITH CHECK (
    get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id()
  );

-- 5. sector_spoc SELECT on every other sector_id-bearing data table
DROP POLICY IF EXISTS "tasks_sector_spoc_select" ON tasks;
CREATE POLICY "tasks_sector_spoc_select" ON tasks
  FOR SELECT USING (get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id());

DROP POLICY IF EXISTS "accomplishments_sector_spoc_select" ON accomplishments;
CREATE POLICY "accomplishments_sector_spoc_select" ON accomplishments
  FOR SELECT USING (get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id());

DROP POLICY IF EXISTS "use_cases_sector_spoc_select" ON use_cases;
CREATE POLICY "use_cases_sector_spoc_select" ON use_cases
  FOR SELECT USING (get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id());

DROP POLICY IF EXISTS "copilot_users_sector_spoc_select" ON copilot_users;
CREATE POLICY "copilot_users_sector_spoc_select" ON copilot_users
  FOR SELECT USING (get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id());

DROP POLICY IF EXISTS "projects_sector_spoc_select" ON projects;
CREATE POLICY "projects_sector_spoc_select" ON projects
  FOR SELECT USING (get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id());

DROP POLICY IF EXISTS "prompt_library_sector_spoc_select" ON prompt_library;
CREATE POLICY "prompt_library_sector_spoc_select" ON prompt_library
  FOR SELECT USING (get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id());

DROP POLICY IF EXISTS "practice_spoc_sector_spoc_select" ON practice_spoc;
CREATE POLICY "practice_spoc_sector_spoc_select" ON practice_spoc
  FOR SELECT USING (get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id());

-- 6. users SELECT for sector_spoc
DROP POLICY IF EXISTS "sector_spoc_users_select" ON users;
CREATE POLICY "sector_spoc_users_select" ON users
  FOR SELECT USING (
    get_user_role() = 'sector_spoc'
    AND (sector_id = get_user_sector_id() OR id = get_current_user_id())
  );

-- 7. Contributor INSERT policies for flat-sector writes
DROP POLICY IF EXISTS "tasks_contributor_sector_insert" ON tasks;
CREATE POLICY "tasks_contributor_sector_insert" ON tasks
  FOR INSERT WITH CHECK (
    get_user_role() = 'contributor'
    AND practice IS NULL
    AND sector_id = get_user_sector_id()
  );

DROP POLICY IF EXISTS "accomplishments_contributor_sector_insert" ON accomplishments;
CREATE POLICY "accomplishments_contributor_sector_insert" ON accomplishments
  FOR INSERT WITH CHECK (
    get_user_role() = 'contributor'
    AND practice IS NULL
    AND sector_id = get_user_sector_id()
  );

DROP POLICY IF EXISTS "submission_approvals_contributor_sector_insert" ON submission_approvals;
CREATE POLICY "submission_approvals_contributor_sector_insert" ON submission_approvals
  FOR INSERT WITH CHECK (
    get_user_role() = 'contributor'
    AND practice IS NULL
    AND sector_id = get_user_sector_id()
  );

-- 8. Index for sector_spoc role lookups
CREATE INDEX IF NOT EXISTS idx_users_sector_spoc
  ON users(role, sector_id)
  WHERE role = 'sector_spoc';

-- 9. Seed role_view_permissions for sector_spoc
INSERT INTO role_view_permissions (role, view_key, is_visible) VALUES
  ('sector_spoc', 'web.mypractice',     false),
  ('sector_spoc', 'web.mydepartment',   false),
  ('sector_spoc', 'web.exec_summary',   false),
  ('sector_spoc', 'web.mysector',       true)
ON CONFLICT (role, view_key) DO UPDATE SET is_visible = EXCLUDED.is_visible;

-- 10. Recreate pending_approvals as security_invoker so RLS applies on the view.
--     Original definition is in sql/002:158; this preserves the shape and adds security_invoker.
--     Without this, dropping the open SELECT policy on submission_approvals would still leak rows
--     through the view (views default to security_definer in PG <15 and in some Supabase configs).
DROP VIEW IF EXISTS pending_approvals CASCADE;
CREATE VIEW pending_approvals
WITH (security_invoker = true) AS
SELECT
  sa.id,
  sa.submission_type,
  sa.submission_id,
  sa.approval_status,
  sa.approval_layer,
  sa.escalation_level,
  sa.saved_hours,
  sa.practice,
  sa.sector_id,
  sa.submitted_by_email,
  sa.spoc_id,
  sa.admin_id,
  CASE
    WHEN sa.approval_status = 'pending' AND sa.saved_hours >= 15 THEN 'admin'
    WHEN sa.approval_status = 'ai_review' THEN 'ai'
    WHEN sa.approval_status = 'spoc_review' THEN 'spoc'
    WHEN sa.approval_status = 'admin_review' THEN 'admin'
    ELSE NULL
  END AS awaiting_from,
  sa.submitted_at,
  sa.created_at
FROM submission_approvals sa
WHERE sa.approval_status NOT IN ('approved', 'rejected')
ORDER BY sa.saved_hours DESC, sa.submitted_at ASC;
