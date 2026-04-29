-- ============================================================
-- EAS AI Adoption — Migration 051: leaderboard hierarchy enrichment
--
-- Goal: surface Department/Unit + Organization (Sector) on every
-- leaderboard row so users no longer have to memorize the org tree.
--
-- Two RPCs are extended (drop+recreate to avoid signature/overload
-- drift):
--   * public.get_employee_leaderboard(p_practice text, p_quarter_id text)
--     — originally defined in sql/016. Adds department_name, sector_name.
--   * public.get_practice_leaderboard(p_quarter_id text)
--     — has lived only in the live database (never committed in source);
--     captured here from pg_get_functiondef and extended with the same
--     hierarchy columns. Scoring math is preserved exactly.
--
-- Hierarchy resolution path (chosen over users.department_id which is
-- null for legacy / flat-sector users):
--   tasks.practice → practices.name → practices.department_id
--                                  → departments.sector_id → sectors
--
-- Joins are deferred until *after* aggregation so they cannot multiply
-- task rows. Tie-break for ambiguous practice-name matches uses
-- MIN(p.id) deterministically.
--
-- Grants: authenticated only (mirrors sql/039, sql/050). Not anon —
-- leaderboard data is not a public-signup helper.
-- Security: SECURITY INVOKER (default). RLS allows authenticated SELECT
-- on departments / practices / sectors (sql/041, sql/001 line 221).
-- ============================================================

-- 1. get_employee_leaderboard — drop+recreate with hierarchy columns

DROP FUNCTION IF EXISTS public.get_employee_leaderboard(text, text);

CREATE FUNCTION public.get_employee_leaderboard(
  p_practice text DEFAULT NULL,
  p_quarter_id text DEFAULT NULL
)
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
  streak_weeks bigint,
  department_name text,
  sector_name text
)
LANGUAGE sql STABLE
AS $$
  WITH agg AS (
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
  ),
  practice_lookup AS (
    SELECT DISTINCT ON (LOWER(p.name))
      LOWER(p.name) AS practice_lc,
      p.department_id
    FROM practices p
    ORDER BY LOWER(p.name), p.id
  )
  SELECT
    a.employee_name,
    a.employee_email,
    a.practice,
    a.task_count,
    a.total_time_saved,
    a.total_time_without,
    a.avg_efficiency,
    a.avg_quality,
    a.completed_count,
    a.first_task_date,
    a.last_task_date,
    a.streak_weeks,
    d.name AS department_name,
    s.name AS sector_name
  FROM agg a
  LEFT JOIN practice_lookup pl ON pl.practice_lc = LOWER(a.practice)
  LEFT JOIN departments d ON d.id = pl.department_id
  LEFT JOIN sectors    s ON s.id = d.sector_id
  ORDER BY a.total_time_saved DESC, a.task_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_employee_leaderboard(text, text) TO authenticated;


-- 2. get_practice_leaderboard — drop+recreate with hierarchy columns
--    Score formula preserved exactly:
--      time_saved*0.4 + tasks*0.3 + efficiency*0.2 + quality*2

DROP FUNCTION IF EXISTS public.get_practice_leaderboard(text);

CREATE FUNCTION public.get_practice_leaderboard(
  p_quarter_id text DEFAULT NULL
)
RETURNS TABLE(
  practice text,
  task_count bigint,
  employee_count bigint,
  total_time_saved numeric,
  total_time_without numeric,
  avg_efficiency numeric,
  avg_quality numeric,
  completed_count bigint,
  accomplishment_count bigint,
  copilot_users bigint,
  score numeric,
  department_name text,
  sector_name text
)
LANGUAGE sql STABLE
AS $$
  WITH task_stats AS (
    SELECT
      t.practice,
      COUNT(*)::BIGINT AS task_count,
      COUNT(DISTINCT t.employee_name)::BIGINT AS employee_count,
      COALESCE(SUM(t.time_saved), 0) AS total_time_saved,
      COALESCE(SUM(t.time_without_ai), 0) AS total_time_without,
      CASE WHEN SUM(t.time_without_ai) > 0
        THEN ROUND(SUM(t.time_saved) / SUM(t.time_without_ai) * 100, 1)
        ELSE 0 END AS avg_efficiency,
      ROUND(AVG(t.quality_rating) FILTER (WHERE t.quality_rating > 0), 1) AS avg_quality,
      COUNT(*) FILTER (WHERE t.status = 'Completed')::BIGINT AS completed_count
    FROM tasks t
    WHERE (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
      AND t.approval_status = 'approved'
    GROUP BY t.practice
  ),
  acc_stats AS (
    SELECT a.practice, COUNT(*)::BIGINT AS accomplishment_count
    FROM accomplishments a
    WHERE (p_quarter_id IS NULL OR a.quarter_id = p_quarter_id)
      AND a.approval_status = 'approved'
    GROUP BY a.practice
  ),
  cu_stats AS (
    SELECT c.practice, COUNT(*)::BIGINT AS copilot_users
    FROM copilot_users c
    GROUP BY c.practice
  ),
  practice_lookup AS (
    SELECT DISTINCT ON (LOWER(p.name))
      LOWER(p.name) AS practice_lc,
      p.department_id
    FROM practices p
    ORDER BY LOWER(p.name), p.id
  )
  SELECT
    ts.practice,
    ts.task_count,
    ts.employee_count,
    ts.total_time_saved,
    ts.total_time_without,
    ts.avg_efficiency,
    ts.avg_quality,
    ts.completed_count,
    COALESCE(ac.accomplishment_count, 0) AS accomplishment_count,
    COALESCE(cu.copilot_users, 0) AS copilot_users,
    ROUND(
      COALESCE(ts.total_time_saved, 0) * 0.4 +
      ts.task_count * 0.3 +
      COALESCE(ts.avg_efficiency, 0) * 0.2 +
      COALESCE(ts.avg_quality, 0) * 2
    , 1) AS score,
    d.name AS department_name,
    s.name AS sector_name
  FROM task_stats ts
  LEFT JOIN acc_stats      ac ON ac.practice    = ts.practice
  LEFT JOIN cu_stats       cu ON cu.practice    = ts.practice
  LEFT JOIN practice_lookup pl ON pl.practice_lc = LOWER(ts.practice)
  LEFT JOIN departments     d ON d.id           = pl.department_id
  LEFT JOIN sectors         s ON s.id           = d.sector_id
  ORDER BY score DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_practice_leaderboard(text) TO authenticated;


-- 3. Smoke probes (run manually via execute_sql, not part of migration):
--   SELECT employee_name, practice, department_name, sector_name
--   FROM get_employee_leaderboard(NULL, NULL) LIMIT 5;
--
--   SELECT practice, score, department_name, sector_name
--   FROM get_practice_leaderboard(NULL) LIMIT 10;
