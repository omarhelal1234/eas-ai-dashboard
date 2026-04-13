-- ============================================================
-- EAS AI Adoption Dashboard — Departments & Practice Enhancements
-- Migration 009: Departments table + Practice CRUD support
-- ============================================================

-- ===================== DEPARTMENTS TABLE =====================

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  head TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Updated_at trigger
CREATE TRIGGER trg_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ===================== ENHANCE PRACTICES TABLE =====================

-- Add department_id FK to practices
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

-- Add description column to practices
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- Add is_active column to practices
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Add updated_at column to practices
ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Updated_at trigger for practices (if not already created)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_practices_updated_at'
  ) THEN
    CREATE TRIGGER trg_practices_updated_at
      BEFORE UPDATE ON practices
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;

-- ===================== INDEXES =====================

CREATE INDEX IF NOT EXISTS idx_practices_department ON practices(department_id);
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active);

-- ===================== ROW-LEVEL SECURITY =====================

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- Anyone can read departments (needed for dropdowns, signup, etc.)
CREATE POLICY "departments_read" ON departments FOR SELECT USING (true);

-- Only admin can write departments
CREATE POLICY "departments_admin_write" ON departments FOR ALL USING (get_user_role() = 'admin');

-- ===================== SEED DEPARTMENTS =====================

-- Insert default departments based on existing practice data
INSERT INTO departments (name, description, head, is_active) VALUES
  ('EAS', 'Enterprise Application Services', '', true),
  ('Service Excellence', 'Service Excellence Division', 'Neraaj Goel', true)
ON CONFLICT (name) DO NOTHING;

-- Link existing practices to their departments
UPDATE practices SET department_id = (
  SELECT id FROM departments WHERE departments.name = practices.department
)
WHERE department_id IS NULL AND department IS NOT NULL;
