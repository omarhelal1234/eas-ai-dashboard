-- ============================================================
-- EAS AI Adoption — Migration 040: Phase 1 advisor hardening
-- Resolves Supabase advisor findings for the 7 Phase-1 migrations.
--
--  ERRORs (3): rls_disabled_in_public on role_change_log,
--              migration_orphans, hierarchy_migration_log
--    → enable RLS, admin-only ALL policy. These tables contain
--      user-identifying data and audit trails — must not be open.
--
--  WARNs (16):
--    * function_search_path_mutable on cascade_deactivate_sector /
--      cascade_deactivate_department
--      → set search_path = public on both functions.
--    * anon_security_definer_function_executable +
--      authenticated_security_definer_function_executable on
--      get_user_sector_id, populate_sector_id, resolve_approver,
--      revoke_org_role, signup_contributor, sync_user_role_from_org,
--      trigger_sync_user_on_email_change
--      → REVOKE EXECUTE FROM PUBLIC and re-GRANT only to the roles
--        that actually need it. populate_sector_id /
--        trigger_sync_user_on_email_change run as triggers (not as
--        RPCs) — REVOKE FROM PUBLIC is sufficient. signup_contributor
--        keeps anon (signup happens before login).
-- ============================================================

-- 1. RLS on the 3 audit tables (admin-only)
ALTER TABLE role_change_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_orphans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE hierarchy_migration_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_change_log_admin_all"         ON role_change_log;
DROP POLICY IF EXISTS "migration_orphans_admin_all"       ON migration_orphans;
DROP POLICY IF EXISTS "hierarchy_migration_log_admin_all" ON hierarchy_migration_log;

CREATE POLICY "role_change_log_admin_all"
  ON role_change_log FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "migration_orphans_admin_all"
  ON migration_orphans FOR ALL USING (get_user_role() = 'admin');
CREATE POLICY "hierarchy_migration_log_admin_all"
  ON hierarchy_migration_log FOR ALL USING (get_user_role() = 'admin');

-- 2. Lock down search_path on the cascade-deactivate functions
ALTER FUNCTION cascade_deactivate_sector()     SET search_path = public;
ALTER FUNCTION cascade_deactivate_department() SET search_path = public;

-- 3. REVOKE PUBLIC EXECUTE on every Phase-1 SECURITY DEFINER function;
--    re-GRANT only to the roles that actually call it.
REVOKE EXECUTE ON FUNCTION get_user_sector_id()                                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION populate_sector_id()                                        FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION resolve_approver(TEXT, UUID, UUID)                          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION revoke_org_role(UUID)                                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sync_user_role_from_org(UUID)                               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION trigger_sync_user_on_email_change()                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.signup_contributor(uuid, text, text, text, text, boolean, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cascade_deactivate_sector()                                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cascade_deactivate_department()                             FROM PUBLIC;

-- get_user_sector_id is called inline by RLS policies — every policy evaluation
-- runs as the querying role (authenticated/anon). RLS internally calls SECURITY
-- DEFINER functions even when the caller can't, so direct EXECUTE rights aren't
-- strictly required. Grant authenticated for transparency in case any RPC reads it.
GRANT EXECUTE ON FUNCTION get_user_sector_id()                       TO authenticated;

-- resolve_approver / sync_user_role_from_org are RPC-callable (js/db.js + js/auth.js)
GRANT EXECUTE ON FUNCTION resolve_approver(TEXT, UUID, UUID)         TO authenticated;
GRANT EXECUTE ON FUNCTION sync_user_role_from_org(UUID)              TO authenticated;

-- revoke_org_role is admin-only but the function itself checks auth.uid → role='admin'
GRANT EXECUTE ON FUNCTION revoke_org_role(UUID)                      TO authenticated;

-- signup_contributor must remain callable by anon (signup happens pre-login)
GRANT EXECUTE ON FUNCTION public.signup_contributor(uuid, text, text, text, text, boolean, uuid, uuid) TO anon, authenticated;

-- populate_sector_id, trigger_sync_user_on_email_change, cascade_deactivate_*:
-- run only as triggers. Triggers fire under the calling role, but the function
-- body executes as the definer (postgres) regardless of the caller's grants.
-- REVOKE FROM PUBLIC + REVOKE FROM anon, authenticated (below) means nobody
-- can call them as RPCs — exactly what we want.
--
-- Accepted residual advisor noise after this migration:
--   * 10 WARNs (anon_/authenticated_security_definer_function_executable)
--     on get_user_sector_id, resolve_approver, revoke_org_role,
--     signup_contributor, sync_user_role_from_org. These functions are
--     RPCs by design — they MUST be callable by anon (signup) or
--     authenticated (post-login). The warnings are informational; we
--     can't suppress them without breaking the auth/approval flows.

-- ------------------------------------------------------------
-- Trigger-only function lockdown (added in re-deploy round-trip):
-- Supabase explicitly grants EXECUTE to anon + authenticated on
-- CREATE FUNCTION; the REVOKE FROM PUBLIC above doesn't strip those.
-- These functions never run as RPCs — only as triggers — so the
-- explicit grants are pure attack surface.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION populate_sector_id()                FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION trigger_sync_user_on_email_change() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION cascade_deactivate_sector()         FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION cascade_deactivate_department()     FROM anon, authenticated;
