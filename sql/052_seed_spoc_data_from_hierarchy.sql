-- ============================================================
-- EAS AI Adoption — Migration 052: seed sector / unit / practice SPOC
--                                   data from Hierarchy.xlsx (canonical)
--
-- The org chart in /Hierarchy.xlsx is the canonical source for SPOC
-- contact info. Migration 049 did a conservative NULL-only backfill
-- from existing user records; this migration *overwrites* with the
-- xlsx values so the live admin UI matches the org-chart spreadsheet.
--
-- Source rows (April 2026 export):
--   * 13 sectors (all populated)
--   * 10 units (Cloud Engineering & Observability, Cybersecurity, DCX,
--     GTM Solution Desk, Innovation Center, Mega Projects,
--     PMO & Governance, SE, EAS, ADI)
--   * 6 practices under EAS (BFSI, CES, EPCS, EPS, ERP Solutions, GRC)
--
-- Notes:
--   * ADI practices in the xlsx don't have SPOC emails — left untouched.
--   * `Service Excellence` and `COE` exist in the DB but not in the
--     xlsx — left untouched.
--   * Names in the xlsx have stray trailing NBSPs (U+00A0) and regular
--     spaces; we trim before matching.
--
-- Idempotent (re-running produces the same final state).
--
-- IMPORTANT (codex P1): the email-change trigger only PROMOTES the new
-- holder; it does not demote the previous holder. Without an explicit
-- demotion pass, overwriting a sector_spoc_email leaves the prior user
-- with their `sector_spoc` role + `sector_id` + RLS scope intact —
-- meaning two people would have approval rights on the same sector,
-- and the deposed SPOC would still receive escalations. Mirror the
-- core of `revoke_org_role` inline (we can't call the RPC because it
-- gates on `auth.uid()` which is NULL in a migration context).
-- ============================================================

-- ---------- Demote stale SPOCs whose email won't survive the seed ----------
-- Identify users currently holding sector_spoc / dept_spoc whose email
-- doesn't match the canonical xlsx value for their assigned scope, and
-- run the same reset as `revoke_org_role`: demote to contributor, null
-- anchors, deactivate practice_spoc rows, clear *_spoc_email pointers,
-- log the change.
WITH canonical_sectors(name, email) AS (VALUES
  ('HR','malobaid@ejada.com'), ('AI & Data','aalqarawi@ejada.com'),
  ('Sales','khijjawi@ejada.com'), ('Strategy','sjakate@ejada.com'),
  ('Marketing','aalzaineddin@ejada.com'), ('MSO','aalsaar@ejada.com'),
  ('SSO','ralhashmi@ejada.com'), ('ITOP','talyousef@ejada.com'),
  ('Internal Audit','balotaibi@ejada.com'), ('GRC','kaljarbou@ejada.com'),
  ('EPMO','asamawal@ejada.com'), ('Finance','izakri@ejada.com'),
  ('ECC','mmonim@ejada.com')
),
stale_sector_spocs AS (
  SELECT u.id
    FROM users u
    JOIN sectors s            ON s.id = u.sector_id
    JOIN canonical_sectors cs ON cs.name = s.name
   WHERE u.role = 'sector_spoc'
     AND u.is_active
     AND lower(u.email) <> lower(cs.email)
),
canonical_units(name, email) AS (VALUES
  ('Cloud Engineering & Observability','helrakaiby@ejada.com'),
  ('Cybersecurity','wsheira@ejada.com'), ('DCX','mazzi@ejada.com'),
  ('GTM Solution Desk','relkably@ejada.com'),
  ('Innovation Center','mhawash@ejada.com'),
  ('Mega Projects','eghoneim@ejada.com'),
  ('PMO & Governance','akalkoti@ejada.com'),
  ('SE','ngoel@ejada.com'),
  ('EAS','oibrahim@ejada.com'),
  ('ADI','afadl@ejada.com')
),
stale_unit_spocs AS (
  SELECT u.id
    FROM users u
    JOIN departments d      ON d.id = u.department_id
    JOIN canonical_units cu ON cu.name = d.name
   WHERE u.role = 'dept_spoc'
     AND u.is_active
     AND lower(u.email) <> lower(cu.email)
),
victims AS (
  SELECT id FROM stale_sector_spocs UNION SELECT id FROM stale_unit_spocs
),
log_demotion AS (
  -- `source` must be one of the four values allowed by
  -- role_change_log_source_check (see sql/037). 'admin_assign' is the
  -- closest match for a privileged seed-driven reassignment — codex P1
  -- caught that the obvious 'migration_052_seed' would violate the
  -- CHECK and abort the migration on the first stale SPOC.
  INSERT INTO role_change_log (user_id, prev_role, new_role, source)
  SELECT u.id, u.role, 'contributor', 'admin_assign'
    FROM users u JOIN victims v ON v.id = u.id
  RETURNING user_id
),
deactivate_practice_spocs AS (
  UPDATE practice_spoc ps SET is_active = false
   WHERE ps.spoc_id IN (SELECT id FROM victims) AND ps.is_active
  RETURNING 1
),
clear_practice_email AS (
  UPDATE practices SET practice_spoc_email = NULL
   WHERE practice_spoc_email IS NOT NULL
     AND lower(practice_spoc_email) IN (SELECT lower(u.email) FROM users u JOIN victims v ON v.id = u.id)
  RETURNING 1
)
UPDATE users
   SET role = 'contributor', practice = NULL, department_id = NULL,
       sector_id = NULL,     profile_completed = false
 WHERE id IN (SELECT id FROM victims);

