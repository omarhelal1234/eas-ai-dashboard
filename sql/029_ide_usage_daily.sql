-- ============================================================
-- EAS AI Adoption — Migration 029: IDE Usage Daily
-- Date: 2026-04-22
-- Purpose:
--   1. Store raw per-user per-day IDE Copilot usage records
--      ingested from GitHub Copilot Grafana JSON dumps.
--   2. Preserve breakdowns (per IDE / feature / language / model)
--      as JSONB for on-demand drill-downs.
--   3. Provide a rollup view + refresh function that feeds the
--      aggregate ide_* columns on copilot_users (kept for backward
--      compatibility with executive / exec-summary views).
--   4. Enforce per-role visibility (admin/executive/dept_spoc all,
--      spoc practice-scoped, team_lead member-scoped, contributor
--      own-row, viewer denied).
-- ============================================================

-- ============================================================
-- 1. Roster columns + grafana_login on copilot_users
--    (emp_id / unit come from the Excel roster;
--     grafana_login matches the JSON user_login field)
-- ============================================================
ALTER TABLE copilot_users ADD COLUMN IF NOT EXISTS emp_id TEXT;
ALTER TABLE copilot_users ADD COLUMN IF NOT EXISTS unit TEXT;
CREATE INDEX IF NOT EXISTS idx_copilot_users_emp_id
  ON copilot_users(emp_id) WHERE emp_id IS NOT NULL;

ALTER TABLE copilot_users
  ADD COLUMN IF NOT EXISTS grafana_login TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_copilot_users_grafana_login
  ON copilot_users(grafana_login)
  WHERE grafana_login IS NOT NULL;

-- Best-effort initial backfill: strip the `_ejadasa` suffix commonly
-- seen on GitHub enterprise logins, compare to the derived username.
UPDATE copilot_users
   SET grafana_login = LOWER(username || '_ejadasa')
 WHERE grafana_login IS NULL
   AND username IS NOT NULL
   AND username <> '';

-- ============================================================
-- 2. ide_usage_daily — one row per (user_login, day)
-- ============================================================
CREATE TABLE IF NOT EXISTS ide_usage_daily (
  id                 BIGSERIAL PRIMARY KEY,
  user_login         TEXT NOT NULL,
  github_user_id     BIGINT,
  enterprise_id      TEXT,
  day                DATE NOT NULL,
  report_start_day   DATE,
  report_end_day     DATE,
  interactions       INT NOT NULL DEFAULT 0,
  code_generations   INT NOT NULL DEFAULT 0,
  code_acceptances   INT NOT NULL DEFAULT 0,
  used_agent         BOOLEAN NOT NULL DEFAULT FALSE,
  used_chat          BOOLEAN NOT NULL DEFAULT FALSE,
  loc_suggested_add  INT NOT NULL DEFAULT 0,
  loc_suggested_del  INT NOT NULL DEFAULT 0,
  loc_added          INT NOT NULL DEFAULT 0,
  loc_deleted        INT NOT NULL DEFAULT 0,
  by_ide             JSONB,
  by_feature         JSONB,
  by_language        JSONB,
  by_model           JSONB,
  source_file        TEXT,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ide_usage_daily_user_day_unique UNIQUE (user_login, day)
);

CREATE INDEX IF NOT EXISTS idx_iud_day      ON ide_usage_daily(day DESC);
CREATE INDEX IF NOT EXISTS idx_iud_login    ON ide_usage_daily(user_login);
CREATE INDEX IF NOT EXISTS idx_iud_login_day ON ide_usage_daily(user_login, day DESC);

COMMENT ON TABLE ide_usage_daily IS
  'Per-user, per-day GitHub Copilot IDE activity from Grafana JSON dumps. '
  'UPSERTED on (user_login, day) so re-syncing the same period is idempotent.';

-- ============================================================
-- 3. ide_usage_user_rollup view — one row per copilot_user
--    with aggregate counts over the LATEST report window per user.
-- ============================================================
CREATE OR REPLACE VIEW ide_usage_user_rollup AS
WITH latest_window AS (
  SELECT user_login,
         MAX(report_end_day) AS max_end
    FROM ide_usage_daily
   GROUP BY user_login
),
windowed AS (
  SELECT d.*
    FROM ide_usage_daily d
    JOIN latest_window w
      ON w.user_login = d.user_login
     AND d.report_end_day = w.max_end
)
SELECT
  w.user_login,
  cu.id                         AS copilot_user_id,
  cu.practice,
  cu.name,
  cu.email,
  COUNT(DISTINCT w.day) FILTER (
    WHERE w.interactions > 0 OR w.code_generations > 0
  )                             AS days_active,
  SUM(w.interactions)           AS total_interactions,
  SUM(w.code_generations)       AS code_generations,
  SUM(w.code_acceptances)       AS code_acceptances,
  COUNT(DISTINCT w.day) FILTER (WHERE w.used_agent) AS agent_days,
  COUNT(DISTINCT w.day) FILTER (WHERE w.used_chat)  AS chat_days,
  SUM(w.loc_suggested_add)      AS loc_suggested,
  SUM(w.loc_added)              AS loc_added,
  SUM(w.loc_deleted)            AS loc_deleted,
  MAX(w.day) FILTER (
    WHERE w.interactions > 0 OR w.code_generations > 0
  )                             AS last_active_date,
  MIN(w.report_start_day)       AS period_start,
  MAX(w.report_end_day)         AS period_end,
  MAX(w.synced_at)              AS last_synced_at
