-- ============================================================
-- EAS AI Adoption Dashboard — Executive Role
-- Migration 010: Add executive role + multi-practice assignment
--
-- Executives are senior directors with read-only, cross-practice
-- visibility into adoption metrics via a dedicated summary dashboard.
-- ============================================================

-- ===================== 1. ALTER CHECK CONSTRAINTS =====================

-- 1a. users.role — drop & recreate to include 'executive'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'spoc', 'contributor', 'viewer', 'executive'));

-- 1b. role_view_permissions.role — same pattern
ALTER TABLE role_view_permissions DROP CONSTRAINT IF EXISTS role_view_permissions_role_check;
ALTER TABLE role_view_permissions ADD CONSTRAINT role_view_permissions_role_check
  CHECK (role IN ('admin', 'spoc', 'contributor', 'viewer', 'executive'));

-- ===================== 2. EXECUTIVE_PRACTICES JUNCTION TABLE =====================

CREATE TABLE executive_practices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice    TEXT NOT NULL REFERENCES practices(name),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, practice)
);

CREATE INDEX idx_exec_practices_user ON executive_practices(user_id);
CREATE INDEX idx_exec_practices_practice ON executive_practices(practice);

COMMENT ON TABLE executive_practices IS
  'Maps executive users to the practices they oversee. One executive can have many practices.';

-- ===================== 3. RLS ON EXECUTIVE_PRACTICES =====================

ALTER TABLE executive_practices ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY "exec_practices_admin_all"
  ON executive_practices FOR ALL
  USING (get_user_role() = 'admin');

-- Executives: read their own assignments
CREATE POLICY "exec_practices_self_read"
  ON executive_practices FOR SELECT
  USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));

-- ===================== 4. HELPER FUNCTION =====================