-- ---------- Sectors (13) ----------
UPDATE sectors SET sector_spoc_name = 'Mishaal Al Obaid',                 sector_spoc_email = 'malobaid@ejada.com'    WHERE name = 'HR';
UPDATE sectors SET sector_spoc_name = 'Abdullah Alqarawi',                sector_spoc_email = 'aalqarawi@ejada.com'   WHERE name = 'AI & Data';
UPDATE sectors SET sector_spoc_name = 'Khaled Hijjawi',                   sector_spoc_email = 'khijjawi@ejada.com'    WHERE name = 'Sales';
UPDATE sectors SET sector_spoc_name = 'Sanket Jakate',                    sector_spoc_email = 'sjakate@ejada.com'     WHERE name = 'Strategy';
UPDATE sectors SET sector_spoc_name = 'Ali Alzaineddin',                  sector_spoc_email = 'aalzaineddin@ejada.com' WHERE name = 'Marketing';
UPDATE sectors SET sector_spoc_name = 'Amr Al Saar',                      sector_spoc_email = 'aalsaar@ejada.com'     WHERE name = 'MSO';
UPDATE sectors SET sector_spoc_name = 'Rayan Alhashmi',                   sector_spoc_email = 'ralhashmi@ejada.com'   WHERE name = 'SSO';
UPDATE sectors SET sector_spoc_name = 'Thaer Al Yousef',                  sector_spoc_email = 'talyousef@ejada.com'   WHERE name = 'ITOP';
UPDATE sectors SET sector_spoc_name = 'Badr Mansour Alotaibi',            sector_spoc_email = 'balotaibi@ejada.com'   WHERE name = 'Internal Audit';
UPDATE sectors SET sector_spoc_name = 'Khaled Al Jarbou',                 sector_spoc_email = 'kaljarbou@ejada.com'   WHERE name = 'GRC';
UPDATE sectors SET sector_spoc_name = 'Ashraf Samawal',                   sector_spoc_email = 'asamawal@ejada.com'    WHERE name = 'EPMO';
UPDATE sectors SET sector_spoc_name = 'Idrees Zakri',                     sector_spoc_email = 'izakri@ejada.com'      WHERE name = 'Finance';
UPDATE sectors SET sector_spoc_name = 'Mohamed Abdel Moneim',             sector_spoc_email = 'mmonim@ejada.com'      WHERE name = 'ECC';

