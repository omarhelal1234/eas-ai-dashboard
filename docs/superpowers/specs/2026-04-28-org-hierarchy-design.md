# Org-Wide Hierarchy Expansion — Design Spec

**Date:** 2026-04-28
**Author:** Claude (brainstorming) + Omar Helal
**Status:** Approved — pending implementation plan
**Source:** `Hierarchy.xlsx` (Ejada org chart, Sector → Unit → Practice)

---

## 1. Background

The current platform tracks AI adoption at a 2-level granularity (Department → Practice), focused on EAS practices. The Hierarchy sheet defines a 3-level org structure:

- **Sector** (13 sectors, each with a Sector SPOC) — HR, AI & Data, Sales, Strategy, Marketing, MSO, SSO, ITOP, Internal Audit, GRC, EPMO, Finance, **ECC**.
- **Unit/Department** (only ECC has units) — Cloud Engineering & Observability, Cybersecurity, DCX, GTM Solution Desk, Innovation Center, Mega Projects, PMO & Governance, SE, **EAS**, **ADI**.
- **Practice** (only EAS and ADI have practices) — EAS: CES, BFSI, ERP Solutions, EPS, GRC, EPCS. ADI: 8 industry verticals (no SPOC yet).

The sheet is a snapshot; counts and SPOCs may evolve. The model must support **variable-depth** trees (a sector may have no units; a unit may have no practices) and tracking AI adoption **org-wide**, not just for ECC/EAS.

## 2. Goals

1. Expand AI adoption tracking to all 13 sectors of Ejada.
2. Add a `Sector` layer above the existing `Department` (Unit) layer.
3. Recognize **Sector SPOCs** as first-class users with sector-scoped read access and fallback approval rights.
4. Onboard non-ECC contributors with no friction (cascading dropdowns with explicit N/A at empty levels).
5. Surface sector-level roll-ups in dashboards and leaderboards.
6. Provide a unified admin tree for managing the org hierarchy with scoped self-service editing.

## 3. Non-goals

- Replacing or renaming the `departments` table (we keep the name for migration parity; column comments document that it now means "Unit/Department").
- Drag-to-reparent UI in v1 (admin uses an edit-dialog parent dropdown instead — same effect, simpler).
- Auto-demoting users when an org-chart email is changed (always-on promote, never auto-demote — explicit admin demote only).
- Integrating with an external HR/identity system to pre-populate sector membership (vendor-lock concern per CLAUDE.md §8 portability rule).

## 4. Decisions Reference

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | Org-wide expansion across all 13 sectors |
| 2 | Variable depth | `unit_id` and `practice_id` nullable; reports group at deepest level present |
| 3 | Roles | Add `sector_spoc`; keep `dept_spoc` naming as-is (less churn) |
| 4 | Approval rights | Sector SPOC = fallback approver only (when no unit/practice SPOC exists) |
| 5 | Pending queue visibility | Sector SPOC sees full sector pipeline read-only |
| 6 | Schema | Keep `departments` table; add `sectors` above; add `sector_id` to relevant tables |
| 7 | ADI practices | Create with empty SPOC; fall back to Unit SPOC (Ahmed Fadl) |
| 8 | Flat sectors | Sector SPOC is de-facto practice SPOC (approver) |
| 9 | Signup | Cascading dropdowns with explicit "N/A" at each level |
| 10 | Existing user backfill | Hybrid — auto-backfill where unambiguous, prompt user otherwise |
| 11 | Reporting nav | Hierarchical drill-down (sector cards → unit cards → practice cards) |
| 12 | Leaderboards | Three tabs: Sector / Unit / Practice |
| 13 | Admin UI | Unified Org Hierarchy tree view |
| 14 | Edit permissions | Scoped self-service: Sector SPOC edits within sector, Unit SPOC within unit |
| 15 | SPOC account creation | Email-based auto-promotion via `*_spoc_email` columns |
| 16 | Promotion mechanic | Hybrid — always-on promote on login + email change; never auto-demote |

## 5. Data Model

### 5.1 New table: `sectors`