CREATE OR REPLACE FUNCTION get_executive_practices()
RETURNS TEXT[] AS $$
  SELECT COALESCE(
    array_agg(practice),
    ARRAY[]::TEXT[]
  )
  FROM executive_practices
  WHERE user_id = (SELECT id FROM users WHERE auth_id = auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;

-- ===================== 5. EXECUTIVE SUMMARY RPC =====================
-- Aggregates KPIs across the executive's assigned practices.
-- Uses the real schema column names (time_without_ai, time_with_ai,
-- time_saved, has_logged_task, approval_status).

CREATE OR REPLACE FUNCTION get_executive_summary(p_quarter_id TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_practices TEXT[];
  v_result JSONB;
BEGIN
  -- Get executive's assigned practices
  v_practices := get_executive_practices();

  SELECT jsonb_build_object(
    'practices', v_practices,
    'total_tasks', (
      SELECT COUNT(*) FROM tasks
      WHERE practice = ANY(v_practices)
        AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
    ),
    'total_hours_saved', (
      SELECT COALESCE(SUM(time_without_ai - time_with_ai), 0) FROM tasks
      WHERE practice = ANY(v_practices)
        AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
        AND approval_status = 'approved'
    ),
    'active_users', (
      SELECT COUNT(DISTINCT employee_email) FROM tasks
      WHERE practice = ANY(v_practices)
        AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
    ),
    'total_licensed_users', (
      SELECT COUNT(*) FROM copilot_users
      WHERE practice = ANY(v_practices)
    ),
    'adoption_rate', (
      SELECT CASE
        WHEN (SELECT COUNT(*) FROM copilot_users WHERE practice = ANY(v_practices)) = 0 THEN 0
        ELSE ROUND(
          COUNT(DISTINCT t.employee_email)::numeric * 100 /
          (SELECT COUNT(*) FROM copilot_users WHERE practice = ANY(v_practices)),
          1
        )
      END
      FROM tasks t
      WHERE t.practice = ANY(v_practices)
        AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
    ),
    'hours_per_resource', (
      SELECT CASE
        WHEN (SELECT COUNT(*) FROM copilot_users WHERE practice = ANY(v_practices)) = 0 THEN 0
        ELSE ROUND(
          COALESCE(SUM(time_without_ai - time_with_ai), 0)::numeric /
          (SELECT COUNT(*) FROM copilot_users WHERE practice = ANY(v_practices)),
          1
        )
      END
      FROM tasks
      WHERE practice = ANY(v_practices)
        AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
        AND approval_status = 'approved'
    ),
    'practice_breakdown', (
      SELECT COALESCE(jsonb_agg(row_to_json(pb)), '[]'::jsonb)
      FROM (
        SELECT
          t.practice,
          COUNT(*) AS task_count,
          COALESCE(SUM(time_without_ai - time_with_ai), 0) AS hours_saved,
          COUNT(DISTINCT employee_email) AS active_users,
          ROUND(AVG(NULLIF(quality_rating, 0))::numeric, 2) AS avg_quality
        FROM tasks t
        WHERE t.practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
        GROUP BY t.practice
        ORDER BY t.practice
      ) pb
    ),
    'approval_stats', (
      SELECT COALESCE(jsonb_agg(row_to_json(ap)), '[]'::jsonb)
      FROM (
        SELECT
          approval_status,
          COUNT(*) AS count
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
        GROUP BY approval_status
      ) ap
    ),
    'weekly_trend', (
      SELECT COALESCE(jsonb_agg(row_to_json(wt)), '[]'::jsonb)
      FROM (
        SELECT
          week_number,
          COUNT(*) AS task_count,
          COALESCE(SUM(time_without_ai - time_with_ai), 0) AS hours_saved,
          SUM(COUNT(*)) OVER (ORDER BY week_number) AS cumulative_tasks,
          SUM(COALESCE(SUM(time_without_ai - time_with_ai), 0)) OVER (ORDER BY week_number) AS cumulative_hours
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
          AND week_number IS NOT NULL
        GROUP BY week_number
        ORDER BY week_number
      ) wt
    ),
    'copilot_adoption', (
      SELECT COALESCE(jsonb_agg(row_to_json(ca)), '[]'::jsonb)
      FROM (
        SELECT
          cu.practice,
          COUNT(*) AS total_users,
          COUNT(*) FILTER (WHERE cu.has_logged_task = true) AS active_users
        FROM copilot_users cu
        WHERE cu.practice = ANY(v_practices)
        GROUP BY cu.practice
      ) ca
    ),
    'tool_usage', (
      SELECT COALESCE(jsonb_agg(row_to_json(tu)), '[]'::jsonb)
      FROM (
        SELECT
          ai_tool,
          COUNT(*) AS usage_count
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
          AND ai_tool IS NOT NULL AND ai_tool != ''
        GROUP BY ai_tool
        ORDER BY usage_count DESC
      ) tu
    ),
    'detailed_metrics', jsonb_build_object(
      'avg_quality', (
        SELECT ROUND(AVG(NULLIF(quality_rating, 0))::numeric, 1)
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
      ),
      'approval_rate', (
        SELECT CASE WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(COUNT(*) FILTER (WHERE approval_status = 'approved')::numeric * 100 / COUNT(*), 1)
        END
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
      ),
      'avg_efficiency', (
        SELECT ROUND(AVG(
          CASE WHEN time_without_ai > 0
            THEN (time_without_ai - time_with_ai)::numeric / time_without_ai * 100
            ELSE 0
          END
        )::numeric, 1)
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
          AND approval_status = 'approved'
      ),
      'top_tool', (
        SELECT ai_tool FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
          AND ai_tool IS NOT NULL AND ai_tool != ''
        GROUP BY ai_tool ORDER BY COUNT(*) DESC LIMIT 1
      ),
      'top_tool_count', (
        SELECT COUNT(*) FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
          AND ai_tool = (
            SELECT ai_tool FROM tasks
            WHERE practice = ANY(v_practices)
              AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
              AND ai_tool IS NOT NULL AND ai_tool != ''
            GROUP BY ai_tool ORDER BY COUNT(*) DESC LIMIT 1
          )
      )
    ),
    'department_breakdown', (
      SELECT COALESCE(jsonb_agg(dept_row ORDER BY dept_name), '[]'::jsonb)
      FROM (
        SELECT
          d.name AS dept_name,
          jsonb_build_object(
            'department', d.name,
            'department_id', d.id,
            'practice_count', COUNT(DISTINCT p.name),
            'task_count', COUNT(t.id),
            'hours_saved', COALESCE(SUM(t.time_without_ai - t.time_with_ai) FILTER (WHERE t.approval_status = 'approved'), 0),
            'active_users', COUNT(DISTINCT t.employee_email),
            'total_resources', (
              SELECT COUNT(*) FROM copilot_users cu
              WHERE cu.practice = ANY(ARRAY(SELECT p2.name FROM practices p2 WHERE p2.department_id = d.id AND p2.name = ANY(v_practices)))
            ),
            'adoption_rate', CASE
              WHEN (
                SELECT COUNT(*) FROM copilot_users cu
                WHERE cu.practice = ANY(ARRAY(SELECT p2.name FROM practices p2 WHERE p2.department_id = d.id AND p2.name = ANY(v_practices)))
              ) = 0 THEN 0
              ELSE ROUND(
                COUNT(DISTINCT t.employee_email)::numeric * 100 / (
                  SELECT COUNT(*) FROM copilot_users cu
                  WHERE cu.practice = ANY(ARRAY(SELECT p2.name FROM practices p2 WHERE p2.department_id = d.id AND p2.name = ANY(v_practices)))
                ), 1
              )
            END,
            'practices', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'practice', sub.practice,
                  'task_count', sub.task_count,
                  'hours_saved', sub.hours_saved,
                  'active_users', sub.active_users,
                  'avg_quality', sub.avg_quality
                ) ORDER BY sub.practice
              )
              FROM (
                SELECT
                  t2.practice,
                  COUNT(*) AS task_count,
                  COALESCE(SUM(t2.time_without_ai - t2.time_with_ai), 0) AS hours_saved,
                  COUNT(DISTINCT t2.employee_email) AS active_users,
                  ROUND(AVG(NULLIF(t2.quality_rating, 0))::numeric, 2) AS avg_quality
                FROM tasks t2
                JOIN practices p2 ON p2.name = t2.practice
                WHERE p2.department_id = d.id
                  AND t2.practice = ANY(v_practices)
                  AND (p_quarter_id IS NULL OR t2.quarter_id = p_quarter_id)
                GROUP BY t2.practice
              ) sub
            ), '[]'::jsonb)
          ) AS dept_row
        FROM departments d
        JOIN practices p ON p.department_id = d.id AND p.name = ANY(v_practices)
        LEFT JOIN tasks t ON t.practice = p.name
          AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
        WHERE d.is_active = true
        GROUP BY d.id, d.name
      ) dept_rows
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
   SET search_path = public;

