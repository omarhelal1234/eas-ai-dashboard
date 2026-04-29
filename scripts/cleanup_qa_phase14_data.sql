-- ============================================================
-- One-off cleanup of QA-introduced data from phases 1–4 testing.
-- DO NOT RUN as a migration. Review row counts before commit.
--
-- Wrap in a transaction so an unexpected count rolls back.
-- Run via the Supabase SQL editor while authenticated as admin.
-- ============================================================

BEGIN;

-- ---------- 1. QA approvals ----------
-- Two rows expected (one approved, one superseded) for ac919efa task.
-- a75cc2fc and 2d10025f never reached an approval round per probe data,
-- but we still scope by submitted_by_email to catch any stragglers.
DELETE FROM submission_approvals
 WHERE submitted_by_email = 'qa.hr.1777423178386@ejada.com';

-- ---------- 2. QA tasks ----------
-- Probe inventory: ac919efa, a75cc2fc, 2d10025f (the user mentioned the
-- first two — 2d10025f is a third probe row from the same QA session).
DELETE FROM tasks
 WHERE employee_email = 'qa.hr.1777423178386@ejada.com'
    OR id IN (
      'ac919efa-501e-4c3b-abe8-a2cd349a2a10',
      'a75cc2fc-463b-4a2f-b827-b91a5b11568e',
      '2d10025f-a6df-402b-b65b-146a26acab32'
    );

-- ---------- 3. QA user (public.users only — does NOT touch auth.users) ----------
-- The auth.users row must be deleted via the Supabase dashboard or
-- service-role API; this script only clears the public mirror.
DELETE FROM users
 WHERE email = 'qa.hr.1777423178386@ejada.com';

-- ---------- 4. Revert QA edits to org tree ----------
-- EAS unit_spoc_name was overwritten to 'QA SPOC EAS' during a probe.
-- Set to NULL so migration 049's backfill repopulates it from the
-- canonical dept_spoc user (oibrahim@ejada.com → 'Omar Ibrahim').
UPDATE departments
   SET unit_spoc_name = NULL
 WHERE name = 'EAS' AND unit_spoc_name = 'QA SPOC EAS';

-- ECC brand_color was set to '#bada55' during a probe. Set to NULL
-- so the admin UI falls back to the default sector palette.
UPDATE sectors
   SET brand_color = NULL
 WHERE name = 'ECC' AND brand_color = '#bada55';

-- ---------- 5. Reset profile_completed for the orphan-flow probe ----------
-- Lets the profile-completion modal fire again on next login.
UPDATE users
   SET profile_completed = false
 WHERE email = 'test.orphan@ejada.com';

-- ---------- 6. Synthetic migration_orphans rows ----------
DELETE FROM migration_orphans
 WHERE id IN (114, 115)
   AND reason LIKE 'TEST orphan%';

-- ---------- 7. Re-apply 049 backfill so the EAS unit name is repopulated ----------
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
   SET unit_spoc_email = c.email,
       unit_spoc_name  = c.name
  FROM canonical c
 WHERE c.department_id = d.id
   AND (d.unit_spoc_email IS NULL OR d.unit_spoc_name IS NULL OR d.unit_spoc_name = '');

-- Inspect counts before COMMIT
SELECT 'tasks remaining'              AS metric, count(*)::text AS value FROM tasks               WHERE employee_email = 'qa.hr.1777423178386@ejada.com'
UNION ALL SELECT 'approvals remaining',           count(*)::text          FROM submission_approvals WHERE submitted_by_email = 'qa.hr.1777423178386@ejada.com'
UNION ALL SELECT 'qa user remaining',             count(*)::text          FROM users                WHERE email = 'qa.hr.1777423178386@ejada.com'
UNION ALL SELECT 'EAS unit_spoc_name',            COALESCE(unit_spoc_name, 'NULL') FROM departments WHERE name = 'EAS'
UNION ALL SELECT 'ECC brand_color',               COALESCE(brand_color, 'NULL')    FROM sectors      WHERE name = 'ECC'
UNION ALL SELECT 'orphan profile_completed',      COALESCE(profile_completed::text, 'NULL') FROM users WHERE email = 'test.orphan@ejada.com'
UNION ALL SELECT 'migration_orphans 114/115',     count(*)::text          FROM migration_orphans    WHERE id IN (114, 115);

-- After visually verifying the counts above, swap to:
--   COMMIT;
-- otherwise:
ROLLBACK;
