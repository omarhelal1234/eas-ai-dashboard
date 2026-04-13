# Executive Role — Implementation Plan

**Date:** 2026-04-13  
**Status:** Implemented  
**Author:** Omar / Copilot

---

## Overview

Add a new `executive` role to the EAS AI Adoption Dashboard. Executives are senior directors who need cross-practice, read-only visibility into adoption metrics across multiple assigned practices, presented through a dedicated executive summary dashboard.

### Role Characteristics

| Attribute | Value |
|-----------|-------|
| Role key | `executive` |
| Data access | Read-only across assigned practices |
| Practice scope | Multi-practice (via assignment table) |
| Dashboard views | Executive summary KPI dashboard only |
| Can log tasks | No |
| Can approve | No |
| Can manage users | No |

---

## Phase 1 — Database Schema (New Migration: `010_executive_role.sql`)

### 1.1 Alter `users` table CHECK constraint

The current constraint is inline on the `role` column. We need to drop and recreate it to add `'executive'`.

```sql
-- Drop existing CHECK constraint on users.role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Add updated constraint including 'executive'
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'spoc', 'contributor', 'viewer', 'executive'));
```

**File:** `sql/010_executive_role.sql` (new file)

### 1.2 Alter `role_view_permissions` CHECK constraint

Same pattern — the `role_view_permissions` table also has a CHECK on its `role` column.

```sql
-- Drop existing CHECK on role_view_permissions.role
ALTER TABLE role_view_permissions DROP CONSTRAINT IF EXISTS role_view_permissions_role_check;

-- Add updated constraint
ALTER TABLE role_view_permissions ADD CONSTRAINT role_view_permissions_role_check
  CHECK (role IN ('admin', 'spoc', 'contributor', 'viewer', 'executive'));
```

### 1.3 Create `executive_practices` junction table

Enables multi-practice assignment for executive users.

```sql
CREATE TABLE executive_practices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice    TEXT NOT NULL REFERENCES practices(name),
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, practice)
);

CREATE INDEX idx_exec_practices_user ON executive_practices(user_id);
CREATE INDEX idx_exec_practices_practice ON executive_practices(practice);

COMMENT ON TABLE executive_practices IS
  'Maps executive users to the practices they oversee. One executive can have many practices.';
```

### 1.4 RLS policies for `executive_practices`

```sql
ALTER TABLE executive_practices ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY "exec_practices_admin_all"
  ON executive_practices FOR ALL
  USING (get_user_role() = 'admin');

-- Executives: read their own assignments
CREATE POLICY "exec_practices_self_read"
  ON executive_practices FOR SELECT
  USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
```

### 1.5 Helper function for executive practice list

```sql
CREATE OR REPLACE FUNCTION get_executive_practices()
RETURNS TEXT[] AS $$
  SELECT COALESCE(
    array_agg(practice),
    ARRAY[]::TEXT[]
  )
  FROM executive_practices
  WHERE user_id = (SELECT id FROM users WHERE auth_id = auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE
   SET search_path = public;
```

### 1.6 Update existing RLS policies for executive read access

The executive needs read-only access to tasks, accomplishments, copilot_users, and projects — but scoped to their assigned practices only.

```sql
-- Tasks: executive can read their assigned practices
CREATE POLICY "tasks_executive_read"
  ON tasks FOR SELECT
  USING (
    get_user_role() = 'executive'
    AND practice = ANY(get_executive_practices())
  );

-- Accomplishments: executive read for assigned practices
CREATE POLICY "acc_executive_read"
  ON accomplishments FOR SELECT
  USING (
    get_user_role() = 'executive'
    AND practice = ANY(get_executive_practices())
  );

-- Copilot users: executive read for assigned practices
CREATE POLICY "copilot_executive_read"
  ON copilot_users FOR SELECT
  USING (
    get_user_role() = 'executive'
    AND practice = ANY(get_executive_practices())
  );

-- Projects: executive read for assigned practices
CREATE POLICY "projects_executive_read"
  ON projects FOR SELECT
  USING (
    get_user_role() = 'executive'
    AND practice = ANY(get_executive_practices())
  );

-- Quarters: executive can read (already open to all authenticated, but explicit)
-- No change needed — existing policy covers all authenticated users.

-- Practices: executive can read
-- No change needed — existing policy allows anonymous read.
```

