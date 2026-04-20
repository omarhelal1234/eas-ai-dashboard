---

## April 20, 2026 — Admin Reset Password

Replaced the Magic Link action in the admin user table with a "Reset Password" action. Motivation: magic links are one-time login URLs, not passwords — admins needed to set a known temporary password (e.g., `12345678`) for users who are locked out.

A new Edge Function (`admin-reset-password`) mirrors the `admin-magic-link` auth pattern: verifies caller JWT, confirms admin role in `public.users`, then calls `supabase.auth.admin.updateUserById` with the new password via the service role key. The service role key stays server-side.

`listUsers({ perPage: 1000 })` is used to look up the target user by email since the Supabase JS SDK v2 Admin API has no `getUserByEmail`. Acceptable for ~120 users; can be optimised with a direct SQL lookup if user count grows significantly.

---

## April 19, 2026 — 3 Bug Fixes: Project Duplication, Checkbox Visibility, Signup Grafana Stats

### 1. SPOC project edit duplicates instead of updating — `src/pages/index.html`
**Root cause:** `editProject(id)` set `fp-id` to the project UUID, then called `openModal('project')`. Inside `openModal`, the `type === 'project'` branch always resets `fp-id` to `''` (as part of the "fresh open" reset added in BUG-01 fix). So by the time `saveProject()` ran, `editId` was empty and it fell into the `insertProject` branch, creating a duplicate.
**Fix:** Reordered `editProject` to call `openModal('project')` first (letting it reset everything), then populate all fields including `fp-id` afterwards.

### 2. Bypass-approval checkbox visible to non-admins — `src/pages/index.html`
**Root cause:** The `<label>` wrapper around the bypass checkbox + span had no visibility control. The JS only toggled `display` on the inner `<span id="f-bypass-label">`, leaving the bare checkbox element always rendered for non-admins.
**Fix:** Added `id="f-bypass-wrapper"` to the `<label>`, defaulted it to `display:none`, removed individual span hide. JS now toggles the wrapper's `display` (`flex`/`none`) based on admin role — both checkbox and label text hidden together.

### 3. Signup doesn't pick up existing Grafana stats — `sql/024_signup_contributor_upsert_grafana_stats.sql`
**Root cause:** `signup_contributor` did a plain `INSERT INTO copilot_users`. With the `copilot_users_email_unique` constraint (added in migration 017), if a row already existed for the user's email (seeded by Grafana/IDE sync), the function would throw a unique-constraint error. Even when no conflict occurred, new users always started with all `ide_*` columns at 0.
**Fix:** Changed to `INSERT … ON CONFLICT (email) DO UPDATE SET` — on conflict, profile fields (`practice`, `name`, `role_skill`, `status`) are updated from the signup data while all `ide_*` Grafana columns are left untouched. Migration 024 applied.

---

## April 19, 2026 — Core-Function Bug Fixes (6 bugs)

### 1. `updateTask` auto-approve path — `js/db.js`
**Bug:** When a non-admin edits a task with < 5 hours saved, `updateTask` reset `approval_status` to `'pending'` and then called `createSubmissionApproval` which returned `{ autoApproved: true }`. Unlike `submitTaskWithApproval`, which explicitly re-stamps `approval_status = 'approved'`, the edit path only set `approval_id = null` and left the status as `'pending'` forever.
**Fix:** Added `if (approval?.autoApproved)` branch that writes `{ approval_id: null, approval_status: 'approved' }` and logs `AUTO_APPROVE`, mirroring the insert path.

### 2. `updateSubmissionApproval` wrong column name — `js/db.js`
**Bug:** Line 1478 mapped `updates.rejectedReason → payload.rejected_reason` but the actual Supabase column is `rejection_reason`. The rejection reason was silently discarded on any call that used `updateSubmissionApproval` with a `rejectedReason` argument.
**Fix:** Changed `payload.rejected_reason` → `payload.rejection_reason`.

### 3. Login page missing profile fields and cache timestamp — `src/pages/login.html`
**Bug:** After successful login, the profile was fetched with only `id, name, role, practice` (missing `email`, `is_active`). The timestamp `eas_user_profile_ts` was never written, so `auth.js`'s 5-minute TTL cache never activated — every call to `getUserProfile()` across the whole session triggered a fresh DB round-trip. Also, downstream code (e.g., `changePassword`) that expects `profile.email` would find it missing from the cached object.
**Fix:** Extended the SELECT to `id, name, email, role, practice, is_active`. Added `localStorage.setItem('eas_user_profile_ts', String(Date.now()))` after storing the profile.

### 4 & 5. Premature modal close before async save — `src/pages/index.html`
**Bug:** Both `saveProject()` and `saveTask()` (edit path) called `closeModal(...)` *before* the `await EAS_DB.update/insert` resolved. If the DB call failed, the modal was already closed and the user's filled-in form data was gone.
**Fix:** Moved `closeModal(...)` calls to *after* the `if (!result) { ... return; }` guard, so the modal only closes on success. For `saveTask`, `_editingId`/`_editingType` cleanup and modal title reset were also moved inside the success branch.

