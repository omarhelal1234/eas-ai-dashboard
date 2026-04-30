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

> **Decision history (read before implementing):** The original plan had the RPC accept `role` and `gh_access_active`. Codex review flagged both as defects: `role` is a privilege-escalation vector (any user can self-promote to admin) and `gh_access_active` writes a column auto-derived from IDE telemetry. Per user decisions A2 and D1 the RPC accepts ONLY `name`, `sector_id`, `department_id`, `practice` and explicitly rejects unknown keys (P2 strict-keys guard).

**Files:**
- Create: `sql/057_self_serve_profile.sql`

- [ ] **Step 1: Write the migration file**

**The live file `sql/057_self_serve_profile.sql` IS the source of truth for this task.** If regenerating, copy that file verbatim. The function:
- Accepts ONLY these payload keys: `name`, `sector_id`, `department_id`, `practice`. Any other key (including `role`, `gh_access_active`) returns `{ok:false, reason:'unsupported_keys', detail:[...]}`.
- Resolves caller from `auth.uid()` → `users.auth_id`.
- Updates `users.name`, then runs the org branch via `complete_profile(...)` for chain validation, then mirrors `sector_id`/`department_id`/`practice` into `copilot_users` (each only if the caller sent that key).
- Returns `{ok:true, applied[], warnings[]}` on success or `{ok:false, reason, detail?}` on validation failure.
- `SECURITY DEFINER`, `SET search_path = public`, `REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO authenticated`.

- [ ] **Step 2: Apply the migration via the Supabase MCP**

Read the full contents of `sql/057_self_serve_profile.sql` (use the `Read` tool, not Bash `cat`) and pass that exact body as the `query` argument to the Supabase MCP `apply_migration` tool, with `name: "057_self_serve_profile"`. Do NOT hand-recreate the SQL — the file is the single source of truth and includes the strict-keys guard, the org sync block, and the function comment. (Per CLAUDE.md §3, never shell out to `psql`.)

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
        <label>Role</label>
        <div id="pf-role" style="padding:8px 10px;background:var(--bg-primary);border:1px solid var(--border-color, rgba(255,255,255,0.1));border-radius:6px;font-size:14px;">—</div>
        <p class="status-line" style="color:var(--text-muted);font-size:12px;margin-top:4px;">
          Role changes are admin-only and managed in admin.html.
        </p>
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

    <!-- Licensed Tools (READ-ONLY — managed by licensing workflow + IDE telemetry) -->
    <section class="card" id="card-licensed">
      <h2>Licensed Tools</h2>
      <div class="field">
        <label>License status</label>
        <div id="pf-license-status" style="padding:8px 10px;background:var(--bg-primary);border:1px solid var(--border-color, rgba(255,255,255,0.1));border-radius:6px;font-size:14px;">—</div>
      </div>
      <div class="field">
        <label>GitHub Copilot active</label>
        <div id="pf-gh-status" style="padding:8px 10px;background:var(--bg-primary);border:1px solid var(--border-color, rgba(255,255,255,0.1));border-radius:6px;font-size:14px;">—</div>
      </div>
      <p class="status-line" style="color:var(--text-muted);font-size:12px;margin-top:8px;">
        These values are managed by the licensing workflow and the weekly IDE-telemetry sync. They cannot be edited here.
      </p>
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

## Task 5: Wire the Account section (name only; role is read-only display)

