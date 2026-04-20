# Multi-Department `dept_spoc` Role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `dept_spoc` (Department SPOC) role that oversees all practices within a department — with aggregated KPIs, drill-down to any practice panel with full SPOC powers, and optional approval escalation.

**Architecture:** Extend the existing SPOC infrastructure — the new "My Department" view reuses `renderMyPractice()` with an `overridePractice` parameter. A single migration adds `department_id` to `users` and extends RLS policies. No new tables or Edge Functions.

**Tech Stack:** Supabase PostgreSQL (RLS, SQL migration), Vanilla JS (IIFE modules), HTML SPA (index.html, admin.html)

**Spec:** `docs/superpowers/specs/2026-04-20-multi-department-design.md`

---

## Task 1: Database Migration — Role Constraint + `department_id` + RLS

**Files:**
- Create: `sql/025_dept_spoc_role.sql`

- [ ] **Step 1: Verify actual role constraint name in DB**

Run this via Supabase MCP (`execute_sql`):
```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'users'::regclass AND contype = 'c';
```
Expected output: a row with `conname` like `users_role_check`. Note the exact name.

- [ ] **Step 2: Create migration file**

Create `sql/025_dept_spoc_role.sql` with the following content:

```sql
-- ============================================================
-- EAS AI Adoption — Migration 025: dept_spoc role
-- Adds Department SPOC role, department_id to users, RLS policies
-- ============================================================

-- 1. Extend role CHECK constraint
-- Drop the old constraint (verify name first: SELECT conname FROM pg_constraint
--   WHERE conrelid='users'::regclass AND contype='c')
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin','spoc','team_lead','contributor','viewer','executive','dept_spoc'));

-- 2. Add department_id FK to users (null for all existing roles; set only for dept_spoc)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_id UUID
    REFERENCES departments(id) ON DELETE SET NULL;

-- 3. Index for RLS performance
CREATE INDEX IF NOT EXISTS idx_users_dept_spoc
  ON users(role, department_id)
  WHERE role = 'dept_spoc';

-- 4. Helper function: get the department_id of the current authenticated user
CREATE OR REPLACE FUNCTION get_user_department_id()
RETURNS UUID AS $$
  SELECT department_id FROM users WHERE auth_id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 5. Extend RLS policies for dept_spoc
-- Pattern: dept_spoc can see/act on rows where the practice belongs to their department.

-- tasks
DROP POLICY IF EXISTS "dept_spoc_tasks_select" ON tasks;
CREATE POLICY "dept_spoc_tasks_select" ON tasks
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

DROP POLICY IF EXISTS "dept_spoc_tasks_update" ON tasks;
CREATE POLICY "dept_spoc_tasks_update" ON tasks
  FOR UPDATE USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- accomplishments
DROP POLICY IF EXISTS "dept_spoc_accomplishments_select" ON accomplishments;
CREATE POLICY "dept_spoc_accomplishments_select" ON accomplishments
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

DROP POLICY IF EXISTS "dept_spoc_accomplishments_update" ON accomplishments;
CREATE POLICY "dept_spoc_accomplishments_update" ON accomplishments
  FOR UPDATE USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- submission_approvals
DROP POLICY IF EXISTS "dept_spoc_approvals_select" ON submission_approvals;
CREATE POLICY "dept_spoc_approvals_select" ON submission_approvals
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

DROP POLICY IF EXISTS "dept_spoc_approvals_update" ON submission_approvals;
CREATE POLICY "dept_spoc_approvals_update" ON submission_approvals
  FOR UPDATE USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- copilot_users
DROP POLICY IF EXISTS "dept_spoc_copilot_select" ON copilot_users;
CREATE POLICY "dept_spoc_copilot_select" ON copilot_users
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- users (can see users in their department's practices)
DROP POLICY IF EXISTS "dept_spoc_users_select" ON users;
CREATE POLICY "dept_spoc_users_select" ON users
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND (
      practice IN (
        SELECT name FROM practices WHERE department_id = get_user_department_id()
      )
      OR id = (SELECT id FROM users WHERE auth_id = auth.uid())
    )
  );

-- practice_spoc (can see SPOCs of practices in their department)
DROP POLICY IF EXISTS "dept_spoc_practice_spoc_select" ON practice_spoc;
CREATE POLICY "dept_spoc_practice_spoc_select" ON practice_spoc
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- projects
DROP POLICY IF EXISTS "dept_spoc_projects_select" ON projects;
CREATE POLICY "dept_spoc_projects_select" ON projects
  FOR SELECT USING (
    get_user_role() = 'dept_spoc' AND
    practice IN (
      SELECT name FROM practices WHERE department_id = get_user_department_id()
    )
  );

-- 6. Seed role_view_permissions for dept_spoc
-- Insert rows that DENY views dept_spoc should NOT see.
-- Fail-open: views not listed here are visible by default.
INSERT INTO role_view_permissions (role, view_key, is_visible) VALUES
  ('dept_spoc', 'web.mypractice',   false),
  ('dept_spoc', 'web.exec_summary', false)
ON CONFLICT (role, view_key) DO UPDATE SET is_visible = EXCLUDED.is_visible;
```