### 6. Double success toast on new task submission — `src/pages/index.html`
**Bug:** `Phase8.submitWithApproval` shows its own toast (e.g., "Task submitted — SPOC review (3.0 hrs saved)") and `saveTask()` also unconditionally called `showToast(resultMsg)` afterward, causing two toasts for every new submission.
**Fix:** Made the outer toast conditional — only fires for the edit path (`if (isEdit) showToast(...)`).

---

# Phase 8 Approval Workflow Implementation - Complete Summary

**Date:** April 11, 2026  
**Status:** ✅ Production Deployed  
**Version:** Phase 8 Complete

## Changes Made

### 0ag. April 19, 2026 — Fix: Batch Recover 12 Incomplete Signup Profiles

**Problem discovered:**
After deploying signup_contributor RPC (fix 0ae), we discovered a systemic issue: 12 users had successfully created auth accounts but their profiles (users + copilot_users rows) were never created:
- rsadek, smagdy, bhegazy, mmabdallah, salmatrafi, asgomaa, magaber, abelllah, y.akl, aallhidan, m.habashy, aelahi
- All created auth accounts and logged in successfully
- But login failed with "Account not found in the system" because profiles didn't exist

**Root cause:**
These accounts were created before signup_contributor RPC was deployed. They went through the signup flow, auth account was created, but the profile creation step (RPC call) either failed silently or the RPC didn't exist yet.

**Fixes applied:**

1. **Created `recover_incomplete_profile()` function** — Admin recovery function that:
   - Takes: email, practice, has_copilot flag
   - Looks up auth account by email
   - Checks if profile already exists
   - Calls signup_contributor to create profile with minimal data
   - Returns success/error JSONB response

2. **Batch recovered all 12 accounts** — Called recover_incomplete_profile for each account:
   - Practice: defaulted to 'EPCS' (common practice)
   - Status: 'pending' (no copilot access initially)
   - Name: derived from email prefix (rsadek → rsadek, etc.)
   - All 12 accounts now have complete profiles and can login successfully

3. **Improved login error handling** — Updated login.html error message:
   - Shows the user's email address
   - Guides them to contact SPOC or admin (eas@ejada.com)
   - Added console logging for RPC errors
   - Distinguishes between data-missing errors vs RPC errors

**Prevention:**
- Added recover_incomplete_profile() function for future manual recovery
- Improved login error messages to catch similar issues earlier
- Next: consider adding a startup check to detect and auto-fix incomplete profiles

**Testing:** All 12 recovered accounts can now login successfully.

---

### 0af. April 19, 2026 — Fix: Profile Completion from Auth Metadata on Login

**Problem:**
After the `signup_contributor` RPC was created (fix 0ae), users could complete signup successfully. However, if they cleared their browser cache or logged in from a different device, they would get "Account not found in the system" error because:
1. The localStorage key `eas_pending_signup` was cleared
2. The login page only checked localStorage as a fallback
3. Even though their profile was created during initial signup, the login page couldn't find it without the localStorage data

**Root cause:**
The login flow didn't leverage the `auth.user.user_metadata` which contains the signup data stored during initial signup (via `sb.auth.signUp({ options: { data: {...} } })`).

**Fix applied:**
Updated login.html to implement a two-tier fallback when user profile is not found:
1. First, try to get signup data from localStorage (for email-confirmation flow)
2. If not found, extract from `auth.user.user_metadata` (for auto-confirm flow)
3. Use either source to call `signup_contributor` RPC to complete profile
4. If profile creation succeeds, cache it and redirect to index.html

This ensures that:
- Users with cleared cache can still login and complete profile
- Users on different devices can login and complete profile
- Cross-device/cross-browser signup works correctly

**Testing:** Login with devtrial@ejada.com after clearing cache now works correctly.

---

### 0ae. April 19, 2026 — Fix: Create Missing signup_contributor RPC Function

**Problem:** 
New users could create auth accounts but profile setup would fail with error: "Account created but profile setup failed: column 'remarks' of relation 'copilot_users' does not exist". The issue was that the `signup_contributor()` RPC function—called during signup to create both `users` and `copilot_users` rows—was never implemented.

**Root cause:**
- The function was referenced in `signup.html` (line 777) and documented in BRD/CODE_ARCHITECTURE but never created in SQL
- Additionally, the function was trying to reference the `remarks` column which was dropped on April 17 when `remarks` and `status` were unified

**Fix applied:**
Created `CREATE OR REPLACE FUNCTION public.signup_contributor()` as a SECURITY DEFINER RPC that:
1. Accepts: `p_auth_id`, `p_name`, `p_email`, `p_practice`, `p_skill`, `p_has_copilot`
2. Creates a `users` row with role = `'contributor'`
3. Creates a `copilot_users` row with status based on `p_has_copilot` flag:
   - If `true`: status = `'access granted'`
   - If `false`: status = `'pending'`
4. Uses only existing columns (`status`, not `remarks`)
5. Returns JSONB response with success/error, user_id, copilot_id, and status
6. Grants EXECUTE to `anon` and `authenticated` roles for signup flow

**Migration:** `024_create_signup_contributor_rpc`

**Testing:** Signup flow now works end-to-end for new users.

---

### 0ad. April 17, 2026 — Block Negative Time Saved + Fix Saved Hours Calc + Accomplishments in Scoring

