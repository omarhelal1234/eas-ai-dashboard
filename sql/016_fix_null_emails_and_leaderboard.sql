-- Migration 016: Fix null employee_email in tasks and prevent duplicate leaderboard entries
-- Date: 2026-04-14
-- Problem: Tasks imported without employee_email caused duplicate entries in get_employee_leaderboard
--          because the function grouped by (employee_name, employee_email, practice) and NULL != NULL.

-- 1. Backfill null employee_email from copilot_users by name match
UPDATE tasks t
SET employee_email = cu.email
FROM copilot_users cu
WHERE t.employee_email IS NULL
  AND t.employee_name IS NOT NULL
  AND t.employee_name != ''
  AND LOWER(TRIM(t.employee_name)) = LOWER(TRIM(cu.name));

-- 2. Recreate get_employee_leaderboard to group by (employee_name, practice) only
--    Using MAX(employee_email) to pick a non-null email when available.
CREATE OR REPLACE FUNCTION public.get_employee_leaderboard(p_practice text DEFAULT NULL, p_quarter_id text DEFAULT NULL)
RETURNS TABLE(
  employee_name text,
  employee_email text,
  practice text,
  task_count bigint,
  total_time_saved numeric,
  total_time_without numeric,
  avg_efficiency numeric,
  avg_quality numeric,
  completed_count bigint,
  first_task_date date,
  last_task_date date,
  streak_weeks bigint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    t.employee_name,
    MAX(t.employee_email) AS employee_email,
    t.practice,
    COUNT(*)::BIGINT AS task_count,
    COALESCE(SUM(t.time_saved), 0) AS total_time_saved,
    COALESCE(SUM(t.time_without_ai), 0) AS total_time_without,
    CASE WHEN SUM(t.time_without_ai) > 0
      THEN ROUND(SUM(t.time_saved) / SUM(t.time_without_ai) * 100, 1)
      ELSE 0 END AS avg_efficiency,
    ROUND(AVG(t.quality_rating) FILTER (WHERE t.quality_rating > 0), 1) AS avg_quality,
    COUNT(*) FILTER (WHERE t.status = 'Completed')::BIGINT AS completed_count,
    MIN(t.week_start)::DATE AS first_task_date,
    MAX(t.week_start)::DATE AS last_task_date,
    COUNT(DISTINCT t.week_number)::BIGINT AS streak_weeks
  FROM tasks t
  WHERE (p_practice IS NULL OR t.practice = p_practice)
    AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
    AND t.employee_name IS NOT NULL
    AND t.employee_name != ''
    AND t.approval_status = 'approved'
  GROUP BY t.employee_name, t.practice
  ORDER BY total_time_saved DESC, task_count DESC;
$$;