> **Decision history:** The original plan let users self-edit `role`. Decision A2 removed that — role is admin-only. Account section saves only `name`; the role field is a non-editable display populated from the current user profile.

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

    const roleLabels = {
      admin: 'Administrator', spoc: 'AI SPOC', dept_spoc: 'Dept SPOC',
      sector_spoc: 'Sector SPOC', team_lead: 'Team Lead',
      contributor: 'Contributor', viewer: 'Viewer', executive: 'Executive'
    };

    nameEl.value         = _current.user.name || '';
    emailEl.value        = _current.user.email || '';
    roleEl.textContent   = roleLabels[_current.user.role] || _current.user.role || '—';

    btn.addEventListener('click', async () => {
      const name = nameEl.value.trim();
      if (!name) { _setStatus('pf-account-status', 'err', 'Name cannot be empty.'); return; }
      if (name === (_current.user.name || '')) {
        _setStatus('pf-account-status', '', 'No changes.'); return;
      }

      btn.disabled = true;
      _setStatus('pf-account-status', '', 'Saving…');
      const { data, error } = await _client().rpc('update_my_profile', {
        p_changes: { name }
      });
      btn.disabled = false;
      if (error || !data?.ok) {
        _setStatus('pf-account-status', 'err', 'Error: ' + (error?.message || data?.reason || 'unknown'));
        return;
      }
      _current.user.name = name;
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

Reload `profile.html`. Change the name → click Save. Expected: green "Saved." appears. Reload the page → new name persists. Confirm the Role display shows the current role label and is NOT editable. Revert via SQL if needed:

```sql
UPDATE users SET name = 'Original Name' WHERE email = 'omar.helal.1234@gmail.com';
```

(via Supabase MCP `execute_sql`).

- [ ] **Step 3: Commit**

```bash
git add js/profile.js
git commit -m "feat(profile): wire Account section (name editable; role display only)"
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

## Task 7: Render the Licensed Tools section (READ-ONLY)

**Decision history:** The original plan had a self-serve GH active toggle. Codex review flagged that `copilot_users.github_copilot_status` is auto-derived from IDE telemetry by `refresh_copilot_users_ide_aggregates()` — any user-set value would be silently overwritten on the next sync. Decision (Issue D1): the section is read-only. Users see their license-provisioning status and GH-active state, but cannot edit them.

**Files:**
- Modify: `js/profile.js`
- Modify: `src/pages/profile.html` — replace the toggle + Save button with a read-only display

- [ ] **Step 1: Update `src/pages/profile.html` Licensed Tools card**

Replace the card body (the `<div class="field toggle-row">` and `<div class="row-actions">` blocks) with:

```html
      <div class="field">
        <label>License status</label>
        <div id="pf-license-status" style="padding:8px 10px;background:var(--bg-primary);border:1px solid var(--border-color, rgba(255,255,255,0.1));border-radius:6px;font-size:14px;">—</div>
      </div>
      <div class="field">
        <label>GitHub Copilot active</label>
        <div id="pf-gh-status" style="padding:8px 10px;background:var(--bg-primary);border:1px solid var(--border-color, rgba(255,255,255,0.1));border-radius:6px;font-size:14px;">—</div>
      </div>
      <p class="status-line" style="color:var(--text-muted);font-size:12px;margin-top:8px;">
        These values are managed by the licensing workflow and the weekly IDE-telemetry sync. They cannot be edited here.
      </p>
```

- [ ] **Step 2: Add `wireLicensed()` in `js/profile.js`**

Add inside the IIFE:

```javascript
  function wireLicensed() {
    const statusEl = document.getElementById('pf-license-status');
    const ghEl     = document.getElementById('pf-gh-status');

    if (!_current.licensed) {
      statusEl.textContent = 'Not in licensed-tool roster';
      ghEl.textContent     = '—';
      return;
    }
    statusEl.textContent = _current.licensed.status || '—';
    ghEl.textContent     = _current.licensed.github_copilot_status || '—';
  }
```

Update the `loadCurrent()` query in Task 4 (only if not already present): the `select` list on `copilot_users` must include `github_copilot_status`. Edit the existing line in `js/profile.js`:

```javascript
      .select('id, email, practice, status, github_copilot_status')
```

(was `'id, email, practice, status'`).

Update `init()`:

```javascript
  async function init() {
    await loadCurrent();
    wireAccount();
    await wireOrganization();
    wireLicensed();
  }
```

- [ ] **Step 3: Verify in browser**

Reload `profile.html`. Confirm:
- License status shows the current `copilot_users.status` value (e.g. "access granted").
- GitHub Copilot active shows `github_copilot_status` (e.g. "active" or "inactive").
- No Save button on this card.
- If the user has no `copilot_users` row, the card shows "Not in licensed-tool roster".

- [ ] **Step 4: Commit**

```bash
git add js/profile.js src/pages/profile.html
git commit -m "feat(profile): Licensed Tools section as read-only (auto-managed)"
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
2. Confirm Role displays the current role and is NOT editable.
3. Change practice via the cascade → Save → check `users.practice` AND `copilot_users.practice` both updated.
4. Change sector or department via the cascade → Save → check `users.sector_id`/`department_id` AND `copilot_users.sector_id`/`department_id` both updated.
5. Confirm Licensed Tools card shows License status + GH active as read-only text (no toggle, no Save).
6. Change password → sign out → sign back in with the new password. Change it back.

Expected: every section saves independently and shows its own inline status.

- [ ] **Step 2: Negative paths**

- Submit empty name → red error, no RPC call.
- Submit mismatched password confirmation → red error, no auth call.
- Pick an invalid sector/unit/practice combination (use DevTools to override the select before clicking Save) → server-side `complete_profile` returns failure → red error mentioning `org_validation_failed`.
- Strict-keys guard: open the page while logged in, then in DevTools console run `(await getSupabaseClient().rpc('update_my_profile', { p_changes: { role: 'admin' } })).data` and confirm the response is `{ok:false, reason:'unsupported_keys', detail:['role']}` — proves the privilege-escalation surface is closed. (`supabase` alone is the UMD namespace from the CDN; the client instance is what `getSupabaseClient()` returns.)

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
