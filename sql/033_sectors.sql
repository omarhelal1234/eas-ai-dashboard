-- ============================================================
-- EAS AI Adoption — Migration 033: Org-wide hierarchy foundation
--   * sectors table (above departments)
--   * sector_id / unit_spoc_email / unit_spoc_name on departments
--   * practice_spoc_email on practices
--   * sector_id + profile_completed on users
--   * sector_id on practice_spoc + every data table
--   * escalation_level on submission_approvals
--   * relax NOT NULL on practice/department_id where flat-sector writes need it
--   * hierarchy-anchor CHECK constraints (NOT VALID; validated in 036)
--   * populate_sector_id() trigger + BEFORE INSERT/UPDATE on data tables
--   * cascading deactivation triggers on sectors and departments
-- Spec: docs/superpowers/specs/2026-04-28-org-hierarchy-design.md §5
-- ============================================================

-- 1. sectors table
CREATE TABLE IF NOT EXISTS sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  sector_spoc_name TEXT NOT NULL DEFAULT '',
  sector_spoc_email TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sectors_active ON sectors(is_active);
CREATE INDEX IF NOT EXISTS idx_sectors_spoc_email
  ON sectors(lower(sector_spoc_email)) WHERE sector_spoc_email IS NOT NULL;

DROP TRIGGER IF EXISTS trg_sectors_updated_at ON sectors;
CREATE TRIGGER trg_sectors_updated_at BEFORE UPDATE ON sectors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. departments: sector linkage + unit SPOC email columns
ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS unit_spoc_email TEXT,
  ADD COLUMN IF NOT EXISTS unit_spoc_name TEXT;

COMMENT ON TABLE departments IS 'Unit/Department layer (between sectors and practices). Name retained for migration parity.';
COMMENT ON COLUMN departments.sector_id IS 'Parent sector. RESTRICT delete: see spec §5.2.';
COMMENT ON COLUMN departments.unit_spoc_email IS 'Org-chart email — drives auto-promotion to dept_spoc.';

CREATE INDEX IF NOT EXISTS idx_departments_sector ON departments(sector_id);
CREATE INDEX IF NOT EXISTS idx_departments_unit_spoc_email
  ON departments(lower(unit_spoc_email)) WHERE unit_spoc_email IS NOT NULL;

-- 3. practices: practice SPOC email column (org-chart metadata only — NOT consulted by resolve_approver)
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS practice_spoc_email TEXT;

COMMENT ON COLUMN practices.practice_spoc_email IS 'Org-chart metadata only — used by sync_user_role_from_org to seed practice_spoc. Multi-SPOC table is authoritative for approval.';

CREATE INDEX IF NOT EXISTS idx_practices_spoc_email
  ON practices(lower(practice_spoc_email)) WHERE practice_spoc_email IS NOT NULL;

-- 4. users: sector_id + profile_completed
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_users_sector ON users(sector_id);
CREATE INDEX IF NOT EXISTS idx_users_profile_completed
  ON users(profile_completed) WHERE profile_completed = false;

-- 5. practice_spoc: denormalized sector_id
ALTER TABLE practice_spoc
  ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_practice_spoc_sector ON practice_spoc(sector_id);

-- 6. Data tables: denormalized sector_id (nullable, FK with RESTRICT)
ALTER TABLE tasks                ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT;
ALTER TABLE accomplishments      ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT;
ALTER TABLE use_cases            ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT;
ALTER TABLE submission_approvals ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT;
ALTER TABLE copilot_users        ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT;
ALTER TABLE projects             ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT;
ALTER TABLE prompt_library       ADD COLUMN IF NOT EXISTS sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_tasks_sector                ON tasks(sector_id);
CREATE INDEX IF NOT EXISTS idx_accomplishments_sector      ON accomplishments(sector_id);
CREATE INDEX IF NOT EXISTS idx_use_cases_sector            ON use_cases(sector_id);
CREATE INDEX IF NOT EXISTS idx_submission_approvals_sector ON submission_approvals(sector_id);
CREATE INDEX IF NOT EXISTS idx_copilot_users_sector        ON copilot_users(sector_id);
CREATE INDEX IF NOT EXISTS idx_projects_sector             ON projects(sector_id);
CREATE INDEX IF NOT EXISTS idx_prompt_library_sector       ON prompt_library(sector_id);