**Three issues addressed:**

1. **Task submission allowed zero/negative time saved** — Users could submit tasks where `time_with_ai >= time_without_ai`, resulting in zero or negative saved hours. This corrupted leaderboard rankings and KPI totals.
   - **Fix:** Added validation in `saveTask()` (`index.html:4831`): blocks submission when `timeWith >= timeWithout`. Updated `initSavedHoursCalculation` (`phase8-submission.js:205`) to show actual negative values (removed `Math.max(0, ...)` clamp) with red color. Updated `updateApprovalTierDisplay` to show "cannot submit" warning for zero/negative.

2. **Approval detail showed stale `saved_hours`** — The `submission_approvals.saved_hours` was set at submission time. When admin edited a task's time values, the approval `saved_hours` was never updated, causing mismatch (e.g., 20h displayed when actual task had 5h-3h=2h).
   - **Fix:** Approval detail modal (`index.html:3097-3102`) now computes saved hours from actual task data (`time_without_ai - time_with_ai`) for tasks, and `effort_saved` for accomplishments, falling back to `approval.saved_hours` only when submission data is unavailable.

3. **Accomplishments excluded from champions scoring & badges** — `computeBadges()` only considered task-based `timeSaved`. Accomplishment `effort_saved` was ignored entirely, and there were no accomplishment-specific badges.
   - **Fix:** `computeBadges()` (`db.js:1121`) now accepts `accomplishments` (count) and `accomplishmentEffort` (total effort_saved) fields. Time Saver and Centurion badges use combined `timeSaved + accomplishmentEffort`. Two new badges added: Innovator (1+ accomplishment) and Impact Maker (3+ accomplishments). Leaderboard (`renderLeaderboard`), My Practice (`renderMyPractice`), and My Tasks (`renderMyTasks`) views all enriched with approved accomplishment data matched by employee name. Leaderboard table now has "Acc." column.

**Trade-off:** Accomplishment-to-employee matching uses substring match on the `employees` text field. This works for single-employee accomplishments and comma-separated lists but could over-match if one employee's name is a substring of another's. This is acceptable given the current data.

### 0ac. April 17, 2026 — Fix Inaccurate Practice Summary for SPOCs

**Problems identified:**

1. **`licensed_users` counted ALL copilot_users** — not filtered by `status = 'access granted'`. E.g., BFSI showed 59 but should be 57; EPS showed 6 but should be 0 (all pending).
2. **`active_users` relied on stale `has_logged_task` boolean** — 9 users had `has_logged_task = true` but zero tasks in the DB (flag was set during Excel import but never synced). GRC showed 2 active but really 0.
3. **"Active" definition was task-only** — users with IDE activity (`ide_days_active > 0`, recent `ide_last_active_date`) but no platform task submissions were classified as inactive. E.g., BFSI had 10+ users using Copilot in IDE but marked inactive.
4. **`fetchInactiveMembers` used task-only logic** — same as above; the inactive members table showed IDE-active users as needing attention.

**Fixes applied:**

- **`get_practice_summary` RPC** — `licensed_users` now `WHERE lower(status) = 'access granted'`; `active_users` now `WHERE (EXISTS tasks OR ide_days_active > 0)`.
- **`practice_summary` view** — dropped and recreated with same logic.
- **`get_executive_summary` RPC** — `copilot_adoption.active_users` now uses same tasks+IDE logic instead of `has_logged_task`.
- **Data fix** — set `has_logged_task = false` for 9 users with stale true flag (no tasks in DB).
- **`fetchInactiveMembers` in `db.js`** — now fetches `ide_days_active` and `ide_last_active_date`; considers a user active if they have a recent task OR recent IDE activity within the cutoff period. Returns `lastActivity`, `ideDaysActive`, `ideLastActive`, `daysSinceActivity`.
- **Inactive table UI in `index.html`** — header changed from "Last Task" to "Last Activity"; shows IDE days badge next to name; uses `daysSinceActivity` (max of task date and IDE date) for inactive duration.
- **`001_schema.sql`** — updated practice_summary view definition to match live DB.

**Before → After counts:**

| Practice | Licensed (old→new) | Active (old→new) |
|---|---|---|
| BFSI | 59→57 | 9→15 |
| CES | 13→13 | 3→2 |
| EPCS | 11→9 | 3→6 |
| EPS | 6→0 | 0→0 |
| ERP Solutions | 86→85 | 22→23 |
| GRC | 4→4 | 2→0 |

**Migrations:** `fix_practice_summary_accurate_counts`, `fix_active_users_include_ide_activity`, `fix_executive_summary_active_users`.

---

### 0ab. April 17, 2026 — Fix Accomplishment Approval Workflow (Mandatory SPOC + Admin)

**Problem:** Accomplishments shared the same approval routing as tasks, which meant accomplishments with < 5 saved hours were auto-approved. The business requirement is that accomplishments must **always** be reviewed by both SPOC and Admin — no auto-approval regardless of hours. Additionally, when a SPOC approved an accomplishment, it would be marked as fully approved instead of advancing to admin review.

**Secondary bug:** `updateAccomplishment` called `createSubmissionApproval` with 6 arguments (passing `practice` as the 5th parameter and `false` as 6th), but the function only accepts 4 parameters — so `practice` was silently dropped, causing approval records for edited accomplishments to have `practice = null`.