- [ ] **Step 3: Apply migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with:
- `project_id`: `apcfnzbiylhgiutcjigg`
- `name`: `025_dept_spoc_role`
- `query`: full SQL above

- [ ] **Step 4: Verify migration applied**

Run via `execute_sql`:
```sql
-- Check column exists
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'department_id';

-- Check constraint updated
SELECT conname FROM pg_constraint
WHERE conrelid = 'users'::regclass AND contype = 'c';

-- Check function exists
SELECT proname FROM pg_proc WHERE proname = 'get_user_department_id';

-- Check policies created
SELECT policyname, tablename FROM pg_policies
WHERE policyname LIKE 'dept_spoc_%';
```
Expected: `department_id` column present, constraint includes `dept_spoc`, function exists, 9 policies present.

- [ ] **Step 5: Commit**

```bash
git add sql/025_dept_spoc_role.sql
git commit -m "feat: migration 025 — dept_spoc role, department_id on users, RLS policies"
```

---

## Task 2: Auth Module — Add `dept_spoc` helpers

**Files:**
- Modify: `js/auth.js`

- [ ] **Step 1: Update `getUserProfile()` select to include `department_id`**

In `js/auth.js` at line 42, find:
```js
      .select('id, name, email, role, practice, is_active')
```
Replace with:
```js
      .select('id, name, email, role, practice, is_active, department_id')
```

- [ ] **Step 2: Add `isDeptSpoc()` and `getUserDepartmentId()` helpers**

After the `isTeamLead()` function (line 90), add:
```js
  function isDeptSpoc() {
    return _userProfile?.role === 'dept_spoc';
  }

  function getUserDepartmentId() {
    return _userProfile?.department_id || null;
  }
```

- [ ] **Step 3: Add `dept_spoc` label to `updateUserDisplay()`**

In `updateUserDisplay()` (line 183), find:
```js
      const roleLabels = { admin: 'Administrator', spoc: 'AI SPOC', contributor: 'Contributor', viewer: 'Viewer', executive: 'Executive', team_lead: 'Team Lead' };
```
Replace with:
```js
      const roleLabels = { admin: 'Administrator', spoc: 'AI SPOC', dept_spoc: 'Dept SPOC', contributor: 'Contributor', viewer: 'Viewer', executive: 'Executive', team_lead: 'Team Lead' };
```

- [ ] **Step 4: Export new helpers in the return object**

At the bottom of `js/auth.js`, find:
```js
  return {
    getSession,
    getUser,
    getUserProfile,
    signOut,
    isAdmin,
    isSPOC,
    isContributor,
    isTeamLead,
    getUserRole,
    getUserPractice,
    getUserName,
    getUserId,
    requireAuth,
    applyRoleVisibility,
    applyViewPermissions,
    updateUserDisplay
  };
```
Replace with:
```js
  return {
    getSession,
    getUser,
    getUserProfile,
    signOut,
    isAdmin,
    isSPOC,
    isDeptSpoc,
    isContributor,
    isTeamLead,
    getUserRole,
    getUserPractice,
    getUserDepartmentId,
    getUserName,
    getUserId,
    requireAuth,
    applyRoleVisibility,
    applyViewPermissions,
    updateUserDisplay
  };
```

- [ ] **Step 5: Verify no syntax errors**

Open `js/auth.js` and confirm the file is valid JS (no missing brackets, correct function placement).

- [ ] **Step 6: Commit**

```bash
git add js/auth.js
git commit -m "feat: auth — add isDeptSpoc, getUserDepartmentId, dept_spoc role label"
```

---

## Task 3: Sidebar Nav + Shared View Role Guards (index.html)

**Files:**
- Modify: `src/pages/index.html`

- [ ] **Step 1: Add `dept_spoc` to shared nav items**

In `src/pages/index.html`, find and update these `data-role` attributes (add `dept_spoc` to each):