FROM windowed w
LEFT JOIN copilot_users cu
       ON cu.grafana_login = w.user_login
GROUP BY w.user_login, cu.id, cu.practice, cu.name, cu.email;

COMMENT ON VIEW ide_usage_user_rollup IS
  'One row per Copilot user (joined by grafana_login) with aggregate IDE '
  'metrics for the most recent report window. Feeds copilot_users.ide_* columns.';

-- ============================================================
-- 4. refresh_copilot_users_ide_aggregates()
--    Called after every NDJSON ingestion to keep copilot_users in sync
--    with ide_usage_daily.
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_copilot_users_ide_aggregates()
RETURNS INT AS $$
DECLARE
  updated_count INT := 0;
BEGIN
  -- 3a. Try to link any copilot_users rows that don't yet have a
  --     grafana_login but now have a matching daily row.
  UPDATE copilot_users cu
     SET grafana_login = d.user_login
    FROM (
      SELECT DISTINCT user_login FROM ide_usage_daily
    ) d
   WHERE cu.grafana_login IS NULL
     AND LOWER(d.user_login) = LOWER(cu.username || '_ejadasa');

  -- 3b. Propagate rollup metrics back onto copilot_users so legacy
  --     readers (executive dashboard, exec-summary export) keep working.
  UPDATE copilot_users cu
     SET ide_days_active        = COALESCE(r.days_active, 0),
         ide_total_interactions = COALESCE(r.total_interactions, 0),
         ide_code_generations   = COALESCE(r.code_generations, 0),
         ide_code_acceptances   = COALESCE(r.code_acceptances, 0),
         ide_agent_days         = COALESCE(r.agent_days, 0),
         ide_chat_days          = COALESCE(r.chat_days, 0),
         ide_loc_suggested      = COALESCE(r.loc_suggested, 0),
         ide_loc_added          = COALESCE(r.loc_added, 0),
         ide_last_active_date   = r.last_active_date,
         ide_data_period        = CASE
           WHEN r.period_start IS NOT NULL AND r.period_end IS NOT NULL
           THEN r.period_start::text || ' to ' || r.period_end::text
           ELSE cu.ide_data_period
         END,
         ide_data_updated_at    = COALESCE(r.last_synced_at, cu.ide_data_updated_at)
    FROM ide_usage_user_rollup r
   WHERE r.copilot_user_id = cu.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

COMMENT ON FUNCTION refresh_copilot_users_ide_aggregates() IS
  'Refreshes copilot_users.ide_* aggregate columns from ide_usage_user_rollup. '
  'Call after every ide_usage_daily bulk upsert.';

-- ============================================================
-- 5. Row-Level Security on ide_usage_daily
-- ============================================================
ALTER TABLE ide_usage_daily ENABLE ROW LEVEL SECURITY;

-- 5a. admin / executive: see everything
CREATE POLICY "iud_admin_all" ON ide_usage_daily
  FOR ALL
  USING (get_user_role() IN ('admin', 'executive'))
  WITH CHECK (get_user_role() = 'admin');

-- 5b. dept_spoc: see users in any practice within their department
CREATE POLICY "iud_dept_spoc_read" ON ide_usage_daily
  FOR SELECT
  USING (
    get_user_role() = 'dept_spoc'
    AND user_login IN (
      SELECT cu.grafana_login
        FROM copilot_users cu
        JOIN practices p ON p.name = cu.practice
       WHERE p.department_id = get_user_department_id()
         AND cu.grafana_login IS NOT NULL
    )
  );

-- 5c. spoc: see users in their own practice
CREATE POLICY "iud_spoc_read" ON ide_usage_daily
  FOR SELECT
  USING (
    get_user_role() = 'spoc'
    AND user_login IN (
      SELECT grafana_login
        FROM copilot_users
       WHERE practice = get_user_practice()
         AND grafana_login IS NOT NULL
    )
  );

-- 5d. team_lead: see only members assigned to them
CREATE POLICY "iud_team_lead_read" ON ide_usage_daily
  FOR SELECT
  USING (
    get_user_role() = 'team_lead'
    AND user_login IN (
      SELECT grafana_login
        FROM copilot_users
       WHERE email = ANY(get_team_lead_members())
         AND grafana_login IS NOT NULL
    )
  );

-- 5e. contributor: see only own row (match by email prefix → grafana_login)
CREATE POLICY "iud_contributor_self" ON ide_usage_daily
  FOR SELECT
  USING (
    get_user_role() = 'contributor'
    AND user_login IN (
      SELECT grafana_login
        FROM copilot_users
       WHERE LOWER(email) = LOWER(
               (SELECT email FROM users WHERE auth_id = auth.uid() LIMIT 1)
             )
         AND grafana_login IS NOT NULL
    )
  );

-- (viewer: no policy → no rows visible)

-- ============================================================
-- 6. Register web view permission for the redesigned page
--    so the new roles can see the nav item.
-- ============================================================
INSERT INTO role_view_permissions (role, view_key, is_visible) VALUES
  ('admin',       'web.ide_usage', TRUE),
  ('executive',   'web.ide_usage', TRUE),
  ('dept_spoc',   'web.ide_usage', TRUE),
  ('spoc',        'web.ide_usage', TRUE),
  ('team_lead',   'web.ide_usage', TRUE),
  ('contributor', 'web.ide_usage', TRUE),
  ('viewer',      'web.ide_usage', FALSE)
ON CONFLICT (role, view_key) DO UPDATE
  SET is_visible = EXCLUDED.is_visible;

-- ============================================================
-- End of migration 029
-- ============================================================