**Fixes applied:**
- **`determineApprovalRouting(practice, savedHours, submissionType)`** — New 3rd parameter. Accomplishments skip the `< 5h auto-approve` check and always set `needsAdminReview = true`.
- **`createSubmissionApproval`** — Passes `submissionType` through to `determineApprovalRouting`.
- **`submitAccomplishmentWithApproval`** — Removed the `autoApproved` handling block; accomplishments always create an approval record.
- **`approveSubmission` state machine** — When SPOC approves an accomplishment, `nextStatus` is always `admin_review` (not `approved`). Admin can still bypass and approve directly at any stage.
- **`updateAccomplishment`** — Fixed the `createSubmissionApproval` call to pass 4 correct arguments: `('accomplishment', data.id, savedHours, data.practice)`.
- **Admin UI** — Approval tables now show a "Type" column distinguishing tasks from accomplishments. Toast messages reflect the submission type and whether the action was a final approval or advancement to admin review.

**Approval flow comparison:**

| Submission | < 5h saved | 5–10h saved | > 10h saved |
|---|---|---|---|
| **Task** | Auto-approve | SPOC → Approved | SPOC → Admin → Approved |
| **Accomplishment** | SPOC → Admin → Approved | SPOC → Admin → Approved | SPOC → Admin → Approved |

**Files changed:** `js/db.js`, `src/pages/admin.html`

---

### 0aa. April 17, 2026 — Unify status/remarks Columns + NOT NULL Constraint

**Problem:** `copilot_users` had two columns carrying the same information: `status` and `remarks`. They frequently conflicted (e.g., `status = 'access granted'` but `remarks = 'pending'`). The UI displayed `remarks` while the backend filtered on `status`.

**Fixes applied:**
- **Data normalization:** `Active` (27 rows) → `access granted`. All statuses now: `access granted` (169) or `pending` (11).
- **Column drop:** Removed `remarks` column entirely from `copilot_users`.
- **NOT NULL constraint:** `status` is now `NOT NULL DEFAULT 'pending'` — no more nulls possible.
- **Code cleanup:** Removed all `remarks` references from `db.js` (insert/update/fetch), `index.html` (table render, form save/load, Excel export), `migrate.html` (import payload), and `001_schema.sql`.

**Migration:** `unify_status_drop_remarks`.

### 0z. April 16, 2026 — Fix Inaccurate Licensed User & Task Counts

**Problem:** Dashboard KPIs showed 180 "Total Licensed Users" (counting all copilot_users regardless of status) and only 10 "Has Logged Task" (stale `has_logged_task` boolean).

**Root causes:**
1. `has_logged_task` boolean was not being synced when tasks were logged via the weekly Excel import — 29 users had tasks but were marked `false`.
2. All statuses (`access granted`, `Active`, `pending`) were counted as "licensed" — only `access granted` (142 users) should count.

**Fixes applied:**
- **Data fix:** Updated `has_logged_task = true` for 29 users with existing tasks in `tasks` table.
- **Schema fix:** Added `DEFAULT 'pending'` on `copilot_users.status` to prevent future NULLs. Normalized `Pending` → `pending`.
- **Dashboard JS:** `totalUsers` now filters `copilot_users` to `status === 'access granted'` only.
- **SQL functions/views:** Updated `practice_summary` view, `get_licensed_tool_adoption()`, and `get_executive_summary()` to filter `WHERE LOWER(status) = 'access granted'`.

**Corrected metrics:** Total Licensed = 142, Has Logged Task = 23 (of licensed), Adoption = 16.2%.

### 0y. April 16, 2026 — Featured Spotlight Banner + Global Likes System

**Purpose:** Add a marketing-style carousel banner to the dashboard spotlighting top-performing content, plus a permanent like system across all content sections.

**Approach:**
- **Schema (MCP):** 3 new tables (`likes`, `featured_banner_config`, `featured_banner_pins`) + `v_banner_candidates` view (UNION ALL across tasks, accomplishments, prompts, use cases) + `toggle_like` RPC (SECURITY DEFINER). Migration: `sql/022_featured_banner_and_likes.sql`.
- **Data layer (`db.js`):** 9 new functions — `fetchBannerCandidates`, `fetchBannerConfig`, `updateBannerConfig`, `fetchBannerPins`, `insertBannerPin`, `deleteBannerPin`, `toggleLike`, `fetchMyLikes`, `fetchLikeCounts`.
- **Banner UI (`index.html`):** Spotlight carousel with ARIA `role="region"` + `aria-roledescription="carousel"`. Skeleton loader during fetch. Auto-rotation (5s) pauses on hover/focus. Manual arrows + dot indicators. Slides show type badge, title, metrics, contributor info, like button.
- **Like buttons (global):** Heart SVG buttons on Tasks table rows, Accomplishment cards, Use Case cards, and inside banner slides. Optimistic UI with bounce animation. `handleLikeClick()` syncs all instances of the same item across page sections. Prompts reuse the existing `prompt_votes` system.
- **Selection algorithm (client-side):** Per content type: pinned items first → sort by likes → sort by metric value. Fills slots from `featured_banner_config`. Always fills banner even with zero likes via metric fallback.
- **Admin config (`admin.html`):** New "Banner Settings" page with slot allocation table, active toggles, pin management list, and "Pin Item" modal with searchable item picker.
- **Cache:** `localStorage` keys (`eas_banner_selection`, `eas_banner_date`, `eas_banner_quarter`) with calendar-day reset. Cleared on quarter change.

