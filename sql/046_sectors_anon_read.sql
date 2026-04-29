-- ============================================================
-- EAS AI Adoption — Migration 046: allow anonymous read of sectors
--
-- Bug discovered during phases 1-4 QA: signup.html cascade renders
-- empty because the unauthenticated user cannot read public.sectors.
-- departments and practices already have public-readable policies
-- (*_read with qual=true), but sectors only had:
--   - sectors_admin_all   (admin only)
--   - sectors_read_authenticated (auth.uid() IS NOT NULL)
-- → anon Supabase client returns 0 rows for sectors, so the sector
-- dropdown stays at "Select your sector...". Cascading signup is
-- broken for every new user.
--
-- Fix: add a permissive SELECT policy with qual=true, matching the
-- pattern already used on departments_read / practices_read.
-- Idempotent: guarded by NOT EXISTS check.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'sectors'
       AND policyname = 'sectors_read'
  ) THEN
    CREATE POLICY sectors_read ON public.sectors
      FOR SELECT USING (true);
  END IF;
END$$;

-- Sanity probe (anon should now see all active sectors):
-- SET ROLE anon;
-- SELECT count(*) FROM sectors WHERE is_active;  -- expect 13
-- RESET ROLE;
