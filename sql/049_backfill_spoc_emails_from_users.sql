-- ============================================================
-- EAS AI Adoption — Migration 049: backfill sector / unit SPOC emails
--
-- Phase 4 QA found 11 of 13 sectors and 11 of 12 units with
-- sector_spoc_email / unit_spoc_email = NULL even though canonical
-- sector_spoc / dept_spoc users exist for some of them. Migration 048
-- made resolve_approver resilient to the NULL columns, but the data
-- is still inconsistent with the seed intent — admins editing the
-- org tree see "—" in the SPOC column.
--
-- This migration is **idempotent** and **non-destructive**:
--   * Only updates rows where the SPOC email is NULL (never overwrites).
--   * Source of truth: oldest active users.role='sector_spoc' (or
--     'dept_spoc') matched by sector_id / department_id.
--   * Sectors / units with no matching user are left NULL — those
--     rows will be filled when the SPOC user is provisioned.
--
-- The unit_spoc_name / sector_spoc_name columns are intentionally
-- left alone unless they are NULL or empty, so manual edits made
-- through the admin UI are preserved.
-- ============================================================

-- 1. Backfill sectors.sector_spoc_email + sector_spoc_name from canonical users.
--    Touches a row when EITHER the email OR the name is missing (codex P2:
--    name-only gaps were previously skipped because the WHERE locked on
--    email being NULL).
WITH canonical AS (
  SELECT DISTINCT ON (u.sector_id)
         u.sector_id, u.email, u.name
    FROM users u
   WHERE u.role = 'sector_spoc'
     AND u.is_active
     AND u.sector_id IS NOT NULL
   ORDER BY u.sector_id, u.created_at
)
UPDATE sectors s
   SET sector_spoc_email = COALESCE(s.sector_spoc_email, c.email),
       sector_spoc_name  = CASE
                             WHEN s.sector_spoc_name IS NULL OR s.sector_spoc_name = ''
                             THEN c.name
                             ELSE s.sector_spoc_name
                           END
  FROM canonical c
 WHERE c.sector_id = s.id
   AND (s.sector_spoc_email IS NULL
        OR s.sector_spoc_name  IS NULL
        OR s.sector_spoc_name  = '');

-- 2. Backfill departments.unit_spoc_email + unit_spoc_name from canonical users.
WITH canonical AS (
  SELECT DISTINCT ON (u.department_id)
         u.department_id, u.email, u.name
    FROM users u
   WHERE u.role = 'dept_spoc'
     AND u.is_active
     AND u.department_id IS NOT NULL
   ORDER BY u.department_id, u.created_at
)
UPDATE departments d
   SET unit_spoc_email = COALESCE(d.unit_spoc_email, c.email),
       unit_spoc_name  = CASE
                           WHEN d.unit_spoc_name IS NULL OR d.unit_spoc_name = ''
                           THEN c.name
                           ELSE d.unit_spoc_name
                         END
  FROM canonical c
 WHERE c.department_id = d.id
   AND (d.unit_spoc_email IS NULL
        OR d.unit_spoc_name  IS NULL
        OR d.unit_spoc_name  = '');

-- 3. Verification (read-only — surfaces remaining NULLs to the migration log).
DO $$
DECLARE
  v_sector_null INT;
  v_unit_null   INT;
BEGIN
  SELECT count(*) INTO v_sector_null FROM sectors     WHERE sector_spoc_email IS NULL;
  SELECT count(*) INTO v_unit_null   FROM departments WHERE unit_spoc_email   IS NULL;
  RAISE NOTICE '[049] sectors with NULL sector_spoc_email after backfill: %', v_sector_null;
  RAISE NOTICE '[049] departments with NULL unit_spoc_email after backfill: %', v_unit_null;
  RAISE NOTICE '[049] (NULLs remain where no users.role=sector_spoc/dept_spoc exists for that branch — expected.)';
END $$;
