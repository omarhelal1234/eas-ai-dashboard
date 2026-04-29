-- ============================================================
-- EAS AI Adoption — Migration 048: harden resolve_approver
--
-- Discovered during phases 1-4 QA: HR sector (and ECC) had
-- sectors.sector_spoc_email=NULL, so the email-based lookup in
-- resolve_approver fell through to admin and broke sector
-- escalation. Also future-proofs against email drift between
-- the sector/department row and the SPOC user record.
--
-- Fix: when the email-join misses, fall back on canonical
--   users.role='sector_spoc' AND users.sector_id = p_sector_id
-- (and the analogous role='dept_spoc' AND department_id check
-- at the unit level). Practice level is unchanged — the
-- practice_spoc table is the source of truth there.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_approver(
  p_practice text, p_department_id uuid, p_sector_id uuid
) RETURNS approver_resolution
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT;
  v_user_id UUID;
BEGIN
  IF p_practice IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM practice_spoc ps
      JOIN users u ON u.id = ps.spoc_id
     WHERE ps.practice = p_practice
       AND ps.is_active = true
       AND u.is_active = true;
    IF v_count > 0 THEN
      RETURN ROW(NULL::UUID, 'practice')::approver_resolution;
    END IF;
  END IF;

  IF p_department_id IS NOT NULL THEN
    SELECT u.id INTO v_user_id
      FROM users u
      JOIN departments d ON lower(d.unit_spoc_email) = lower(u.email)
     WHERE d.id = p_department_id AND u.is_active
     LIMIT 1;
    IF v_user_id IS NULL THEN
      SELECT u.id INTO v_user_id
        FROM users u
       WHERE u.role = 'dept_spoc'
         AND u.department_id = p_department_id
         AND u.is_active
       LIMIT 1;
    END IF;
    IF v_user_id IS NOT NULL THEN
      RETURN ROW(v_user_id, 'unit')::approver_resolution;
    END IF;
  END IF;

  IF p_sector_id IS NOT NULL THEN
    SELECT u.id INTO v_user_id
      FROM users u
      JOIN sectors s ON lower(s.sector_spoc_email) = lower(u.email)
     WHERE s.id = p_sector_id AND u.is_active
     LIMIT 1;
    IF v_user_id IS NULL THEN
      SELECT u.id INTO v_user_id
        FROM users u
       WHERE u.role = 'sector_spoc'
         AND u.sector_id = p_sector_id
         AND u.is_active
       LIMIT 1;
    END IF;
    IF v_user_id IS NOT NULL THEN
      RETURN ROW(v_user_id, 'sector')::approver_resolution;
    END IF;
  END IF;

  SELECT id INTO v_user_id
    FROM users WHERE role = 'admin' AND is_active
    ORDER BY created_at LIMIT 1;
  RETURN ROW(v_user_id, 'admin')::approver_resolution;
END;
$function$;