**Key decisions:**
- **Prompts excluded from `likes` table** — `prompt_votes` already handles like/dislike for prompts, so `v_banner_candidates` joins `prompt_votes WHERE vote_type='like'` for prompt like counts. The `likes` CHECK only allows `task`, `accomplishment`, `use_case`.
- **Lazy-loaded like data** — `loadLikeData()` runs in parallel with other non-critical boot tasks rather than blocking `fetchAllData()`.
- **Cross-section sync** — `handleLikeClick()` uses `querySelectorAll` to find and update ALL like buttons for the same item across banner + section pages.
- **`prefers-reduced-motion`** — disables auto-rotation, transitions, and bounce animations.
- **SPOC pin permissions** — SPOCs can pin items and delete their own pins; admins have full pin control.

**Files changed:**
- `sql/022_featured_banner_and_likes.sql` — new migration
- `js/db.js` — 9 new functions in Phase 12 section
- `css/dashboard.css` — ~250 lines of carousel + like button styles
- `src/pages/index.html` — banner HTML, like buttons in Tasks/Accomplishments/Use Cases, spotlight script block
- `src/pages/admin.html` — Banner Settings nav item + page + pin modal + script block

### 0x. April 16, 2026 — Multi-SPOC Approval per Practice

**Purpose:** Allow multiple SPOCs per practice, where any SPOC in a practice can approve any task for that practice. Show actual SPOC usernames in the "Pending With" column of the employee task status grid.

**Approach:**
- **Schema:** Removed `UNIQUE(practice)` constraint from `practice_spoc` table, replaced with `UNIQUE(practice, spoc_id)` to allow multiple SPOCs per practice while preventing duplicate assignments. Added partial index on `(practice, is_active) WHERE is_active = true`.
- **Views:** Updated `employee_task_approvals`, `pending_approvals`, and `spoc_approval_workload` with a `pending_spoc_names` column that aggregates all active SPOC names for the practice via correlated subquery (`string_agg`).
- **JS (`db.js`):** New `getSpocsForPractice(practice)` returns array of all active SPOCs. `getSpocForPractice()` now delegates to it (returns first). `fetchPendingApprovals()` for SPOC role now matches by `practice` equality rather than `spoc_id` — any SPOC in the practice sees all pending tasks for that practice.
- **UI (`employee-status.html`):** `getPendingWith()` reads `task.pending_spoc_names` from the view when status is `spoc_review`, displaying comma-separated SPOC names. Added `escapeHtml()` helper for XSS safety on user-supplied names.

**Trade-offs:**
- Correlated subquery in views adds minor overhead per row but avoids schema denormalization. Acceptable at current scale.
- The `spoc_id` column on `submission_approvals` still stores one SPOC ID (the first found at submission time) for backward compatibility. Approval matching now uses practice-level logic, so this column is informational only.

**Migration:** `sql/021_multi_spoc_approval.sql`

### 0w. April 16, 2026 — Admin Override: Approve Any Task at Any Stage

**Purpose:** Allow admin to approve tasks even if they are pending with SPOC, bypassing the normal multi-step approval flow.

**Approach:**
- Modified `approveSubmission()` in `js/db.js` to check `userRole === 'admin'` as the first branch in the state machine. When true, `nextStatus` is set directly to `'approved'` regardless of `currentStatus`.
- No changes to `fetchPendingApprovals()` — admin already queries all pending statuses (`pending`, `admin_review`, `spoc_review`).
- No UI changes — the Approve/Reject buttons in `admin.html` already render for every pending approval.
- Metadata fields (`approved_by`, `approved_by_name`, `approved_at`) are populated correctly since the `nextStatus === 'approved'` block handles final approval metadata.

**Trade-offs:**
- Simple role check added to existing state machine — minimal code change, no new DB columns or RLS policies needed.
- BRD/HLD/CODE_ARCHITECTURE unchanged — this is a business-logic-only change within the existing approval module.

### 0v. April 16, 2026 — Team Lead Role

**Purpose:** Allow SPOCs to delegate scoped SPOC-like capabilities to practice contributors by assigning them as "Team Leads" over a subset of members.

