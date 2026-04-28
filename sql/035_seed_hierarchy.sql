-- ============================================================
-- EAS AI Adoption — Migration 035: Seed sectors, units, ADI practices
-- Spec: docs/superpowers/specs/2026-04-28-org-hierarchy-design.md §5.3
-- Source: Hierarchy.xlsx (snapshot — emails to be populated from sheet)
-- ============================================================

-- 1. 13 sectors (emails NULL until Hierarchy.xlsx is exported)
INSERT INTO sectors (name, sector_spoc_name, sector_spoc_email) VALUES
  ('HR',              '', NULL),
  ('AI & Data',       '', NULL),
  ('Sales',           '', NULL),
  ('Strategy',        '', NULL),
  ('Marketing',       '', NULL),
  ('MSO',             '', NULL),
  ('SSO',             '', NULL),
  ('ITOP',            '', NULL),
  ('Internal Audit',  '', NULL),
  ('GRC',             '', NULL),
  ('EPMO',            '', NULL),
  ('Finance',         '', NULL),
  ('ECC',             '', NULL)
ON CONFLICT (name) DO NOTHING;

-- 2. ECC's units in departments (sector_id = ECC).
DO $$
DECLARE
  v_ecc UUID;
BEGIN
  SELECT id INTO v_ecc FROM sectors WHERE name = 'ECC' LIMIT 1;
  IF v_ecc IS NULL THEN
    RAISE EXCEPTION 'ECC sector not found — seed step 1 failed';
  END IF;

  -- Insert each unit row idempotently
  INSERT INTO departments (name, sector_id, unit_spoc_name, unit_spoc_email, is_active)
  VALUES
    ('Cloud Engineering & Observability', v_ecc, '',          NULL, true),
    ('Cybersecurity',                     v_ecc, '',          NULL, true),
    ('DCX',                               v_ecc, '',          NULL, true),
    ('GTM Solution Desk',                 v_ecc, '',          NULL, true),
    ('Innovation Center',                 v_ecc, '',          NULL, true),
    ('Mega Projects',                     v_ecc, '',          NULL, true),
    ('PMO & Governance',                  v_ecc, '',          NULL, true),
    ('SE',                                v_ecc, '',          NULL, true),
    ('ADI',                               v_ecc, 'Ahmed Fadl', NULL, true)
  ON CONFLICT (name) DO UPDATE SET
    sector_id       = EXCLUDED.sector_id,
    unit_spoc_name  = COALESCE(NULLIF(EXCLUDED.unit_spoc_name, ''), departments.unit_spoc_name),
    unit_spoc_email = COALESCE(EXCLUDED.unit_spoc_email,             departments.unit_spoc_email);

  -- EAS already exists from sql/009 — link to ECC if not already linked
  UPDATE departments SET sector_id = v_ecc WHERE name = 'EAS' AND sector_id IS NULL;
END$$;

-- 3. Merge "Service Excellence" → "SE" under ECC; deactivate the old row.
DO $$
DECLARE
  v_old UUID;
  v_new UUID;
BEGIN
  SELECT id INTO v_old FROM departments WHERE name = 'Service Excellence' LIMIT 1;
  SELECT id INTO v_new FROM departments WHERE name = 'SE'                LIMIT 1;
  IF v_old IS NOT NULL AND v_new IS NOT NULL THEN
    UPDATE practices  SET department_id = v_new WHERE department_id = v_old;
    UPDATE departments SET is_active   = false WHERE id = v_old;
  END IF;
END$$;

-- 4. ADI's 8 industry-vertical practices (no SPOC email; fallback to Unit SPOC Ahmed Fadl).
DO $$
DECLARE
  v_adi UUID;
BEGIN
  SELECT id INTO v_adi FROM departments WHERE name = 'ADI' LIMIT 1;
  IF v_adi IS NULL THEN
    RAISE EXCEPTION 'ADI department not found — seed step 2 failed';
  END IF;

  INSERT INTO practices (name, department_id, practice_spoc_email, is_active) VALUES
    ('ADI - Banking',            v_adi, NULL, true),
    ('ADI - Insurance',          v_adi, NULL, true),
    ('ADI - Telecom',            v_adi, NULL, true),
    ('ADI - Healthcare',         v_adi, NULL, true),
    ('ADI - Government',         v_adi, NULL, true),
    ('ADI - Retail',             v_adi, NULL, true),
    ('ADI - Energy & Utilities', v_adi, NULL, true),
    ('ADI - Manufacturing',      v_adi, NULL, true)
  ON CONFLICT (name) DO NOTHING;
END$$;

-- 5. Existing EAS practice_spoc_email — left NULL until Hierarchy.xlsx is exported.
--    Multi-SPOC table is authoritative; emails will be populated in a follow-up data-only migration.
