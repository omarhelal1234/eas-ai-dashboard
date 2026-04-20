# Multi-Department Support — Design Spec
**Date:** 2026-04-20  
**Status:** Approved  
**Author:** Omar (via brainstorming session)

---

## Overview

Add a `dept_spoc` role (7th role) that sits above practice SPOCs in the org hierarchy. A Dept SPOC oversees all practices within their assigned department — seeing aggregated KPIs, drilling into individual practice panels with full SPOC powers, and optionally escalating or overriding approvals.

---

## Org Hierarchy (New)

```
Admin
└── Department (e.g. EAS, Service Excellence)
    └── Dept SPOC — oversees whole department
        └── Practice (e.g. BFSI, CES, ERP, EPS, CIS, Security)
            └── Practice SPOC — manages one practice
                └── Team Lead → Contributors
```

---

## Decisions Made

| # | Question | Decision |
|---|---|---|
| 1 | Is Dept SPOC a new distinct role? | Yes — `dept_spoc`, 7th role |
| 2 | Approval authority? | Optional escalation/override — not a required step in the approval chain |
| 3 | Dashboard location? | New "My Department" view in existing SPA (`index.html`) |
| 4 | Scope storage? | `department_id` FK on `users` table; one department per Dept SPOC |
| 5 | Drill-down access? | Full SPOC powers for any practice in their department |
| 6 | Account creation? | Admin-only — no self-registration |
| 7 | Implementation approach? | Extend SPOC infrastructure (reuse, no duplication) |

---

## Section 1 — Data Model Changes

### Migration 025: Add `dept_spoc` role and `department_id` to users

```sql
-- 1. Update role CHECK constraint
-- NOTE: verify actual constraint name first:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c';
-- Then drop by exact name before re-adding.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check,
  ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin','spoc','team_lead','contributor','viewer','executive','dept_spoc'));

-- 2. Add department_id to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department_id UUID
    REFERENCES departments(id) ON DELETE SET NULL;

-- 3. Index for RLS performance
CREATE INDEX IF NOT EXISTS idx_users_dept_spoc
  ON users(role, department_id)
  WHERE role = 'dept_spoc';
```

**No new tables.** No changes to `practices`, `departments`, `practice_spoc`, or `tasks`.

**Column usage by role:**

| Role | `practice` | `department_id` |
|---|---|---|
| contributor, spoc, team_lead | set | null (dept derived via practice) |
| dept_spoc | null | set |
| admin, viewer, executive | null | null |

---

## Section 2 — Role & Auth Changes

### Backend (`get_user_role()`)
No change — reads `users.role` directly. `dept_spoc` works automatically after the CHECK constraint update.

### Frontend auth (`js/auth.js`)
- Add `dept_spoc` to any role switch/guard logic
- `getUserProfile()` already fetches the full `users` row — `department_id` returns automatically

### UIGuard (`js/utils.js`)
Add `dept_spoc` wherever `spoc` appears in UIGuard calls for shared views (Tasks, Leaderboard, Approvals, Community Prompts).

### Sidebar visibility (`role_view_permissions` table)
Insert deny-list entries for `dept_spoc`:

| View | Visible to `dept_spoc`? |
|---|---|
| Dashboard | ✅ |
| My Department | ✅ (new) |
| Tasks | ✅ |
| Leaderboard | ✅ |
| Approvals | ✅ |
| Community Prompts | ✅ |
| My Practice | ❌ (spoc only) |
| Executive Summary | ❌ |
| Admin Panel | ❌ |

### Login redirect
After login, `dept_spoc` is redirected to `#my-department` (same pattern as `spoc` → `#my-practice`).

---

## Section 3 — RLS Policies

### New helper function

```sql
CREATE OR REPLACE FUNCTION get_user_department_id()
RETURNS UUID AS $$
  SELECT department_id FROM users WHERE auth_id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;
```

### Scope join pattern (used in all extended policies)

```sql
practice IN (
  SELECT name FROM practices
  WHERE department_id = get_user_department_id()
)
```

### Policies extended (add `dept_spoc` OR-clause to existing `spoc` policies)