Line 65 — Practices section label:
```html
<!-- Before -->
<div class="nav-section" data-role="admin,spoc,team_lead,viewer">Practices</div>
<!-- After -->
<div class="nav-section" data-role="admin,spoc,dept_spoc,team_lead,viewer">Practices</div>
```

Line 74 — Tasks nav item:
```html
<!-- Before -->
<div class="nav-item" data-page="tasks" data-role="admin,spoc,team_lead,viewer" data-view-key="web.tasks">
<!-- After -->
<div class="nav-item" data-page="tasks" data-role="admin,spoc,dept_spoc,team_lead,viewer" data-view-key="web.tasks">
```

Line 97 — Approvals nav item:
```html
<!-- Before -->
<div class="nav-item" data-page="approvals" data-role="admin,spoc,team_lead" data-view-key="web.approvals">
<!-- After -->
<div class="nav-item" data-page="approvals" data-role="admin,spoc,dept_spoc,team_lead" data-view-key="web.approvals">
```

Line 102 — Copilot Users nav item:
```html
<!-- Before -->
<div class="nav-item" data-page="copilot" data-role="admin,spoc,team_lead,viewer" data-view-key="web.copilot">
<!-- After -->
<div class="nav-item" data-page="copilot" data-role="admin,spoc,dept_spoc,team_lead,viewer" data-view-key="web.copilot">
```

Line 107 — IDE Usage nav item:
```html
<!-- Before -->
<div class="nav-item" data-page="ide-usage" data-role="admin,spoc,team_lead" data-view-key="web.ide_usage">
<!-- After -->
<div class="nav-item" data-page="ide-usage" data-role="admin,spoc,dept_spoc,team_lead" data-view-key="web.ide_usage">
```

Line 111 — Projects nav item:
```html
<!-- Before -->
<div class="nav-item" data-page="projects" data-role="admin,spoc,team_lead,viewer" data-view-key="web.projects">
<!-- After -->
<div class="nav-item" data-page="projects" data-role="admin,spoc,dept_spoc,team_lead,viewer" data-view-key="web.projects">
```

- [ ] **Step 2: Add "My Department" sidebar nav item**

Find the existing "My Practice" nav item (line 65):
```html
  <div class="nav-item" data-page="mypractice" data-role="spoc,team_lead" data-view-key="web.mypractice">
```
After it, add:
```html
  <div class="nav-item" data-page="mydepartment" data-role="dept_spoc" data-view-key="web.mydepartment">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
    My Department
  </div>
```

- [ ] **Step 3: Add login redirect for `dept_spoc`**

Find line 7087–7090:
```js
  if (role === 'executive') {
    document.querySelector('.nav-item[data-page="exec-summary"]')?.click();
  } else if (role === 'spoc') {
    document.querySelector('.nav-item[data-page="mypractice"]')?.click();
```
Replace with:
```js
  if (role === 'executive') {
    document.querySelector('.nav-item[data-page="exec-summary"]')?.click();
  } else if (role === 'dept_spoc') {
    document.querySelector('.nav-item[data-page="mydepartment"]')?.click();
  } else if (role === 'spoc') {
    document.querySelector('.nav-item[data-page="mypractice"]')?.click();
```

- [ ] **Step 4: Register `renderMyDepartment` in nav-click handler and quarter-change**

Find the nav-click switch block (around line 2210):
```js
    if (item.dataset.page === 'mypractice') renderMyPractice();
```
After it, add:
```js
    if (item.dataset.page === 'mydepartment') renderMyDepartment();
```

Find the quarter-change handler (around line 7118):
```js
    if (activePage === 'mypractice') renderMyPractice();
```
After it, add:
```js
    if (activePage === 'mydepartment') renderMyDepartment();
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.html
git commit -m "feat: sidebar — add My Department nav item, dept_spoc role guards, login redirect"
```

---

## Task 4: Refactor `renderMyPractice()` to Accept `overridePractice`

**Files:**
- Modify: `src/pages/index.html` (JS section around line 3266)

- [ ] **Step 1: Add `overridePractice` parameter to `renderMyPractice()`**

Find line 3266:
```js
async function renderMyPractice() {
  const practice = EAS_Auth.getUserPractice();
  if (!practice) return;
  const userRole = EAS_Auth.getUserRole();
```
Replace with:
```js
async function renderMyPractice(overridePractice = null) {
  const practice = overridePractice ?? EAS_Auth.getUserPractice();
  if (!practice) return;
  // When called from My Department drill-down, treat as spoc scope
  const userRole = overridePractice ? 'spoc' : EAS_Auth.getUserRole();
```

