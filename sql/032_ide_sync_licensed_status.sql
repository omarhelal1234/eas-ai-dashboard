-- ============================================================
-- EAS AI Adoption — Migration 032: IDE sync ↔ Licensed AI Users
-- Date: 2026-04-29
-- Purpose:
--   Close two gaps that left "Licensed AI Users" KPIs stale
--   even after a successful IDE NDJSON upload:
--
--   1. ide_usage_user_rollup previously aggregated only the
--      LATEST report window per user. A partial re-upload could
--      shrink ide_days_active. Now it aggregates across all
--      windows, so re-uploads are monotonic-extending and
--      idempotent (the daily UPSERT key already guarantees no
--      double-counting).
--
--   2. refresh_copilot_users_ide_aggregates() now also flips
--      copilot_users.github_copilot_status to 'active' when the
--      user has any IDE activity (and stamps the activation
--      timestamp once). The get_licensed_tool_adoption() RPC
--      and practice_summary view read this column directly, so
--      KPIs now track real IDE usage instead of staying frozen
--      at the manual default.
-- ============================================================

-- ============================================================
-- 1. Rebuild ide_usage_user_rollup over ALL windows per user.
-- ============================================================
CREATE OR REPLACE VIEW ide_usage_user_rollup AS
SELECT
  d.user_login,
  cu.id                         AS copilot_user_id,
  cu.practice,
  cu.name,
  cu.email,
  COUNT(DISTINCT d.day) FILTER (
    WHERE d.interactions > 0 OR d.code_generations > 0
  )                             AS days_active,
  SUM(d.interactions)           AS total_interactions,
  SUM(d.code_generations)       AS code_generations,
  SUM(d.code_acceptances)       AS code_acceptances,
  COUNT(DISTINCT d.day) FILTER (WHERE d.used_agent) AS agent_days,
  COUNT(DISTINCT d.day) FILTER (WHERE d.used_chat)  AS chat_days,
  SUM(d.loc_suggested_add)      AS loc_suggested,
  SUM(d.loc_added)              AS loc_added,
  SUM(d.loc_deleted)            AS loc_deleted,
  MAX(d.day) FILTER (
    WHERE d.interactions > 0 OR d.code_generations > 0
  )                             AS last_active_date,
  MIN(d.report_start_day)       AS period_start,
  MAX(d.report_end_day)         AS period_end,
  MAX(d.synced_at)              AS last_synced_at
FROM ide_usage_daily d
LEFT JOIN copilot_users cu
       ON cu.grafana_login = d.user_login
GROUP BY d.user_login, cu.id, cu.practice, cu.name, cu.email;

COMMENT ON VIEW ide_usage_user_rollup IS
  'One row per Copilot user (joined by grafana_login) with aggregate IDE '
  'metrics across ALL synced windows. Re-uploads of the same period are '
  'idempotent because ide_usage_daily UPSERTs on (user_login, day).';

-- ============================================================
-- 2. Refresh function — also flip github_copilot_status
--    for users with any IDE activity.
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_copilot_users_ide_aggregates()
RETURNS INT AS $$
DECLARE
  updated_count INT := 0;
BEGIN
  -- 2a. Backfill grafana_login for unlinked roster rows whose
  --     username matches the standard <username>_ejadasa pattern.
  UPDATE copilot_users cu
     SET grafana_login = d.user_login
    FROM (
      SELECT DISTINCT user_login FROM ide_usage_daily
    ) d
   WHERE cu.grafana_login IS NULL
     AND LOWER(d.user_login) = LOWER(cu.username || '_ejadasa');

  -- 2b. Push rollup metrics back onto copilot_users.
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

  -- 2c. Flip github_copilot_status to 'active' for anyone with
  --     IDE activity, stamping the activation date the first time.
  --     We do not flip back to 'inactive' here — that would race
  --     with manual admin overrides.
  UPDATE copilot_users
     SET github_copilot_status = 'active',
         github_copilot_activated_at = COALESCE(github_copilot_activated_at, NOW())
   WHERE COALESCE(ide_days_active, 0) > 0
     AND github_copilot_status IS DISTINCT FROM 'active';

  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

COMMENT ON FUNCTION refresh_copilot_users_ide_aggregates() IS
  'Refreshes copilot_users.ide_* aggregate columns from ide_usage_user_rollup '
  'and flips github_copilot_status to active for users with IDE activity. '
  'Call after every ide_usage_daily bulk upsert.';

-- ============================================================
-- End of migration 032
-- ============================================================
