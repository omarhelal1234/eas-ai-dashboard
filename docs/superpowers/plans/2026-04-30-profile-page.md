# Self-Serve Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every authenticated user a Profile page where they can edit their own name, role, organization (sector/department/practice), GitHub Copilot licensed-user status, and password. Practice changes propagate to both `users` and `copilot_users` (per Q4-B).

**Architecture:**
- New page `src/pages/profile.html` + IIFE module `js/profile.js` mirroring the existing `EAS_Auth` / `EAS_Hierarchy` pattern.
- Single new SQL migration `sql/057_self_serve_profile.sql` adding RPC `update_my_profile(jsonb)` (`SECURITY DEFINER`). All writes go through this RPC; existing `complete_profile` RPC is reused for the org cascade (called from inside `update_my_profile` for DRY).
- Password change uses `supabase.auth.updateUser` directly after a re-auth round-trip.
- Entry point: a Profile button added to the sidebar `user-profile` block on every authenticated page (next to the logout button).

**Tech Stack:** Vanilla JS (IIFE modules), Supabase JS v2 client (already loaded via `js/config.js`), Postgres + RLS, plain HTML/CSS using `css/variables.css` tokens.

**Testing reality:** This repo has no JS test runner configured (no Jest/Vitest/Mocha in `package.json`). Verification is **manual in a browser** plus direct SQL checks via the Supabase MCP. Each task lists the exact verification command. Do not invent fake test infrastructure.

---

## Task 1: Create the SQL migration for `update_my_profile`

**Files:**
- Create: `sql/057_self_serve_profile.sql`

- [ ] **Step 1: Write the migration file**

Create `sql/057_self_serve_profile.sql` with this exact content:

```sql
-- ============================================================
-- EAS AI Adoption — Migration 057: Self-serve profile RPC.
-- Single SECURITY DEFINER entry point for the profile.html page.
-- Lets the authenticated caller update their own name, role,
-- organization (sector/dept/practice), and GH licensed-user status.
-- Practice change syncs to copilot_users (matched by email) so the
-- licensed-tool roster stays consistent (Q4-B).
-- Password changes go through supabase.auth.updateUser, NOT this RPC.
-- ============================================================

CREATE OR REPLACE FUNCTION update_my_profile(p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          UUID;
  v_user_id      UUID;
  v_email        TEXT;
  v_applied      TEXT[] := ARRAY[]::TEXT[];
  v_role         TEXT;
  v_name         TEXT;
  v_practice     TEXT;
  v_sector_id    UUID;
  v_dept_id      UUID;
  v_gh_active    BOOLEAN;
  v_complete_res JSONB;
  v_copilot_hit  INTEGER;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT id, email INTO v_user_id, v_email FROM users WHERE auth_id = v_uid LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_users_row');
  END IF;

  -- ---- name ----
  IF p_changes ? 'name' THEN
    v_name := NULLIF(trim(p_changes->>'name'), '');
    IF v_name IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_name');
    END IF;
    UPDATE users SET name = v_name WHERE id = v_user_id;
    v_applied := array_append(v_applied, 'name');
  END IF;

  -- ---- role ----
  IF p_changes ? 'role' THEN
    v_role := p_changes->>'role';
    IF v_role NOT IN ('admin','spoc','dept_spoc','sector_spoc','team_lead','contributor','viewer','executive') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_role');
    END IF;
    UPDATE users SET role = v_role WHERE id = v_user_id;
    v_applied := array_append(v_applied, 'role');
  END IF;

  -- ---- organization (sector / department / practice) ----
  -- Reuse complete_profile for the chain validation. It writes
  -- users.sector_id, users.department_id, users.practice and flips
  -- profile_completed = true. Only call when at least one of the
  -- three keys is present in p_changes.
  IF (p_changes ? 'sector_id') OR (p_changes ? 'department_id') OR (p_changes ? 'practice') THEN
    -- Pull current values for any key the caller did NOT send so we
    -- pass a complete chain to complete_profile.
    SELECT
      COALESCE((p_changes->>'sector_id')::uuid,     sector_id),
      COALESCE((p_changes->>'department_id')::uuid, department_id),
      COALESCE(NULLIF(p_changes->>'practice',''),   practice)
    INTO v_sector_id, v_dept_id, v_practice
    FROM users WHERE id = v_user_id;

    IF v_sector_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'sector_required');
    END IF;

    v_complete_res := complete_profile(v_sector_id, v_dept_id, v_practice);
    IF (v_complete_res->>'success')::boolean IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'org_validation_failed',
        'detail', v_complete_res
      );
    END IF;

    -- Q4-B sync: mirror the practice change into copilot_users (matched by email).
    IF v_practice IS NOT NULL THEN
      UPDATE copilot_users
         SET practice = v_practice,
             updated_at = now()
       WHERE lower(email) = lower(v_email);
    END IF;

    v_applied := array_append(v_applied, 'organization');
  END IF;

  -- ---- GH access status (toggles copilot_users.status) ----
  IF p_changes ? 'gh_access_active' THEN
    v_gh_active := (p_changes->>'gh_access_active')::boolean;
    UPDATE copilot_users
       SET status = CASE WHEN v_gh_active THEN 'active' ELSE 'pending' END,
           updated_at = now()
     WHERE lower(email) = lower(v_email);
    GET DIAGNOSTICS v_copilot_hit = ROW_COUNT;
    IF v_copilot_hit = 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'no_licensed_user_row',
        'applied', to_jsonb(v_applied)
      );
    END IF;
    v_applied := array_append(v_applied, 'gh_access');
  END IF;

  RETURN jsonb_build_object('ok', true, 'applied', to_jsonb(v_applied));
END;
$$;

REVOKE EXECUTE ON FUNCTION update_my_profile(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_my_profile(jsonb) TO authenticated;

COMMENT ON FUNCTION update_my_profile(jsonb) IS
  'Self-serve profile update for the authenticated caller. Accepts a JSONB payload with any of: name, role, sector_id, department_id, practice, gh_access_active. Returns {ok, applied[]} or {ok:false, reason}. Practice changes are mirrored into copilot_users (Q4-B).';
```