-- 7. submission_approvals: escalation_level
ALTER TABLE submission_approvals
  ADD COLUMN IF NOT EXISTS escalation_level TEXT
    CHECK (escalation_level IS NULL OR escalation_level IN ('practice','unit','sector','admin'));

CREATE INDEX IF NOT EXISTS idx_submission_approvals_escalation
  ON submission_approvals(escalation_level);

-- 8. Relax NOT NULL on practice/department_id for flat-sector writes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='tasks' AND column_name='practice' AND is_nullable='NO') THEN
    EXECUTE 'ALTER TABLE tasks ALTER COLUMN practice DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='accomplishments' AND column_name='practice' AND is_nullable='NO') THEN
    EXECUTE 'ALTER TABLE accomplishments ALTER COLUMN practice DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='copilot_users' AND column_name='practice' AND is_nullable='NO') THEN
    EXECUTE 'ALTER TABLE copilot_users ALTER COLUMN practice DROP NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='projects' AND column_name='practice' AND is_nullable='NO') THEN
    EXECUTE 'ALTER TABLE projects ALTER COLUMN practice DROP NOT NULL';
  END IF;
END$$;

-- 9. Hierarchy-anchor CHECKs (NOT VALID — validated in 036 after backfill)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tasks_hierarchy_anchor_chk') THEN
    EXECUTE 'ALTER TABLE tasks ADD CONSTRAINT tasks_hierarchy_anchor_chk CHECK (sector_id IS NOT NULL OR practice IS NOT NULL) NOT VALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='accomplishments_hierarchy_anchor_chk') THEN
    EXECUTE 'ALTER TABLE accomplishments ADD CONSTRAINT accomplishments_hierarchy_anchor_chk CHECK (sector_id IS NOT NULL OR practice IS NOT NULL) NOT VALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='copilot_users_hierarchy_anchor_chk') THEN
    EXECUTE 'ALTER TABLE copilot_users ADD CONSTRAINT copilot_users_hierarchy_anchor_chk CHECK (sector_id IS NOT NULL OR practice IS NOT NULL) NOT VALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='projects_hierarchy_anchor_chk') THEN
    EXECUTE 'ALTER TABLE projects ADD CONSTRAINT projects_hierarchy_anchor_chk CHECK (sector_id IS NOT NULL OR practice IS NOT NULL) NOT VALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='submission_approvals_hierarchy_anchor_chk') THEN
    EXECUTE 'ALTER TABLE submission_approvals ADD CONSTRAINT submission_approvals_hierarchy_anchor_chk CHECK (sector_id IS NOT NULL OR practice IS NOT NULL) NOT VALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_hierarchy_anchor_chk') THEN
    EXECUTE 'ALTER TABLE users ADD CONSTRAINT users_hierarchy_anchor_chk CHECK (
      role IN (''admin'',''executive'',''viewer'')
      OR sector_id IS NOT NULL
      OR practice IS NOT NULL
    ) NOT VALID';
  END IF;
END$$;

-- 10. populate_sector_id() trigger function — canonicalises sector_id from practice/department chain.
-- Spec §5.2a: when practice or department_id is non-null, ALWAYS override client-supplied sector_id.
-- Honour client-supplied sector_id only when both are NULL (true sector-direct write).
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
  -- practice → sector chain. Only override sector_id when the chain actually resolves;
  -- if the practice is unknown, leave NEW.sector_id alone (avoids silently nulling a valid
  -- client-supplied sector_id when practice points at a row missing department_id).
  IF NEW.practice IS NOT NULL THEN
    SELECT d.sector_id INTO v_resolved
    FROM practices p
    JOIN departments d ON d.id = p.department_id
    WHERE p.name = NEW.practice
    LIMIT 1;
    IF v_resolved IS NOT NULL THEN
      NEW.sector_id := v_resolved;
    END IF;
    RETURN NEW;
  END IF;

  -- department_id → sector chain (only on tables that have department_id, e.g. users / copilot_users after 038)
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
      IF v_resolved IS NOT NULL THEN
        NEW.sector_id := v_resolved;
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  -- Both anchors NULL → trust the client-supplied sector_id (flat-sector write).
  -- Contributor INSERT policies (migration 034) enforce sector_id = get_user_sector_id().
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_sector_tasks                ON tasks;
DROP TRIGGER IF EXISTS trg_populate_sector_accomplishments      ON accomplishments;
DROP TRIGGER IF EXISTS trg_populate_sector_use_cases            ON use_cases;
DROP TRIGGER IF EXISTS trg_populate_sector_submission_approvals ON submission_approvals;
DROP TRIGGER IF EXISTS trg_populate_sector_copilot_users        ON copilot_users;
DROP TRIGGER IF EXISTS trg_populate_sector_projects             ON projects;
-- prompt_library has no practice/department_id column (sector_id is set explicitly by writers; no chain to canonicalise)
DROP TRIGGER IF EXISTS trg_populate_sector_users                ON users;
DROP TRIGGER IF EXISTS trg_populate_sector_practice_spoc        ON practice_spoc;