-- ===================== 6. SEED VIEW PERMISSIONS =====================

-- Extension views: all hidden for executive (executives don't use IDE extension)
INSERT INTO role_view_permissions (role, view_key, label, is_visible) VALUES
  ('executive', 'ext.tab_log_task',    'Log Task Tab',         false),
  ('executive', 'ext.tab_my_tasks',    'My Tasks Tab',         false),
  ('executive', 'ext.context_banner',  'Context Banner',       false),
  ('executive', 'ext.quick_log',       'Quick Log Command',    false),
  ('executive', 'ext.advanced_fields', 'Advanced Fields',      false),
  ('executive', 'ext.time_tracking',   'Time Tracking Fields', false),
  ('executive', 'ext.quality_rating',  'Quality Rating',       false),
  ('executive', 'ext.project_select',  'Project Selection',    false)
ON CONFLICT (role, view_key) DO NOTHING;

-- Web views: hide everything except exec summary + dashboard + leaderboard
INSERT INTO role_view_permissions (role, view_key, label, is_visible) VALUES
  ('executive', 'web.dashboard',        'Dashboard',           true),
  ('executive', 'web.leaderboard',      'Leaderboard',         true),
  ('executive', 'web.mypractice',       'My Practice',         false),
  ('executive', 'web.practices',        'All Practices',       false),
  ('executive', 'web.tasks',            'All Tasks',           false),
  ('executive', 'web.mytasks',          'My Tasks',            false),
  ('executive', 'web.accomplishments',  'Accomplishments',     false),
  ('executive', 'web.approvals',        'Approvals',           false),
  ('executive', 'web.copilot',          'Licensed AI Users',   false),
  ('executive', 'web.projects',         'Projects',            false),
  ('executive', 'web.usecases',         'Use Case Library',    false),
  ('executive', 'web.prompts',          'Prompt Library',      false),
  ('executive', 'web.skills',           'Skills Library',      false),
  ('executive', 'web.guidelines',       'Guidelines',          false),
  ('executive', 'web.enablement',       'Copilot Enablement',  false),
  ('executive', 'web.ainews',           'AI News',             false),
  ('executive', 'web.vscode',           'VS Code Extension',   false),
  ('executive', 'web.exec_summary',     'Executive Summary',   true)
ON CONFLICT (role, view_key) DO NOTHING;

-- Also add exec_summary view key for other roles (hidden by default)
INSERT INTO role_view_permissions (role, view_key, label, is_visible) VALUES
  ('admin',       'web.exec_summary', 'Executive Summary', false),
  ('spoc',        'web.exec_summary', 'Executive Summary', false),
  ('contributor', 'web.exec_summary', 'Executive Summary', false),
  ('viewer',      'web.exec_summary', 'Executive Summary', false)
ON CONFLICT (role, view_key) DO NOTHING;