- [ ] **Step 2: Apply the migration via the Supabase MCP**

Use the Supabase MCP `apply_migration` tool with name `057_self_serve_profile` and the SQL above. (Per CLAUDE.md §3, never shell out to `psql`.)

Expected: migration succeeds, function `update_my_profile(jsonb)` exists.

- [ ] **Step 3: Smoke-test the RPC**

Use Supabase MCP `execute_sql`:

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'update_my_profile';
```

Expected: returns one row whose body matches what was written.

```sql
SELECT has_function_privilege('authenticated', 'update_my_profile(jsonb)', 'EXECUTE');
```

Expected: `true`.

- [ ] **Step 4: Commit**

```bash
git add sql/057_self_serve_profile.sql
git commit -m "feat(sql): update_my_profile RPC for self-serve profile edits"
```

---

## Task 2: Add a "Profile" button to the sidebar `user-profile` block

**Files:**
- Modify: `src/pages/index.html` (around line 178-188 — the `.user-profile` block)
- Modify: every other authenticated page that has the same sidebar footer (search before editing, see Step 1)

- [ ] **Step 1: Find every page that uses the sidebar `user-profile` markup**

Use the Grep tool:

```
pattern: class="user-profile"
glob:    src/pages/*.html
output:  files_with_matches
```

Expected matches at least: `src/pages/index.html`, `src/pages/admin.html`, `src/pages/employee-status.html`. Apply Step 2 to **every** file returned.

- [ ] **Step 2: Insert the Profile button before the logout button**

In each matched file, find this block:

```html
      <button class="btn-logout" onclick="EAS_Auth.signOut()" title="Sign Out" aria-label="Sign Out">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </button>
```

Insert immediately before it:

```html
      <a href="profile.html" class="btn-logout" title="My Profile" aria-label="My Profile" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </a>
```

(Reuses the existing `.btn-logout` class so no new CSS is needed; the icon is the standard "user" silhouette.)

- [ ] **Step 3: Verify in a browser**

Run the project (open `src/pages/index.html` via VS Code Live Server or your usual workflow), log in, and confirm:
- Two icons appear in the sidebar footer: user icon, then logout icon.
- Hovering shows tooltips "My Profile" and "Sign Out".
- Clicking the user icon navigates to `profile.html` (will 404 until Task 3 lands — that's expected at this point).

- [ ] **Step 4: Commit**

```bash
git add src/pages/*.html
git commit -m "feat(ui): add Profile button to sidebar footer"
```

---

## Task 3: Scaffold `src/pages/profile.html`

**Files:**
- Create: `src/pages/profile.html`

- [ ] **Step 1: Write the file**

Create `src/pages/profile.html` with this exact content (sections are scaffolded; behavior is wired in Tasks 5-8):

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>My Profile — EAS AI Adoption Tracker</title>
<script>if(localStorage.getItem('eas-theme')==='light')document.documentElement.setAttribute('data-theme','light')</script>
<link rel="stylesheet" href="../../css/variables.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    min-height: 100vh;
    padding: 32px 20px;
  }
  .profile-wrap { max-width: 640px; margin: 0 auto; }
  .profile-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; }
  .profile-header h1 { font-size:24px; font-weight:600; }
  .profile-header a { color: var(--accent); text-decoration:none; font-size:14px; }
  .card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color, rgba(255,255,255,0.06));
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .card h2 { font-size:16px; font-weight:600; margin-bottom:12px; }
  .field { margin-bottom:12px; }
  .field label { display:block; font-size:13px; color: var(--text-muted); margin-bottom:4px; }
  .field input, .field select {
    width:100%; padding:8px 10px;
    background: var(--bg-primary); color: var(--text-primary);
    border: 1px solid var(--border-color, rgba(255,255,255,0.1));
    border-radius: 6px; font-size:14px; font-family:inherit;
  }
  .field input[readonly] { opacity: 0.6; cursor: not-allowed; }
  .row-actions { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:8px; }
  .btn-primary {
    background: var(--accent); color:#fff; border:none;
    padding: 8px 16px; border-radius:6px; font-size:14px; font-weight:500; cursor:pointer;
  }
  .btn-primary[disabled] { opacity:0.5; cursor:not-allowed; }
  .status-line { font-size:13px; min-height:1em; }
  .status-line.ok { color: #16a34a; }
  .status-line.err { color: #c0392b; }
  .toggle-row { display:flex; align-items:center; gap:10px; }
  .toggle-row input[type="checkbox"] { width:auto; }
</style>
</head>
<body>
  <div class="profile-wrap">
    <div class="profile-header">
      <h1>My Profile</h1>
      <a href="index.html">← Back to dashboard</a>
    </div>

    <!-- Account -->
    <section class="card" id="card-account">
      <h2>Account</h2>
      <div class="field">
        <label for="pf-name">Full name</label>
        <input id="pf-name" type="text" autocomplete="name" />
      </div>
      <div class="field">
        <label for="pf-email">Email</label>
        <input id="pf-email" type="email" readonly />
      </div>
      <div class="field">
        <label for="pf-role">Role</label>
        <select id="pf-role">
          <option value="admin">Administrator</option>
          <option value="spoc">AI SPOC</option>
          <option value="dept_spoc">Dept SPOC</option>
          <option value="sector_spoc">Sector SPOC</option>
          <option value="team_lead">Team Lead</option>
          <option value="contributor">Contributor</option>
          <option value="viewer">Viewer</option>
          <option value="executive">Executive</option>
        </select>
      </div>
      <div class="row-actions">
        <span class="status-line" id="pf-account-status"></span>
        <button class="btn-primary" id="pf-account-save">Save</button>
      </div>
    </section>

    <!-- Organization -->
    <section class="card" id="card-org">
      <h2>Organization</h2>
      <div class="field">
        <label for="pf-sector">Sector</label>
        <select id="pf-sector"></select>
      </div>
      <div class="field">
        <label for="pf-unit">Department / Unit</label>
        <select id="pf-unit"></select>
      </div>
      <div class="field">
        <label for="pf-practice">Practice</label>
        <select id="pf-practice"></select>
      </div>
      <div class="row-actions">
        <span class="status-line" id="pf-org-status"></span>
        <button class="btn-primary" id="pf-org-save">Save</button>
      </div>
    </section>

    <!-- Licensed Tools -->
    <section class="card" id="card-licensed">
      <h2>Licensed Tools</h2>
      <div class="field toggle-row">
        <input id="pf-gh-active" type="checkbox" />
        <label for="pf-gh-active">GitHub Copilot active (mark as actively using your license)</label>
      </div>
      <div class="row-actions">
        <span class="status-line" id="pf-licensed-status"></span>
        <button class="btn-primary" id="pf-licensed-save">Save</button>
      </div>
    </section>

    <!-- Security -->
    <section class="card" id="card-security">
      <h2>Security</h2>
      <div class="field">
        <label for="pf-pw-current">Current password</label>
        <input id="pf-pw-current" type="password" autocomplete="current-password" />
      </div>
      <div class="field">
        <label for="pf-pw-new">New password</label>
        <input id="pf-pw-new" type="password" autocomplete="new-password" />
      </div>
      <div class="field">
        <label for="pf-pw-confirm">Confirm new password</label>
        <input id="pf-pw-confirm" type="password" autocomplete="new-password" />
      </div>
      <div class="row-actions">
        <span class="status-line" id="pf-security-status"></span>
        <button class="btn-primary" id="pf-security-save">Change password</button>
      </div>
    </section>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="../../js/config.js"></script>
  <script src="../../js/auth.js"></script>
  <script src="../../js/utils.js"></script>
  <script src="../../js/hierarchy.js"></script>
  <script src="../../js/profile.js"></script>
  <script>
    (async () => {
      const ok = await EAS_Auth.requireAuth();
      if (!ok) return;
      await Profile.init();
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the page loads and gates on auth**

Open `src/pages/profile.html` while logged out → should redirect to `login.html`. Log in → page renders all four cards. (Selects may be empty / unwired until Tasks 5-8.)

- [ ] **Step 3: Commit**

```bash
git add src/pages/profile.html
git commit -m "feat(ui): scaffold profile.html with four section cards"
```

---

## Task 4: Create `js/profile.js` skeleton with `init()` and `loadCurrent()`

**Files:**
- Create: `js/profile.js`

- [ ] **Step 1: Write the module**

Create `js/profile.js`:

```javascript
// ============================================================
// EAS_Profile — self-serve profile edits.
// Backed by the update_my_profile RPC (sql/057) and
// supabase.auth.updateUser for the password path.
// ============================================================

const Profile = (() => {
  const sb = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  let _current = null; // { user, licensed }

  function _client() {
    if (!sb) throw new Error('Profile: Supabase client not available');
    return sb;
  }

  function _setStatus(elId, kind, msg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.className = 'status-line ' + (kind || '');
    el.textContent = msg || '';
  }

  async function loadCurrent() {
    const profile = await EAS_Auth.getUserProfile(true);
    if (!profile) throw new Error('No user profile loaded');

    const { data: licensed } = await _client()
      .from('copilot_users')
      .select('id, email, practice, status')
      .ilike('email', profile.email)
      .maybeSingle();

    _current = { user: profile, licensed: licensed || null };
    return _current;
  }

  async function init() {
    await loadCurrent();
    // Section wiring is added in later tasks.
  }

  return { init, loadCurrent, _setStatus, _client, get current() { return _current; } };
})();
```

- [ ] **Step 2: Verify it loads without console errors**

Reload `profile.html`. Open DevTools console. Expected: no errors. `Profile.current` (after `Profile.init()` resolves) returns `{ user: {...}, licensed: {...} | null }`.

- [ ] **Step 3: Commit**

```bash
git add js/profile.js
git commit -m "feat(js): Profile module skeleton with loadCurrent"
```

---

## Task 5: Wire the Account section (name, role)

**Files:**
- Modify: `js/profile.js`

- [ ] **Step 1: Add the wiring**

In `js/profile.js`, **inside** the IIFE, add this function and call it from `init()` after `loadCurrent()`:

```javascript
  function wireAccount() {
    const nameEl = document.getElementById('pf-name');
    const emailEl = document.getElementById('pf-email');
    const roleEl = document.getElementById('pf-role');
    const btn = document.getElementById('pf-account-save');

    nameEl.value  = _current.user.name || '';
    emailEl.value = _current.user.email || '';
    roleEl.value  = _current.user.role || 'contributor';

    btn.addEventListener('click', async () => {
      const name = nameEl.value.trim();
      const role = roleEl.value;
      if (!name) { _setStatus('pf-account-status', 'err', 'Name cannot be empty.'); return; }

      btn.disabled = true;
      _setStatus('pf-account-status', '', 'Saving…');
      const { data, error } = await _client().rpc('update_my_profile', {
        p_changes: { name, role }
      });
      btn.disabled = false;
      if (error || !data?.ok) {
        _setStatus('pf-account-status', 'err', 'Error: ' + (error?.message || data?.reason || 'unknown'));
        return;
      }
      _current.user.name = name;
      _current.user.role = role;
      _setStatus('pf-account-status', 'ok', 'Saved.');
    });
  }
```

Update `init()`:

```javascript
  async function init() {
    await loadCurrent();
    wireAccount();
  }
```

- [ ] **Step 2: Verify in browser**

Reload `profile.html`. Change the name → click Save. Expected: green "Saved." appears. Reload the page → new name persists. Revert via SQL if needed:

```sql
UPDATE users SET name = 'Original Name' WHERE email = 'omar.helal.1234@gmail.com';
```

(via Supabase MCP `execute_sql`).

- [ ] **Step 3: Commit**

```bash
git add js/profile.js
git commit -m "feat(profile): wire Account section (name, role)"
```

---

## Task 6: Wire the Organization section (sector → unit → practice cascade)

**Files:**
- Modify: `js/profile.js`

- [ ] **Step 1: Add `wireOrganization()`**

In `js/profile.js`, add inside the IIFE:

```javascript
  async function wireOrganization() {
    const sectorEl   = document.getElementById('pf-sector');
    const unitEl     = document.getElementById('pf-unit');
    const practiceEl = document.getElementById('pf-practice');
    const btn        = document.getElementById('pf-org-save');

    if (typeof EAS_Hierarchy === 'undefined') {
      _setStatus('pf-org-status', 'err', 'Hierarchy module unavailable.');
      return;
    }

    await EAS_Hierarchy.attachCascade({
      sectorEl, unitEl, practiceEl,
      initial: {
        sectorId:     _current.user.sector_id || null,
        departmentId: _current.user.department_id || null,
        practice:     _current.user.practice || null
      }
    });

    btn.addEventListener('click', async () => {
      const check = await EAS_Hierarchy.validateCascade(sectorEl, unitEl, practiceEl);
      if (!check.ok) { _setStatus('pf-org-status', 'err', check.error); return; }

      btn.disabled = true;
      _setStatus('pf-org-status', '', 'Saving…');
      const { data, error } = await _client().rpc('update_my_profile', {
        p_changes: {
          sector_id:     check.sectorId,
          department_id: check.departmentId,
          practice:      check.practice
        }
      });
      btn.disabled = false;
      if (error || !data?.ok) {
        _setStatus('pf-org-status', 'err', 'Error: ' + (error?.message || data?.reason || 'unknown'));
        return;
      }
      _current.user.sector_id     = check.sectorId;
      _current.user.department_id = check.departmentId;
      _current.user.practice      = check.practice;
      _setStatus('pf-org-status', 'ok', 'Saved.');
    });
  }
```

Update `init()`:

```javascript
  async function init() {
    await loadCurrent();
    wireAccount();
    await wireOrganization();
  }
```

- [ ] **Step 2: Verify in browser**

Reload `profile.html`. The three selects pre-fill with your current sector/dept/practice. Change practice → Save. Expected: "Saved." Then check via Supabase MCP:

```sql
SELECT u.practice, c.practice AS copilot_practice
FROM users u
LEFT JOIN copilot_users c ON lower(c.email) = lower(u.email)
WHERE u.email = 'omar.helal.1234@gmail.com';
```

Expected: both columns reflect the new practice (Q4-B sync confirmed). Revert via SQL afterwards if the test value should not stick.

- [ ] **Step 3: Commit**

```bash
git add js/profile.js
git commit -m "feat(profile): wire Organization section (cascade + practice sync)"
```

---

## Task 7: Wire the Licensed Tools section (GH access toggle)

**Files:**
- Modify: `js/profile.js`

- [ ] **Step 1: Add `wireLicensed()`**

Add inside the IIFE:

```javascript
  function wireLicensed() {
    const toggleEl = document.getElementById('pf-gh-active');
    const btn      = document.getElementById('pf-licensed-save');

    if (!_current.licensed) {
      toggleEl.disabled = true;
      btn.disabled = true;
      _setStatus('pf-licensed-status', 'err',
        'You are not in the licensed-tool roster. Contact your SPOC to be added.');
      return;
    }

    toggleEl.checked = (_current.licensed.status === 'active');

    btn.addEventListener('click', async () => {
      const active = !!toggleEl.checked;
      btn.disabled = true;
      _setStatus('pf-licensed-status', '', 'Saving…');
      const { data, error } = await _client().rpc('update_my_profile', {
        p_changes: { gh_access_active: active }
      });
      btn.disabled = false;
      if (error || !data?.ok) {
        if (data?.reason === 'no_licensed_user_row') {
          _setStatus('pf-licensed-status', 'err',
            'Your licensed-user record was removed. Refresh the page.');
        } else {
          _setStatus('pf-licensed-status', 'err', 'Error: ' + (error?.message || data?.reason || 'unknown'));
        }
        return;
      }
      _current.licensed.status = active ? 'active' : 'pending';
      _setStatus('pf-licensed-status', 'ok', 'Saved.');
    });
  }
```

Update `init()`:

```javascript
  async function init() {
    await loadCurrent();
    wireAccount();
    await wireOrganization();
    wireLicensed();
  }
```

- [ ] **Step 2: Verify in browser**

Reload `profile.html`. If your account has a `copilot_users` row, the toggle reflects current `status`. Flip it → Save. Expected: "Saved." Then verify via SQL:

```sql
SELECT email, status FROM copilot_users WHERE lower(email) = lower('omar.helal.1234@gmail.com');
```

Also test the empty-roster path: temporarily delete the `copilot_users` row, reload, expect the section to be disabled with the explanatory message. Restore the row afterwards.

- [ ] **Step 3: Commit**

```bash
git add js/profile.js
git commit -m "feat(profile): wire Licensed Tools section (GH access toggle)"
```

---

## Task 8: Wire the Security section (password change)

**Files:**
- Modify: `js/profile.js`

- [ ] **Step 1: Add `wireSecurity()`**

Add inside the IIFE:

```javascript
  function wireSecurity() {
    const curEl     = document.getElementById('pf-pw-current');
    const newEl     = document.getElementById('pf-pw-new');
    const confirmEl = document.getElementById('pf-pw-confirm');
    const btn       = document.getElementById('pf-security-save');

    btn.addEventListener('click', async () => {
      const cur = curEl.value;
      const next = newEl.value;
      const confirm = confirmEl.value;

      if (!cur || !next || !confirm) {
        _setStatus('pf-security-status', 'err', 'Fill all three fields.'); return;
      }
      if (next.length < 8) {
        _setStatus('pf-security-status', 'err', 'New password must be at least 8 characters.'); return;
      }
      if (next !== confirm) {
        _setStatus('pf-security-status', 'err', 'New password and confirmation do not match.'); return;
      }

      btn.disabled = true;
      _setStatus('pf-security-status', '', 'Verifying current password…');

      // Re-auth round-trip to confirm the current password is correct.
      const { error: signInErr } = await _client().auth.signInWithPassword({
        email: _current.user.email,
        password: cur
      });
      if (signInErr) {
        btn.disabled = false;
        _setStatus('pf-security-status', 'err', 'Current password is incorrect.');
        return;
      }

      _setStatus('pf-security-status', '', 'Updating password…');
      const { error: updErr } = await _client().auth.updateUser({ password: next });
      btn.disabled = false;
      if (updErr) {
        _setStatus('pf-security-status', 'err', 'Error: ' + updErr.message);
        return;
      }
      curEl.value = newEl.value = confirmEl.value = '';
      _setStatus('pf-security-status', 'ok', 'Password updated.');
    });
  }
```

Update `init()`:

```javascript
  async function init() {
    await loadCurrent();
    wireAccount();
    await wireOrganization();
    wireLicensed();
    wireSecurity();
  }
```

- [ ] **Step 2: Verify in browser**

Reload `profile.html`. Enter a wrong current password → expect "Current password is incorrect." Enter the correct current password and a new one of length ≥ 8 (matching confirmation) → expect "Password updated." Sign out, sign back in with the new password to confirm. Then change it back to your real password.

- [ ] **Step 3: Commit**

```bash
git add js/profile.js
git commit -m "feat(profile): wire Security section (password change)"
```

---

## Task 9: End-to-end manual verification

- [ ] **Step 1: Walk through every section in one session**

Log in as a contributor account (not admin). On `profile.html`:
1. Change name → Save → reload → name persists.
2. Change role to a different valid role → Save → reload → role persists. (Revert via SQL afterwards.)
3. Change practice via the cascade → Save → check `users.practice` AND `copilot_users.practice` both updated.
4. Toggle GH access → Save → check `copilot_users.status`.
5. Change password → sign out → sign back in with the new password. Change it back.

Expected: every section saves independently and shows its own inline status.

- [ ] **Step 2: Negative paths**

- Submit empty name → red error, no RPC call.
- Submit mismatched password confirmation → red error, no auth call.
- Pick an invalid sector/unit/practice combination (use DevTools to override the select before clicking Save) → server-side `complete_profile` returns failure → red error mentioning `org_validation_failed`.

- [ ] **Step 3: Theme + responsive**

Toggle light/dark theme. Confirm cards remain readable in both. Resize the window narrow (mobile width) — content stacks cleanly.

- [ ] **Step 4: Regression sweep on existing pages**

Open the dashboard (`index.html`), admin (`admin.html`), and employee status pages. Confirm sidebar still shows BOTH icons (Profile + Sign Out) and nothing else broke.

---

## Task 10: Documentation sweep (CLAUDE.md §4 — full)

**Files (modify each):**
- `CHANGELOG.md`
- `docs/BRD.md`
- `docs/HLD.md`
- `docs/CODE_ARCHITECTURE.md`
- `docs/IMPLEMENTATION_NOTES.md`
- `docs/IMPLEMENTATION_PLAN.md` (if it has phase tracking that this work fits into; otherwise note "n/a — feature is out-of-band of phase plan")

- [ ] **Step 1: CHANGELOG**

Append under `## [Unreleased]`:

```
- 2026-04-30 (claude) — feat: self-serve profile page (src/pages/profile.html, js/profile.js, sql/057_self_serve_profile.sql) lets users edit name, role, organization, GH access, and password; practice changes mirror to copilot_users (profile)
```

- [ ] **Step 2: BRD**

Add a section noting users can self-serve all their profile fields (no admin approval), per Q1-A decision.

- [ ] **Step 3: HLD**

Add `update_my_profile(jsonb)` to the RPC list, note the Q4-B sync into `copilot_users`, and add `js/profile.js` to the client modules list.

- [ ] **Step 4: CODE_ARCHITECTURE**

Add `src/pages/profile.html` and `js/profile.js` to the file inventory with a one-line responsibility statement each.

- [ ] **Step 5: IMPLEMENTATION_NOTES**

Append a section with:
- Why a single `update_my_profile` RPC instead of relaxing per-column RLS on three tables.
- Why we reuse `complete_profile` from inside the new RPC (avoid duplicating chain validation).
- Q4-B copilot_users sync rationale (keeps licensed-tool roster aligned with `users.practice`).
- Password change kept out of the RPC because Supabase Auth lives in `auth.users`, not `public.users`.

- [ ] **Step 6: Commit the docs**

```bash
git add CHANGELOG.md docs/BRD.md docs/HLD.md docs/CODE_ARCHITECTURE.md docs/IMPLEMENTATION_NOTES.md
git commit -m "docs: documentation sweep for self-serve profile page"
```

---

## Task 11: Final push

- [ ] **Step 1: Push to origin**

```bash
git push origin master
```

(Per CLAUDE.md §7: push after completion unless the user requests otherwise. If `master` push requires a different branch policy at this repo, ask before pushing.)

---

## Self-Review (writing-plans skill — completed inline)

- **Spec coverage:** Every section of the spec maps to a task. Account → Task 5. Organization → Task 6 (uses existing `complete_profile` per Note 2). Licensed Tools → Task 7. Security → Task 8. RPC + RLS → Task 1. Entry point → Task 2. Page scaffold → Task 3. Module → Task 4.
- **Placeholder scan:** No TBD/TODO/"add appropriate validation" left. Every code block is concrete.
- **Type consistency:** RPC name `update_my_profile`, payload key `gh_access_active`, response keys `ok`/`reason`/`applied`/`detail` — used identically in SQL (Task 1) and JS (Tasks 5-8).
- **Spec drift noted at top of plan:** "org_hierarchy" wording in spec corrected to `users.sector_id`/`users.department_id` (the actual columns); reuse of `complete_profile` chain validation; sidebar entry point (no dropdown — sidebar has no menu today).
