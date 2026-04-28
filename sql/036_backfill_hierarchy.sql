-- ============================================================
-- EAS AI Adoption — Migration 036: Backfill hierarchy + validate CHECKs
-- Spec: docs/superpowers/specs/2026-04-28-org-hierarchy-design.md §8
--   * audit tables: hierarchy_migration_log, migration_orphans
--   * resolve sector_id via practice → department → sector chain
--   * flag profile_completed=false on users we couldn't resolve
--   * VALIDATE CONSTRAINT on every NOT VALID CHECK from 033
-- ============================================================

-- 1. Audit tables (idempotent)
CREATE TABLE IF NOT EXISTS hierarchy_migration_log (
  id BIGSERIAL PRIMARY KEY,
  source_table   TEXT NOT NULL,
  source_id      UUID,
  resolved_chain JSONB,
  resolved_sector_id UUID,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_orphans (
  id BIGSERIAL PRIMARY KEY,
  source_table  TEXT NOT NULL,
  source_id     UUID,
  practice      TEXT,
  department_id UUID,
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_orphans_source ON migration_orphans(source_table);

-- 2. Departments still unmapped to a sector → orphans
INSERT INTO migration_orphans (source_table, source_id, reason)
SELECT 'departments', id, 'unmapped to sector'
FROM departments
WHERE sector_id IS NULL AND is_active = true;

-- 3. Users.sector_id backfill via department or practice
WITH resolved AS (
  SELECT
    u.id AS user_id,
    COALESCE(
      d.sector_id,
      (SELECT d2.sector_id
         FROM practices  p
         JOIN departments d2 ON d2.id = p.department_id
        WHERE p.name = u.practice
        LIMIT 1)
    ) AS new_sector_id
  FROM users u
  LEFT JOIN departments d ON d.id = u.department_id
)
UPDATE users u
   SET sector_id = r.new_sector_id
  FROM resolved r
 WHERE u.id = r.user_id
   AND r.new_sector_id IS NOT NULL
   AND u.sector_id IS NULL;

UPDATE users
   SET profile_completed = false
 WHERE sector_id IS NULL
   AND role IN ('contributor','spoc','dept_spoc','team_lead');

INSERT INTO migration_orphans (source_table, source_id, practice, department_id, reason)
SELECT 'users', id, practice, department_id, 'sector_id unresolved'
FROM users
WHERE sector_id IS NULL
  AND role IN ('contributor','spoc','dept_spoc','team_lead');

-- 4. Data tables — backfill via practice → department → sector chain.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT unnest(ARRAY['tasks','accomplishments','submission_approvals','copilot_users','projects','prompt_library','use_cases']) AS t
  LOOP
    -- prompt_library has no practice column; skip.
    IF rec.t = 'prompt_library' THEN CONTINUE; END IF;

    EXECUTE format($q$
      WITH chain AS (
        SELECT p.name AS practice_name, d.sector_id
          FROM practices  p
          JOIN departments d ON d.id = p.department_id
      )
      UPDATE %I t
         SET sector_id = c.sector_id
        FROM chain c
       WHERE t.practice = c.practice_name
         AND t.sector_id IS NULL
    $q$, rec.t);

    -- Log unresolved rows
    EXECUTE format($q$
      INSERT INTO migration_orphans (source_table, source_id, practice, reason)
      SELECT %L, id, practice, 'sector_id unresolved post-backfill'
      FROM %I
      WHERE sector_id IS NULL AND practice IS NOT NULL
    $q$, rec.t, rec.t);
  END LOOP;
END$$;

-- 5. practice_spoc.sector_id backfill
WITH chain AS (
  SELECT p.name AS practice_name, d.sector_id
    FROM practices  p
    JOIN departments d ON d.id = p.department_id
)
UPDATE practice_spoc ps
   SET sector_id = c.sector_id
  FROM chain c
 WHERE ps.practice = c.practice_name
   AND ps.sector_id IS NULL;

-- 6. Validate the NOT VALID CHECKs from 033.
--    If any orphan row remains, validation fails loudly — that's the intended behavior.
ALTER TABLE tasks                VALIDATE CONSTRAINT tasks_hierarchy_anchor_chk;
ALTER TABLE accomplishments      VALIDATE CONSTRAINT accomplishments_hierarchy_anchor_chk;
ALTER TABLE copilot_users        VALIDATE CONSTRAINT copilot_users_hierarchy_anchor_chk;
ALTER TABLE projects             VALIDATE CONSTRAINT projects_hierarchy_anchor_chk;
ALTER TABLE submission_approvals VALIDATE CONSTRAINT submission_approvals_hierarchy_anchor_chk;
ALTER TABLE users                VALIDATE CONSTRAINT users_hierarchy_anchor_chk;
