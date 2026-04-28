-- ============================================================
-- EAS AI Adoption — Migration 041: Phase 2 — scoped self-service for the Org Hierarchy tree
-- Spec: docs/superpowers/specs/2026-04-28-org-hierarchy-design.md §10.3
--   * sector_spoc can edit their own sector's metadata + units + practices
--   * dept_spoc can edit their own unit's metadata + practices
--   * neither can reparent: WITH CHECK ties them to their own scope
-- ============================================================

-- ---------- sectors ----------
DROP POLICY IF EXISTS "sectors_sector_spoc_update" ON sectors;
CREATE POLICY "sectors_sector_spoc_update" ON sectors
  FOR UPDATE USING (
    get_user_role() = 'sector_spoc' AND id = get_user_sector_id()
  )
  WITH CHECK (
    get_user_role() = 'sector_spoc' AND id = get_user_sector_id()
  );

-- ---------- departments ----------
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_admin_all"             ON departments;
DROP POLICY IF EXISTS "departments_read_authenticated"    ON departments;
DROP POLICY IF EXISTS "departments_sector_spoc_insert"    ON departments;
DROP POLICY IF EXISTS "departments_sector_spoc_update"    ON departments;
DROP POLICY IF EXISTS "departments_dept_spoc_update"      ON departments;

CREATE POLICY "departments_admin_all"             ON departments FOR ALL    USING (get_user_role() = 'admin');
CREATE POLICY "departments_read_authenticated"    ON departments FOR SELECT USING (auth.uid() IS NOT NULL);

-- sector_spoc can insert + update units within their own sector. WITH CHECK
-- prevents reparenting (sector_id must remain the user's sector).
CREATE POLICY "departments_sector_spoc_insert" ON departments
  FOR INSERT WITH CHECK (
    get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id()
  );
CREATE POLICY "departments_sector_spoc_update" ON departments
  FOR UPDATE USING (
    get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id()
  )
  WITH CHECK (
    get_user_role() = 'sector_spoc' AND sector_id = get_user_sector_id()
  );

-- dept_spoc can update their own unit's metadata (SPOC email, name, is_active)
-- but cannot reparent to another sector.
CREATE POLICY "departments_dept_spoc_update" ON departments
  FOR UPDATE USING (
    get_user_role() = 'dept_spoc' AND id = get_user_department_id()
  )
  WITH CHECK (
    get_user_role() = 'dept_spoc'
    AND id = get_user_department_id()
    AND sector_id = (SELECT sector_id FROM departments WHERE id = get_user_department_id())
  );

-- ---------- practices ----------
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "practices_read_authenticated"      ON practices;
DROP POLICY IF EXISTS "practices_sector_spoc_insert"      ON practices;
DROP POLICY IF EXISTS "practices_sector_spoc_update"      ON practices;
DROP POLICY IF EXISTS "practices_dept_spoc_insert"        ON practices;
DROP POLICY IF EXISTS "practices_dept_spoc_update"        ON practices;
-- The existing practices_admin_write (sql/001:222) is FOR ALL admin — keep.

CREATE POLICY "practices_read_authenticated" ON practices FOR SELECT USING (auth.uid() IS NOT NULL);

-- sector_spoc can insert + update practices that belong to a unit in their own sector.
CREATE POLICY "practices_sector_spoc_insert" ON practices
  FOR INSERT WITH CHECK (
    get_user_role() = 'sector_spoc'
    AND department_id IN (SELECT id FROM departments WHERE sector_id = get_user_sector_id())
  );
CREATE POLICY "practices_sector_spoc_update" ON practices
  FOR UPDATE USING (
    get_user_role() = 'sector_spoc'
    AND department_id IN (SELECT id FROM departments WHERE sector_id = get_user_sector_id())
  )
  WITH CHECK (
    get_user_role() = 'sector_spoc'
    AND department_id IN (SELECT id FROM departments WHERE sector_id = get_user_sector_id())
  );

-- dept_spoc can insert + update practices in their own unit only.
CREATE POLICY "practices_dept_spoc_insert" ON practices
  FOR INSERT WITH CHECK (
    get_user_role() = 'dept_spoc' AND department_id = get_user_department_id()
  );
CREATE POLICY "practices_dept_spoc_update" ON practices
  FOR UPDATE USING (
    get_user_role() = 'dept_spoc' AND department_id = get_user_department_id()
  )
  WITH CHECK (
    get_user_role() = 'dept_spoc' AND department_id = get_user_department_id()
  );