- [ ] **Step 2: Update `nudgeInactive()` to propagate `overridePractice`**

Find around line 3385:
```js
async function nudgeInactive(userId, userName) {
  const result = await EAS_DB.nudgeUser(userId);
  if (result) {
    showToast(`Nudge sent to ${userName}`);
    renderMyPractice(); // Refresh
  } else {
    showToast('Failed to nudge user', 'error');
  }
}
```
Replace with:
```js
async function nudgeInactive(userId, userName, overridePractice = null) {
  const result = await EAS_DB.nudgeUser(userId);
  if (result) {
    showToast(`Nudge sent to ${userName}`);
    renderMyPractice(overridePractice); // Refresh
  } else {
    showToast('Failed to nudge user', 'error');
  }
}
```

- [ ] **Step 3: Update nudge button in `renderMyPractice()` to pass `overridePractice`**

Inside `renderMyPractice()`, find the nudge button template string (line ~3375):
```js
      return `<tr>
        ...
        <td><button class="btn btn-secondary" style="font-size:12px;padding:4px 12px" onclick="nudgeInactive('${u.id}','${u.name}')">Nudge</button></td>
      </tr>`;
```
Replace with:
```js
      const _op = overridePractice ? `'${overridePractice}'` : 'null';
      return `<tr>
        ...
        <td><button class="btn btn-secondary" style="font-size:12px;padding:4px 12px" onclick="nudgeInactive('${u.id}','${u.name}',${_op})">Nudge</button></td>
      </tr>`;
```

- [ ] **Step 4: Suppress team-lead management section when called with override**

Find inside `renderMyPractice()` (line ~3380):
```js
  if (EAS_Auth.getUserRole() === 'spoc') {
    renderTeamLeadManagement();
  }
```
Replace with:
```js
  if (EAS_Auth.getUserRole() === 'spoc' && !overridePractice) {
    renderTeamLeadManagement();
  }
```

- [ ] **Step 5: Verify `renderMyPractice()` still works for existing spoc/team_lead**

Manually test in browser: log in as a SPOC user → My Practice should load unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.html
git commit -m "refactor: renderMyPractice — accept overridePractice param for dept_spoc drill-down"
```

---

## Task 5: Add `#page-mydepartment` HTML Section

**Files:**
- Modify: `src/pages/index.html`

- [ ] **Step 1: Add the My Department page div**

Find the existing My Practice section (around line 529):
```html
  <div id="page-mypractice" class="page hidden">
```
Before it, insert the My Department section:

```html
  <!-- ======== MY DEPARTMENT (dept_spoc) ======== -->
  <div id="page-mydepartment" class="page hidden">
    <div class="page-header">
      <div>
        <h2 id="mydept-title">My Department</h2>
        <div class="subtitle" id="mydept-subtitle">Department dashboard</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <select class="quarter-selector" id="mydept-filter-quarter" aria-label="Filter by quarter"></select>
      </div>
    </div>

    <!-- Dept KPI row -->
    <div class="kpi-grid" id="mydept-kpis"></div>

    <!-- Practice cards grid -->
    <div style="margin-top:24px">
      <h3 style="margin-bottom:16px;font-size:16px;font-weight:600">Practices</h3>
      <div id="mydept-practice-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px"></div>
    </div>

    <!-- Practice drill-down panel (hidden until a card is clicked) -->
    <div id="mydept-detail-panel" style="display:none;margin-top:32px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <button class="btn btn-secondary" style="font-size:13px;padding:6px 14px" onclick="closeDeptDrillDown()">← Back to Department</button>
        <h3 id="mydept-detail-title" style="font-size:16px;font-weight:600;margin:0"></h3>
      </div>
      <!-- renderMyPractice(selectedPractice) renders into the mypractice DOM elements,
           so we embed a scoped copy of those elements here with distinct IDs -->
      <div id="mydept-mypractice-scope"></div>
    </div>
  </div>
```

- [ ] **Step 2: Verify the section renders in the DOM (no JS yet)**

Open `index.html` in browser as dept_spoc → the "My Department" sidebar item should appear. Clicking it should show an empty page with the header "My Department". No errors in console.

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.html
git commit -m "feat: add #page-mydepartment HTML scaffold for dept_spoc view"
```

---

## Task 6: Implement `renderMyDepartment()` JS Function

**Files:**
- Modify: `src/pages/index.html` (JS section)

- [ ] **Step 1: Add `renderMyDepartment()` function**

After the `nudgeInactive()` function (around line 3393), insert:

```js
// ======== DEPT SPOC: MY DEPARTMENT ========
let _deptDrillPractice = null; // track which practice is drilled into

