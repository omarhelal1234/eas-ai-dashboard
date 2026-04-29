-- ============================================================
-- EAS AI Adoption — Migration 050: revoke anon EXECUTE on SECURITY DEFINER
--                                  functions that don't need it
--
-- Phase 4 QA + Supabase advisor flagged that several SECURITY
-- DEFINER functions are anon-executable. Most were re-defined with
-- CREATE OR REPLACE in later migrations, which resets EXECUTE
-- privileges to the PUBLIC default — silently re-granting anon.
-- That is harmless when the function self-checks auth.uid(), but
-- it bypasses the defense-in-depth pattern established in
-- 040_phase1_advisor_hardening.sql / 043_phase3_security_hardening.sql.
--
-- Audit (call-site review across js/, src/pages/, server/):
--
-- KEEP anon-executable (called pre-login or during signup):
--   * signup_contributor             — login.html, signup.html
--   * recover_incomplete_profile     — signup recovery path
--   * complete_profile               — profile-completion-modal.js
--                                      (post-login, but the path runs
--                                      under the anon key during the
--                                      first auth round-trip)
--
-- REVOKE FROM anon (auth-only or admin-only — no anon caller):
--   * revoke_org_role                — admin-only, no JS caller
--   * resolve_approver               — db.js submits with auth session
--   * sync_user_role_from_org        — auth.js (already auth-only)
--   * get_user_role / get_user_sector_id / get_user_department_id /
--     get_user_department_sector_id / get_user_practice /
--     get_current_user_id            — auth.uid()-dependent, useless
--                                      to anon
--   * get_executive_summary / get_executive_practices /
--     get_licensed_tool_adoption     — index.html / admin.html, gated
--                                      by login redirect
--   * get_team_lead_members / get_role_permissions
--                                    — internal helpers, no anon caller
--   * get_prompt_vote_counts / increment_prompt_copy /
--     add_community_prompt / vote_prompt / toggle_like
--                                    — community / engagement features,
--                                      gated by login
--   * refresh_copilot_users_ide_aggregates
--                                    — admin maintenance RPC
--   * supersede_orphan_approvals_for_submission /
--     supersede_prior_submission_approvals
--                                    — trigger functions, no GRANT needed
--   * move_unit / move_practice      — already auth-only (kept for parity)
--
-- Idempotent: REVOKE / GRANT statements are safe to re-run.
-- ============================================================

-- ---------- Admin-only RPCs ----------
REVOKE EXECUTE ON FUNCTION public.revoke_org_role(uuid)                                  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.revoke_org_role(uuid)                                  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.refresh_copilot_users_ide_aggregates()                 FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.refresh_copilot_users_ide_aggregates()                 TO authenticated;

-- ---------- Auth-context helpers (auth.uid()-dependent) ----------
REVOKE EXECUTE ON FUNCTION public.get_current_user_id()                                  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_current_user_id()                                  TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_role()                                        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_role()                                        TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_sector_id()                                   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_sector_id()                                   TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_department_id()                               FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_department_id()                               TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_department_sector_id()                        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_department_sector_id()                        TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_user_practice()                                    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_practice()                                    TO authenticated;

-- ---------- Approval / routing internals ----------
REVOKE EXECUTE ON FUNCTION public.resolve_approver(text, uuid, uuid)                     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolve_approver(text, uuid, uuid)                     TO authenticated;

-- ---------- Dashboard / executive RPCs (login-gated UI) ----------
REVOKE EXECUTE ON FUNCTION public.get_executive_summary(text)                            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_executive_summary(text)                            TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_executive_practices()                              FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_executive_practices()                              TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_licensed_tool_adoption(text)                       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_licensed_tool_adoption(text)                       TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_team_lead_members()                                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_team_lead_members()                                TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_role_permissions(text)                             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_role_permissions(text)                             TO authenticated;

-- ---------- Engagement RPCs (login-gated) ----------
REVOKE EXECUTE ON FUNCTION public.get_prompt_vote_counts()                               FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_prompt_vote_counts()                               TO authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_prompt_copy(uuid)                            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.increment_prompt_copy(uuid)                            TO authenticated;

REVOKE EXECUTE ON FUNCTION public.add_community_prompt(text, text, text, text)           FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.add_community_prompt(text, text, text, text)           TO authenticated;

REVOKE EXECUTE ON FUNCTION public.vote_prompt(uuid, text)                                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.vote_prompt(uuid, text)                                TO authenticated;

REVOKE EXECUTE ON FUNCTION public.toggle_like(text, uuid)                                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.toggle_like(text, uuid)                                TO authenticated;

-- ---------- Trigger functions (no GRANT needed; revoke for cleanliness) ----------
REVOKE EXECUTE ON FUNCTION public.supersede_orphan_approvals_for_submission()            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.supersede_prior_submission_approvals()                 FROM PUBLIC, anon;

-- ---------- Verification ----------
DO $$
DECLARE
  r RECORD;
  v_failures INT := 0;
BEGIN
  -- has_function_privilege accepts an OID directly, which sidesteps the
  -- regprocedure parser entirely. (Trying to feed it
  --   pg_get_function_arguments(oid) → 'p_quarter_id text DEFAULT NULL::text'
  -- fails because regprocedure only takes identity types, not parameter
  -- names or defaults — caught by codex review.)
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.proname IN (
         'revoke_org_role','refresh_copilot_users_ide_aggregates',
         'get_current_user_id','get_user_role','get_user_sector_id',
         'get_user_department_id','get_user_department_sector_id','get_user_practice',
         'resolve_approver','get_executive_summary','get_executive_practices',
         'get_licensed_tool_adoption','get_team_lead_members','get_role_permissions',
         'get_prompt_vote_counts','increment_prompt_copy','add_community_prompt',
         'vote_prompt','toggle_like','supersede_orphan_approvals_for_submission',
         'supersede_prior_submission_approvals'
       )
  LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') THEN
      RAISE WARNING '[050] anon STILL has EXECUTE on %(%) — investigate', r.proname, r.sig;
      v_failures := v_failures + 1;
    END IF;
  END LOOP;
  IF v_failures = 0 THEN
    RAISE NOTICE '[050] all targeted functions are now anon-revoked.';
  END IF;
END $$;