```sql
CREATE TABLE sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  sector_spoc_name TEXT NOT NULL DEFAULT '',
  sector_spoc_email TEXT,                    -- drives auto-promotion
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 5.2 Modified tables

- `departments` — add `sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL`, `unit_spoc_email TEXT`, `unit_spoc_name TEXT`. Table name retained; column comment clarifies "Unit/Department".
- `practices` — add `practice_spoc_email TEXT`. Existing `spoc` column holds the name.
- `users` — add `sector_id UUID REFERENCES sectors(id) ON DELETE SET NULL`. Existing `department_id`, `practice` columns become nullable for flat-sector contributors.
- Data tables (`tasks`, `accomplishments`, `use_cases`, `submission_approvals`, `copilot_users`, `projects`, `prompts`) — add `sector_id UUID` (nullable, denormalized for fast sector queries and RLS without 3-table joins).

### 5.3 Seed data (from Hierarchy.xlsx)

- 13 `sectors` rows with SPOC name + email.
- 10 ECC unit rows in `departments` with unit_spoc_email + unit_spoc_name + `sector_id = ECC`.
- 8 ADI practices in `practices` with `practice_spoc_email = NULL` (fallback to Unit SPOC Ahmed Fadl).
- Existing EAS practices get `practice_spoc_email` populated from the sheet (CES → Norah Alwabel, BFSI → Al-Moataz, ERP → Reham Ibrahim, EPS → Yousef Milhem, GRC → Mohamed Essam, EPCS → Ahmed Shaheen).
- Existing `EAS` department gets `sector_id = ECC`.
- Existing `Service Excellence` department merged into the new `SE` row under ECC; old row deactivated.

### 5.4 Cascading deactivation

A trigger on `sectors.is_active` and `departments.is_active` cascades `is_active = false` to descendants when set false. Reactivation is per-node (manual). Deletion is not used — we deactivate to preserve history.

## 6. Roles, RLS & Approval Cascade

### 6.1 Role inventory

| Role | Scope | Can approve? |
|---|---|---|
| `admin` | Everything | Yes — all |
| `sector_spoc` | Their sector (units + practices + direct contributors) | **Fallback only** — when no unit/practice SPOC exists for the path |
| `dept_spoc` | Their unit (practices + direct contributors) | Yes — within unit |
| `spoc` | Their practice | Yes — for their practice |
| `team_lead` | Subset of one practice (existing) | No |
| `executive` | Read-only summary across all sectors | No |
| `contributor` | Their own submissions | No |
| `viewer` | Read-only practice scope (existing) | No |

### 6.2 New RLS helper

```sql
CREATE FUNCTION get_user_sector_id() RETURNS UUID AS $$
  SELECT sector_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
```

### 6.3 New SELECT policies for `sector_spoc`

Applied to `tasks`, `accomplishments`, `submission_approvals`, `copilot_users`, `users`, `practice_spoc`, `projects`, `prompts`, `use_cases`:

```sql
CREATE POLICY "sector_spoc_<table>_select" ON <table>
  FOR SELECT USING (
    get_user_role() = 'sector_spoc'
    AND sector_id = get_user_sector_id()
  );
```

### 6.4 Approval cascade — `resolve_approver()`

All three SPOC lookups join through the `*_spoc_email` columns on the org tables (so the source of truth is the org chart, not stale `users.role` flags). A row only matches when the email holder is an active user — meaning auto-promotion has already linked them. Admin users matched by email (rare edge case) still resolve correctly because the join is purely by email, and RLS lets admins approve anyway.

```sql
CREATE FUNCTION resolve_approver(
  p_practice TEXT,
  p_department_id UUID,
  p_sector_id UUID
) RETURNS UUID
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- 1. Practice SPOC (email-based)
  IF p_practice IS NOT NULL THEN
    SELECT u.id INTO v_user_id
    FROM users u
    JOIN practices pr ON lower(pr.practice_spoc_email) = lower(u.email)
    WHERE pr.name = p_practice AND u.is_active
    LIMIT 1;
    IF v_user_id IS NOT NULL THEN RETURN v_user_id; END IF;
  END IF;

  -- 2. Unit (department) SPOC (email-based)
  IF p_department_id IS NOT NULL THEN
    SELECT u.id INTO v_user_id
    FROM users u
    JOIN departments d ON lower(d.unit_spoc_email) = lower(u.email)
    WHERE d.id = p_department_id AND u.is_active
    LIMIT 1;
    IF v_user_id IS NOT NULL THEN RETURN v_user_id; END IF;
  END IF;

  -- 3. Sector SPOC fallback (email-based)
  IF p_sector_id IS NOT NULL THEN
    SELECT u.id INTO v_user_id
    FROM users u
    JOIN sectors s ON lower(s.sector_spoc_email) = lower(u.email)
    WHERE s.id = p_sector_id AND u.is_active
    LIMIT 1;
    IF v_user_id IS NOT NULL THEN RETURN v_user_id; END IF;
  END IF;

  -- 4. Admin fallback
  SELECT id INTO v_user_id
  FROM users
  WHERE role = 'admin' AND is_active
  ORDER BY created_at LIMIT 1;
  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