### 1.7 Seed view permissions for executive role

Executive should only see the executive summary dashboard. All extension views and most web views are hidden.

```sql
-- Extension views: all hidden for executive
INSERT INTO role_view_permissions (role, view_key, label, is_visible) VALUES
  ('executive', 'ext.tab_log_task',    'Log Task Tab',         false),
  ('executive', 'ext.tab_my_tasks',    'My Tasks Tab',         false),
  ('executive', 'ext.context_banner',  'Context Banner',       false),
  ('executive', 'ext.quick_log',       'Quick Log Command',    false),
  ('executive', 'ext.advanced_fields', 'Advanced Fields',      false),
  ('executive', 'ext.time_tracking',   'Time Tracking Fields', false),
  ('executive', 'ext.quality_rating',  'Quality Rating',       false),
  ('executive', 'ext.project_select',  'Project Selection',    false)
ON CONFLICT (role, view_key) DO NOTHING;

-- Web views: hide everything except the new executive summary
INSERT INTO role_view_permissions (role, view_key, label, is_visible) VALUES
  ('executive', 'web.dashboard',        'Dashboard',           false),
  ('executive', 'web.leaderboard',      'Leaderboard',         false),
  ('executive', 'web.mypractice',       'My Practice',         false),
  ('executive', 'web.practices',        'All Practices',       false),
  ('executive', 'web.tasks',            'All Tasks',            false),
  ('executive', 'web.mytasks',          'My Tasks',             false),
  ('executive', 'web.accomplishments',  'Accomplishments',     false),
  ('executive', 'web.approvals',        'Approvals',           false),
  ('executive', 'web.copilot',          'Licensed AI Users',   false),
  ('executive', 'web.projects',         'Projects',            false),
  ('executive', 'web.usecases',         'Use Case Library',    false),
  ('executive', 'web.prompts',          'Prompt Library',      false),
  ('executive', 'web.skills',           'Skills Library',      false),
  ('executive', 'web.guidelines',       'Guidelines',          false),
  ('executive', 'web.enablement',       'Copilot Enablement',  false),
  ('executive', 'web.ainews',           'AI News',             false),
  ('executive', 'web.vscode',           'VS Code Extension',   false),
  ('executive', 'web.exec_summary',     'Executive Summary',   true)
ON CONFLICT (role, view_key) DO NOTHING;
```

---

## Phase 2 — Backend (Edge Function Updates)

### 2.1 Update `supabase/functions/ide-task-log/index.ts`

The edge function returns role-based view permissions. No structural change needed since it already reads from `role_view_permissions` dynamically. However, verify that the executive role is not blocked by any hardcoded role checks.

**Action items:**
- Search for any hardcoded `role === 'admin'` or `role === 'spoc'` checks and ensure `executive` is handled gracefully (should fall through to read-only behavior)
- The approval routing logic does NOT need changes — executives don't submit tasks

### 2.2 New API endpoint or RPC for executive summary data

Create a Supabase RPC function that aggregates KPIs across the executive's assigned practices.