| Table | Action | Scope |
|---|---|---|
| `tasks` | SELECT, UPDATE | Practice in user's department |
| `accomplishments` | SELECT, UPDATE | Practice in user's department |
| `submission_approvals` | SELECT, UPDATE | Practice in user's department |
| `copilot_users` | SELECT | Practice in user's department |
| `users` | SELECT | Users whose practice belongs to user's department |
| `practice_spoc` | SELECT | Practices in user's department |
| `projects` | SELECT | Practice in user's department |

`departments` and `practices` RLS unchanged — already public-read / admin-write.

---

## Section 4 — Frontend: "My Department" View

### Sidebar entry
```html
<li data-view="my-department" class="nav-item dept-spoc-only">My Department</li>
```
Hidden via UIGuard for all roles except `dept_spoc`.

### View layout (`#my-department` section in `index.html`)

```
┌─────────────────────────────────────────────────────┐
│  [Dept Name] Department              [Export ▾]      │
│  [N] practices · [N] active users · [Quarter]        │
├─────────────────────────────────────────────────────┤
│  [Total Tasks] │ [Hours Saved] │ [Efficiency] │ [Users] │
├─────────────────────────────────────────────────────┤
│  Practice Cards Grid (1 per practice in dept)        │
│  Each card: name · task count · efficiency · [View ▶]│
├─────────────────────────────────────────────────────┤
│  Practice Detail Panel                               │
│  (loads on View ▶ click — reuses SPOC panel funcs)  │
└─────────────────────────────────────────────────────┘
```

### JS reuse strategy

Existing SPOC panel functions (leaderboard loader, inactive users nudge, approval queue, KPI cards) are refactored to accept an optional `overridePractice` parameter:

```js
// Before:
function loadSpocPanel() {
  const practice = userProfile.practice;
  // ...
}

// After:
function loadSpocPanel(overridePractice = null) {
  const practice = overridePractice ?? userProfile.practice;
  // ...
}
```

When a Dept SPOC clicks "View ▶" on a practice card, `loadSpocPanel(selectedPractice)` is called. No logic duplication.

### Approval escalation
In the dept-level approvals view, each pending submission gets an "Escalate to Admin" button alongside the existing Approve/Reject actions. Escalation uses the existing admin escalation path already present in `submission_approvals`.

---

## Section 5 — Admin Panel Changes

### User edit modal (`admin.html`)
- Add `dept_spoc` to the role `<select>` dropdown
- Conditional field logic:
  - When role = `dept_spoc`: hide "Practice" field, show "Department" dropdown (from `departments` table)
  - On save: `role = 'dept_spoc'`, `department_id = <selected>`, `practice = null`
  - All other roles: existing behaviour unchanged

### Department SPOCs table (in Users management section)
New tab/sub-section listing current `dept_spoc` assignments:

| Name | Email | Department | Assigned Since | Actions |
|---|---|---|---|---|
| — | — | — | — | Edit · Remove |

Same CRUD pattern as existing SPOC management table. No new page or Edge Function.

---

## Out of Scope (explicitly excluded)

- Self-registration for `dept_spoc`
- A Dept SPOC being assigned to multiple departments
- Dept SPOC as a required step in the approval chain
- Changes to existing `spoc`, `team_lead`, `contributor`, `executive`, or `viewer` role behaviour
- Any new Edge Functions or server-side endpoints

---

## Files Affected

| File | Change |
|---|---|
| `sql/025_dept_spoc_role.sql` | New migration (role constraint + users.department_id + RLS) |
| `js/auth.js` | Add `dept_spoc` to role guards |
| `js/utils.js` | UIGuard: add `dept_spoc` to shared view guards |
| `js/db.js` | SPOC panel functions: add `overridePractice` param |
| `src/pages/index.html` | New `#my-department` section + sidebar entry |
| `src/pages/admin.html` | Role dropdown + dept field conditional + Dept SPOC table |
| `CHANGELOG.md` | Entry under `[Unreleased]` |
| `docs/HLD.md` | Update role hierarchy diagram |
| `docs/CODE_ARCHITECTURE.md` | Document new role + view |
| `docs/IMPLEMENTATION_NOTES.md` | Rationale and trade-offs |