The `escalation_level` field on `submission_approvals` is set once at creation time based on which step in `resolve_approver` matched (returned alongside the user_id via an OUT parameter or sibling helper). It's never recomputed.

`createSubmissionApproval` in `js/db.js` calls this function. The `submission_approvals` table gets an `escalation_level` column (`practice` | `unit` | `sector` | `admin`) for UI transparency ("Approving as Sector SPOC fallback").

## 7. Signup & Onboarding Flow

### 7.1 Cascade

```
Email + Password
   ├─→ Sector dropdown (required, all 13 active sectors)
   ├─→ Unit dropdown (filtered by sector; locked "N/A — sector has no units" if empty)
   └─→ Practice dropdown (filtered by unit; locked "N/A — unit has no practices" if empty)
```

Submit enabled when all three dropdowns have a value (real or N/A). Server validates parent-child consistency.

### 7.2 Server-side on submit

1. Create `auth.users` row via Supabase Auth.
2. Insert `users` row with `sector_id`, `department_id` (or NULL), `practice` (or NULL), `role = 'contributor'`.
3. Run `sync_user_role_from_org()` (Section 9) to auto-promote if email matches a `*_spoc_email` field.
4. Upsert `grafana_stats` row keyed on the new `sector_id`.

### 7.3 Validation

- Picked Unit MUST belong to picked Sector.
- Picked Practice MUST belong to picked Unit.
- Picking "N/A" for Unit forces Practice = N/A (no unit context).

## 8. Existing User & Data Backfill

### 8.1 One-shot SQL migration steps

1. **Backfill `departments.sector_id`:** map known department names to ECC; flag others to `migration_orphans`.
2. **Backfill `users.sector_id`:** if `department_id` exists → derive sector from it; else if `practice` exists → resolve `practice → department → sector`; else leave NULL (admins/viewers).
3. **Backfill data tables `sector_id`:** denormalize from `practice → department → sector` chain. Log breaks to `migration_orphans`.
4. **Flag ambiguous users:** set `users.profile_completed = false` (new column, default true) for users where Step 2 couldn't resolve.

### 8.2 Profile-completion modal

After login, if `profile_completed = false`, show a one-time modal with the same cascade as signup. Submission writes `sector_id`/`department_id` and flips `profile_completed = true`.

### 8.3 Audit & rollback

- `hierarchy_migration_log` table records every backfilled row, the chain used, and timestamp.
- `migration_orphans` table records rows that couldn't be resolved (admin reviews).
- Migration wrapped in transaction; new columns nullable; reversible by dropping new columns + `sectors` table.

## 9. Auto-Promotion Mechanics

### 9.1 Email columns drive promotion

- `sectors.sector_spoc_email`
- `departments.unit_spoc_email`
- `practices.practice_spoc_email`

### 9.2 `sync_user_role_from_org(p_user_id UUID)`

```
1. Lookup highest-scope email match for the user's email:
   - practice match → role = 'spoc',        scope_id = practice_id
   - unit match     → role = 'dept_spoc',   scope_id = department_id
   - sector match   → role = 'sector_spoc', scope_id = sector_id
2. If user.role NOT IN (spoc, dept_spoc, sector_spoc, admin, executive):
     promote and set sector_id/department_id/practice from the match.
3. Else if user.role IN (spoc, dept_spoc, sector_spoc)
     AND matched scope is broader than current role:
     promote upward.
4. Else: no-op (do not demote, do not narrow scope, do not touch admin/executive).
```

### 9.3 Trigger points

- Post-auth hook in `js/auth.js` — every login.
- Inline during signup.
- DB trigger on UPDATE of `sector_spoc_email` / `unit_spoc_email` / `practice_spoc_email` — runs for the new email holder (promotes); previous holder is **not** demoted.

### 9.4 Demotion = explicit admin action

