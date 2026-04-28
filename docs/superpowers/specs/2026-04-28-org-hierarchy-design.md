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

- `departments` — add `sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT`, `unit_spoc_email TEXT`, `unit_spoc_name TEXT`. Table name retained; column comment clarifies "Unit/Department". `RESTRICT` is deliberate: §5.4 mandates deactivation over deletion, and `SET NULL` would leave child rows stranded with no sector and (for flat-sector contributors) violate the §5.2 hierarchy-anchor CHECK.
- `practices` — add `practice_spoc_email TEXT`. **This column is org-chart metadata only — used by the auto-promotion machinery to seed `practice_spoc` rows.** It is NOT consulted by `resolve_approver` and does NOT replace the multi-SPOC `practice_spoc` table. Multi-SPOC behavior (multiple active SPOCs per practice, any can approve) is preserved (`sql/021_multi_spoc_approval.sql`).
- `users` — add `sector_id UUID REFERENCES sectors(id) ON DELETE RESTRICT`. Existing `department_id`, `practice` columns become nullable for flat-sector contributors. `RESTRICT` for the same reason as `departments.sector_id`: a flat-sector contributor with sector_id nulled out would simultaneously have NULL `sector_id` and NULL `practice`, violating the hierarchy-anchor CHECK.
- `practice_spoc` — add `sector_id UUID` (denormalized for sector-scoped reads). The multi-SPOC table itself is unchanged in shape — it remains authoritative.
- Data tables (`tasks`, `accomplishments`, `use_cases`, `submission_approvals`, `copilot_users`, `projects`, `prompt_library`) — add `sector_id UUID` (nullable, denormalized for fast sector queries and RLS without 3-table joins).
- Flat-sector support requires relaxing existing practice constraints on tables that represent contributor activity or roster data:
  - `tasks.practice`, `accomplishments.practice`, `copilot_users.practice`, and `projects.practice` become nullable.
  - `practice_spoc.practice` remains `NOT NULL` because a practice SPOC is, by definition, practice-scoped.
  - `team_lead_assignments.practice`, `executive_practices.practice`, and `reported_issues.practice` stay practice-scoped in v1 unless a later phase explicitly adds sector/unit variants.
  - New CHECK constraints enforce a valid hierarchy anchor: activity/roster rows must have either `sector_id` or `practice` populated, and if both are present the trigger validates they belong to the same chain. **The CHECKs are added with `NOT VALID` in migration 033 so they apply to new writes only; migration 036 runs `VALIDATE CONSTRAINT` after backfill completes.** Rows that fail to resolve during backfill are logged to `migration_orphans` and resolved manually before validation.
- Existing `users_role_check` and `role_view_permissions_role_check` constraints (`sql/025_dept_spoc_role.sql` lines 9 and 149) are extended to include `sector_spoc`. Migration `034_sector_spoc_role.sql` drops and re-adds both constraints.

### 5.2a Denormalized `sector_id` is auto-maintained by triggers

The denormalized `sector_id` columns on data tables MUST be kept populated regardless of whether the calling code passes it. Frontend writes today only send `practice` (e.g., `js/db.js` line 550 `tasks.insert`, line 672 `accomplishments.insert`). Two enforcement mechanisms:

1. **`BEFORE INSERT/UPDATE` triggers** on every data table that has a `sector_id` column. The trigger function `populate_sector_id()` **canonicalizes** the sector via the chain: if `NEW.practice IS NOT NULL` look up `practices.department_id` then `departments.sector_id`; else if `NEW.department_id IS NOT NULL` use `departments.sector_id`. **When either `practice` or `department_id` is non-null, the trigger always overrides any client-supplied `sector_id`** — this prevents a contributor from writing `practice = X` with `sector_id = Y` (cross-sector tagging that would route to the wrong sector_spoc). Client-supplied `sector_id` is honored only when both `practice` and `department_id` are NULL (a true sector-direct write from a flat-sector contributor); in that case the value must equal `get_user_sector_id()` per the contributor INSERT policies in §6.3a.

2. **`resolve_approver()` and `createSubmissionApproval` set `sector_id` and `escalation_level` on the new `submission_approvals` row at creation time** — same trigger fires, but `js/db.js` also passes the resolved value explicitly for transparency.

The trigger ensures sector RLS policies see every row even when frontend code paths aren't updated (defensive defaulting per CLAUDE.md scoping rule — we don't refactor every insert site, we make the schema correct by construction).