async function renderMyDepartment() {
  const departmentId = EAS_Auth.getUserDepartmentId();
  if (!departmentId) return;

  const quarterId = document.getElementById('mydept-filter-quarter')?.value || EAS_DB.getSelectedQuarter();

  // 1. Fetch department name + its practices
  const sb = getSupabaseClient();
  const { data: dept } = await sb.from('departments').select('name').eq('id', departmentId).single();
  const { data: practices } = await sb.from('practices').select('name').eq('department_id', departmentId).eq('is_active', true);
  const practiceNames = (practices || []).map(p => p.name);

  const deptName = dept?.name || 'Department';
  document.getElementById('mydept-title').textContent = deptName;
  document.getElementById('mydept-subtitle').textContent = `${practiceNames.length} practices — ${quarterId && quarterId !== 'all' ? EAS_DB.getQuarterLabel(quarterId) : 'All Quarters'}`;

  if (practiceNames.length === 0) {
    document.getElementById('mydept-kpis').innerHTML = '<p style="color:var(--text-muted)">No active practices in this department.</p>';
    document.getElementById('mydept-practice-cards').innerHTML = '';
    return;
  }

  // 2. Aggregate KPIs across all practices in the department
  const allTasks = (data.tasks || []).filter(t =>
    practiceNames.includes(t.practice) &&
    t.approvalStatus === 'approved' &&
    (quarterId === 'all' || !quarterId || t.quarterId === quarterId)
  );
  const totalTasks = allTasks.length;
  const totalSaved = allTasks.reduce((s, t) => s + (t.timeSaved || 0), 0);
  const avgEff = allTasks.length > 0
    ? allTasks.reduce((s, t) => s + (t.efficiency || 0), 0) / allTasks.length
    : 0;
  const activeUsers = new Set(allTasks.map(t => t.employeeEmail)).size;

  document.getElementById('mydept-kpis').innerHTML = `
    <div class="kpi-card"><div class="kpi-label">Total Tasks</div><div class="kpi-value green">${totalTasks}</div><div class="kpi-sub">${deptName}</div></div>
    <div class="kpi-card"><div class="kpi-label">Hours Saved</div><div class="kpi-value yellow">${fmt(totalSaved, 0)}</div><div class="kpi-sub">across department</div></div>
    <div class="kpi-card"><div class="kpi-label">Avg Efficiency</div><div class="kpi-value purple">${fmt(avgEff * 100, 1)}%</div><div class="kpi-sub">time reduction</div></div>
    <div class="kpi-card"><div class="kpi-label">Active Contributors</div><div class="kpi-value blue">${activeUsers}</div><div class="kpi-sub">this quarter</div></div>
  `;

  // 3. Render practice cards
  document.getElementById('mydept-practice-cards').innerHTML = practiceNames.map(pName => {
    const pTasks = allTasks.filter(t => t.practice === pName);
    const pSaved = pTasks.reduce((s, t) => s + (t.timeSaved || 0), 0);
    const pEff = pTasks.length > 0
      ? pTasks.reduce((s, t) => s + (t.efficiency || 0), 0) / pTasks.length
      : 0;
    return `
      <div class="table-card" style="padding:18px;cursor:pointer" onclick="openDeptDrillDown('${EAS_Utils.sanitize(pName)}')">
        <div style="font-weight:700;font-size:15px;margin-bottom:10px;color:var(--text-primary)">${EAS_Utils.sanitize(pName)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
          <div><div style="color:var(--text-muted)">Tasks</div><div style="font-weight:600;color:var(--success)">${pTasks.length}</div></div>
          <div><div style="color:var(--text-muted)">Efficiency</div><div style="font-weight:600;color:var(--primary)">${fmt(pEff * 100, 1)}%</div></div>
          <div><div style="color:var(--text-muted)">Hours Saved</div><div style="font-weight:600;color:var(--warning)">${fmt(pSaved, 0)}</div></div>
          <div><div style="color:var(--text-muted)">Contributors</div><div style="font-weight:600">${new Set(pTasks.map(t => t.employeeEmail)).size}</div></div>
        </div>
        <button class="btn btn-secondary" style="width:100%;margin-top:14px;font-size:13px">View Practice ▶</button>
      </div>
    `;
  }).join('');
}

