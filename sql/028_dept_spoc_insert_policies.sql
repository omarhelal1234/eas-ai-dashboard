-- ============================================================
-- EAS AI Adoption — Migration 028: dept_spoc INSERT policies
-- Fixes RLS violation: dept_spoc users could not insert tasks,
-- accomplishments, or submission_approvals.
-- Scoped to practices within their assigned department.
-- ============================================================

-- ---- TASKS: dept_spoc can insert for practices in their department ----
DROP POLICY IF EXISTS "dept_spoc_tasks_insert" ON tasks;
CREATE POLICY "dept_spoc_tasks_insert" ON tasks
  FOR INSERT WITH CHECK (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- ---- ACCOMPLISHMENTS: dept_spoc can insert for practices in their department ----
DROP POLICY IF EXISTS "dept_spoc_accomplishments_insert" ON accomplishments;
CREATE POLICY "dept_spoc_accomplishments_insert" ON accomplishments
  FOR INSERT WITH CHECK (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- ---- SUBMISSION_APPROVALS: dept_spoc can insert for practices in their department ----
DROP POLICY IF EXISTS "dept_spoc_approvals_insert" ON submission_approvals;
CREATE POLICY "dept_spoc_approvals_insert" ON submission_approvals
  FOR INSERT WITH CHECK (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );
