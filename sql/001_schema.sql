-- ============================================================
-- EAS AI Adoption Dashboard — Supabase Schema
-- Phase 1: Database Migration
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- ===================== ENUMS / TYPES =====================

-- (Using TEXT with CHECK constraints for flexibility)

-- ===================== TABLES =====================

-- 1. Practices (reference table)
CREATE TABLE practices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  head TEXT NOT NULL DEFAULT '',
  spoc TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT 'EAS',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Quarters
CREATE TABLE quarters (
  id TEXT PRIMARY KEY, -- e.g., 'Q1-2026'
  label TEXT NOT NULL, -- e.g., 'Q1 2026'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT false,
  is_locked BOOLEAN DEFAULT false,
  targets JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Users & Auth
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE, -- links to auth.users.id
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'contributor' CHECK (role IN ('admin', 'spoc', 'contributor', 'viewer')),
  practice TEXT REFERENCES practices(name),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Tasks (core tracking)
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter_id TEXT REFERENCES quarters(id),
  practice TEXT NOT NULL REFERENCES practices(name),
  week_number INT,
  week_start DATE,
  week_end DATE,
  project TEXT,
  project_code TEXT,
  employee_name TEXT NOT NULL DEFAULT '',
  employee_email TEXT,
  task_description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  ai_tool TEXT NOT NULL DEFAULT '',
  prompt_used TEXT,
  time_without_ai NUMERIC(8,2) DEFAULT 0,
  time_with_ai NUMERIC(8,2) DEFAULT 0,
  time_saved NUMERIC(8,2) GENERATED ALWAYS AS (time_without_ai - time_with_ai) STORED,
  efficiency NUMERIC(7,6) GENERATED ALWAYS AS (
    CASE WHEN time_without_ai > 0 THEN (time_without_ai - time_with_ai) / time_without_ai ELSE 0 END
  ) STORED,
  quality_rating NUMERIC(2,1) DEFAULT 0,
  status TEXT DEFAULT 'Completed',
  notes TEXT,
  logged_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Accomplishments
CREATE TABLE accomplishments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter_id TEXT REFERENCES quarters(id),
  practice TEXT NOT NULL REFERENCES practices(name),
  date DATE,
  project TEXT,
  project_code TEXT,
  spoc TEXT,
  employees TEXT,
  title TEXT NOT NULL,
  details TEXT,
  ai_tool TEXT,
  category TEXT,
  before_baseline TEXT,
  after_result TEXT,
  quantified_impact TEXT,
  business_gains TEXT,
  cost TEXT DEFAULT 'Free of Cost',
  effort_saved NUMERIC(8,2),
  status TEXT DEFAULT 'Completed',
  evidence TEXT,
  notes TEXT,
  logged_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Copilot Users (license management)
CREATE TABLE copilot_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice TEXT NOT NULL REFERENCES practices(name),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role_skill TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  has_logged_task BOOLEAN DEFAULT false,
  last_task_date DATE,
  nudged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice TEXT NOT NULL REFERENCES practices(name),
  project_name TEXT NOT NULL,
  project_code TEXT,
  contract_number TEXT,
  customer TEXT,
  contract_value NUMERIC(14,2) DEFAULT 0,
  start_date DATE,
  end_date DATE,
  revenue_type TEXT,
  line_type TEXT,
  project_manager TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Lists of Values (LOVs)
CREATE TABLE lovs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL, -- 'taskCategory', 'aiTool', 'status'
  value TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  is_licensed BOOLEAN DEFAULT false, -- true for Ejada-paid tools (GH Copilot, M365 Copilot)
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(category, value)
);

-- 9. Activity Log (audit trail)
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  user_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ===================== INDEXES =====================

CREATE INDEX idx_tasks_quarter ON tasks(quarter_id);
CREATE INDEX idx_tasks_practice ON tasks(practice);
CREATE INDEX idx_tasks_employee ON tasks(employee_name);
CREATE INDEX idx_tasks_created ON tasks(created_at);
CREATE INDEX idx_accomplishments_quarter ON accomplishments(quarter_id);
CREATE INDEX idx_accomplishments_practice ON accomplishments(practice);
CREATE INDEX idx_copilot_users_practice ON copilot_users(practice);
CREATE INDEX idx_copilot_users_email ON copilot_users(email);
CREATE INDEX idx_projects_practice ON projects(practice);
CREATE INDEX idx_activity_log_user ON activity_log(user_id);
CREATE INDEX idx_activity_log_created ON activity_log(created_at);
CREATE INDEX idx_lovs_category ON lovs(category);

-- ===================== UPDATED_AT TRIGGERS =====================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_accomplishments_updated_at BEFORE UPDATE ON accomplishments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_copilot_users_updated_at BEFORE UPDATE ON copilot_users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================== ROW-LEVEL SECURITY =====================

ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE quarters ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE accomplishments ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE lovs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;

-- Helper function: get current user's practice
CREATE OR REPLACE FUNCTION get_user_practice()
RETURNS TEXT AS $$
  SELECT practice FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;

-- ---- PRACTICES: anyone can read (signup needs anonymous access) ----
CREATE POLICY "practices_read" ON practices FOR SELECT USING (true);
CREATE POLICY "practices_admin_write" ON practices FOR ALL USING (get_user_role() = 'admin');

-- ---- QUARTERS: authenticated users can read, admin can write ----
CREATE POLICY "quarters_read" ON quarters FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "quarters_admin_write" ON quarters FOR ALL USING (get_user_role() = 'admin');

-- ---- USERS: admin full access, all authenticated can read ----
CREATE POLICY "users_admin_all" ON users FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "users_read_all_authenticated" ON users FOR SELECT USING (auth.uid() IS NOT NULL);

-- ---- TASKS ----
-- Admin: full access
CREATE POLICY "tasks_admin_all" ON tasks FOR ALL USING (get_user_role() = 'admin');
-- All authenticated users can read all tasks (dashboard, leaderboard, charts)
CREATE POLICY "tasks_read_all_authenticated" ON tasks FOR SELECT USING (auth.uid() IS NOT NULL);
-- SPOC: write access to own practice
CREATE POLICY "tasks_spoc_write" ON tasks FOR INSERT WITH CHECK (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);
CREATE POLICY "tasks_spoc_update" ON tasks FOR UPDATE USING (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);
CREATE POLICY "tasks_spoc_delete" ON tasks FOR DELETE USING (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);
-- Contributor: insert for own practice
CREATE POLICY "tasks_contributor_insert" ON tasks FOR INSERT WITH CHECK (
  get_user_role() = 'contributor' AND practice = get_user_practice()
);
-- Contributor: update own practice tasks (for approval workflow)
CREATE POLICY "tasks_contributor_update" ON tasks FOR UPDATE USING (
  get_user_role() = 'contributor' AND practice = get_user_practice()
) WITH CHECK (
  get_user_role() = 'contributor' AND practice = get_user_practice()
);

-- ---- ACCOMPLISHMENTS ----
CREATE POLICY "acc_admin_all" ON accomplishments FOR ALL USING (get_user_role() = 'admin');
-- All authenticated users can read all accomplishments
CREATE POLICY "acc_read_all_authenticated" ON accomplishments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "acc_spoc_write" ON accomplishments FOR INSERT WITH CHECK (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);
CREATE POLICY "acc_spoc_update" ON accomplishments FOR UPDATE USING (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);
CREATE POLICY "acc_spoc_delete" ON accomplishments FOR DELETE USING (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);

-- ---- COPILOT USERS ----
CREATE POLICY "copilot_admin_all" ON copilot_users FOR ALL USING (get_user_role() = 'admin');
-- All authenticated users can read all copilot users
CREATE POLICY "copilot_read_all_authenticated" ON copilot_users FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "copilot_spoc_write" ON copilot_users FOR INSERT WITH CHECK (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);
CREATE POLICY "copilot_spoc_update" ON copilot_users FOR UPDATE USING (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);