async function openDeptDrillDown(practiceName) {
  _deptDrillPractice = practiceName;
  document.getElementById('mydept-practice-cards').closest('[style*="margin-top:24px"]').style.display = 'none';
  document.getElementById('mydept-kpis').style.display = 'none';
  const panel = document.getElementById('mydept-detail-panel');
  panel.style.display = '';
  document.getElementById('mydept-detail-title').textContent = practiceName;

  // Reuse the mypractice DOM elements by temporarily reparenting them
  const scope = document.getElementById('mydept-mypractice-scope');
  const mypracticeEl = document.getElementById('page-mypractice');
  scope.innerHTML = '';
  scope.appendChild(mypracticeEl.cloneNode(true));

  // Point renderMyPractice to the scoped clone's IDs (they share the same IDs,
  // so we temporarily move the original elements into the scope)
  scope.querySelectorAll('[id]').forEach(el => {
    const orig = document.getElementById(el.id);
    if (orig && orig !== el) orig.replaceWith(el);
  });

  await renderMyPractice(practiceName);
}

function closeDeptDrillDown() {
  _deptDrillPractice = null;
  document.getElementById('mydept-detail-panel').style.display = 'none';
  const cardsSection = document.getElementById('mydept-practice-cards').closest('[style*="margin-top:24px"]');
  if (cardsSection) cardsSection.style.display = '';
  document.getElementById('mydept-kpis').style.display = '';
}
```

- [ ] **Step 2: Wire quarter selector for My Department**

After `EAS_DB.populatePageQuarterSelector('mypractice-filter-quarter', ...)` (around line 7005), add:
```js
  EAS_DB.populatePageQuarterSelector('mydept-filter-quarter', () => renderMyDepartment());
```

- [ ] **Step 3: Verify My Department renders correctly**

Log in as a `dept_spoc` user (or temporarily set `role = 'dept_spoc'` and `department_id` on a test user via MCP). Navigate to "My Department" → should see:
- Department name in heading
- 4 KPI cards (Total Tasks, Hours Saved, Avg Efficiency, Active Contributors)
- Practice cards for each active practice in the department
- Clicking a practice card shows the full SPOC panel for that practice
- "← Back to Department" button returns to the cards view

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.html
git commit -m "feat: renderMyDepartment — KPI row, practice cards, drill-down to SPOC panel"
```

---

## Task 7: Admin Panel — `dept_spoc` User Management

**Files:**
- Modify: `src/pages/admin.html`

- [ ] **Step 1: Add `dept_spoc` to the user edit modal role dropdown**

Find the `eu-role` select (line 1460):
```html
        <select id="eu-role" onchange="toggleExecPractices()">
          <option value="admin">Admin</option>
          <option value="spoc">SPOC</option>
          <option value="team_lead">Team Lead</option>
          <option value="contributor">Contributor</option>
          <option value="viewer">Viewer</option>
          <option value="executive">Executive</option>
        </select>
```
Replace with:
```html
        <select id="eu-role" onchange="toggleRoleFields()">
          <option value="admin">Admin</option>
          <option value="spoc">SPOC</option>
          <option value="dept_spoc">Dept SPOC</option>
          <option value="team_lead">Team Lead</option>
          <option value="contributor">Contributor</option>
          <option value="viewer">Viewer</option>
          <option value="executive">Executive</option>
        </select>
```

- [ ] **Step 2: Add Department field group after the Practice field group**

Find the practice form group (line 1454):
```html
      <div class="form-group" id="eu-practice-group">
        <label>Practice</label>
        <select id="eu-practice"></select>
      </div>
```
After it, add:
```html
      <div class="form-group" id="eu-department-group" style="display:none">
        <label>Department</label>
        <select id="eu-department"></select>
      </div>
```

- [ ] **Step 3: Rename and extend `toggleExecPractices()` → `toggleRoleFields()`**

Find `function toggleExecPractices()` (line 3967):
```js
function toggleExecPractices() {
  const role = document.getElementById('eu-role').value;
  const execRow = document.getElementById('exec-practices-row');
  const practiceGroup = document.getElementById('eu-practice-group');
  if (role === 'executive') {
    if (execRow) execRow.style.display = '';
    if (practiceGroup) practiceGroup.style.display = 'none';
  } else {
    if (execRow) execRow.style.display = 'none';
    if (practiceGroup) practiceGroup.style.display = '';
  }
}
```
Replace with:
```js
function toggleRoleFields() {
  const role = document.getElementById('eu-role').value;
  const execRow = document.getElementById('exec-practices-row');
  const practiceGroup = document.getElementById('eu-practice-group');
  const deptGroup = document.getElementById('eu-department-group');
  if (role === 'executive') {
    if (execRow) execRow.style.display = '';
    if (practiceGroup) practiceGroup.style.display = 'none';
    if (deptGroup) deptGroup.style.display = 'none';
  } else if (role === 'dept_spoc') {
    if (execRow) execRow.style.display = 'none';
    if (practiceGroup) practiceGroup.style.display = 'none';
    if (deptGroup) deptGroup.style.display = '';
  } else {
    if (execRow) execRow.style.display = 'none';
    if (practiceGroup) practiceGroup.style.display = '';
    if (deptGroup) deptGroup.style.display = 'none';
  }
}

// Keep old name as alias for any callers in the file
const toggleExecPractices = toggleRoleFields;
```

