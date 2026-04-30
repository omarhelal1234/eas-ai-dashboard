# Self-Serve Profile Page — Design Spec

**Date:** 2026-04-30
**Status:** Approved (brainstorming)
**Author:** Omar Ibrahim (via Claude)

## 1. Goal

Let an authenticated user view and edit their own profile from a dedicated page reachable via the existing header avatar/initials menu. Self-serve scope (per Q1 = A): user can change all their own fields without admin approval. Changes to overlapping fields must propagate to both `users` and `copilot_users` (per Q4 = B).

## 2. Entry Point

- Existing header avatar/initials button → dropdown gains a **"Profile"** item → navigates to `src/pages/profile.html`.
- "Sign out" remains in the dropdown.
- No top-level nav item (Q3 = B).

## 3. Page

`src/pages/profile.html`

- Visual language matches `signup.html` (centered card, brand block, theme-aware via `css/variables.css`).
- "Back to dashboard" link in the header strip.
- Four independent sections, each with its own Save button and inline status line:

  1. **Account** — full name (editable), email (read-only), role (select from existing CHECK list).
  2. **Organization** — practice, department, sector. Cascading selects loaded from `practices`, `departments`, `sectors`.
  3. **Licensed Tools** — GH access status toggle. Maps to `copilot_users.status` (`active` ↔ `pending`).
  4. **Security** — current password, new password, confirm new password.

## 4. Client Module

New IIFE module `js/profile.js` (matches `js/db.js`, `js/auth.js` style):

```
Profile.loadCurrent() → {
  user:       row from users (by auth_id),
  hierarchy:  row from org_hierarchy (by email, may be null),
  licensed:   row from copilot_users (by email, may be null)
}
Profile.saveAccount({ name, role })
Profile.saveOrganization({ practice, department, sector })
Profile.saveGhAccess(active: boolean)
Profile.changePassword(current, next)
```

All writes route through Supabase client (RPC where applicable). No bypass of RLS.

## 5. Database

New migration: `sql/057_profile_self_update.sql`

### 5.1 RPC

```sql
update_my_profile(p_changes jsonb) returns jsonb
  security definer
  language plpgsql
```

Single transaction. Reads `auth.uid()`, resolves the caller's `users` row, and applies whichever of these keys are present in `p_changes`:

- `name` → `users.name`
- `role` → `users.role` (validated against CHECK list)
- `practice` → `users.practice` AND `copilot_users.practice WHERE email = caller_email` AND `org_hierarchy.practice WHERE email = caller_email` (Q4-B sync)
- `department` → `org_hierarchy.department` (upsert by email)
- `sector` → `org_hierarchy.sector` (upsert by email)
- `gh_access_active` (boolean) → `copilot_users.status` (`active`/`pending`) WHERE email = caller_email. If no `copilot_users` row exists, returns `{ ok:false, reason:'no_licensed_user_row' }` so the UI can surface a clear message.

Returns `{ ok: true, applied: [...] }` on success, `{ ok: false, reason, detail }` on failure.

Password change is **not** in this RPC — it goes through `supabase.auth.updateUser({ password })` directly, after a re-auth round-trip with the user's current password.

### 5.2 Grants

`GRANT EXECUTE ON FUNCTION update_my_profile(jsonb) TO authenticated;`

### 5.3 Policies

The RPC is `SECURITY DEFINER` so no per-column RLS relaxation is required. Existing RLS on `users`, `copilot_users`, `org_hierarchy` stays untouched. The function is the single audited write path for self-serve profile edits.

## 6. Validation

- `practice`, `department`, `sector` must exist in their lookup tables (FK enforces).
- `role` must be in the `users.role` CHECK list.
- Password: min 8 chars; current password verified via a `signInWithPassword` round-trip before calling `auth.updateUser`.
- Email is not editable in v1.

## 7. Error Handling

- Each section catches errors locally and shows an inline status line ("Saved", "Error: …").
- Save buttons are disabled while a request is in flight and re-enabled on completion or failure.
- Auth failure on password change shows "Current password is incorrect."
- RPC `{ ok:false, reason:'no_licensed_user_row' }` shows: "You are not in the licensed-tool roster. Contact your SPOC to be added before toggling GH access."

## 8. Out of Scope (v1)

- Email change.
- Avatar upload.
- Phone, manager, sub-practice, job title.
- Audit log of profile edits (can be added later via a `profile_changes` table).
- Admin editing other users' profiles via this page (already covered by `admin.html`).

## 9. Files Touched

**New**
- `src/pages/profile.html`
- `js/profile.js`
- `sql/057_profile_self_update.sql`

**Edit**
- Header avatar dropdown markup wherever it lives (likely `src/pages/index.html` and other authenticated pages) — add "Profile" link.
- `js/auth.js` only if the current-user resolution helper needs an export tweak.

**Docs (per CLAUDE.md §4)**
- `CHANGELOG.md` — `## [Unreleased]` entry.
- `docs/BRD.md` — note self-serve profile capability.
- `docs/HLD.md` — note `update_my_profile` RPC and `js/profile.js` module.
- `docs/CODE_ARCHITECTURE.md` — add `profile.html` and `js/profile.js`.
- `docs/IMPLEMENTATION_NOTES.md` — rationale: SECURITY DEFINER RPC instead of per-column RLS; B-mode sync to `copilot_users`.

## 10. Enterprise Portability (CLAUDE.md §8)

- Password change uses Supabase Auth (`auth.updateUser`). Migration difficulty to another IdP: **Medium** — single function call to swap.
- All other writes are standard SQL via an RPC. Fully portable.
- No new vendor lock-in introduced beyond the existing Supabase Auth dependency.

## 11. Acceptance Criteria

- [ ] Logged-in user can navigate to Profile via header avatar menu.
- [ ] Account section saves name + role to `users`.
- [ ] Organization section saves practice/department/sector and the practice change is reflected in `users`, `copilot_users`, and `org_hierarchy` rows for the caller's email.
- [ ] GH access toggle flips `copilot_users.status` between `active` and `pending`; surfaces a clear message if no `copilot_users` row exists.
- [ ] Password change requires correct current password and updates Supabase Auth.
- [ ] Each section reports success or failure inline.
- [ ] Page is theme-aware (light/dark) and matches signup visual language.
- [ ] No existing tests/views regress (leaderboard, ROI, admin).
