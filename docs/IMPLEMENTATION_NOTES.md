# Phase 8 Approval Workflow Implementation - Complete Summary

**Date:** April 11, 2026  
**Status:** ✅ Production Deployed  
**Version:** Phase 8 Complete

## Changes Made

### 0q. April 14, 2026 — Database Backup & Cross-Table Data Cleanup

**Backup:** Created schema `backup_20260414` with full copies of all 18 public tables (618 total rows). Row counts verified to match live tables exactly.

**Integrity Audit:** Ran 26 FK integrity checks and 18 cross-table consistency checks covering every foreign key relationship and denormalized field.

**Issues Found & Fixed:**

| # | Issue | Severity | Fix Applied |
|---|-------|----------|-------------|
| 1 | Orphan `submission_approvals` record (`6646e835...`) references deleted task `a8936902...` | Medium | Deleted the orphan record |
| 2 | `practices.spoc` on SE = "Neeraj Goel" (user is `contributor`, not `spoc`); ADI = "Ahmed Fadl" (user doesn't exist) | Medium | Cleared stale `spoc` text fields |
| 3 | 2 tasks had `approval_status = 'pending'` while their `submission_approvals` showed `ai_review` / `spoc_review` | Low | Expanded CHECK constraints on `tasks` and `accomplishments` to include `ai_review`, `spoc_review`, `admin_review`. Synced task statuses. |

**Not fixed (by design):** 5 tasks have `employee_email` not in `copilot_users` — includes test data and SPOC-submitted tasks for non-licensed employees. Not a FK violation.

**Post-fix verification:** All 23 checks pass with 0 remaining issues.

### 0p. April 14, 2026 — SPOC Mandatory Approval + Employee Dropdown + Duplicate Fix + Column Name Fix

**Four critical fixes implemented across two iterations:**

#### Fix 0: Column Name Mismatch — `submitted_for_approval` vs `submission_approved` (Critical)
**Problem:** ALL non-admin task and accomplishment updates were silently failing. The code referenced `submitted_for_approval` in 8 places across `db.js` and 1 in `ide-task-log/index.ts`, but the actual database column is `submission_approved`. This caused:
1. Every `updateTask()` and `updateAccomplishment()` call for non-admin users to fail (PostgreSQL rejects unknown columns)
2. Approval linkage after new task/accomplishment inserts to fail — `approval_id` was never set on the parent record
3. The user perceived "updated task gets deleted, old version stays" because the update silently failed

**Additional problem:** Code was writing workflow states (`spoc_review`, `admin_review`) into `tasks.approval_status` and `accomplishments.approval_status`, but those columns have a CHECK constraint allowing only `pending`/`approved`/`rejected`. The fine-grained workflow states belong only in `submission_approvals`.

**Fix:**
- Replaced all 8 `submitted_for_approval` → `submission_approved` in `db.js`
- Replaced 1 occurrence in `supabase/functions/ide-task-log/index.ts`
- Changed `submitTaskWithApproval()` and `submitAccomplishmentWithApproval()` to only set `approval_id` on the parent record (not copy the workflow approval_status)
- Changed `approveSubmission()` to map intermediate states to `pending` on the parent table (`const mappedStatus = (nextStatus === 'approved' || nextStatus === 'rejected') ? nextStatus : 'pending'`)
- Added migration `sql/013_fix_column_name_and_linkage.sql` to fix existing broken linkage and migrate legacy `ai_review` records to `spoc_review`

**Files:** `js/db.js`, `supabase/functions/ide-task-log/index.ts`, `sql/013_fix_column_name_and_linkage.sql`

#### Fix 1: Duplicate-on-Edit Bug (Critical)
**Problem:** Editing any task, accomplishment, copilot user, or issue created a duplicate instead of updating. Root cause: `closeModal(type)` clears `_editingId`/`_editingType` in all save functions, but it was called BEFORE the `if (_editingId && _editingType === 'task')` check — so the check was always false, always inserting.

**Fix:** Capture `_editingId` and `_editingType` into local `const editId`/`const editType` before `closeModal()`. Use local vars for the edit-vs-insert branch. Applied to `saveTask()`, `saveAccomplishment()`, `saveCopilotUser()`, `saveIssue()`.

**Orphan fix:** `updateTask()` and `updateAccomplishment()` now delete the old `submission_approvals` record (by `data.approval_id`) before creating a new approval workflow entry, preventing orphaned approval rows.

**Cleanup:** New `sql/012_cleanup_duplicates.sql` removes existing duplicates (same employee+description within 1 minute) and orphaned approval records.

**Files:** `src/pages/index.html`, `js/db.js`, `sql/012_cleanup_duplicates.sql`

#### Fix 2: SPOC Mandatory Approval (AI → SPOC → Admin)
**Problem:** SPOCs only saw tasks when AI validation failed. The routing sent most tasks directly through AI review, bypassing SPOCs entirely.

**Fix:** Rewrote `determineApprovalRouting()` to always start at `ai_review`, then mandatory `spoc_review`, then `admin_review` only if hours ≥ 15. Rewrote `approveSubmission()` as a state machine — each approval advances to the next layer instead of jumping to `approved`. SPOC self-approval is allowed per requirement.

**State machine:**
```
ai_review → spoc_review → (admin_review if ≥15h) → approved
                        → approved (if <15h)
Any layer reject → rejected
```

**Files:** `js/db.js` (determineApprovalRouting, approveSubmission), `js/phase8-submission.js` (tier display, badge), `src/pages/index.html` (handleApprovalAction, updateApprovalTierDisplay)

#### Fix 3: Mandatory Employee Dropdown
**Problem:** Employee name was a free-text input. Users could type any name, and `employee_email` was never stored from the autocomplete selection (a data gap).

**Fix:** Replaced `<input type="text" id="f-employee">` with a searchable dropdown (text input + floating list) populated from `copilot_users`. Mandatory: validation blocks submission unless an employee is selected from the list (checks `data-selectedUserId`). Admin sees all practices, SPOC sees own practice only. Selected employee's ID, email, and name are stored with the task via hidden fields.

**Fix 3b (April 14):** Removed the `status = 'access granted'` filter that excluded 21 users (7 `Active` + 14 `pending`). Two practices (EPCS, EPS) had zero `access granted` users, so the dropdown was completely empty for them. Now all `copilot_users` appear regardless of status.

**Files:** `src/pages/index.html` (HTML + saveTask + editTask + form reset), `js/phase8-submission.js` (initEmployeeDropdown replacing initEmployeeAutocomplete)

**Docs impact:** HLD updated (approval pipeline section), CODE_ARCHITECTURE unchanged (same public interfaces, just new behavior).

### 0m. April 13, 2026 — Inactive Members: practice list reflects task activity

**Problem:** The My Practice "Inactive Members" list showed many users as "Never logged" even after tasks were submitted. The list relied on `copilot_users.has_logged_task` and `copilot_users.last_task_date`, which are not consistently updated for contributor-submitted tasks due to RLS.

**Fix (js/db.js):** Reworked `fetchInactiveMembers()` to derive activity directly from the `tasks` table by matching `employee_email` + `practice`, then computing the latest `created_at` per user. The list now filters to `copilot_users.status = 'access granted'` and marks inactive when the latest task is older than the inactivity threshold.

**Files changed:** `js/db.js`
**Docs impact:** BRD/HLD/CODE_ARCHITECTURE/IMPLEMENTATION_PLAN unchanged — data derivation only.

### 0l. April 13, 2026 — Executive Dashboard: Graphs crash + All Time calculation fix

**Problems:**
1. Executive Summary charts appeared blank/"crashed" — no visual feedback when chart data is empty
2. "All Time" quarter selection returned zero data because `'all'` was passed as-is to the `get_executive_summary` RPC, which treats `p_quarter_id = 'all'` as a literal quarter_id filter (matching nothing) instead of the intended all-time aggregation (requires `NULL`)
3. Global quarter-changed event handler did not re-render the exec-summary page

**Root Cause:** The exec-specific quarter selector value was passed directly without converting `'all'` → `null`. The SQL RPC `get_executive_summary` uses `(p_quarter_id IS NULL OR quarter_id = p_quarter_id)` — so `NULL` means "all quarters" but `'all'` matches no real quarter_id.

**Fix (src/pages/index.html):**
- `renderExecSummary()`: Convert `rawQuarter === 'all'` to `null` before calling the RPC
- `renderExecCharts()`: Added canvas-based "No data available" messages for each of the 4 charts when their datasets are empty (weekly trend, copilot adoption, approval pipeline, tools usage)
- `quarter-changed` event listener: Added `if (activePage === 'exec-summary') renderExecSummary()` so global quarter changes re-render the exec page

**Files changed:** `src/pages/index.html`  
**Docs impact:** BRD/HLD unchanged — bug fix only, no architectural change.

### 0k. April 13, 2026 — Issues/Blockers, SPOC Project CRUD, Password Reset

**Problem:** Three gaps identified:
1. Contributors had no way to report AI adoption issues or blockers
2. SPOCs could not add projects from the dashboard (only admin via legacy localStorage-based admin panel)
3. Users could not reset/change passwords without email delivery (email not configured)

**Solution:**

**1. Reported Issues / Blockers:**
- New `reported_issues` table with title, description, severity (low/medium/high/critical), AI tool reference, practice, status (open/in_progress/resolved/closed), resolution tracking
- RLS policies: admin full access, authenticated read, SPOC write for own practice, contributor insert for own practice + update own issues
- New Issues/Blockers page in dashboard with KPI cards, severity/status badges, search + filters, full CRUD
- New `fetchReportedIssues`, `insertReportedIssue`, `updateReportedIssue`, `deleteReportedIssue` in `db.js`

**2. SPOC Project CRUD:**
- New `insertProject`, `updateProject`, `deleteProject` functions in `db.js` (previously only admin via localStorage)
- "+ Add Project" button visible to admin + SPOC on Dashboard Projects page
- Project modal with all fields: practice, department, name, code, customer, PM, dates, value, revenue type
- Edit/delete actions on project rows for admin/SPOC users
- Projects now persist to Supabase directly (existing RLS already supports SPOC insert/update)

**3. Password Reset:**
- In-app Change Password form accessible from sidebar footer (all users)
- Verifies current password by re-authenticating, then uses `supabase.auth.updateUser({ password })` to change
- Admin password reset: Not possible client-side (requires service_role key). Directs admin to Supabase dashboard for now

**Design Decisions:**
- **Issue severity as CHECK constraint enum:** Used `CHECK (severity IN ('low','medium','high','critical'))` rather than LOV table for simplicity and validation at DB level
- **Password change without email:** Since email delivery isn't working, implemented a "change password" flow (user knows current password) rather than "forgot password" (which requires email). Admin reset deferred to Supabase dashboard since it needs service_role.
- **Project CRUD via Supabase:** Replaced the admin.html localStorage pattern with proper Supabase CRUD. The dashboard project modal now writes to the `projects` table directly.

### 0j. April 13, 2026 — Executive Role Implementation

**Problem:** Senior directors needed cross-practice, read-only visibility into AI adoption metrics without the noise of task logging, approval, or management views.

**Solution:** New `executive` role with a dedicated Executive Summary dashboard, multi-practice assignment via junction table, and an RPC-based aggregation function.

**Design Decisions:**
- **Frontend-only scoping (not RLS-restricted):** Existing RLS policies grant SELECT to all authenticated users. Adding executive-specific policies would be OR'd with existing broad policies, providing no actual restriction. Instead, practice scoping is enforced in the `get_executive_summary()` RPC function and the frontend. If strict DB-level restriction is needed later, the broad `_read_all_authenticated` policies would need to be modified to exclude executives.
- **`executive_practices` junction table:** Enables N:M assignment of practices to executives. Simpler than overloading the single `practice` column on the `users` table (which is 1:1 for other roles).
- **RPC aggregation vs client-side:** `get_executive_summary()` runs server-side to avoid N+1 queries and reduce payload. Returns a single JSONB blob with all KPIs, breakdowns, trends, and adoption data.
- **Column corrections:** The plan referenced `saved_hours` and `copilot_users.is_active`. The real schema uses `time_without_ai - time_with_ai` (computed) and `has_logged_task` respectively. Corrected in the RPC.
- **Visible pages:** Per user decision, executives see Dashboard + Leaderboard + Executive Summary (not only Executive Summary). This gives them broader context while keeping the focused executive view as their default landing page.
- **Admin multi-practice picker:** When role = `executive`, the single-practice dropdown is hidden and a checkbox grid of all practices is shown. On save, `executive_practices` rows are upserted. On role change away from executive, cleanup deletes the junction rows.
- **No edge function changes:** The IDE task logger reads role dynamically from `users.role` and `role_view_permissions`. The only hardcoded `"admin"` references are for approval routing, which executives don't use.

### 0i. April 13, 2026 — Departments & Practices CRUD Enhancement

**Problem:** Practices management in the admin panel was localStorage-based (editing head/spoc only), and there was no concept of organizational departments to group practices.

**Solution:** New `departments` table with full Supabase-backed CRUD. Practices table enhanced with `department_id` FK, `description`, `is_active`, `updated_at` columns. Both admin pages rewritten for Supabase-direct operations with add/edit/delete, search, and filters.

**Design Decisions:**
- **1:N Department→Practice:** Each practice belongs to exactly one department. `department_id` FK with `ON DELETE SET NULL` — deleting a department unlinks practices rather than cascading deletes.
- **Supabase-direct CRUD:** Replaced localStorage-based practice editing with Supabase queries (consistent with Users management pattern). Uses local cache (`_adminPractices`, `_adminDepartments`) cleared on mutations.
- **`is_active` on both tables:** Soft-delete pattern matching existing project conventions. Status filters in admin UI.
- **Preserved `department` TEXT column:** Existing column kept for backward compatibility. New `department_id` UUID FK added alongside it. Seed migration links existing practices by matching `department` text to `departments.name`.
- **RLS:** `departments_read` policy allows public read (needed for signup dropdowns). `departments_admin_write` restricts writes to admin role.
- **Nested select:** `practices` query uses `select('*, departments(id, name)')` for efficient department name resolution without separate queries.

### 0h. April 13, 2026 — Role-Based Sidebar View Permissions

**Problem:** All VS Code extension sidebar sections were visible to all roles. Admins had no way to control which sections each role could see, and no UI to manage user roles.

**Solution:** Deny-list permissions table (`role_view_permissions`) controlling 8 sidebar view keys across 4 roles. Admin panel gains "Manage Users" and "View Permissions" pages.

**Design Decisions:**
- **Deny-list approach:** Default visible (`is_visible = true`). Admins toggle to `false` to hide. Prevents accidental lockouts and reduces initial setup.
- **Per-role only:** No per-user overrides. Simpler schema and admin UI. Can be extended later with a `user_view_overrides` table.
- **Permissions embedded in `/context`:** Avoids extra API call. Permissions fetched alongside user profile on every sidebar load.
- **8 granular view keys:** Covers all meaningful sidebar sections without being too atomic (individual form fields would be overkill).
- **Seed all 32 rows:** Pre-populating ensures the admin grid is complete; no need for upsert logic on first access.

### 0h-ext. April 13, 2026 — Admin-Managed Dashboard View Permissions

**Problem:** The `role_view_permissions` system only covered VS Code extension views (`ext.*`). Dashboard sidebar views were hardcoded via `data-role` HTML attributes with no admin control over visibility per role.

**Solution:** Extended the same `role_view_permissions` table with 68 new `web.*` rows (4 roles × 17 dashboard views). Dashboard boot sequence now fetches permissions and applies them on top of the existing `data-role` system.

**Design Decisions:**
- **Intersection model:** DB permissions work in addition to `data-role` HTML attributes. Admin can restrict further (hide a view for a role) but cannot grant access beyond what the role's `data-role` attribute allows. This is safer than replacing `data-role` entirely, which would require careful re-seeding.
- **`data-view-key` attribute:** Each nav item gets a `data-view-key="web.<page>"` attribute. This provides a clean hook for JS to match DB rows to DOM elements without fragile string parsing or coupling to `data-page`.
- **Fail-open default:** If the permission fetch fails (network error, table missing), all views remain visible. Missing view_keys in the permissions map also default to visible. This ensures the dashboard degrades gracefully.
- **All visible by default:** All 68 new rows are seeded with `is_visible = true`, matching current behavior. Admin then selectively hides views per role.
- **`web.*` prefix convention:** Mirrors the existing `ext.*` prefix for extension views, keeping namespaces clean and enabling category headers in the admin UI.
- **Category headers in admin matrix:** The permission grid now groups rows under "Dashboard Views" and "VS Code Extension Views" headers for visual clarity, without changing the underlying flat data model.
- **Navigation guard:** Click handler checks if target nav-item is hidden before navigating, preventing programmatic access to permission-hidden views.

**Files Changed:**
- `sql/008_web_view_permissions.sql` — New migration: 68 rows for 17 web views × 4 roles
- `js/db.js` — New `fetchMyViewPermissions(role)` function returning `Map<viewKey, boolean>`
- `js/auth.js` — New `applyViewPermissions(permissionsMap)` function hiding nav items + page divs
- `src/pages/index.html` — Added `data-view-key` to all 17 nav items, permission fetch in boot, navigation guard
- `src/pages/admin.html` — Updated subtitle, how-it-works text, and `renderAdminPermissions()` with category row headers

**Files Changed:**
- `sql/007_role_view_permissions.sql` — New migration: table, RLS, helper function, seed data
- `supabase/functions/ide-task-log/index.ts` — Extended `/context` response with `permissions` object
- `vscode-extension/src/api.ts` — Added `permissions` to `EasContext` type + `isViewPermitted()` helper
- `vscode-extension/src/sidebar.ts` — Conditional rendering of all sidebar sections based on permissions
- `vscode-extension/src/quickLog.ts` — Permission check before Quick Log wizard execution
- `js/db.js` — New CRUD functions: `fetchUsers`, `updateUserRole`, `updateUserStatus`, `updateUser`, `fetchRolePermissions`, `updateRolePermission`, `resetRolePermissions`
- `src/pages/admin.html` — Two new admin pages (Manage Users + View Permissions), Edit User modal, navigation wiring

### 0g. April 13, 2026 — Phase 10: IDE Task Logger

**Objective:** Allow developers to log AI adoption tasks directly from VS Code without switching to the web dashboard.

**Key Decisions:**

1. **Single Edge Function with path routing** over multiple functions — reduces cold start surface, keeps related logic together. The `ide-task-log` Edge Function handles 4 routes (`POST /`, `GET /context`, `GET /my-tasks`, `GET /health`).

2. **JWT auth on the Edge Function** — unlike existing Edge Functions (`ai-suggestions`, `ai-validate`) which are open CORS, `ide-task-log` validates the `Authorization: Bearer <jwt>` header using `supabase.auth.getUser(token)`. This is the first authenticated Edge Function in the project.

3. **Email/password auth in IDE** (not full OAuth PKCE) — simpler to implement for v1. The extension prompts for credentials via `vscode.window.showInputBox`, calls the Supabase Auth REST API directly, and stores the JWT in `vscode.SecretStorage`. Tokens auto-refresh via the refresh token. Full browser-based OAuth can be added in v2.

4. **`source` column on `tasks`** — `TEXT DEFAULT 'web'` with CHECK constraint for `'web'|'ide'|'api'`. Backwards-compatible (existing rows get `'web'`). Enables analytics on submission origin without schema disruption.

5. **Service-to-service AI validation** — the Edge Function calls `ai-validate` internally using the service role key, so the AI validation flow is identical to web submissions. Approval routing mirrors `js/db.js → determineApprovalRouting()`.

6. **Webview sidebar over TreeView** — a form-heavy UI needs HTML; TreeView is too limited for data entry. The webview renders arbitrary HTML/CSS inside VS Code using VS Code CSS variables for theme consistency.

7. **Extension in-repo** — co-located in `vscode-extension/` with the API and schema for simpler versioning. Can be extracted to a separate repo later if needed.

**Files Created:**
- `sql/006_ide_api.sql` — Schema migration
- `supabase/functions/ide-task-log/index.ts` — Edge Function API
- `supabase/functions/ide-task-log/import_map.json` — Deno import map
- `vscode-extension/src/extension.ts` — Entry point
- `vscode-extension/src/auth.ts` — Auth module
- `vscode-extension/src/api.ts` — API client
- `vscode-extension/src/sidebar.ts` — Webview sidebar
- `vscode-extension/src/quickLog.ts` — Command Palette wizard
- `vscode-extension/src/statusBar.ts` — Status bar item
- `vscode-extension/package.json` — Extension manifest
- `vscode-extension/tsconfig.json` — TypeScript config

### 0g1. April 13, 2026 — Phase 10.1: IDE Context Auto-Detection

**Objective:** Make the task logging experience near-zero-friction by auto-detecting developer work context from the VS Code environment and pre-filling form fields.

**Key Decisions:**

1. **Context detector as a separate module** (`contextDetector.ts`) — keeps detection logic isolated from UI code; easy to extend with new signal sources.

2. **Parallel context gathering** — `gatherIdeContext()` fetches git info, editor context, and AI tool detection simultaneously via `Promise.all()`, adding negligible latency.

3. **20+ AI extension IDs mapped** — covers GitHub Copilot (3 variants), Tabnine, Amazon Q/CodeWhisperer, Cody, Continue, Codeium, Cursor, Supermaven, Claude Dev, Cline, Windsurf, Pieces, IntelliCode, and more. The `matchToolToLov()` function handles exact and fuzzy matching against the server's LOV list.

4. **Language → Category heuristic** — maps `languageId` to task categories (e.g., `typescript` → "Code Generation", `sql` → "Data Analysis"). Shown as "💡 Suggested" in the UI; user can override.

5. **Project auto-matching** — workspace name and Git repo name are fuzzy-matched against the user's EAS project list. Falls back to single-project auto-select.

6. **Auto-detected values in QuickLog** — detected tool and suggested category are promoted to the top of their respective dropdown lists with markers. The description field is pre-filled with a context-aware suggestion (e.g., "Used GitHub Copilot working on auth.ts on branch feature/auth").

7. **Sidebar context banner** — a chip-based banner at the top of the sidebar shows detected signals at a glance (tool, branch, language, week number).

8. **Web dashboard install page** — new "VS Code Extension" page under Resources with: install CTA, feature grid, step-by-step installation guide, auto-detection reference table, and settings reference. Visible to all authenticated roles.

**Files Created:**
- `vscode-extension/src/contextDetector.ts` — Core context detection module
- `.github/skills/ide-context/SKILL.md` — Skill documentation

**Files Modified:**
- `vscode-extension/src/extension.ts` — Imports `resetSessionTimer`, calls on activation
- `vscode-extension/src/quickLog.ts` — Gathers IDE context, pre-fills all wizard steps
- `vscode-extension/src/sidebar.ts` — Gathers IDE context, pre-fills sidebar form, adds context banner
- `vscode-extension/package.json` — `autoDetectTool` setting now defaults to `true`
- `src/pages/index.html` — New "VS Code Extension" nav item + page + `copyVsixInstallCmd()` function

### 0f. April 12, 2026 — Skills Library → skills.sh Integration

- **What changed:** Replaced the static "Skills Library" page (6 learning-path cards linking to MS Learn) with a full skills.sh marketplace integration — searchable, filterable, with IDE-specific install commands.
- **Why:** The Copilot agent skills ecosystem (skills.sh by Vercel) has matured to 90K+ installs and 45+ supported agents. Integrating it directly into the dashboard gives adopters a discovery surface for useful agent skills without leaving the tracker.
- **No API available:** skills.sh does not expose a public REST API. The catalog is implemented as a curated JS array (`SKILLS_CATALOG`, 18 skills) sourced from the leaderboard. This avoids runtime API dependencies and keeps the page functional offline.
- **Architecture:**
  - HTML: New `page-skills` section with hero, search bar, filter pills, card grid, agents section, and how-to steps.
  - CSS: ~300 new lines in `dashboard.css` under `/* ===== SKILLS LIBRARY MARKETPLACE ===== */` — covers `.skill-card`, `.skills-hero`, `.skills-search-bar`, `.skill-install-modal`, `.skills-agents-grid`, `.skills-howto-*`.
  - JS: `SKILLS_CATALOG` array, `renderSkillsLibrary()`, `renderSkillCards()`, `filterSkillCards()`, `filterSkillCategory()`, `toggleSkillInstall()`, `copySkillCmd()`.
  - Navigation: Added `if (item.dataset.page === 'skills') renderSkillsLibrary();` to the nav handler.
- **Install modal:** Each skill card has an "Install" button that opens a slide-up modal with copy-to-clipboard commands for: All IDEs, GitHub Copilot (`-a github-copilot`), Cursor (`-a cursor`), Windsurf (`-a windsurf`), Claude Code (`-a claude-code`), Global (`-g`).
- **Trade-offs:**
  - Client-side catalog means manual updates when new popular skills emerge. Acceptable since the leaderboard changes slowly and the "Browse full catalog" link sends users to skills.sh for the complete registry.
  - DOMPurify is used to sanitize descriptions rendered from the catalog array.
  - No server-side component needed.

### 0e. April 12, 2026 — Phase 9: Licensed Tool Tracking

- **Business context:** Ejada pays for GitHub Copilot and M365 Copilot (Basic) as primary adoption tools. Other tools (Claude, ChatGPT, Gemini, Cursor, Codex) are allowed but not adoption targets.
- **SQL migration:** `sql/004_licensed_tool_tracking.sql`
  - `lovs.is_licensed` boolean column to flag licensed tool LOVs
  - `copilot_users.github_copilot_status` and `m365_copilot_status` with activation timestamps
  - `tasks.is_licensed_tool` generated column using `LOWER(ai_tool) LIKE '%github copilot%' OR LOWER(ai_tool) LIKE '%m365 copilot%'`
  - `get_licensed_tool_adoption(p_quarter_id)` RPC returning per-practice breakdown
  - Updated `practice_summary` view with `licensed_tool_tasks`, `other_tool_tasks`, `licensed_hours_saved`
- **db.js changes:**
  - `LICENSED_TOOLS` constant and `isLicensedTool()` helper for consistent client-side checks
  - `fetchLovs()` returns `licensedTools[]` and `otherTools[]` arrays
  - `fetchLicensedToolAdoption(quarterId)` calls the new RPC
  - `fetchAllData()` returns `licensedToolAdoption` and `licensedTotals` objects
- **Dashboard KPIs:** New "Licensed Tool Adoption" section with 5 cards: GH Copilot, M365 Copilot, Licensed Share %, Licensed Hours Saved, Other Tools
- **Charts:** Licensed vs Other split donut, Licensed Tool Adoption by Practice stacked bar, AI Tools donut with licensed tool color distinction (blue/purple)
- **Form dropdowns:** `<optgroup>` tags separate "Licensed (Ejada-Paid)" from "Other Tools" in task/accomplishment forms and task filter
- **Tasks table:** "🏢 Licensed" badge on AI Tool column for licensed tools
- **Use Case Library:** Licensed tool badges, "Licensed Tools Only" filter, Licensed Tool UCs KPI
- **SPOC Panel:** Practice-level "Licensed Tools %" KPI
- **Licensed AI Users page:** Renamed from "Copilot Access", per-tool status columns with Active/Inactive badges
- **Trade-offs:**
  - Used case-insensitive LIKE matching rather than exact string match to handle "Github Copilot" vs "GitHub Copilot" variants
  - `is_licensed_tool` is a generated column (not writable) — always derived from `ai_tool` text
  - Form `<optgroup>` cannot be styled with CSS in many browsers — used emoji prefix as fallback visual distinction
  - LOV `is_licensed` column needs the migration run to populate; until then, `isLicensedTool()` helper provides client-side fallback

### 0c. April 12, 2026 — AI Innovation Approved Use Cases

- **New table:** `use_cases` in Supabase — stores AI Innovation approved reference use cases with full metadata (asset_id, name, description, practice, SDLC phase, category, subcategory, AI tools, effort estimates, validation details, implementation guidelines, etc.).
- **Data source:** Extracted 40 EAS use cases from `ReferencesAndGuidance/AI_Use_Case_Asset_Template (5).xlsx`, filtered by Department=EAS, all with "Accepted Idea" validation feedback across 6 practices (BFSI, CES, EPCS, EPS, ERP Solutions, GRC).
- **Validation detail breakdown:** 6 "Proven with Adoption Evidence", 4 "Ready for Implementation", 30 "Ready for Pilot".
- **Migration SQL:** `sql/003_use_cases.sql` — 40 idempotent INSERT statements with ON CONFLICT DO NOTHING.
- **db.js:** Added `fetchApprovedUseCases()` function and included in `fetchAllData()` parallel fetch.
- **UI (Use Case Library):** Completely rewritten `renderUseCases()` to merge approved reference use cases (with "⚡ AI Innovation Approved" badge and validation detail badges) alongside community task-derived use cases. Added type filter dropdown (All/Approved/Community). KPIs now show approved vs community counts separately.
- **AI Validation Edge Function:** Updated `ai-validate/index.ts` to fetch approved use cases from DB and include them as context in the GPT-4 validation prompt. Added rule 6: "Alignment with approved use cases" — submissions matching known patterns get bonus points; novel use cases not penalized.
- **Trade-offs:**
  - Chose TEXT for effort fields (efforts_without_ai, efforts_with_ai, hours_saved_per_impl) because source data has mixed formats ("16H", "3 Days per task", "8-10 MD per project") — no reliable numeric normalization possible.
  - Two CES use cases had no asset_id in the Excel; generated IDs (CES-AI-DOC-001, CES-AI-DEV-001).
  - Unit "ERP" mapped to practice "ERP Solutions" to match the existing practices table.

### 0d. April 12, 2026 — Approval Gating (Approved-Only Metrics)

- **DB:** Updated summary RPCs and views to filter `approval_status = 'approved'` for all aggregates.
- **UI:** Added approval badges to tasks/accomplishments; charts and forecasts use approved-only tasks.
- **Edits:** Task/accomplishment edits reset approval and re-create approval workflow entries.
- **Exports:** Task exports now include approved-only records by default.

### 0b. April 12, 2026 — Guide Me Page (New Phase)

- Added a new "Guide Me" tab under a **Resources** nav section in the sidebar, accessible to all roles.
- The page has 4 tabbed sections:
  1. **Guidelines** — Content parsed from `ReferencesAndGuidance/guidlines.txt` and rendered as structured cards (GitHub Enterprise login, access types, how to get access, important reminders, PM/SM resources).
  2. **AI News** — Curated AI news items covering GitHub Copilot Workspace, M365 Copilot, Extensions, industry trends, and responsible AI.
  3. **Skills Library** — Training resources organized by skill level (beginner/intermediate/advanced) with tags for role applicability.
  4. **Copilot Enablement** — Microsoft training session recordings (3 sessions from Jan 2026) and official Microsoft enablement links.
- CSS styles added to `css/dashboard.css` (`.guide-*` classes) with responsive breakpoints.
- Tab switching handled via `renderGuideMe()` function with event delegation.
- No database changes required — all content is static HTML.

### 0b-1. April 12, 2026 — Prompt Library → Database Migration

- **Migrated 55 hardcoded prompts to Supabase `prompt_library` table** — prompts are now admin-editable, analytics-tracked, and dynamically rendered.
- **New DB objects:** `prompt_library` table, RLS policies (`prompt_library_select`, `prompt_library_admin_all`), `increment_prompt_copy()` RPC, auto `updated_at` trigger, 3 indexes.
- **Migration file:** `sql/005_prompt_library.sql`.
- **js/db.js additions:** `fetchPromptLibrary()` fetches active prompts ordered by role + sort_order; `incrementPromptCopy(promptId)` calls the RPC fire-and-forget.
- **Dynamic rendering in Guide Me:** `loadPromptLibrary()` fetches from DB and renders via `renderPromptCards(prompts, container)`. Cards are grouped by role then category. Loading spinner shown while fetching. Cache used (`_promptLibraryCache`) to avoid re-fetching on tab switch.
- **Copy tracking:** `copyPrompt(card)` now reads `data-prompt-id` from the card and calls `EAS_DB.incrementPromptCopy(id)` so admins can see which prompts are most used.
- **Admin CRUD panel:** New "Prompt Library" nav item in Admin Panel → renders table with search + role filter; modal for add/edit with fields: role, category, prompt_text, sort_order, is_active. Delete with confirmation. All operations go direct to Supabase.
- **Trade-off:** Kept old hardcoded HTML inside a `<template>` tag (hidden, not rendered) as a reference fallback; can be removed after validation.
- **Escape:** `escapeHtml()` function used when rendering prompt text to prevent XSS.

### 0. April 12, 2026 — Approvals UI Fix

- Added `getUserId()` to the auth module to support approvals queries without runtime errors.
- Scoped the Approvals nav item to admin/SPOC roles for consistent visibility.

### 1. Database Schema (sql/002_approval_workflow.sql)

**New Tables:**
- `practice_spoc` - Maps practices to SPOCs
- `submission_approvals` - Tracks approval workflow

**Modified Tables:**
- `tasks` - Added approval_id, approved_by, approved_by_name, approval_status, approval_notes, submission_approved
- `accomplishments` - Same approval-related fields added

**New Views:**
- `pending_approvals` - For dashboard
- `employee_task_approvals` - For employee status tracking
- `spoc_approval_workload` - For SPOC dashboard
- `admin_approval_dashboard` - For admin overview

**Indexes:** Added for performance on approval queries

### 2. Backend Logic (js/db.js)

**New Functions:**
- `getSpocForPractice(practice)` - Get SPOC for a practice
- `determineApprovalRouting(practice, savedHours, aiValidationFailed)` - Smart routing logic
- `fetchPendingApprovals(userRole, userPractice, userId)` - Get pending approvals
- `fetchApprovalHistory(userRole, userPractice, limit)` - Get completed approvals
- `approveSubmission(approvalId, approvalNotes)` - Approve a task
- `rejectSubmission(approvalId, rejectionReason)` - Reject a task
- `fetchEmployeeTaskApprovals(employeeEmail)` - Get employee's approval status

**Updated Functions:**
- `createSubmissionApproval()` - Now includes smart routing logic
- `submitTaskWithApproval()` - Passes practice and AI validation info
- `submitAccomplishmentWithApproval()` - Same updates as tasks

### 3. Admin UI (admin.html)

**New Navigation:**
- "Approvals" tab in sidebar with pending approval count badge

**New Page:**
- Approvals management page with:
  - Filters (status, practice, search)
  - Pending Approvals section with review/approve/reject buttons
  - Approval History section showing completed approvals
  - Real-time approval count updates

**New Functions:**
- `renderApprovals()` - Main approval page renderer
- `renderPendingApprovals()` - Render pending items
- `renderApprovalHistory()` - Render completed approvals
- `approveApproval()` - Approve action
- `rejectApprovalWithReason()` - Reject with reason
- `openApprovalDetailModal()` - View details (to be enhanced)

### 4. Employee Status Page (employee-status.html)

**New Standalone Page:**
- URL: `employee-status.html`
- Shows employee's submitted tasks and approval status
- Features:
  - Statistics dashboard (Total, Approved, Pending, Rejected)
  - Filterable task list
  - Status badges with visual indicators
  - Approval timeline modal
  - Displays who task is pending with

### 5. Dashboard Navigation (index.html)

**Added Link:**
- "Task Status" navigation item for contributors
- Links to `employee-status.html`
- Shows in "My Work" section

### 6. Documentation (docs/APPROVAL_WORKFLOW.md)

**Comprehensive Guide:**
- Workflow process overview
- Routing rules detailed
- Approval stages explained
- User guides for all roles
- Database schema reference
- API function documentation
- Troubleshooting guide

## Approval Routing Rules

### Priority 1: High Savings (≥15 hours)
- **Routes to:** Admin (Omar Ibrahim)
- **Status:** admin_review
- **Reason:** High impact requires top-level approval

### Priority 2: AI Validation Failure
- **Routes to:** SPOC (practice manager)
- **Status:** spoc_review
- **Reason:** Manual review needed
- **Fallback:** Admin if SPOC not found

### Priority 3: Standard (< 15 hours, AI passes)
- **Route to:** AI → SPOC
- **Statuses:** ai_review → spoc_review
- **Reason:** Normal workflow

## Key Features

✅ **Smart Routing:** Automatically routes based on saved hours and AI validation
✅ **Multi-Stage Approval:** AI validation → SPOC → Admin (as needed)
✅ **Role-Based Views:** Different interfaces for employees, SPOCs, and admins
✅ **Real-time Status:** Employees can track approval progress
✅ **Audit Trail:** Complete history of all approval actions
✅ **Error Handling:** Graceful handling of missing SPOCs or AI failures
✅ **Visual Indicators:** Color-coded status badges and timelines
✅ **Filtering & Search:** Easy discovery of specific approvals
✅ **Performance:** Optimized with indexes on approval queries

## Data Flow

```
Employee Submits Task
         ↓
Task Created (approval_status = 'pending')
         ↓
    Approval Entry Created in submission_approvals
    (approval_status = 'spoc_review')
         ↓
    Task linked via approval_id
         ↓
SPOC Reviews Task
         ↓
├─ If saved_hours ≥ 15 → advance to admin_review
└─ Else → approve directly
         ↓
Admin Reviews (if applicable)
         ↓
Approve or Reject
         ↓
Task approval_status updated to 'approved'/'rejected'
         ↓
Employee Notified (via status page)
```

## Deployment Checklist

- [x] SQL migration file created (002_approval_workflow.sql)
- [x] Database functions implemented
- [x] Admin UI updated with Approvals tab
- [x] Employee status page created
- [x] Navigation links added
- [x] Documentation written
- [ ] SQL migration needs to be run in Supabase
- [ ] Test approval workflow end-to-end
- [ ] Verify all email notifications work (if email integration exists)
- [ ] Monitor approval times and adjust SLAs

## Testing Guide

### Test Case 1: High Savings Task (≥15 hours)
1. Employee submits task with 20 hours saved
2. Verify approval status = "admin_review"
3. Verify appears in admin's Approvals tab
4. Admin approves the task
5. Verify employee sees "✅ Approved" status

### Test Case 2: AI Validation Fails
1. Mock AI validation failure
2. Employee submits task
3. Verify approval status = "spoc_review"
4. Verify appears in SPOC's pending list
5. SPOC approves with notes
6. Verify task moves to "approved"

### Test Case 3: Normal Workflow (< 15 hours, AI passes)
1. Employee submits task with 5 hours saved
2. Verify approval status = "ai_review"
3. Wait for AI validation
4. Verify status changes to "spoc_review"
5. SPOC approves
6. Verify final status = "approved"

### Test Case 4: Employee Status Page
1. Employee logs in
2. Click "Task Status" navigation
3. Verify all submitted tasks shown
4. Click "View Timeline" on a task
5. Verify approval timeline displayed correctly
6. Verify statistics updated

## Known Limitations & Future Improvements

- [ ] Email notifications for approval status changes
- [ ] Automated reminders for pending approvals
- [ ] Bulk approval operations
- [ ] SLA tracking and alerts
- [ ] Integration with Teams/Slack notifications
- [ ] Approval workflow webhooks
- [ ] Advanced analytics on approval times

## Technical Notes

- All functions are async to handle Supabase calls
- Error handling includes logging to console and user feedback via toasts
- RLS (Row Level Security) updated to allow appropriate access
- Indexes added for optimal query performance
- Timestamps use TIMESTAMPTZ for timezone-aware tracking

## Rollback Plan

If issues arise:
1. Rename new tables to _backup
2. Remove new columns from tasks/accomplishments
3. Remove RLS policies for new tables
4. Revert admin.html and index.html changes
5. Keep employee-status.html as it won't break existing functionality

## Support & Maintenance

- Monitor submission_approvals table growth
- Periodically clean up old approval records (archive after 1 year)
- Track approval metrics for performance improvement
- Update SPOC mappings if organizational changes occur


---

## Structural Update — 2026-04-11

HTML entry points were relocated from the repository root into `src/pages/`. Shared assets in `css/` and `js/` now resolve via `../../css/…` and `../../js/…`. Cross-page navigation between pages in `src/pages/` stays flat (e.g. `window.location.href = 'login.html'`).

See `docs/CODE_ARCHITECTURE.md` §2 for the authoritative tree and path convention, and `.github/copilot-instructions.md` for the mandatory workflow governing future changes (skills, Supabase MCP, full docs sweep, commit & push).