-- ---- PROJECTS ----
CREATE POLICY "projects_read" ON projects FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "projects_admin_write" ON projects FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "projects_spoc_write" ON projects FOR INSERT WITH CHECK (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);
CREATE POLICY "projects_spoc_update" ON projects FOR UPDATE USING (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);

-- ---- LOVS: authenticated users read, admin writes ----
CREATE POLICY "lovs_read" ON lovs FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "lovs_admin_write" ON lovs FOR ALL USING (get_user_role() = 'admin');

-- ---- ACTIVITY LOG: admin reads all, others read own, authenticated can insert ----
CREATE POLICY "activity_admin_read" ON activity_log FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "activity_user_read" ON activity_log FOR SELECT USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
CREATE POLICY "activity_insert" ON activity_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ===================== SEED BASE DATA =====================

-- Practices
INSERT INTO practices (name, head, spoc, department) VALUES
  ('BFSI', 'Mohab ElHaddad', 'Omar Ibrahim', 'EAS'),
  ('CES', 'Osama Nagdy', 'Norah Al Wabel', 'EAS'),
  ('ERP Solutions', 'Amer Farghaly', 'Reham Ibrahim', 'EAS'),
  ('EPS', 'Mohamed Ziaudin', 'Yousef Milhem', 'EAS'),
  ('GRC', 'Ahmed Madkour', 'Mohamed Essam', 'EAS'),
  ('EPCS', 'Mohamed Mobarak', 'Ahmed Shaheen', 'EAS'),
  ('SE', 'Neraaj Goel', 'Neeraj Goel', 'Service Excellence');

-- Quarters
INSERT INTO quarters (id, label, start_date, end_date, is_active, targets) VALUES
  ('Q1-2026', 'Q1 2026', '2026-01-01', '2026-03-31', false, '{"tasks": 50, "hours_saved": 200, "adoption_rate": 0.15}'::jsonb),
  ('Q2-2026', 'Q2 2026', '2026-04-01', '2026-06-30', true, '{"tasks": 100, "hours_saved": 500, "adoption_rate": 0.30}'::jsonb),
  ('Q3-2026', 'Q3 2026', '2026-07-01', '2026-09-30', false, '{"tasks": 150, "hours_saved": 800, "adoption_rate": 0.40}'::jsonb),
  ('Q4-2026', 'Q4 2026', '2026-10-01', '2026-12-31', false, '{"tasks": 200, "hours_saved": 1000, "adoption_rate": 0.50}'::jsonb);

-- LOVs
INSERT INTO lovs (category, value, sort_order, is_licensed) VALUES
  ('taskCategory', 'Development', 1, false),
  ('taskCategory', 'Database', 2, false),
  ('taskCategory', 'Documentation', 3, false),
  ('taskCategory', 'Testing', 4, false),
  ('taskCategory', 'Code Review', 5, false),
  ('taskCategory', 'Application Development', 6, false),
  ('taskCategory', 'Application configuration', 7, false),
  ('aiTool', 'Github Copilot', 1, true),
  ('aiTool', 'Cursor', 2, false),
  ('aiTool', 'Codex', 3, false),
  ('aiTool', 'Claude', 4, false),
  ('aiTool', 'ChatGPT', 5, false),
  ('aiTool', 'Gemini', 6, false),
  ('aiTool', 'M365 Copilot', 7, true),
  ('status', 'Completed', 1, false),
  ('status', 'In Progress', 2, false),
  ('status', 'Pending', 3, false),
  ('status', 'Testing', 4, false);

-- Admin user (will be linked to auth after signup)
INSERT INTO users (email, name, role, practice) VALUES
  ('oibrahim@ejada.com', 'Omar Ibrahim', 'admin', 'BFSI');

-- SPOC users
INSERT INTO users (email, name, role, practice) VALUES
  ('norah.alwabel@ejada.com', 'Norah Al Wabel', 'spoc', 'CES'),
  ('reham.ibrahim@ejada.com', 'Reham Ibrahim', 'spoc', 'ERP Solutions'),
  ('ymilhem@ejada.com', 'Yousef Milhem', 'spoc', 'EPS'),
  ('messam@ejada.com', 'Mohamed Essam', 'spoc', 'GRC'),
  ('ashaheen@ejada.com', 'Ahmed Shaheen', 'spoc', 'EPCS');

