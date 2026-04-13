-- ============================================================
-- EAS AI Adoption Dashboard — Web Dashboard View Permissions
-- Migration 008: Add web.* view keys for dashboard sidebar views
--
-- Extends the role_view_permissions table (created in 007) to cover
-- all dashboard sidebar views. Uses the same deny-list pattern:
-- all views default to visible (is_visible = true).
-- Admins can toggle is_visible = false to hide specific views per role.
--
-- Convention: web.<data-page>  for dashboard views
--             ext.<view_key>   for VS Code extension views (existing)
-- ============================================================

-- 4 roles × 17 dashboard views = 68 rows, all visible by default
-- ON CONFLICT ensures idempotency — safe to re-run

INSERT INTO role_view_permissions (role, view_key, label, is_visible) VALUES
  -- ====== Admin ======
  ('admin', 'web.dashboard',       'Dashboard',            true),
  ('admin', 'web.leaderboard',     'Leaderboard',          true),
  ('admin', 'web.mypractice',      'My Practice',          true),
  ('admin', 'web.practices',       'All Practices',        true),
  ('admin', 'web.tasks',           'All Tasks',            true),
  ('admin', 'web.mytasks',         'My Tasks',             true),
  ('admin', 'web.accomplishments', 'Accomplishments',      true),
  ('admin', 'web.approvals',       'Approvals',            true),
  ('admin', 'web.copilot',         'Licensed AI Users',    true),
  ('admin', 'web.projects',        'Projects',             true),
  ('admin', 'web.usecases',        'Use Case Library',     true),
  ('admin', 'web.prompts',         'Prompt Library',       true),
  ('admin', 'web.skills',          'Skills Library',       true),
  ('admin', 'web.guidelines',      'Guidelines',           true),
  ('admin', 'web.enablement',      'Copilot Enablement',   true),
  ('admin', 'web.ainews',          'AI News',              true),
  ('admin', 'web.vscode',          'VS Code Extension',    true),

  -- ====== SPOC ======
  ('spoc', 'web.dashboard',       'Dashboard',            true),
  ('spoc', 'web.leaderboard',     'Leaderboard',          true),
  ('spoc', 'web.mypractice',      'My Practice',          true),
  ('spoc', 'web.practices',       'All Practices',        true),
  ('spoc', 'web.tasks',           'All Tasks',            true),
  ('spoc', 'web.mytasks',         'My Tasks',             true),
  ('spoc', 'web.accomplishments', 'Accomplishments',      true),
  ('spoc', 'web.approvals',       'Approvals',            true),
  ('spoc', 'web.copilot',         'Licensed AI Users',    true),
  ('spoc', 'web.projects',        'Projects',             true),
  ('spoc', 'web.usecases',        'Use Case Library',     true),
  ('spoc', 'web.prompts',         'Prompt Library',       true),
  ('spoc', 'web.skills',          'Skills Library',       true),
  ('spoc', 'web.guidelines',      'Guidelines',           true),
  ('spoc', 'web.enablement',      'Copilot Enablement',   true),
  ('spoc', 'web.ainews',          'AI News',              true),
  ('spoc', 'web.vscode',          'VS Code Extension',    true),

  -- ====== Contributor ======
  ('contributor', 'web.dashboard',       'Dashboard',            true),
  ('contributor', 'web.leaderboard',     'Leaderboard',          true),
  ('contributor', 'web.mypractice',      'My Practice',          true),
  ('contributor', 'web.practices',       'All Practices',        true),
  ('contributor', 'web.tasks',           'All Tasks',            true),
  ('contributor', 'web.mytasks',         'My Tasks',             true),
  ('contributor', 'web.accomplishments', 'Accomplishments',      true),
  ('contributor', 'web.approvals',       'Approvals',            true),
  ('contributor', 'web.copilot',         'Licensed AI Users',    true),
  ('contributor', 'web.projects',        'Projects',             true),
  ('contributor', 'web.usecases',        'Use Case Library',     true),
  ('contributor', 'web.prompts',         'Prompt Library',       true),
  ('contributor', 'web.skills',          'Skills Library',       true),
  ('contributor', 'web.guidelines',      'Guidelines',           true),
  ('contributor', 'web.enablement',      'Copilot Enablement',   true),
  ('contributor', 'web.ainews',          'AI News',              true),
  ('contributor', 'web.vscode',          'VS Code Extension',    true),

  -- ====== Viewer ======
  ('viewer', 'web.dashboard',       'Dashboard',            true),
  ('viewer', 'web.leaderboard',     'Leaderboard',          true),
  ('viewer', 'web.mypractice',      'My Practice',          true),
  ('viewer', 'web.practices',       'All Practices',        true),
  ('viewer', 'web.tasks',           'All Tasks',            true),
  ('viewer', 'web.mytasks',         'My Tasks',             true),
  ('viewer', 'web.accomplishments', 'Accomplishments',      true),
  ('viewer', 'web.approvals',       'Approvals',            true),
  ('viewer', 'web.copilot',         'Licensed AI Users',    true),
  ('viewer', 'web.projects',        'Projects',             true),
  ('viewer', 'web.usecases',        'Use Case Library',     true),
  ('viewer', 'web.prompts',         'Prompt Library',       true),
  ('viewer', 'web.skills',          'Skills Library',       true),
  ('viewer', 'web.guidelines',      'Guidelines',           true),
  ('viewer', 'web.enablement',      'Copilot Enablement',   true),
  ('viewer', 'web.ainews',          'AI News',              true),
  ('viewer', 'web.vscode',          'VS Code Extension',    true)

ON CONFLICT (role, view_key) DO NOTHING;