-- ---------- Units (10) ----------
UPDATE departments SET unit_spoc_name = 'Hisham Elrakaiby',                unit_spoc_email = 'helrakaiby@ejada.com'    WHERE name = 'Cloud Engineering & Observability';
UPDATE departments SET unit_spoc_name = 'Wagieh Sheira',                   unit_spoc_email = 'wsheira@ejada.com'       WHERE name = 'Cybersecurity';
UPDATE departments SET unit_spoc_name = 'Mohannad Azzi',                   unit_spoc_email = 'mazzi@ejada.com'         WHERE name = 'DCX';
UPDATE departments SET unit_spoc_name = 'Ramy Elkably',                    unit_spoc_email = 'relkably@ejada.com'      WHERE name = 'GTM Solution Desk';
UPDATE departments SET unit_spoc_name = 'Moaiad Hawash',                   unit_spoc_email = 'mhawash@ejada.com'       WHERE name = 'Innovation Center';
UPDATE departments SET unit_spoc_name = 'Emad Mohamed Ghoneim',            unit_spoc_email = 'eghoneim@ejada.com'      WHERE name = 'Mega Projects';
UPDATE departments SET unit_spoc_name = 'Ashfaq A. Kalkoti',               unit_spoc_email = 'akalkoti@ejada.com'      WHERE name = 'PMO & Governance';
UPDATE departments SET unit_spoc_name = 'Neeraj Goel',                     unit_spoc_email = 'ngoel@ejada.com'         WHERE name = 'SE';
UPDATE departments SET unit_spoc_name = 'Omar Ibrahim',                    unit_spoc_email = 'oibrahim@ejada.com'      WHERE name = 'EAS';
UPDATE departments SET unit_spoc_name = 'Ahmed Fadl',                      unit_spoc_email = 'afadl@ejada.com'         WHERE name = 'ADI';

-- ---------- Practices (6 — EAS only; ADI practices have no email in xlsx) ----------
-- Tie-break by department to avoid colliding on the standalone GRC sector
-- and the EAS practice both named 'GRC'.
--
-- NOTE on practice-level demotion (codex P1 follow-up): we DO NOT demote
-- prior holders of `practices.practice_spoc_email` because the EAS model
-- is intentionally multi-SPOC at the practice level — the
-- `practice_spoc` table holds the authoritative grants and supports
-- multiple active SPOCs per practice (e.g. BFSI currently has 3,
-- CES has 3). `practices.practice_spoc_email` is a single primary-contact
-- hint; overwriting it does not revoke any existing practice_spoc row.
-- The email-change trigger will additionally promote the new holder to
-- `spoc` (idempotent if they already are one), which is the desired
-- "supplement, not replace" semantics.
UPDATE practices p
   SET practice_spoc_email = 'nalwabel@ejada.com'
  FROM departments d
 WHERE p.department_id = d.id AND d.name = 'EAS' AND p.name = 'CES';

UPDATE practices p
   SET practice_spoc_email = 'abellah@ejada.com'
  FROM departments d
 WHERE p.department_id = d.id AND d.name = 'EAS' AND p.name = 'BFSI';

UPDATE practices p
   SET practice_spoc_email = 'rmibrahim@ejada.com'
  FROM departments d
 WHERE p.department_id = d.id AND d.name = 'EAS' AND p.name = 'ERP Solutions';

UPDATE practices p
   SET practice_spoc_email = 'ymilhem@ejada.com'
  FROM departments d
 WHERE p.department_id = d.id AND d.name = 'EAS' AND p.name = 'EPS';

UPDATE practices p
   SET practice_spoc_email = 'messam@ejada.com'
  FROM departments d
 WHERE p.department_id = d.id AND d.name = 'EAS' AND p.name = 'GRC';

UPDATE practices p
   SET practice_spoc_email = 'ashaheen@ejada.com'
  FROM departments d
 WHERE p.department_id = d.id AND d.name = 'EAS' AND p.name = 'EPCS';

-- ---------- Verification ----------
DO $$
DECLARE
  v_sector_null INT;
  v_unit_null   INT;
BEGIN
  SELECT count(*) INTO v_sector_null FROM sectors     WHERE sector_spoc_email IS NULL OR sector_spoc_name IS NULL OR sector_spoc_name = '';
  SELECT count(*) INTO v_unit_null   FROM departments WHERE unit_spoc_email   IS NULL OR unit_spoc_name   IS NULL OR unit_spoc_name   = '';
  RAISE NOTICE '[052] sectors with missing SPOC after seed: %  (expected 0)', v_sector_null;
  RAISE NOTICE '[052] departments with missing SPOC after seed: %  (expected 2 — COE + Service Excellence are not in xlsx)', v_unit_null;
END $$;