### 5.2b Practice-null write model

Flat sectors like HR or Finance have no unit or practice. Their contributors can still log tasks/accomplishments and appear in roster/adoption dashboards:

- `users`: `sector_id` required for contributors; `department_id` and `practice` nullable.
- `copilot_users`: `sector_id` required; `practice` nullable.
- `tasks` / `accomplishments`: `sector_id` required; `practice` nullable. Existing practice-centric fields stay available when a practice exists.
- `projects`: `sector_id` required; `practice` nullable for sector-level projects.
- `submission_approvals`: `sector_id` required; `practice` nullable; `escalation_level` determines whether the approval is practice, unit, sector, or admin routed.

Client form validation must shift from "practice required" to "deepest available org node required." For sector-only contributors, the sector dropdown is the selected node and practice fields render as locked N/A.

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

Applied to all tables that have a `sector_id` column per Section 5.2: `tasks`, `accomplishments`, `submission_approvals`, `copilot_users`, `practice_spoc`, `projects`, `use_cases`, `prompt_library` (the actual table name in this repo per `sql/005_prompt_library.sql`).

**Pre-requisite: tighten the existing open `submission_approvals` SELECT policy.** `sql/002_approval_workflow.sql:120` currently grants SELECT on `submission_approvals` to **every** authenticated user (`submission_approvals_read_all_authenticated`). That makes any sector-scoped SELECT policy added on top meaningless. Migration 034 **drops** that open policy and replaces it with role-scoped SELECT policies:

- `admin` — all rows (existing).
- `sector_spoc` — `sector_id = get_user_sector_id()` (new, this section).
- `dept_spoc` — `department_id = get_user_department_id()` (existing scope, re-expressed as a SELECT policy).
- `spoc` — `practice = get_user_practice()` (existing scope).
- `team_lead` — existing assignment-based scope (preserved).
- `executive` — read across all practices (existing).
- `contributor` — `submitted_by = get_current_user_id()` (existing scope).

**Audit before merge:** any dashboard, admin page, or RPC that today silently relies on the universal SELECT must be re-checked. Known callers to verify: `pending_approvals` view (`sql/002:226`), `js/db.js` `fetchPendingApprovals` and `fetchSubmissionApproval` (multi-row queries), and any executive/leaderboard surface that aggregates `submission_approvals`.

The `users` table does not have a `sector_id` column itself — its sector membership is the column already added in Section 5.2. The `users` SELECT policy for sector_spoc uses `users.sector_id = get_user_sector_id()` directly:

```sql
-- Standard pattern for tables with sector_id
CREATE POLICY "sector_spoc_<table>_select" ON <table>
  FOR SELECT USING (
    get_user_role() = 'sector_spoc'
    AND sector_id = get_user_sector_id()
  );

-- users table (sector_id is on users itself)
CREATE POLICY "sector_spoc_users_select" ON users
  FOR SELECT USING (
    get_user_role() = 'sector_spoc'
    AND (sector_id = get_user_sector_id() OR id = get_current_user_id())
  );
```

### 6.3a Write policies for sector-only and fallback approval flows

`sector_spoc` has two distinct access modes:

1. **Pipeline visibility:** read-only access to every pending item in their sector, including items currently routed to practice/unit SPOCs. This is implemented by the SELECT policies above.
2. **Fallback approval:** UPDATE access only when the item is actually assigned to sector fallback (`escalation_level = 'sector'`, `approval_status = 'spoc_review'`, and `sector_id = get_user_sector_id()`).

Add these policies:

```sql
-- Contributors in flat sectors can insert sector-only rows.
CREATE POLICY "tasks_contributor_sector_insert" ON tasks
  FOR INSERT WITH CHECK (
    get_user_role() = 'contributor'
    AND practice IS NULL
    AND sector_id = get_user_sector_id()
  );

CREATE POLICY "accomplishments_contributor_sector_insert" ON accomplishments
  FOR INSERT WITH CHECK (
    get_user_role() = 'contributor'
    AND practice IS NULL
    AND sector_id = get_user_sector_id()
  );

CREATE POLICY "submission_approvals_contributor_sector_insert" ON submission_approvals
  FOR INSERT WITH CHECK (
    get_user_role() = 'contributor'
    AND practice IS NULL
    AND sector_id = get_user_sector_id()
  );

-- Sector SPOC may approve only fallback items routed to the sector level.
CREATE POLICY "sector_spoc_approvals_update" ON submission_approvals
  FOR UPDATE USING (
    get_user_role() = 'sector_spoc'
    AND sector_id = get_user_sector_id()
    AND escalation_level = 'sector'
    AND approval_status = 'spoc_review'
  )
  WITH CHECK (
    get_user_role() = 'sector_spoc'
    AND sector_id = get_user_sector_id()
  );
```

