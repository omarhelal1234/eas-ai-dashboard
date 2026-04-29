-- ============================================================
-- EAS AI Adoption — Migration 053: unify Org-Rankings score
--
-- Bug: the Practice tab in Org Rankings did not match Practice
-- Rankings — sectors/units/practices in get_org_leaderboard had no
-- score column and were ordered by hours_saved, while Practice
-- Rankings uses the weighted score from get_practice_leaderboard:
--    time_saved*0.4 + tasks*0.3 + efficiency_pct*0.2 + quality_avg*2
--
-- Fix: extend get_org_leaderboard with the same `score numeric`
-- column, applied identically at every level (sector / unit /
-- practice), and order by score DESC. Body otherwise preserved
-- from the live definition (v_has_quality dynamic check, RLS
-- model, sector_id-denormalised filter on tasks).
--
-- Also: round quality_avg to 1 decimal (was 2 in the previous
-- live version). The practice RPC rounds to 1; matching it here
-- removes a ±0.1 score drift between the two surfaces.
--
-- Verified post-deploy: every practice score returned by
-- get_org_leaderboard('practice', …) is identical to the score
-- in get_practice_leaderboard(…) for the same quarter.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_org_leaderboard(text, text);

CREATE FUNCTION public.get_org_leaderboard(p_level text, p_quarter_id text DEFAULT NULL::text)
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
          (SELECT count(DISTINCT cu.email)::INT FROM copilot_users cu WHERE cu.sector_id = s.id) AS contributors,
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
          (SELECT count(DISTINCT cu.email)::INT FROM copilot_users cu
             WHERE cu.department_id = d.id
                OR cu.practice IN (SELECT name FROM practices WHERE department_id = d.id)) AS contributors,
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
          (SELECT count(DISTINCT cu.email)::INT FROM copilot_users cu WHERE cu.practice = p.name) AS contributors,
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

GRANT EXECUTE ON FUNCTION public.get_org_leaderboard(text, text) TO authenticated;

-- Smoke probes:
--   SELECT scope_name, tasks, hours_saved, score FROM get_org_leaderboard('practice', NULL);
--   -- order should match Practice Rankings cards