```sql
CREATE OR REPLACE FUNCTION get_executive_summary(p_quarter_id TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_practices TEXT[];
  v_result JSONB;
BEGIN
  -- Get executive's assigned practices
  v_practices := get_executive_practices();

  SELECT jsonb_build_object(
    'total_tasks', (
      SELECT COUNT(*) FROM tasks
      WHERE practice = ANY(v_practices)
        AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
    ),
    'total_hours_saved', (
      SELECT COALESCE(SUM(saved_hours), 0) FROM tasks
      WHERE practice = ANY(v_practices)
        AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
    ),
    'active_users', (
      SELECT COUNT(DISTINCT employee_email) FROM tasks
      WHERE practice = ANY(v_practices)
        AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
    ),
    'practice_breakdown', (
      SELECT COALESCE(jsonb_agg(row_to_json(pb)), '[]'::jsonb)
      FROM (
        SELECT
          practice,
          COUNT(*) as task_count,
          COALESCE(SUM(saved_hours), 0) as hours_saved,
          COUNT(DISTINCT employee_email) as active_users
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
        GROUP BY practice
        ORDER BY practice
      ) pb
    ),
    'approval_stats', (
      SELECT COALESCE(jsonb_agg(row_to_json(ap)), '[]'::jsonb)
      FROM (
        SELECT
          approval_status,
          COUNT(*) as count
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
        GROUP BY approval_status
      ) ap
    ),
    'weekly_trend', (
      SELECT COALESCE(jsonb_agg(row_to_json(wt)), '[]'::jsonb)
      FROM (
        SELECT
          week_number,
          COUNT(*) as task_count,
          COALESCE(SUM(saved_hours), 0) as hours_saved
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
        GROUP BY week_number
        ORDER BY week_number
      ) wt
    ),
    'copilot_adoption', (
      SELECT COALESCE(jsonb_agg(row_to_json(ca)), '[]'::jsonb)
      FROM (
        SELECT
          practice,
          COUNT(*) as total_users,
          COUNT(*) FILTER (WHERE is_active) as active_users
        FROM copilot_users
        WHERE practice = ANY(v_practices)
        GROUP BY practice
      ) ca
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
   SET search_path = public;
```

---

## Phase 3 — Frontend Changes

### 3.1 Update `js/auth.js` — Add role helper

**File:** `js/auth.js` (around line 88, after `isViewer()`)

```javascript
function isExecutive() {
  return _userProfile?.role === 'executive';
}
```

Also export it in the module's public API (the `window.EAS_Auth` object).

### 3.2 Update `applyRoleVisibility()` in `js/auth.js`

No structural change needed — the existing `data-role` and `data-hide-role` system already supports any role string. Just ensure executive is used in HTML attributes:

```html
<div data-role="executive" data-view-key="web.exec_summary">Executive Summary</div>
<button data-hide-role="viewer,executive">+ Log Task</button>
```

### 3.3 Create Executive Summary page/section

**New file or section:** `src/pages/exec-summary.html` (or a new section in `index.html`)

The executive summary dashboard should display:
- Total tasks logged across assigned practices
- Total hours saved across assigned practices
- Active user count across assigned practices
- Practice-by-practice breakdown table
- Weekly trend chart (line/bar chart)
- Copilot adoption rates per practice
- Approval pipeline status

**Implementation approach:**
- Create a new `<div id="page-exec-summary">` section in `index.html` (or as standalone page)
- Add navigation item visible only to `data-role="executive"` with `data-view-key="web.exec_summary"`
- Fetch data via `supabase.rpc('get_executive_summary', { p_quarter_id: selectedQuarter })`
- Render charts using the existing charting library (Chart.js or whichever is already in use)

### 3.4 Update navigation sidebar

Add executive summary nav item in `index.html`:

```html
<div class="nav-item" data-role="executive" data-view-key="web.exec_summary"
     onclick="showPage('exec-summary')">
  <i class="icon">📊</i>
  <span>Executive Summary</span>
</div>
```

### 3.5 Hide task logging UI for executives

Ensure the "+ Log Task" button and any task submission forms are hidden:

```html
<button onclick="openModal('task')" data-hide-role="viewer,executive">+ Log Task</button>
```

---

## Phase 4 — Admin Panel Updates

### 4.1 Update role dropdown in user management

**File:** `src/pages/admin.html` (line ~1239)

Add `executive` to the role `<select>`:

```html
<select id="eu-role">
  <option value="admin">Admin</option>
  <option value="spoc">SPOC</option>
  <option value="contributor">Contributor</option>
  <option value="viewer">Viewer</option>
  <option value="executive">Executive</option>
</select>
```

### 4.2 Add multi-practice picker for executives

When `role === 'executive'` is selected, show a multi-select for practices instead of the single practice dropdown.

**New UI element in admin modal:**

```html
<div id="exec-practices-row" class="form-row" style="display:none;">
  <label>Assigned Practices</label>
  <div id="exec-practices-checkboxes">
    <!-- Dynamically populated with practice checkboxes -->
  </div>
</div>
```

