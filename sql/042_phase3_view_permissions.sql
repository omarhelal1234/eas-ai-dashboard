-- ============================================================
-- EAS AI Adoption — Migration 042: Phase 3 — view permissions for the new
-- "Org Overview" sidebar item. Seeds web.org for every existing role so
-- the drill-down landing is visible by default.
-- ============================================================

INSERT INTO role_view_permissions (role, view_key, is_visible) VALUES
  ('admin',         'web.org', true),
  ('spoc',          'web.org', true),
  ('dept_spoc',     'web.org', true),
  ('sector_spoc',   'web.org', true),
  ('team_lead',     'web.org', true),
  ('contributor',   'web.org', true),
  ('viewer',        'web.org', true),
  ('executive',     'web.org', true)
ON CONFLICT (role, view_key) DO UPDATE SET is_visible = EXCLUDED.is_visible;
