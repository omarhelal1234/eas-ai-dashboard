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
  v_avg_per_user NUMERIC;
  v_hours_min   NUMERIC;
  v_final_hours NUMERIC;
  v_gross_sar   NUMERIC;
  v_by_practice JSONB;
BEGIN
  IF v_role NOT IN ('admin', 'spoc', 'team_lead') THEN
    RETURN NULL;
  END IF;

  SELECT (value)::numeric INTO v_cap         FROM app_config WHERE key = 'roi.cap';
  SELECT (value)::numeric INTO v_coef        FROM app_config WHERE key = 'roi.coef';
  SELECT (value)::numeric INTO v_usd_per_day FROM app_config WHERE key = 'roi.usd_per_day';
  SELECT (value)::numeric INTO v_hrs_per_day FROM app_config WHERE key = 'roi.hours_per_day';
  SELECT (value)::numeric INTO v_sar_per_usd FROM app_config WHERE key = 'roi.sar_per_usd';

  v_rate_sar_hr := (v_usd_per_day / v_hrs_per_day) * v_sar_per_usd;

  IF v_role = 'admin' THEN
    IF p_practice IS NULL THEN
      v_scope     := 'org';
      v_practices := ARRAY(SELECT DISTINCT practice FROM practices ORDER BY practice);
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
    IF v_practices IS NULL OR cardinality(v_practices) = 0 THEN
      v_practices := ARRAY(
        SELECT practice FROM public.users
        WHERE auth_id = auth.uid() AND practice IS NOT NULL
      );
    END IF;
  END IF;

  IF v_practices IS NULL OR cardinality(v_practices) = 0 THEN
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

  SELECT COALESCE(SUM(LEAST(t.time_saved, v_cap)), 0)
    INTO v_m1
  FROM tasks t
  WHERE t.approval_status = 'approved'
    AND t.is_licensed_tool = true
    AND t.time_saved > 0
    AND t.practice = ANY(v_practices);

  SELECT COALESCE(SUM(t.time_saved), 0)
    INTO v_m2
  FROM tasks t
  WHERE t.approval_status = 'approved'
    AND t.is_licensed_tool = true
    AND t.time_saved > 0
    AND t.practice = ANY(v_practices);

  WITH per_user AS (
    SELECT t.employee_email, SUM(t.time_saved) AS user_total
    FROM tasks t
    WHERE t.approval_status = 'approved'
      AND t.is_licensed_tool = true
      AND t.time_saved > 0
      AND t.practice = ANY(v_practices)
    GROUP BY t.employee_email
  )
  SELECT
    COUNT(*)::int,
    COALESCE(AVG(user_total), 0)
    INTO v_active_users, v_avg_per_user
  FROM per_user;
  v_m3 := v_active_users * v_avg_per_user;

  v_hours_min   := LEAST(v_m1, v_m2, v_m3);
  v_final_hours := v_hours_min * v_coef;
  v_gross_sar   := v_final_hours * v_rate_sar_hr;

  WITH per_practice AS (
    SELECT
      t.practice,
      COALESCE(SUM(LEAST(t.time_saved, v_cap)), 0) AS m1_p,
      COALESCE(SUM(t.time_saved), 0)               AS m2_p
    FROM tasks t
    WHERE t.approval_status = 'approved'
      AND t.is_licensed_tool = true
      AND t.time_saved > 0
      AND t.practice = ANY(v_practices)
    GROUP BY t.practice
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'practice',    pp.practice,
      'final_hours', LEAST(pp.m1_p, pp.m2_p) * v_coef,
      'gross_sar',   LEAST(pp.m1_p, pp.m2_p) * v_coef * v_rate_sar_hr
    ) ORDER BY pp.practice
  ), '[]'::jsonb)
    INTO v_by_practice
  FROM per_practice pp;

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