**Approach:**
- **Junction table `team_lead_assignments`** maps team_lead user ID → member_email per practice. UNIQUE on `(member_email, practice)` ensures one team lead per contributor per practice.
- **Helper functions** `get_current_user_id()` and `get_team_lead_members()` (SECURITY DEFINER) used by RLS policies to scope team_lead access to their assigned members only.
- **RLS policies** on `tasks`, `accomplishments`, `submission_approvals`, and `copilot_users` extended to allow team_lead read/write for their assigned members.
- **auth.js**: Added `isTeamLead()` check and `team_lead: 'Team Lead'` to `roleLabels`.
- **db.js**: `fetchPendingApprovals` and `fetchApprovalHistory` filter by team lead member emails. New CRUD functions: `fetchTeamLeadMemberEmails()` (cached 2min), `fetchTeamLeadAssignments()`, `assignMemberToTeamLead()`, `removeMemberFromTeamLead()`, `removeAllTeamLeadAssignments()`.
- **index.html**: Sidebar nav updated with `team_lead` data-role, `renderMyPractice()` scopes data to assigned members for team leads, `renderApprovals()` grants team_lead access, Team Lead Management table + assignment modal (SPOC-only), export functions use `_isPracticeScoped(role)` helper.
- **admin.html**: Role dropdowns/filters include `team_lead`, role badge color added, role change cleanup removes `team_lead_assignments`.

**Trade-offs:**
- Team lead sees filtered view of existing SPOC pages rather than a separate dashboard — reduces code duplication.
- Member assignment is per-practice, matching the existing practice-scoped model.
- `get_team_lead_members()` is called per-request in RLS; acceptable for current scale.

### 0u. April 15, 2026 — Community Prompt Library: Submit + Like/Dislike Voting

**Purpose:** Allow any authenticated user to contribute prompts to the shared library, and let the community curate quality via like/dislike voting.

**Approach:**
- **New table `prompt_votes`** (UUID PK, `prompt_id` FK → `prompt_library ON DELETE CASCADE`, `user_id` FK → `auth.users`, `vote_type` CHECK `('like','dislike')`, unique on `(prompt_id, user_id)`).
- **SECURITY DEFINER RPCs** rather than client-side RLS for vote+delete logic:
  - `vote_prompt(prompt_id, vote_type)` — UPSERT pattern. If `vote_type IS NULL`, removes the vote (toggle off). After each vote, checks if `dislike_count ≥ 10` → hard-deletes the prompt (cascades to votes). Returns `{deleted, like_count, dislike_count, user_vote}`.
  - `get_prompt_vote_counts()` — returns aggregated `{prompt_id, like_count, dislike_count}` for all prompts.
  - `add_community_prompt(role, role_label, category, prompt_text)` — inserts with `created_by = auth.uid()`, `sort_order = 999`, `is_active = true`. Returns the new row as JSON.
- **New RLS policies**: `prompt_library_insert_authenticated` (any auth user can insert), `prompt_library_delete_own` (users can delete their own). Existing admin policy covers admin CRUD.
- **UI**: "Submit a Prompt" button in page header → modal with role dropdown, category input (with datalist autocomplete from existing categories), and text area. Cards now show like/dislike pill buttons with counts, author name, and "🔥 Popular" badge for ≥10 likes.
- **Optimistic UI**: Vote buttons update instantly; server result confirms and corrects if needed. Deleted prompts animate out smoothly.

**Key decisions:**
- **Hard-delete at ≥10 dislikes** (user chose this over soft-delete) — keeps DB clean; admins can re-add if needed
- **UPSERT pattern** for votes — simpler than separate insert/update/delete flows
- **RPC-based aggregation** over materialized columns — avoids trigger complexity for a small dataset
- **`fetchPromptLibrary` now JOINs** `users` table to get `authorName` — single query, no N+1
- **Parallel fetch**: prompts, vote counts, and user's own votes loaded concurrently with `Promise.all`
- **Category autocomplete**: existing categories populate a `<datalist>` so users converge on consistent naming

**Files changed:**
- `sql/019_prompt_votes.sql` — new migration (table + RLS + RPCs)
- `js/db.js` — 4 new functions (`addCommunityPrompt`, `votePrompt`, `fetchPromptVoteCounts`, `fetchMyVotes`); updated `fetchPromptLibrary` to return `createdBy`/`authorName`
- `src/pages/index.html` — new "Submit a Prompt" button, new modal `#modal-add-prompt`, rewritten `renderPromptCards` with voting UI, new functions (`handlePromptVote`, `submitCommunityPrompt`, `copyPromptById`, `populateCategoryDatalist`)
- `css/dashboard.css` — voting styles, popular highlight, author text, submit button, modal form styles

### 0t. April 15, 2026 — SPOC IDE Usage Stats Page

**Purpose:** Give SPOCs visibility into their practice team's Grafana Copilot IDE usage without navigating the admin panel.

**Approach:** Display aggregate `copilot_users.ide_*` columns (synced from Grafana exports via `sync_grafana.py`) on a new dedicated page. SPOCs see only their own practice; admins see all practices with a dropdown filter.

**Key decisions:**
- Chose aggregate data (option C) over quarterly partitioning since Grafana data is synced as all-time totals, not per-quarter
- Standalone page pattern (like `employee-status.html`) rather than SPA tab — keeps the page lightweight and focused
- New `fetchGrafanaStats(practice)` function in `db.js` selects only the IDE-related columns to minimize payload
- Sortable columns with sparkline bars for visual comparison of interactions
- CSV export built-in for SPOCs who need to report to practice heads

**Files changed:** `js/db.js` (new function + export), `src/pages/grafana-stats.html` (new), `src/pages/index.html` (nav link)

### 0s. April 15, 2026 — Dedup Post-Sync + Data-Sync Skill

**Purpose:** Clean up duplicate records created when tracker_sync data overlapped with existing web-sourced records. Establish a reusable weekly sync skill.