-- ===================== VIEWS (for dashboard aggregates) =====================

-- Practice summary view (replaces summary.practices in data.js)
CREATE OR REPLACE VIEW practice_summary AS
SELECT
  p.name AS practice,
  p.head,
  p.spoc,
  COALESCE(t.task_count, 0) AS tasks,
  COALESCE(t.total_time_without, 0) AS time_without,
  COALESCE(t.total_time_with, 0) AS time_with,
  COALESCE(t.total_time_saved, 0) AS time_saved,
  CASE WHEN COALESCE(t.total_time_without, 0) > 0
    THEN ROUND((t.total_time_saved / t.total_time_without * 100)::numeric, 1)
    ELSE 0 END AS efficiency_pct,
  COALESCE(t.avg_quality, 0) AS avg_quality,
  COALESCE(t.completed_count, 0) AS completed,
  COALESCE(proj.project_count, 0) AS project_count,
  COALESCE(cu.licensed_users, 0) AS licensed_users,
  COALESCE(cu.active_users, 0) AS active_users
FROM practices p
LEFT JOIN (
  SELECT
    practice,
    COUNT(*) AS task_count,
    SUM(time_without_ai) AS total_time_without,
    SUM(time_with_ai) AS total_time_with,
    SUM(time_without_ai - time_with_ai) AS total_time_saved,
    ROUND(AVG(NULLIF(quality_rating, 0))::numeric, 2) AS avg_quality,
    COUNT(*) FILTER (WHERE LOWER(status) = 'completed') AS completed_count
  FROM tasks
  WHERE approval_status = 'approved'
  GROUP BY practice
) t ON t.practice = p.name
LEFT JOIN (
  SELECT practice, COUNT(DISTINCT project_name) AS project_count
  FROM projects
  GROUP BY practice
) proj ON proj.practice = p.name
LEFT JOIN (
  SELECT
    cu.practice,
    COUNT(*) FILTER (WHERE lower(cu.status) = 'access granted') AS licensed_users,
    COUNT(*) FILTER (
      WHERE lower(cu.status) = 'access granted'
      AND (
        EXISTS (SELECT 1 FROM tasks tk WHERE lower(tk.employee_email) = lower(cu.email))
        OR COALESCE(cu.ide_days_active, 0) > 0
      )
    ) AS active_users
  FROM copilot_users cu
  GROUP BY cu.practice
) cu ON cu.practice = p.name;

-- Quarter summary view
CREATE OR REPLACE VIEW quarter_summary AS
SELECT
  q.id AS quarter_id,
  q.label,
  q.is_active,
  COALESCE(t.task_count, 0) AS tasks,
  COALESCE(t.total_time_without, 0) AS time_without,
  COALESCE(t.total_time_with, 0) AS time_with,
  COALESCE(t.total_time_saved, 0) AS time_saved,
  CASE WHEN COALESCE(t.total_time_without, 0) > 0
    THEN ROUND((t.total_time_saved / t.total_time_without * 100)::numeric, 1)
    ELSE 0 END AS efficiency_pct,
  COALESCE(t.avg_quality, 0) AS avg_quality,
  COALESCE(t.completed_count, 0) AS completed,
  q.targets
FROM quarters q
LEFT JOIN (
  SELECT
    quarter_id,
    COUNT(*) AS task_count,
    SUM(time_without_ai) AS total_time_without,
    SUM(time_with_ai) AS total_time_with,
    SUM(time_without_ai - time_with_ai) AS total_time_saved,
    ROUND(AVG(NULLIF(quality_rating, 0))::numeric, 2) AS avg_quality,
    COUNT(*) FILTER (WHERE LOWER(status) = 'completed') AS completed_count
  FROM tasks
  WHERE approval_status = 'approved'
  GROUP BY quarter_id
) t ON t.quarter_id = q.id;