CREATE TRIGGER trg_populate_sector_tasks                BEFORE INSERT OR UPDATE OF practice, sector_id ON tasks                FOR EACH ROW EXECUTE FUNCTION populate_sector_id();
CREATE TRIGGER trg_populate_sector_accomplishments      BEFORE INSERT OR UPDATE OF practice, sector_id ON accomplishments      FOR EACH ROW EXECUTE FUNCTION populate_sector_id();
CREATE TRIGGER trg_populate_sector_use_cases            BEFORE INSERT OR UPDATE OF practice, sector_id ON use_cases            FOR EACH ROW EXECUTE FUNCTION populate_sector_id();
CREATE TRIGGER trg_populate_sector_submission_approvals BEFORE INSERT OR UPDATE OF practice, sector_id ON submission_approvals FOR EACH ROW EXECUTE FUNCTION populate_sector_id();
CREATE TRIGGER trg_populate_sector_copilot_users        BEFORE INSERT OR UPDATE OF practice, sector_id ON copilot_users        FOR EACH ROW EXECUTE FUNCTION populate_sector_id();
CREATE TRIGGER trg_populate_sector_projects             BEFORE INSERT OR UPDATE OF practice, sector_id ON projects             FOR EACH ROW EXECUTE FUNCTION populate_sector_id();
CREATE TRIGGER trg_populate_sector_users                BEFORE INSERT OR UPDATE OF practice, department_id, sector_id ON users FOR EACH ROW EXECUTE FUNCTION populate_sector_id();
CREATE TRIGGER trg_populate_sector_practice_spoc        BEFORE INSERT OR UPDATE OF practice, sector_id ON practice_spoc        FOR EACH ROW EXECUTE FUNCTION populate_sector_id();

-- 11. Cascading deactivation (§5.4): is_active=false on sector cascades to departments & practices.
CREATE OR REPLACE FUNCTION cascade_deactivate_sector()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active = false AND (OLD.is_active IS NULL OR OLD.is_active = true) THEN
    UPDATE departments SET is_active = false WHERE sector_id = NEW.id AND is_active = true;
    UPDATE practices  SET is_active = false WHERE department_id IN (SELECT id FROM departments WHERE sector_id = NEW.id) AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cascade_deactivate_department()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active = false AND (OLD.is_active IS NULL OR OLD.is_active = true) THEN
    UPDATE practices SET is_active = false WHERE department_id = NEW.id AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_deactivate_sector     ON sectors;
DROP TRIGGER IF EXISTS trg_cascade_deactivate_department ON departments;

CREATE TRIGGER trg_cascade_deactivate_sector     AFTER UPDATE OF is_active ON sectors     FOR EACH ROW EXECUTE FUNCTION cascade_deactivate_sector();
CREATE TRIGGER trg_cascade_deactivate_department AFTER UPDATE OF is_active ON departments FOR EACH ROW EXECUTE FUNCTION cascade_deactivate_department();

-- 12. RLS on sectors
ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sectors_admin_all" ON sectors;
CREATE POLICY "sectors_admin_all" ON sectors FOR ALL USING (get_user_role() = 'admin');
DROP POLICY IF EXISTS "sectors_read_authenticated" ON sectors;
CREATE POLICY "sectors_read_authenticated" ON sectors FOR SELECT USING (auth.uid() IS NOT NULL);