- [ ] **Step 4: Populate department dropdown when editing a user**

Find `openEditUserModal(user)` — where it calls `toggleExecPractices()` (line 3962):
```js
  toggleExecPractices();
```
Replace with:
```js
  // Populate department dropdown
  const deptSelect = document.getElementById('eu-department');
  if (deptSelect) {
    const { data: depts } = await getSupabaseClient().from('departments').select('id, name').eq('is_active', true).order('name');
    deptSelect.innerHTML = '<option value="">— Select Department —</option>' +
      (depts || []).map(d => `<option value="${d.id}"${user.department_id === d.id ? ' selected' : ''}>${EAS_Utils.sanitize(d.name)}</option>`).join('');
  }
  toggleRoleFields();
```

- [ ] **Step 5: Update `saveUser()` to handle `dept_spoc`**

Find `saveUser()` (line 3980). Update the `updates` object and cleanup logic:
```js
async function saveUser() {
  const id = document.getElementById('eu-id').value;
  const role = document.getElementById('eu-role').value;
  const updates = {
    name: document.getElementById('eu-name').value.trim(),
    practice: (role === 'executive' || role === 'dept_spoc') ? null : document.getElementById('eu-practice').value,
    department_id: role === 'dept_spoc' ? (document.getElementById('eu-department').value || null) : null,
    role: role,
    is_active: document.getElementById('eu-active').value === 'true'
  };

  if (!updates.name) {
    showToast('Name is required', 'error');
    return;
  }

  if (role === 'dept_spoc' && !updates.department_id) {
    showToast('Please select a department for Dept SPOC', 'error');
    return;
  }

  const sb = getSupabaseClient();
  const { error } = await sb.from('users').update(updates).eq('id', id);
  if (error) {
    showToast('Failed to save user: ' + error.message, 'error');
    return;
  }

  // Handle executive practice assignments
  if (role === 'executive') {
    const selectedPractices = [...document.querySelectorAll('.exec-practice-cb:checked')].map(cb => cb.value);
    await sb.from('executive_practices').delete().eq('user_id', id);
    if (selectedPractices.length > 0) {
      const { error: epError } = await sb
        .from('executive_practices')
        .insert(selectedPractices.map(p => ({ user_id: id, practice: p })));
      if (epError) {
        showToast('User saved but failed to update practice assignments: ' + epError.message, 'error');
      }
    }
  } else {
    await sb.from('executive_practices').delete().eq('user_id', id);
  }

  // Clean up team_lead_assignments if role changed away from team_lead
  if (role !== 'team_lead') {
    await sb.from('team_lead_assignments').delete().eq('team_lead_id', id);
  }

  // Auto-sync practice_spoc when role changes to/from SPOC
  await EAS_DB.syncPracticeSpoc(id, role, updates.practice, updates.name, document.getElementById('eu-email').value);

  closeModal('modal-edit-user');
```

- [ ] **Step 6: Add `dept_spoc` to the admin user role filter dropdown**

Find the `admin-user-role-filter` select (line 1048):
```html
            <option value="admin">Admin</option>
            <option value="spoc">SPOC</option>
```
After the `spoc` option, add:
```html
            <option value="dept_spoc">Dept SPOC</option>
```

- [ ] **Step 7: Verify admin panel user editing works**

In admin panel:
1. Edit any user → role dropdown shows "Dept SPOC" option
2. Select "Dept SPOC" → Practice field hides, Department dropdown appears
3. Select a department and save → user record updated with `role=dept_spoc`, `department_id` set, `practice=null`
4. Re-open the user → Department dropdown shows the correct value

- [ ] **Step 8: Commit**

```bash
git add src/pages/admin.html
git commit -m "feat: admin — dept_spoc role option, department field, toggleRoleFields, saveUser update"
```

---

## Task 8: Documentation Sweep

**Files:**
- Modify: `CHANGELOG.md`, `docs/HLD.md`, `docs/CODE_ARCHITECTURE.md`, `docs/IMPLEMENTATION_NOTES.md`