**Duplicate audit results (before cleanup):**

| Table | Dupe Groups | Extra Rows | Pattern |
|---|---|---|---|
| tasks | 29 | 37 | web + tracker_sync overlap (some web-web triples) |
| projects | 20 | 21 | old (no sync_hash) + tracker_sync (has sync_hash) |
| copilot_users | 0 | 0 | Clean (email unique constraint) |
| accomplishments | 0 | 0 | Clean |
| submission_approvals | 1 pair + 4 orphans | 5 | Dupe pair + orphaned test record |
| activity_log | 10 | 26 | Genuine repeated user actions (different timestamps) — kept |

**Cleanup actions (migration `018_dedup_post_sync.sql`):**
1. Tasks: Deleted 37 web-sourced records where tracker_sync version existed for same (practice, employee_name, week_number, task_description). Kept tracker_sync (complete, has sync_hash).
2. Projects: Deleted 21 records without sync_hash where record with sync_hash existed for same (practice, project_name, project_code).
3. Submission approvals: Deleted 3 (1 dupe admin_review keeping approved, 1 test record, 1 truly orphaned approval). Fixed 1 approval linkage (task ac5c7ed2 → approval 03944f90).
4. Activity log: Kept as-is — 26 entries are genuine repeated user actions at different timestamps.

**Post-cleanup table counts:**
| Table | Before | After | Removed |
|---|---|---|---|
| tasks | 94 | 57 | 37 |
| projects | 49 | 28 | 21 |
| copilot_users | 171 | 171 | 0 |
| accomplishments | 9 | 9 | 0 |
| submission_approvals | 13 | 10 | 3 |
| activity_log | 87 | 87 | 0 |

**Data-sync skill created:** `.github/skills/data-sync/SKILL.md` — documents the full weekly sync procedure (file placement, script execution, MCP SQL order, verification queries, dedup patterns). Designed for weekly reuse with the same set of refreshed files.

### 0r. April 14, 2026 — Data Sync Phase: Tracker Sheet + Grafana IDE Usage

**Purpose:** Establish a recurring (weekly/bi-weekly) data sync process to keep the database current with the master tracker spreadsheet and Grafana IDE usage telemetry.

**Two sync streams:**

**1. Tracker Sheet Sync** (`scripts/sync_tracker.py`)
- Reads the EAS AI Adoption Weekly Tracker Excel (multi-sheet workbook)
- Extracts 4 entity types: copilot_users (from "Copliot User Access"), tasks (from practice sheets: BFSI/CES/ERP/EPS/EPCS/GRC), projects (from "Projects"), accomplishments (from "AI Accomplishments")
- Generates SQL INSERT...ON CONFLICT for upsert behavior (never deletes existing data)
- Uses MD5 sync_hash for task/project/accomplishment dedup (practice+employee+week+task)
- Uses email uniqueness for copilot_users dedup
- CLI: `python scripts/sync_tracker.py <tracker.xlsx> --out scripts/sync_output`

**2. Grafana IDE Usage Sync** (`scripts/sync_grafana.py`)
- Reads Grafana Copilot IDE usage exports (daily per-user metrics: interactions, code gen, acceptances, agent/chat usage, LOC stats)
- Filters to EAS employees by matching `user_login` to copilot_users via generated `username` column (email prefix)
- Aggregates daily data per user → updates `copilot_users` IDE columns
- CLI: `python scripts/sync_grafana.py <feb.xlsx> <mar.xlsx> --emails eas_emails.txt`

**Schema changes** (migration `017_data_sync_phase.sql`):
- 12 new columns on `copilot_users`: `ide_days_active`, `ide_total_interactions`, `ide_code_generations`, `ide_code_acceptances`, `ide_agent_days`, `ide_chat_days`, `ide_loc_suggested`, `ide_loc_added`, `ide_last_active_date`, `ide_data_period`, `ide_data_updated_at`, `username` (generated from email)
- `sync_source`, `last_synced_at` on `copilot_users`
- `sync_hash` on tasks, accomplishments, projects
- Unique partial indexes on `sync_hash` columns
- Unique constraint on `copilot_users.email`
- Extended `source` CHECK constraints to allow `'tracker_sync'`

**First sync results:**

| Entity | Records Synced | Notes |
|--------|---------------|-------|
| Copilot Users | 168 (from 173 rows, 5 dupes) | Upserted by email |
| Tasks | 44 (from 53 rows, 9 dupes) | Upserted by sync_hash |
| Projects | 25 | New projects by practice |
| Accomplishments | 4 | New accomplishments |
| Grafana IDE data | 25 users | Feb+Mar 2026, avg 7 active days |

**Key design decisions:**
- Scripts generate SQL files (not direct DB connections) for MCP execution → auditable, repeatable
- ON CONFLICT upserts ensure idempotent re-runs — same Excel can be synced multiple times safely
- Grafana user_login matching via generated `username` column avoids manual mapping
- Tracker-synced records get `source = 'tracker_sync'` and `approval_status = 'approved'` (pre-approved by SPOCs in the tracker)

**Known issue (minor):** The ERP practice sheet may have columns in a different order than other practice sheets, causing 5 ERP tasks to have swapped ai_tool/prompt_used values during the first sync (manually corrected). Future fix: add column-order detection per sheet.

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

