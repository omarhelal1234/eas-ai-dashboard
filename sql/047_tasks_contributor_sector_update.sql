-- ============================================================
-- EAS AI Adoption — Migration 047: contributor sector-only UPDATE
--
-- Sector-only contributors (e.g. HR users with practice=NULL) could
-- INSERT tasks via tasks_contributor_sector_insert (sector match)
-- but the existing tasks_contributor_update policy required
-- `practice = get_user_practice()`. Both sides being NULL evaluates
-- to NULL (falsy), so HR contributors could not:
--   • flip approval_status to 'approved' (under-5h auto-approve)
--   • edit their own tasks
--
-- Mirror tasks_contributor_sector_insert with a parallel UPDATE
-- policy that matches when practice IS NULL and the user's sector
-- equals the row sector.
-- Idempotent: guarded by NOT EXISTS check.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'tasks'
       AND policyname = 'tasks_contributor_sector_update'
  ) THEN
    CREATE POLICY tasks_contributor_sector_update ON public.tasks
      FOR UPDATE
      USING ((get_user_role() = 'contributor')
             AND (practice IS NULL)
             AND (sector_id = get_user_sector_id()))
      WITH CHECK ((get_user_role() = 'contributor')
                  AND (practice IS NULL)
                  AND (sector_id = get_user_sector_id()));
  END IF;
END$$;