- [ ] **Step 1: Update `CHANGELOG.md`**

Under `## [Unreleased]`, add:
```
- 2026-04-20 (claude) — add dept_spoc role with My Department dashboard, practice drill-down, and admin assignment UI (multi-department)
```

- [ ] **Step 2: Update `docs/HLD.md` — role hierarchy section**

Find the roles/hierarchy section and add `dept_spoc` to the role table and hierarchy diagram:
```
Role: dept_spoc
Scope: All practices within their assigned department
Access: Full SPOC powers on any practice in their department; optional approval escalation
Assignment: Admin-only; department_id stored on users row
```

- [ ] **Step 3: Update `docs/CODE_ARCHITECTURE.md`**

Add `dept_spoc` to the roles section and document:
- `js/auth.js`: `isDeptSpoc()`, `getUserDepartmentId()` helpers
- `src/pages/index.html`: `renderMyDepartment()`, `openDeptDrillDown()`, `closeDeptDrillDown()`
- `sql/025_dept_spoc_role.sql`: migration added

- [ ] **Step 4: Update `docs/IMPLEMENTATION_NOTES.md`**

Append:
```
## 2026-04-20 — Multi-Department dept_spoc Role

**What:** Added `dept_spoc` as 7th role. Dept SPOCs oversee all practices in their department
with aggregated KPIs and full drill-down SPOC powers.

**Key decisions:**
- `department_id` FK added to `users` (not a mapping table) — one dept per Dept SPOC by design.
- `renderMyPractice()` gained an `overridePractice` param — Dept SPOC drill-down reuses it.
  When called with an override, `userRole` is treated as 'spoc' to suppress team-lead-only UI.
- The drill-down DOM strategy temporarily reparents `#page-mypractice` child elements into
  `#mydept-mypractice-scope` so `renderMyPractice()` can write to them by ID.
- `toggleExecPractices()` renamed to `toggleRoleFields()` with an alias for compatibility.
- No new Edge Functions or tables added.

**Trade-offs:**
- The DOM reparenting in `openDeptDrillDown` is somewhat fragile — if new elements are added
  to `#page-mypractice` with hard-coded IDs, they must not clash. Consider a proper scoped
  render approach if the panel grows more complex.
- Approval escalation uses the existing `spoc_review → admin_review` path; no new status
  values were added.
```

- [ ] **Step 5: Commit documentation**

```bash
git add CHANGELOG.md docs/HLD.md docs/CODE_ARCHITECTURE.md docs/IMPLEMENTATION_NOTES.md
git commit -m "docs: multi-department dept_spoc — changelog, HLD, architecture, implementation notes"
```

---

## Task 9: Push to Origin

- [ ] **Step 1: Push all commits**

```bash
git push origin master
```

Expected: all 8 commits (Tasks 1–8) pushed successfully.

- [ ] **Step 2: Verify on GitHub**

Check that the latest commit on `master` is the docs commit from Task 8.

---

## Self-Review Checklist

- [x] Migration adds `department_id` to `users` and extends role CHECK → Task 1
- [x] `getUserProfile()` fetches `department_id` → Task 2
- [x] `isDeptSpoc()` and `getUserDepartmentId()` helpers → Task 2
- [x] `dept_spoc` label in `updateUserDisplay()` → Task 2
- [x] Sidebar nav items updated with `dept_spoc` role guards → Task 3
- [x] "My Department" sidebar nav item added → Task 3
- [x] Login redirect for `dept_spoc` → `#mydepartment` → Task 3
- [x] `renderMyPractice(overridePractice)` refactor → Task 4
- [x] `nudgeInactive` propagates `overridePractice` → Task 4
- [x] `#page-mydepartment` HTML scaffold → Task 5
- [x] `renderMyDepartment()` implementation → Task 6
- [x] Quarter selector wired for My Department → Task 6
- [x] Admin `eu-role` dropdown includes `dept_spoc` → Task 7
- [x] Admin `eu-department` field shown for `dept_spoc` → Task 7
- [x] `toggleRoleFields()` handles `dept_spoc` case → Task 7
- [x] `saveUser()` sets `department_id`, clears `practice` for `dept_spoc` → Task 7
- [x] RLS policies cover tasks, accomplishments, approvals, copilot_users, users, practice_spoc, projects → Task 1
- [x] `role_view_permissions` seeded to hide My Practice and Exec Summary for `dept_spoc` → Task 1
- [x] Full documentation sweep → Task 8