## 2026-04-20 — Practice-Scoped Views for SPOC and Team Lead

**Change:** Tasks, Licensed AI Users, and Projects views in `index.html` now automatically filter to the user's own practice (SPOC) or assigned team members (team_lead). Practice filter dropdowns are locked (disabled) for both roles.

**Approach:** Filter at render time. `_tlMemberEmails` (module-level array) is pre-fetched at init via `EAS_DB.fetchTeamLeadMemberEmails()` for team_lead users, so all three render functions stay synchronous. SPOC uses `EAS_Auth.getUserPractice()` directly.

**Why not filter at data load:** Destructive — would lose cross-practice data from `data` object, breaking admin views and quarter-change refreshes.

**Scope:** `src/pages/index.html` only. DB RLS write restrictions for SPOCs were already in place (no change needed there).

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

---

## April 19, 2026 — 11-Bug Fix from Manual Test Run (BUG-01 – BUG-11)

### BUG-01: Modal forms not reset on cancel/reopen — `src/pages/index.html`
Root cause: form field resets only ran after a successful save. Cancel left all fields dirty.
Fix: Added explicit field resets at the top of each modal's `openModal` branch (`type === 'task'`, `'accomplishment'`, `'project'`) so every fresh open starts clean regardless of prior cancel or save.

### BUG-02: `contract_value` persists as 0 instead of null — `src/pages/index.html`
Root cause: `parseFloat('') || 0` evaluated blank numeric input to 0.
Fix: Changed `|| 0` to `|| null` in `saveProject`.

### BUG-03: `quality_rating` JS validation missing — `src/pages/index.html`
Root cause: HTML `max="5"` only hints, it doesn't prevent paste or programmatic values. No JS guard existed.
Fix: Added a pre-save check in `saveTask` — if quality is entered and outside [1,5], show error and abort.

### BUG-04: Employee dropdown hidden after practice change — `js/phase8-submission.js`
Root cause 1: Practice-change handler loaded users into `allUsers` and called `renderDropdownOptions` but never called `showDropdown`, so the div stayed `display:none` until the user manually focused the search field.
Root cause 2: `initEmployeeDropdown` was called on every `openModal`, accumulating redundant `addEventListener` registrations on both the practice select and search input.
Fix: Added `if (practice) showDropdown()` after `loadUsers` in the practice-change handler. Added `data-attribute` guards (`empDropdownListenerAttached`, `empSearchListenerAttached`) to prevent duplicate listener registration.

### BUG-05: Orphaned `submission_approvals` rows after auto-approve-on-edit — `js/db.js`
Root cause: `updateTask`/`updateAccomplishment` attempted to DELETE the old approval row, but if RLS blocked that operation the error was silently ignored and the row remained in `spoc_review` state.
Fix: Wrapped the DELETE in an error check; on failure, falls back to UPDATE with `approval_status='superseded'` so the row leaves the review queue even without delete rights.

### BUG-06: `approval_status` copy drift — `js/db.js`
Root cause: `submitTaskWithApproval` and `submitAccomplishmentWithApproval` only wrote `approval_id` to the submission row when linking a new approval record; `approval_status` in `tasks`/`accomplishments` was never synced to `spoc_review` or `admin_review`.
Fix: Extended the update payload to include `approval_status: approval.approval_status` when linking.

### BUG-07: Misleading toast on bypass-approval — `js/phase8-submission.js`
Root cause: The bypass path routes through `EAS_DB.insertTask` (not `submitTaskWithApproval`), which returns the raw task row with no `approval` object. `approval?.autoApproved` was falsy so the message defaulted to "SPOC review".
Fix: Added `formData.bypassApproval` check first in the approval message branch.

### BUG-08 & BUG-09: Multiple toasts per save action — `src/pages/index.html`
Root cause: Both `saveTask` and `saveAccomplishment` fired an intermediate "Saving…" toast AND `Phase8.submitWithApproval` emitted its own success toast. The accomplishment handler also had a third trailing toast after `Phase8`.
Fix: Removed the intermediate `showToast('Saving…')` calls. For accomplishments, the trailing toast is now conditional on `isEdit` only.

### BUG-10: Missing `spoc_reviewed_*` audit fields on SPOC reject — `js/db.js`
Root cause: `rejectSubmission` built a fixed payload with only rejection reason and `admin_reviewed_at`. It never checked the current approval stage or stamped SPOC-layer fields.
Fix: Added a SELECT to fetch the current `approval_status` before updating. When status is `spoc_review`, payload is extended with `spoc_reviewed_by`, `spoc_reviewed_by_name`, and `spoc_reviewed_at`.

### BUG-11: Admin sidebar missing practice label — `src/pages/index.html` + `js/auth.js`
Root cause: `auth.js::updateUserDisplay` referenced `#user-display-practice` which was absent from the sidebar HTML; the element was apparently removed at some earlier point. Without it, `practiceEl` was always null and `getUserPractice()` was never rendered for any role.
Fix: Added `<div id="user-display-practice">` to the `.user-info` section of the sidebar footer. `auth.js` already populates it correctly for all roles including admin.