`revoke_org_role(p_user_id)` admin-only RPC resets to `contributor`. Surfaced as "Demote to contributor" in admin user-edit modal.

### 9.5 `role_change_log`

Records `user_id, prev_role, new_role, source, org_path, timestamp` for every promotion/demotion. Source values: `auto_promote_login`, `auto_promote_email_change`, `admin_revoke`, `admin_assign`.

## 10. UI Design

### 10.1 Hierarchical drill-down (replaces current default landing on index.html)

- **Landing:** 13 sector tiles (name, Sector SPOC, contributors, tasks, hours saved, adoption %, trend).
- **Unit view:** breadcrumb `Sector >`, grid of unit tiles.
- **Practice view:** breadcrumb `Sector > Unit >`, grid of practice tiles.
- **Practice detail:** existing page, unchanged.
- **Filters:** Quarter selector, search, role-aware view toggle persist across levels.

### 10.2 Leaderboards

New `leaderboard.html` (or section) with three tabs: **Sector | Unit | Practice**. Same component, different aggregation key. Columns: rank, name, contributors, tasks, hours saved, efficiency %, quality avg. Tab persisted in URL (`?lb=sector|unit|practice`).

### 10.3 Admin tree view

Replaces Departments + Practices sections in admin.html. Tree with inline edit, role-scoped `+ Unit` / `+ Practice` buttons, edit dialog with parent dropdown for reparenting. Cascade-deactivation prompt on the destructive action.

### 10.4 Sector SPOC dashboard

Scoped landing = the unit view of their sector. Extra "Pending approvals across sector" widget showing items routed to unit/practice SPOCs (read-only, for nudging) + items currently routed to them (actionable, fallback case).

### 10.5 Header & breadcrumbs

Persistent breadcrumb across hierarchy pages. New `Sector SPOC` role badge.

## 11. Rollout Phases

### Phase 1 — Foundation (DB + auth)
- Migrations: `033_sectors`, `034_sector_spoc_role`, `035_seed_hierarchy`, `036_backfill_hierarchy`, `037_role_sync_function`.
- `js/auth.js`: post-login `sync_user_role_from_org()` call + profile-completion modal.
- `js/db.js`: `createSubmissionApproval` uses `resolve_approver`; new `getSectorSummary` RPC wrapper.
- **Exit:** Sector SPOCs sign up via existing flow and are auto-recognized; approvals route correctly; existing pages unchanged.

### Phase 2 — Signup cascade + Admin tree
- `signup.html` cascading dropdowns.
- New `js/hierarchy.js` module (reused by signup, profile modal, admin tree).
- `admin.html` Org Hierarchy tree with scoped self-service.
- **Exit:** Admin manages tree from UI; sector_spoc / dept_spoc edit within scope.

### Phase 3 — Drill-down navigation + leaderboards
- `index.html` redesigned to drill-down landing (sector → unit → practice cards).
- Sector SPOC dashboard variant.
- Leaderboard tabs with persistent URL state.
- Cache busters bumped.
- **Exit:** End-to-end: HR contributor signs up, logs a task, HR Sector SPOC approves; ECC Sector SPOC sees EAS+ADI+SE roll-ups.

### Phase 4 — Polish
- Tree drag-to-reparent.
- Per-sector branded color/icon.
- Migration-orphans review.
- Documentation sweep per CLAUDE.md §4 (BRD, HLD, CODE_ARCHITECTURE, IMPLEMENTATION_NOTES, CHANGELOG) — performed at end of every phase, finalized in Phase 4.

## 12. Cross-Phase Requirements

- **Portability (CLAUDE.md §8):** All ops via Supabase MCP. RLS for auth. No new external SaaS. Migration to other Postgres + auth stack remains Low difficulty.
- **Cache busters bumped** on every UI change per CLAUDE.md workflow defaults.
- **Skills required:** Supabase + supabase-postgres-best-practices (every phase), UI/UX Pro (Phases 2 + 3), Superpowers (planning).
- **Documentation sweep** performed at the end of every phase per CLAUDE.md §4.

## 13. Open Items (deferred, not blocking)

- Branded sector icons/colors (Phase 4).
- Drag-to-reparent (Phase 4).
- Whether `executive` role should be sector-scopable (currently org-wide read-only — revisit if needed).
- Whether to expose `migration_orphans` as an admin UI surface or just a SQL audit table.
