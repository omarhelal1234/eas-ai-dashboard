-- ============================================================
-- EAS AI Adoption — Migration 039: org rollup RPCs
-- Spec: docs/superpowers/specs/2026-04-28-org-hierarchy-design.md §10.2
--   * get_sector_summary(p_quarter_id)
--   * get_unit_summary(p_sector_id, p_quarter_id)
--   * get_org_leaderboard(p_level, p_quarter_id)
-- All aggregate from denormalized sector_id and nullable practice so
-- flat-sector contributions appear in counts/leaderboards.
-- ============================================================

CREATE OR REPLACE FUNCTION get_sector_summary(p_quarter_id TEXT DEFAULT NULL)
RETURNS TABLE (
  sector_id    UUID,
  sector_name  TEXT,
  sector_spoc  TEXT,
  contributors INT,
  tasks        INT,
  hours_saved  NUMERIC,
  adoption_pct NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    s.id,
    s.name,
    s.sector_spoc_name,
    (SELECT count(DISTINCT email)::INT FROM copilot_users cu WHERE cu.sector_id = s.id),
    (SELECT count(*)::INT FROM tasks t
       WHERE t.sector_id = s.id
         AND t.approval_status = 'approved'
         AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)),
    COALESCE((SELECT sum(t.time_saved) FROM tasks t
       WHERE t.sector_id = s.id
         AND t.approval_status = 'approved'
         AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)), 0),
    NULL::NUMERIC -- adoption_pct deferred to phase 3 leaderboard polish
  FROM sectors s
 WHERE s.is_active
 ORDER BY s.name;
$$;

GRANT EXECUTE ON FUNCTION get_sector_summary(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION get_unit_summary(p_sector_id UUID, p_quarter_id TEXT DEFAULT NULL)
RETURNS TABLE (
  department_id   UUID,
  department_name TEXT,
  unit_spoc       TEXT,
  contributors    INT,
  tasks           INT,
  hours_saved     NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT
    d.id,
    d.name,
    d.unit_spoc_name,
    (SELECT count(DISTINCT email)::INT FROM copilot_users cu WHERE cu.department_id = d.id),
    (SELECT count(*)::INT FROM tasks t
       WHERE t.sector_id = p_sector_id
         AND t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
         AND t.approval_status = 'approved'
         AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)),
    COALESCE((SELECT sum(t.time_saved) FROM tasks t
       WHERE t.sector_id = p_sector_id
         AND t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
         AND t.approval_status = 'approved'
         AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)), 0)
  FROM departments d
 WHERE d.sector_id = p_sector_id
   AND d.is_active
 ORDER BY d.name;
$$;

GRANT EXECUTE ON FUNCTION get_unit_summary(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION get_org_leaderboard(p_level TEXT, p_quarter_id TEXT DEFAULT NULL)
RETURNS TABLE (
  scope_id     UUID,
  scope_name   TEXT,
  contributors INT,
  tasks        INT,
  hours_saved  NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF p_level = 'sector' THEN
    RETURN QUERY
      SELECT s.sector_id, s.sector_name, s.contributors, s.tasks, s.hours_saved
        FROM get_sector_summary(p_quarter_id) s
       ORDER BY s.hours_saved DESC NULLS LAST;
  ELSIF p_level = 'unit' THEN
    -- Aggregate across all sectors at the unit (department) granularity.
    RETURN QUERY
      SELECT
        d.id,
        d.name,
        (SELECT count(DISTINCT email)::INT FROM copilot_users cu WHERE cu.department_id = d.id),
        (SELECT count(*)::INT FROM tasks t
           WHERE t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
             AND t.approval_status = 'approved'
             AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)),
        COALESCE((SELECT sum(t.time_saved) FROM tasks t
           WHERE t.practice IN (SELECT name FROM practices WHERE department_id = d.id)
             AND t.approval_status = 'approved'
             AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)), 0)
      FROM departments d
      WHERE d.is_active
      ORDER BY 5 DESC NULLS LAST;
  ELSIF p_level = 'practice' THEN
    RETURN QUERY
      SELECT
        p.id,
        p.name,
        (SELECT count(DISTINCT email)::INT FROM copilot_users cu WHERE cu.practice = p.name),
        (SELECT count(*)::INT FROM tasks t
           WHERE t.practice = p.name
             AND t.approval_status = 'approved'
             AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)),
        COALESCE((SELECT sum(t.time_saved) FROM tasks t
           WHERE t.practice = p.name
             AND t.approval_status = 'approved'
             AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)), 0)
      FROM practices p
      WHERE p.is_active
      ORDER BY 5 DESC NULLS LAST;
  ELSE
    RAISE EXCEPTION 'p_level must be one of sector|unit|practice (got %)', p_level;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_org_leaderboard(TEXT, TEXT) TO authenticated;
