-- ============================================================
-- Migration 056 — Conservative ROI
-- Date: 2026-04-29
-- Adds:
--   1. app_config         — tunable constants (admin-editable)
--   2. is_licensed_tool_value() — pure helper to classify any ai_tool string
--   3. get_conservative_roi(p_practice) — admin/SPOC-only RPC
-- ============================================================

-- 1. Tunable constants table
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config_read_admin_spoc" ON app_config;
CREATE POLICY "app_config_read_admin_spoc" ON app_config
  FOR SELECT USING (
    get_user_role() IN ('admin', 'spoc', 'team_lead')
  );

DROP POLICY IF EXISTS "app_config_write_admin" ON app_config;
CREATE POLICY "app_config_write_admin" ON app_config
  FOR ALL USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 2. Seed ROI constants
INSERT INTO app_config (key, value) VALUES
  ('roi.cap',           '8'::jsonb),
  ('roi.coef',          '0.5'::jsonb),
  ('roi.usd_per_day',   '250'::jsonb),
  ('roi.hours_per_day', '8'::jsonb),
  ('roi.sar_per_usd',   '3.75'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 3. Pure helper: classify any ai_tool string as licensed.
CREATE OR REPLACE FUNCTION is_licensed_tool_value(p_ai_tool TEXT)
RETURNS BOOLEAN AS $$
  SELECT
    CASE
      WHEN p_ai_tool IS NULL THEN false
      WHEN LOWER(p_ai_tool) LIKE '%github copilot%' THEN true
      WHEN LOWER(p_ai_tool) LIKE '%m365 copilot%'  THEN true
      ELSE false
    END;
$$ LANGUAGE sql IMMUTABLE
   SET search_path = public, pg_catalog;

-- 4. Conservative ROI RPC (admin + spoc/team_lead only)
CREATE OR REPLACE FUNCTION get_conservative_roi(p_practice TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_role        TEXT := get_user_role();
  v_cap         NUMERIC;
  v_coef        NUMERIC;
  v_usd_per_day NUMERIC;
  v_hrs_per_day NUMERIC;
  v_sar_per_usd NUMERIC;
  v_rate_sar_hr NUMERIC;
  v_practices   TEXT[];
  v_scope       TEXT;
  v_m1 NUMERIC; v_m2 NUMERIC; v_m3 NUMERIC;
  v_active_users INT;
  v_median_per_user NUMERIC;
  v_hours_min   NUMERIC;
  v_final_hours NUMERIC;
  v_gross_sar   NUMERIC;
  v_by_practice JSONB;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'spoc', 'team_lead') THEN
    RETURN NULL;
  END IF;

  SELECT (value)::numeric INTO v_cap         FROM app_config WHERE key = 'roi.cap';
  SELECT (value)::numeric INTO v_coef        FROM app_config WHERE key = 'roi.coef';
  SELECT (value)::numeric INTO v_usd_per_day FROM app_config WHERE key = 'roi.usd_per_day';
  SELECT (value)::numeric INTO v_hrs_per_day FROM app_config WHERE key = 'roi.hours_per_day';
  SELECT (value)::numeric INTO v_sar_per_usd FROM app_config WHERE key = 'roi.sar_per_usd';

  IF v_cap IS NULL OR v_coef IS NULL OR v_usd_per_day IS NULL
     OR v_hrs_per_day IS NULL OR v_sar_per_usd IS NULL THEN
    RAISE EXCEPTION 'app_config missing one or more roi.* keys (cap/coef/usd_per_day/hours_per_day/sar_per_usd)';
  END IF;
  IF v_hrs_per_day = 0 THEN
    RAISE EXCEPTION 'app_config roi.hours_per_day must be > 0';
  END IF;

  v_rate_sar_hr := (v_usd_per_day / v_hrs_per_day) * v_sar_per_usd;

  IF v_role = 'admin' THEN
    IF p_practice IS NULL THEN
      v_scope     := 'org';
      v_practices := ARRAY(SELECT DISTINCT name FROM practices WHERE COALESCE(is_active, true) = true ORDER BY name);
    ELSE
      v_scope     := 'practice';
      v_practices := ARRAY[p_practice];
    END IF;
  ELSE
    v_scope := 'practice';
    v_practices := ARRAY(
      SELECT DISTINCT ps.practice
      FROM practice_spoc ps
      JOIN public.users u ON u.id = ps.spoc_id
      WHERE u.auth_id = auth.uid()
        AND COALESCE(ps.is_active, true) = true
    );
    -- Fallback only when user has NO practice_spoc rows at all (not "no ACTIVE rows" —
    -- a deactivated SPOC must NOT auto-recover via users.practice).
    IF cardinality(v_practices) = 0 THEN
      IF NOT EXISTS (
        SELECT 1 FROM practice_spoc ps
        JOIN public.users u ON u.id = ps.spoc_id
        WHERE u.auth_id = auth.uid()
      ) THEN
        v_practices := ARRAY(
          SELECT practice FROM public.users
          WHERE auth_id = auth.uid() AND practice IS NOT NULL
        );
      END IF;
    END IF;
  END IF;

  IF cardinality(v_practices) = 0 THEN
    RETURN jsonb_build_object(
      'scope', v_scope,
      'practices_in_scope', '[]'::jsonb,
      'method1_hours', 0, 'method2_hours', 0, 'method3_hours', 0,
      'hours_min', 0, 'coef', v_coef, 'cap', v_cap,
      'final_hours', 0, 'rate_sar_hr', v_rate_sar_hr, 'gross_sar', 0,
      'by_practice', '[]'::jsonb,
      'computed_at', now()
    );
  END IF;

  -- Single-pass scan over tasks. base feeds totals (m1/m2), per_user (median for m3),
  -- and per_practice (per-practice capped sums for the breakdown).
  -- Method 3: active_users × median(per_user_total). Median (not mean) makes this
  -- genuinely independent of method 2 — robust to outliers.
  -- per-practice uses capped sum directly: LEAST(capped_sum, raw_sum) is always capped_sum
  WITH base AS (
    SELECT t.practice, t.employee_email,
           t.time_saved,
           LEAST(t.time_saved, v_cap) AS capped
    FROM tasks t
    WHERE t.approval_status = 'approved'
      AND t.is_licensed_tool = true
      AND t.time_saved > 0
      AND t.practice = ANY(v_practices)
  ),
  per_user AS (
    SELECT employee_email, SUM(time_saved) AS user_total
    FROM base
    GROUP BY employee_email
  ),
  totals AS (
    SELECT
      COALESCE(SUM(capped),     0) AS m1,
      COALESCE(SUM(time_saved), 0) AS m2
    FROM base
  ),
  user_stats AS (
    SELECT
      COUNT(*)::int                                                        AS active_users,
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY user_total), 0) AS median_per_user
    FROM per_user
  ),
  per_practice AS (
    SELECT
      practice,
      COALESCE(SUM(capped), 0) AS m1_p
    FROM base
    GROUP BY practice
  )
  SELECT
    t.m1, t.m2, us.active_users, us.median_per_user,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'practice',    pp.practice,
        'final_hours', pp.m1_p * v_coef,
        'gross_sar',   pp.m1_p * v_coef * v_rate_sar_hr
      ) ORDER BY pp.practice
    ) FILTER (WHERE pp.practice IS NOT NULL), '[]'::jsonb) AS by_practice
    INTO v_m1, v_m2, v_active_users, v_median_per_user, v_by_practice
  FROM totals t
  CROSS JOIN user_stats us
  LEFT JOIN per_practice pp ON true
  GROUP BY t.m1, t.m2, us.active_users, us.median_per_user;

  v_m3          := v_active_users * v_median_per_user;
  v_hours_min   := LEAST(v_m1, v_m2, v_m3);
  v_final_hours := v_hours_min * v_coef;
  v_gross_sar   := v_final_hours * v_rate_sar_hr;

  RETURN jsonb_build_object(
    'scope', v_scope,
    'practices_in_scope', to_jsonb(v_practices),
    'method1_hours', v_m1,
    'method2_hours', v_m2,
    'method3_hours', v_m3,
    'hours_min',     v_hours_min,
    'coef',          v_coef,
    'cap',           v_cap,
    'final_hours',   v_final_hours,
    'rate_sar_hr',   v_rate_sar_hr,
    'gross_sar',     v_gross_sar,
    'by_practice',   v_by_practice,
    'computed_at',   now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
   SET search_path = public, pg_catalog;

REVOKE ALL ON FUNCTION get_conservative_roi(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_conservative_roi(TEXT) TO authenticated;

-- Covering index for the ROI scan path (and other dashboards filtering on the same combo)
CREATE INDEX IF NOT EXISTS idx_tasks_roi_scan
  ON tasks (practice, approval_status, is_licensed_tool)
  INCLUDE (time_saved, employee_email)
  WHERE approval_status = 'approved' AND is_licensed_tool = true;

COMMENT ON TABLE  app_config                IS 'Tunable, admin-editable constants. Read by SECURITY DEFINER RPCs.';
COMMENT ON FUNCTION is_licensed_tool_value(TEXT) IS 'Pure classifier mirroring the rule used by tasks.is_licensed_tool generated column (sql/004). Kept for parity-check tests and future call sites.';
COMMENT ON FUNCTION get_conservative_roi(TEXT) IS 'Returns conservative ROI (final hours saved + gross SAR) for admins (org-wide or filtered) and Dept SPOCs (their practice_spoc assignments only). NULL for other roles. Computes 3 independent hour methods (capped sum, raw sum, users × median per-user), takes MIN, applies humility coefficient. See docs/superpowers/specs/2026-04-29-conservative-roi-design.md.';
