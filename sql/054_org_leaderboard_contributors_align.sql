-- ============================================================
-- EAS AI Adoption — Migration 054: align Org-Rankings contributor
-- count with get_practice_leaderboard.
--
-- Bug: get_org_leaderboard counted distinct entitled copilot_users
-- (96 for ERP), while get_practice_leaderboard counts distinct
-- task loggers (50 for ERP). On the same Leaderboard page, the
-- Org Rankings card and the Practice Rankings card showed
-- different contributor numbers for the same practice — and the
-- Org count was unaffected by the quarter filter (it counts an
-- all-time entitled population, not a per-quarter active one).
--
-- Fix: at all 3 levels (sector / unit / practice), count
-- COUNT(DISTINCT t.employee_name) from approved tasks in scope
-- (and respecting p_quarter_id), matching the practice RPC's
-- definition exactly.
--
-- CREATE OR REPLACE — no signature change since 053 already
-- introduced the score column.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_org_leaderboard(p_level text, p_quarter_id text DEFAULT NULL::text)
RETURNS TABLE(
  scope_id uuid,
  scope_name text,
  contributors integer,
  tasks integer,
  hours_saved numeric,
  efficiency_pct numeric,
  quality_avg numeric,
  score numeric
)
LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $function$
DECLARE v_has_quality BOOLEAN;
BEGIN
  v_has_quality := EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tasks' AND column_name='quality_rating'
  );
  IF p_level = 'sector' THEN
    RETURN QUERY
      WITH agg AS (
        SELECT s.id AS scope_id, s.name AS scope_name,
          (SELECT count(DISTINCT t.employee_name)::INT FROM tasks t
             WHERE t.sector_id = s.id AND t.approval_status='approved'
               AND t.employee_name IS NOT NULL AND t.employee_name <> ''
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)) AS contributors,
          (SELECT count(*)::INT FROM tasks t
             WHERE t.sector_id = s.id AND t.approval_status='approved'
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)) AS tasks,
          COALESCE((SELECT sum(t.time_saved) FROM tasks t
             WHERE t.sector_id = s.id AND t.approval_status='approved'
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)), 0) AS hours_saved,
          (SELECT CASE WHEN sum(t.time_without_ai) > 0
                   THEN round(100.0 * sum(t.time_saved) / NULLIF(sum(t.time_without_ai),0), 1)
                   ELSE NULL END
             FROM tasks t WHERE t.sector_id = s.id AND t.approval_status='approved'
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)) AS efficiency_pct,
          CASE WHEN v_has_quality THEN
            (SELECT round(avg(t.quality_rating)::numeric, 1)
               FROM tasks t WHERE t.sector_id = s.id AND t.approval_status='approved'
                AND t.quality_rating IS NOT NULL AND t.quality_rating > 0
                AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id))
          ELSE NULL END AS quality_avg
        FROM sectors s WHERE s.is_active
      )
      SELECT a.scope_id, a.scope_name, a.contributors, a.tasks, a.hours_saved,
             a.efficiency_pct, a.quality_avg,
             ROUND(
               COALESCE(a.hours_saved, 0) * 0.4 +
               a.tasks * 0.3 +
               COALESCE(a.efficiency_pct, 0) * 0.2 +
               COALESCE(a.quality_avg, 0) * 2
             , 1) AS score
      FROM agg a
      ORDER BY score DESC NULLS LAST;

  ELSIF p_level = 'unit' THEN
    RETURN QUERY
      WITH agg AS (
        SELECT d.id AS scope_id, d.name AS scope_name,
          (SELECT count(DISTINCT t.employee_name)::INT FROM tasks t
             WHERE t.approval_status='approved'
               AND t.employee_name IS NOT NULL AND t.employee_name <> ''
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
               AND (t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
                    OR (t.practice IS NULL
                        AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id)))) AS contributors,
          (SELECT count(*)::INT FROM tasks t
             WHERE t.approval_status='approved'
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
               AND (t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
                    OR (t.practice IS NULL
                        AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id)))) AS tasks,
          COALESCE((SELECT sum(t.time_saved) FROM tasks t
             WHERE t.approval_status='approved'
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
               AND (t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
                    OR (t.practice IS NULL
                        AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id)))), 0) AS hours_saved,
          (SELECT CASE WHEN sum(t.time_without_ai) > 0
                   THEN round(100.0 * sum(t.time_saved) / NULLIF(sum(t.time_without_ai),0), 1)
                   ELSE NULL END
             FROM tasks t WHERE t.approval_status='approved'
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
               AND (t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
                    OR (t.practice IS NULL
                        AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id)))) AS efficiency_pct,
          CASE WHEN v_has_quality THEN
            (SELECT round(avg(t.quality_rating)::numeric, 1)
               FROM tasks t WHERE t.approval_status='approved'
                AND t.quality_rating IS NOT NULL AND t.quality_rating > 0
                AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
                AND (t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
                     OR (t.practice IS NULL
                         AND lower(t.employee_email) IN (SELECT lower(cu.email) FROM copilot_users cu WHERE cu.department_id = d.id))))
          ELSE NULL END AS quality_avg
        FROM departments d WHERE d.is_active
      )
      SELECT a.scope_id, a.scope_name, a.contributors, a.tasks, a.hours_saved,
             a.efficiency_pct, a.quality_avg,
             ROUND(
               COALESCE(a.hours_saved, 0) * 0.4 +
               a.tasks * 0.3 +
               COALESCE(a.efficiency_pct, 0) * 0.2 +
               COALESCE(a.quality_avg, 0) * 2
             , 1) AS score
      FROM agg a
      ORDER BY score DESC NULLS LAST;

  ELSIF p_level = 'practice' THEN
    RETURN QUERY
      WITH agg AS (
        SELECT p.id AS scope_id, p.name AS scope_name,
          (SELECT count(DISTINCT t.employee_name)::INT FROM tasks t
             WHERE t.practice = p.name AND t.approval_status='approved'
               AND t.employee_name IS NOT NULL AND t.employee_name <> ''
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)) AS contributors,
          (SELECT count(*)::INT FROM tasks t
             WHERE t.practice = p.name AND t.approval_status='approved'
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)) AS tasks,
          COALESCE((SELECT sum(t.time_saved) FROM tasks t
             WHERE t.practice = p.name AND t.approval_status='approved'
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)), 0) AS hours_saved,
          (SELECT CASE WHEN sum(t.time_without_ai) > 0
                   THEN round(100.0 * sum(t.time_saved) / NULLIF(sum(t.time_without_ai),0), 1)
                   ELSE NULL END
             FROM tasks t WHERE t.practice = p.name AND t.approval_status='approved'
               AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)) AS efficiency_pct,
          CASE WHEN v_has_quality THEN
            (SELECT round(avg(t.quality_rating)::numeric, 1)
               FROM tasks t WHERE t.practice = p.name AND t.approval_status='approved'
                AND t.quality_rating IS NOT NULL AND t.quality_rating > 0
                AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id))
          ELSE NULL END AS quality_avg
        FROM practices p WHERE p.is_active
      )
      SELECT a.scope_id, a.scope_name, a.contributors, a.tasks, a.hours_saved,
             a.efficiency_pct, a.quality_avg,
             ROUND(
               COALESCE(a.hours_saved, 0) * 0.4 +
               a.tasks * 0.3 +
               COALESCE(a.efficiency_pct, 0) * 0.2 +
               COALESCE(a.quality_avg, 0) * 2
             , 1) AS score
      FROM agg a
      ORDER BY score DESC NULLS LAST;
  ELSE
    RAISE EXCEPTION 'p_level must be one of sector|unit|practice (got %)', p_level;
  END IF;
END;
$function$;

-- Verified: every active practice returns identical
-- (contributors, tasks, hours_saved, efficiency_pct, quality_avg, score)
-- from get_org_leaderboard('practice', q) and get_practice_leaderboard(q).