**JavaScript logic:**
- Listen to `eu-role` change event
- When `executive` is selected: hide single-practice field, show multi-practice checkboxes
- When saving: insert/upsert rows in `executive_practices` table
- When loading an executive user for editing: fetch their `executive_practices` rows and pre-check

### 4.3 Update `saveUser()` function

After saving the user record, if role is `executive`:

```javascript
async function saveUser() {
  // ... existing save logic ...

  if (role === 'executive') {
    const selectedPractices = getSelectedExecPractices(); // from checkboxes

    // Delete existing assignments
    await supabase
      .from('executive_practices')
      .delete()
      .eq('user_id', userId);

    // Insert new assignments
    if (selectedPractices.length > 0) {
      await supabase
        .from('executive_practices')
        .insert(selectedPractices.map(p => ({
          user_id: userId,
          practice: p
        })));
    }
  }
}
```

### 4.4 Add view permission management for executive

The admin panel's "Manage Permissions" tab needs to include the `executive` role. Since the existing admin UI reads from `role_view_permissions` dynamically, it should pick up the new role's rows automatically. Verify this works and add the `web.exec_summary` view key to all roles' permission sets (hidden by default for non-executive roles).

---

## Phase 5 — Testing & Verification

### 5.1 Database verification

- Run migration `010_executive_role.sql` against a test database
- Verify CHECK constraints accept `'executive'` for both `users.role` and `role_view_permissions.role`
- Create a test executive user and assign practices via `executive_practices`
- Verify RLS: executive can SELECT tasks/accomplishments/copilot_users for assigned practices only
- Verify RLS: executive CANNOT insert/update/delete any data
- Test `get_executive_summary()` RPC returns correct aggregated data

### 5.2 Frontend verification

- Log in as executive → should see only the executive summary dashboard
- Verify "+ Log Task" button is hidden
- Verify sidebar shows only "Executive Summary" nav item
- Verify practice filter on exec summary shows only assigned practices
- Verify chart/KPI data matches expected values

### 5.3 Admin panel verification

- Create a new user with `executive` role → multi-practice picker appears
- Assign 2-3 practices → verify `executive_practices` rows created
- Edit executive user → checkboxes reflect current assignments
- Change role from `executive` to `contributor` → verify `executive_practices` rows are cleaned up
- Verify permission management tab shows executive role entries

### 5.4 Edge cases

- Executive with zero practices assigned → should see empty dashboard, not an error
- Executive with all practices assigned → equivalent to cross-org view
- Changing an executive's practice assignments → dashboard updates immediately
- Deactivating an executive → `is_active = false` should prevent login

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `sql/010_executive_role.sql` | **Create** | New migration with all DB changes |
| `js/auth.js` | **Edit** | Add `isExecutive()`, export it |
| `src/pages/index.html` | **Edit** | Add exec summary nav item + page section |
| `src/pages/admin.html` | **Edit** | Add role option + multi-practice UI |
| `js/admin.js` (or inline) | **Edit** | Multi-practice save/load logic |
| `css/` | **Edit** | Executive summary dashboard styles |
| `supabase/functions/ide-task-log/index.ts` | **Verify** | No hardcoded role blockers |

---

## Rollback Plan

If issues arise, rollback in reverse order:

1. Remove frontend changes (revert `index.html`, `admin.html`, `auth.js`)
2. Drop RLS policies: `DROP POLICY "tasks_executive_read" ON tasks;` (repeat for each)
3. Drop function: `DROP FUNCTION get_executive_summary;`
4. Drop function: `DROP FUNCTION get_executive_practices;`
5. Drop table: `DROP TABLE executive_practices;`
6. Revert CHECK constraints to exclude `'executive'`
7. Delete executive rows from `role_view_permissions`

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1 — Database | ~2 hours |
| Phase 2 — Backend | ~1 hour |
| Phase 3 — Frontend | ~4 hours |
| Phase 4 — Admin Panel | ~2 hours |
| Phase 5 — Testing | ~2 hours |
| **Total** | **~11 hours** |
