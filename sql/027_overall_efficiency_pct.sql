-- 027: Add overall_efficiency_pct = time_saved / (total_resources * 520) * 100
-- 520 = standard quarter working hours per resource (13 weeks × 5 days × 8 hrs)
-- Formula: Overall Efficiency = Saved Hours / (Resources × Quarter Working Hours) × 100

-- 1. Recreate practice_summary view with overall_efficiency_pct
DROP VIEW IF EXISTS practice_summary;

CREATE VIEW practice_summary AS
SELECT
  p.name AS practice,
  p.head,
  p.spoc,
  p.total_resources,
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
  COALESCE(cu.active_users, 0) AS active_users,
  CASE WHEN p.total_resources > 0
    THEN ROUND((COALESCE(cu.active_users, 0)::numeric / p.total_resources * 100), 1)
    ELSE 0 END AS adoption_rate_pct,
  CASE WHEN p.total_resources > 0
    THEN ROUND((COALESCE(t.total_time_saved, 0)::numeric / p.total_resources), 1)
    ELSE 0 END AS hours_saved_per_resource,
  CASE WHEN p.total_resources > 0
    THEN ROUND((COALESCE(t.total_time_saved, 0)::numeric / (p.total_resources * 520) * 100), 2)
    ELSE 0 END AS overall_efficiency_pct
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

-- 2. Update get_practice_summary RPC with overall_efficiency_pct
DROP FUNCTION IF EXISTS get_practice_summary(text);

CREATE OR REPLACE FUNCTION get_practice_summary(p_quarter_id text DEFAULT NULL)
RETURNS TABLE(
  practice text,
  head text,
  spoc text,
  total_resources integer,
  tasks bigint,
  time_without numeric,
  time_with numeric,
  time_saved numeric,
  efficiency_pct numeric,
  avg_quality numeric,
  completed bigint,
  project_count bigint,
  licensed_users bigint,
  active_users bigint,
  adoption_rate_pct numeric,
  hours_saved_per_resource numeric,
  overall_efficiency_pct numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.name AS practice,
    p.head,
    p.spoc,
    p.total_resources,
    COALESCE(t.task_count, 0) AS tasks,
    COALESCE(t.total_time_without, 0) AS time_without,
    COALESCE(t.total_time_with, 0) AS time_with,
    COALESCE(t.total_time_saved, 0) AS time_saved,
    CASE
      WHEN COALESCE(t.total_time_without, 0) > 0
      THEN round(t.total_time_saved / t.total_time_without * 100, 1)
      ELSE 0
    END AS efficiency_pct,
    COALESCE(t.avg_quality, 0) AS avg_quality,
    COALESCE(t.completed_count, 0) AS completed,
    COALESCE(proj.project_count, 0) AS project_count,
    COALESCE(cu.licensed_users, 0) AS licensed_users,
    COALESCE(cu.active_users, 0) AS active_users,
    CASE WHEN p.total_resources > 0
      THEN ROUND((COALESCE(cu.active_users, 0)::numeric / p.total_resources * 100), 1)
      ELSE 0 END AS adoption_rate_pct,
    CASE WHEN p.total_resources > 0
      THEN ROUND((COALESCE(t.total_time_saved, 0)::numeric / p.total_resources), 1)
      ELSE 0 END AS hours_saved_per_resource,
    CASE WHEN p.total_resources > 0
      THEN ROUND((COALESCE(t.total_time_saved, 0)::numeric / (p.total_resources * 520) * 100), 2)
      ELSE 0 END AS overall_efficiency_pct
  FROM practices p
  LEFT JOIN (
    SELECT
      tk.practice,
      count(*) AS task_count,
      sum(tk.time_without_ai) AS total_time_without,
      sum(tk.time_with_ai) AS total_time_with,
      sum(tk.time_without_ai - tk.time_with_ai) AS total_time_saved,
      round(avg(NULLIF(tk.quality_rating, 0)), 2) AS avg_quality,
      count(*) FILTER (WHERE lower(tk.status) = 'completed') AS completed_count
    FROM tasks tk
    WHERE (p_quarter_id IS NULL OR tk.quarter_id = p_quarter_id)
      AND tk.approval_status = 'approved'
    GROUP BY tk.practice
  ) t ON t.practice = p.name
  LEFT JOIN (
    SELECT pr.practice, count(DISTINCT pr.project_name) AS project_count
    FROM projects pr
    GROUP BY pr.practice
  ) proj ON proj.practice = p.name
  LEFT JOIN (
    SELECT
      cu.practice,
      count(*) FILTER (WHERE lower(cu.status) = 'access granted') AS licensed_users,
      count(*) FILTER (
        WHERE lower(cu.status) = 'access granted'
        AND (
          EXISTS (SELECT 1 FROM tasks tk WHERE lower(tk.employee_email) = lower(cu.email))
          OR COALESCE(cu.ide_days_active, 0) > 0
        )
      ) AS active_users
    FROM copilot_users cu
    GROUP BY cu.practice
  ) cu ON cu.practice = p.name;
$$;
