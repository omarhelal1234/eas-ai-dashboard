-- ============================================================
-- EAS AI Adoption — Migration 025: dept_spoc role
-- Adds Department SPOC role, department_id to users, RLS policies
-- ============================================================

-- 1. Extend role CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin','spoc','team_lead','contributor','viewer','executive','dept_spoc'));

-- 2. Add department_id FK to users (null for all existing roles; set only for dept_spoc)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_id UUID
    REFERENCES departments(id) ON DELETE SET NULL;

-- 3. Index for RLS performance
CREATE INDEX IF NOT EXISTS idx_users_dept_spoc
  ON users(role, department_id)
  WHERE role = 'dept_spoc';

-- 4. Helper function: get the department_id of the current authenticated user
CREATE OR REPLACE FUNCTION get_user_department_id()
RETURNS UUID AS $$
  SELECT department_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER
   SET search_path = public;

-- 5. Extend RLS policies for dept_spoc

-- tasks
DROP POLICY IF EXISTS "dept_spoc_tasks_select" ON tasks;
CREATE POLICY "dept_spoc_tasks_select" ON tasks
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

DROP POLICY IF EXISTS "dept_spoc_tasks_update" ON tasks;
CREATE POLICY "dept_spoc_tasks_update" ON tasks
  FOR UPDATE USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- accomplishments
DROP POLICY IF EXISTS "dept_spoc_accomplishments_select" ON accomplishments;
CREATE POLICY "dept_spoc_accomplishments_select" ON accomplishments
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

DROP POLICY IF EXISTS "dept_spoc_accomplishments_update" ON accomplishments;
CREATE POLICY "dept_spoc_accomplishments_update" ON accomplishments
  FOR UPDATE USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- submission_approvals
DROP POLICY IF EXISTS "dept_spoc_approvals_select" ON submission_approvals;
CREATE POLICY "dept_spoc_approvals_select" ON submission_approvals
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

DROP POLICY IF EXISTS "dept_spoc_approvals_update" ON submission_approvals;
CREATE POLICY "dept_spoc_approvals_update" ON submission_approvals
  FOR UPDATE USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- copilot_users
DROP POLICY IF EXISTS "dept_spoc_copilot_select" ON copilot_users;
CREATE POLICY "dept_spoc_copilot_select" ON copilot_users
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- users (can see users in their department's practices)
DROP POLICY IF EXISTS "dept_spoc_users_select" ON users;
CREATE POLICY "dept_spoc_users_select" ON users
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND (
      practice IN (
        SELECT name FROM practices WHERE department_id = get_user_department_id()
      )
      OR id = get_current_user_id()
    )
  );

-- practice_spoc
DROP POLICY IF EXISTS "dept_spoc_practice_spoc_select" ON practice_spoc;
CREATE POLICY "dept_spoc_practice_spoc_select" ON practice_spoc
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- projects
DROP POLICY IF EXISTS "dept_spoc_projects_select" ON projects;
CREATE POLICY "dept_spoc_projects_select" ON projects
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- 6. Extend role_view_permissions role CHECK constraint to include dept_spoc
ALTER TABLE role_view_permissions DROP CONSTRAINT IF EXISTS role_view_permissions_role_check;
ALTER TABLE role_view_permissions
  ADD CONSTRAINT role_view_permissions_role_check
    CHECK (role IN ('admin','spoc','team_lead','contributor','viewer','executive','dept_spoc'));

-- 7. Seed role_view_permissions for dept_spoc
INSERT INTO role_view_permissions (role, view_key, is_visible) VALUES
  ('dept_spoc', 'web.mypractice',   false),
  ('dept_spoc', 'web.exec_summary', false),
  ('dept_spoc', 'web.mydepartment', true)
ON CONFLICT (role, view_key) DO UPDATE SET is_visible = EXCLUDED.is_visible;