Equivalent INSERT policies are needed for `copilot_users` sector-only signup/upsert paths if the client writes directly; the preferred path is the extended `signup_contributor` RPC.

### 6.4 Approval cascade — `resolve_approver()`

The function answers two questions: **(a) what escalation level is this submission at?** and **(b) which user_id (if any) is the singular owner of this approval?** For practices with multiple active SPOCs (the existing multi-SPOC model from `sql/021_multi_spoc_approval.sql`), we deliberately return NULL for `assigned_user_id` at the practice level — the existing pattern of "any active SPOC can approve" is preserved by the `practice_spoc` table + RLS, and the existing `pending_approvals` view already aggregates SPOC names. Only at the unit/sector/admin fallback levels do we route to a single named user.

```sql
CREATE TYPE approver_resolution AS (
  assigned_user_id UUID,    -- NULL means "any active SPOC in practice_spoc for this practice"
  escalation_level TEXT     -- 'practice' | 'unit' | 'sector' | 'admin'
);

CREATE FUNCTION resolve_approver(
  p_practice TEXT,
  p_department_id UUID,
  p_sector_id UUID
) RETURNS approver_resolution
AS $$
DECLARE
  v_count INT;
  v_user_id UUID;
BEGIN
  -- 1. Practice level (multi-SPOC preserved): only linked active user rows count.
  --    Legacy name-only practice_spoc seed rows must not block fallback.
  IF p_practice IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM practice_spoc ps
    JOIN users u ON u.id = ps.spoc_id
    WHERE ps.practice = p_practice
      AND ps.is_active = true
      AND u.is_active = true;
    IF v_count > 0 THEN
      RETURN ROW(NULL::UUID, 'practice')::approver_resolution;
    END IF;
  END IF;

  -- 2. Unit (department) SPOC fallback (email-based, single owner)
  IF p_department_id IS NOT NULL THEN
    SELECT u.id INTO v_user_id
    FROM users u
    JOIN departments d ON lower(d.unit_spoc_email) = lower(u.email)
    WHERE d.id = p_department_id AND u.is_active
    LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      RETURN ROW(v_user_id, 'unit')::approver_resolution;
    END IF;
  END IF;

  -- 3. Sector SPOC fallback (email-based, single owner)
  IF p_sector_id IS NOT NULL THEN
    SELECT u.id INTO v_user_id
    FROM users u
    JOIN sectors s ON lower(s.sector_spoc_email) = lower(u.email)
    WHERE s.id = p_sector_id AND u.is_active
    LIMIT 1;
    IF v_user_id IS NOT NULL THEN
      RETURN ROW(v_user_id, 'sector')::approver_resolution;
    END IF;
  END IF;

  -- 4. Admin fallback
  SELECT id INTO v_user_id
  FROM users WHERE role = 'admin' AND is_active
  ORDER BY created_at LIMIT 1;
  RETURN ROW(v_user_id, 'admin')::approver_resolution;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

**Auto-promotion + practice_spoc sync (Section 9 cross-link):** when `sync_user_role_from_org()` matches a user against a `practice.practice_spoc_email`, it not only sets `users.role = 'spoc'` but also upserts a row in `practice_spoc` (`practice`, `spoc_id`, `spoc_name`, `spoc_email`, `is_active = true`) using the same pattern as `js/db.js` `syncPracticeSpoc()` (line 1379). This preserves the multi-SPOC model: the org-chart email is *one* of potentially many SPOCs on a practice; admins can still add additional SPOCs through the existing UI without changing the email column.

Migration `037_role_sync_function.sql` also cleans legacy `practice_spoc` rows that have no `spoc_id` and no `spoc_email` match. These rows were useful as display metadata in the early approval workflow, but they cannot be treated as approvers in the fallback cascade.

**`escalation_level` and column mapping on `submission_approvals`:** the table gets a new `escalation_level TEXT` column (`practice` | `unit` | `sector` | `admin`), set once at creation time by `createSubmissionApproval`. The `assigned_user_id` returned by `resolve_approver()` is written to existing columns according to this rule:

| `escalation_level` | Target column | Notes |
|---|---|---|
| `practice` | `spoc_id = NULL` | Multi-SPOC routing — RLS + `practice_spoc` table determine who can approve. |
| `unit` | `spoc_id = <unit SPOC user_id>` | Single-owner fallback. |
| `sector` | `spoc_id = <sector SPOC user_id>` | Single-owner fallback. |
| `admin` | `admin_id = <admin user_id>` | Existing convention. |

This keeps the existing `pending_approvals` view (`sql/002:226`, joins on `spoc_id`) working unchanged for unit and sector fallback rows — they surface with the unit/sector SPOC named, no view edit required. UI surfaces "Approving as Sector SPOC fallback" / "Unit SPOC fallback" by reading `escalation_level`.

**Caller wiring — `createSubmissionApproval`.** The function in `js/db.js` (line 1479) is rewritten to:

1. Look up the submitter's `department_id` and `sector_id` from `EAS_Auth.getUserProfile()` (today only `practice` is read). For admin/dept_spoc submitting on behalf of someone else, the form passes the target's `practice` and the caller resolves `department_id`/`sector_id` from `practices` join.
2. Call `resolve_approver(p_practice, p_department_id, p_sector_id)`. The 3-arg signature is **required** so unit-only submissions (no practice) and flat-sector submissions (no practice, no department) can route — a 1-arg `resolve_approver(p_practice TEXT)` cannot handle either case.
3. Write `escalation_level` and the resolved `spoc_id`/`admin_id` onto the new `submission_approvals` row per the table above.

**Removal of `determineApprovalRouting`.** The existing JS function `determineApprovalRouting(practice, savedHours, submissionType)` in `js/db.js` is **removed**; `resolve_approver()` is the single source of truth for routing. The `<5h` task auto-approval bypass (currently `js/db.js:1486` `routing.autoApproved`) **stays in JS** — it is a business rule, not a routing decision, and keeping it client-side avoids an extra DB round-trip for the common short-task case. `createSubmissionApproval` short-circuits on auto-approval before calling `resolve_approver()`, preserving today's behavior.

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
3. Run `sync_user_role_from_org()` (Section 9) to auto-promote if email matches a `*_spoc_email` field. When practice match auto-promotes to `spoc`, also upsert `practice_spoc` (preserves multi-SPOC).
4. Call existing `signup_contributor_upsert_grafana_stats(...)` RPC (`sql/024_signup_contributor_upsert_grafana_stats.sql`) — this is the existing function whose body upserts a `copilot_users` row, not a `grafana_stats` table (table doesn't exist; the function name is historical). This phase extends that RPC to accept `p_sector_id` and `p_department_id` and write them onto the inserted `copilot_users` row so the new sector_id denormalization is populated from signup forward. The `BEFORE INSERT` trigger on `copilot_users` from Section 5.2a is the safety net if any caller forgets.

### 7.3 Validation

- Picked Unit MUST belong to picked Sector.
- Picked Practice MUST belong to picked Unit.
- Picking "N/A" for Unit forces Practice = N/A (no unit context).
- For flat-sector signups, server accepts `sector_id != NULL`, `department_id = NULL`, `practice = NULL`; the extended signup RPC must not insert NULL into any still-`NOT NULL` practice column.
- For unit-without-practice signups, server accepts `sector_id != NULL`, `department_id != NULL`, `practice = NULL`; approval fallback starts at Unit SPOC.
- For practice signups, server validates all three levels and preserves the existing practice-scoped behavior.

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
5. If the match was at the practice level (role = spoc), also UPSERT
   into practice_spoc (practice, spoc_id, spoc_name, spoc_email, is_active=true)
   to preserve multi-SPOC routing. Mirror of js/db.js syncPracticeSpoc().
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

Backend contract:

| RPC | Grain | Parameters | Notes |
|---|---|---|---|
| `get_sector_summary(p_quarter_id TEXT)` | one row per sector | quarter optional | Includes flat-sector rows where `practice IS NULL`. |
| `get_unit_summary(p_sector_id UUID, p_quarter_id TEXT)` | one row per department/unit | sector required for drill-down | Includes unit-direct rows where `practice IS NULL`. |
| `get_practice_summary(p_quarter_id TEXT)` | existing practice rows | quarter optional | Existing contract preserved; add `sector_id`/`department_id` only if consumers need it. |
| `get_org_leaderboard(p_level TEXT, p_quarter_id TEXT)` | sector/unit/practice | `p_level IN ('sector','unit','practice')` | Replaces client-side tab aggregation. |
| `get_employee_leaderboard(...)` | employee | add `p_sector_id`, `p_department_id`, `p_practice` | Practice-only filter remains backward compatible. |

These RPCs must aggregate from denormalized `sector_id` and nullable `practice`, not only from joins through `practices`, so flat sectors appear in counts and leaderboards.

### 10.3 Admin tree view

Replaces Departments + Practices sections in admin.html. Tree with inline edit, role-scoped `+ Unit` / `+ Practice` buttons, edit dialog with parent dropdown for reparenting. Cascade-deactivation prompt on the destructive action.

Access model:

- `admin.html` currently signs out non-admin users. Phase 2 either relaxes that guard for `sector_spoc` / `dept_spoc` and hides unrelated admin sections, or creates a separate `hierarchy-admin.html` surface for scoped editing.
- `admin` can edit any sector/unit/practice and manage users/roles.
- `sector_spoc` can edit metadata under their sector only: units, practices, SPOC emails, active flags. They cannot change sector parentage, assign admins, or edit rows outside their sector.
- `dept_spoc` can edit metadata under their unit only: child practices and practice SPOC emails. They cannot reparent the unit or edit sibling units.
- RLS/SECURITY DEFINER RPCs enforce this; UI hiding is convenience only.

### 10.4 Sector SPOC dashboard

Scoped landing = the unit view of their sector. Extra "Pending approvals across sector" widget showing items routed to unit/practice SPOCs (read-only, for nudging) + items currently routed to them (actionable, fallback case).

Approval UI changes:

- Add `sector_spoc` to approver role constants (`js/approvals-modal.js` and any page-level approval guards).
- `fetchPendingApprovals()` gets a `sector_spoc` branch:
  - pipeline tab: `sector_id = profile.sector_id`, pending statuses, read-only;
  - my fallback queue: `sector_id = profile.sector_id`, `escalation_level = 'sector'`, `approval_status = 'spoc_review'`, actionable.
- Row labels show `Sector fallback`, `Unit fallback`, or `Practice SPOC` from `escalation_level`, not only `approval_status`.

### 10.5 Header & breadcrumbs

Persistent breadcrumb across hierarchy pages. New `Sector SPOC` role badge.

## 11. Rollout Phases

### Phase 1 — Foundation (DB + auth)

Migrations (numbered 033+ to follow existing sequence):

- **`033_sectors.sql`** — create `sectors` table; add `sector_id`, `unit_spoc_email`, `unit_spoc_name` to `departments` (FK `ON DELETE RESTRICT`); add `practice_spoc_email` to `practices`; add `sector_id` to `users` (FK `ON DELETE RESTRICT`), `practice_spoc`, and all data tables (`tasks`, `accomplishments`, `use_cases`, `submission_approvals`, `copilot_users`, `projects`, `prompt_library`); add `escalation_level TEXT` to `submission_approvals`; make `users.department_id`, `users.practice`, `tasks.practice`, `accomplishments.practice`, `copilot_users.practice`, and `projects.practice` nullable where required for flat-sector writes; add hierarchy-anchor CHECK constraints **with `NOT VALID`** (validated in 036 after backfill); add `users.profile_completed BOOLEAN DEFAULT true`; create the `populate_sector_id()` trigger function (canonicalizes from chain, only honors client `sector_id` when both `practice` and `department_id` are NULL — see §5.2a) and BEFORE INSERT/UPDATE triggers on every data table that has the new column.
- **`034_sector_spoc_role.sql`** — DROP and re-add `users_role_check` to allow `sector_spoc`. DROP and re-add `role_view_permissions_role_check` likewise (per `sql/025_dept_spoc_role.sql` lines 9 and 149). Create `get_user_sector_id()` helper. **DROP the existing `submission_approvals_read_all_authenticated` policy (`sql/002:120`)** and replace with role-scoped SELECT policies per §6.3 (admin / sector_spoc / dept_spoc / spoc / team_lead / executive / contributor). Add `sector_spoc_*` SELECT policies on every other sector_id-bearing table per §6.3 plus fallback UPDATE policies per §6.3a. Add sector-only contributor INSERT policies for `tasks`, `accomplishments`, and `submission_approvals`. Seed `role_view_permissions` rows for the `sector_spoc` role (mirror of the `dept_spoc` seeding pattern in migration 025).
- **`035_seed_hierarchy.sql`** — insert 13 sectors with SPOC name + email; insert 10 ECC unit rows in `departments` with unit_spoc_email + unit_spoc_name + `sector_id = ECC`; create 8 ADI practices in `practices` (no SPOC email); populate `practice_spoc_email` on existing EAS practices from the sheet. Wire `EAS` department → ECC sector. Merge `Service Excellence` into the new `SE` row under ECC; deactivate the old row.
- **`036_backfill_hierarchy.sql`** — populate `sector_id` on existing rows of `users`, `practice_spoc`, and all data tables via the practice→department→sector chain. Create `migration_orphans` and `hierarchy_migration_log`. Set `profile_completed = false` on users where the chain didn't resolve. **After backfill (and after manual orphan resolution), run `ALTER TABLE … VALIDATE CONSTRAINT` on every hierarchy-anchor CHECK added `NOT VALID` in 033.** If any orphan remains unresolved, validation fails loudly — that's the intended behavior; do not skip.
- **`037_role_sync_function.sql`** — create `approver_resolution` composite type; clean or backfill legacy name-only `practice_spoc` rows; create `resolve_approver(p_practice TEXT, p_department_id UUID, p_sector_id UUID)` (3-arg signature is required to route unit-only and flat-sector submissions that have no practice — see §6.4); create `sync_user_role_from_org(p_user_id UUID)` that also upserts into `practice_spoc` on practice match (mirroring `syncPracticeSpoc()` in `js/db.js` line 1379); install UPDATE triggers on the three `*_spoc_email` columns; create `revoke_org_role(p_user_id UUID)` admin RPC; create `role_change_log` table.
- **`038_extend_signup_rpc.sql`** — extend `signup_contributor_upsert_grafana_stats` (existing function from `sql/024_*`) to accept `p_sector_id` and `p_department_id` and write them onto the upserted `copilot_users` row. Backwards-compatible default for older callers.
- **`039_org_rollups.sql`** — add `get_sector_summary`, `get_unit_summary`, `get_org_leaderboard`, and extended employee leaderboard filters. Existing `get_practice_summary` remains backward compatible.

Code:

- `js/auth.js` — call `sync_user_role_from_org(<my user_id>)` post-login; render profile-completion modal when `profile_completed = false`.
- `js/db.js` — **delete** `determineApprovalRouting()` (subsumed by `resolve_approver`). Rewrite `createSubmissionApproval()` to: (a) keep the `<5h` task auto-approval short-circuit in JS (business rule, not routing), (b) read `department_id` and `sector_id` from `EAS_Auth.getUserProfile()`, (c) call `resolve_approver(p_practice, p_department_id, p_sector_id)`, (d) write `escalation_level` plus `spoc_id` (for practice/unit/sector) or `admin_id` (for admin) per the §6.4 mapping table. Add sector/unit summary and leaderboard RPC wrappers. Add `sector_spoc` branch to `fetchPendingApprovals()`. New signup path passes `sector_id` and `department_id` to the extended signup RPC.
- `js/approvals-modal.js` and approvals page code — include `sector_spoc`, split read-only sector pipeline from actionable fallback approvals, and display `escalation_level`.

**Exit:** Sector SPOCs in the sheet sign up via existing flow and are auto-recognized; flat-sector contributors can sign up and submit tasks without a practice; approvals route correctly through the new cascade with multi-SPOC preserved; sector_spoc role is valid against all CHECK constraints; existing pages unchanged.

### Phase 2 — Signup cascade + Admin tree
- `signup.html` cascading dropdowns.
- New `js/hierarchy.js` module (reused by signup, profile modal, admin tree).
- Org Hierarchy tree with scoped self-service. Either adapt `admin.html` guard/sections for scoped non-admin access or create a focused `hierarchy-admin.html` page.
- **Exit:** Admin manages tree from UI; sector_spoc / dept_spoc edit within scope.

### Phase 3 — Drill-down navigation + leaderboards
- `index.html` redesigned to drill-down landing (sector → unit → practice cards).
- Sector SPOC dashboard variant.
- Leaderboard tabs with persistent URL state backed by `get_org_leaderboard`, not client-only aggregation.
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
