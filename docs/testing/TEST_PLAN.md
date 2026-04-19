# EAS AI Adoption Tracker — Manual Test Plan

**Version:** 1.0  
**Date:** 2026-04-19  
**Scope:** All core user flows + regression cases for bugs fixed 2026-04-19  
**Environment:** GitHub Pages (production) or local dev server  
**Format:** Feature-based — one section per feature area, all roles covered within each section

---

## Test Case Format

```
ID            : TC-[AREA]-[NN]
Title         : Short description
Pre-condition : Setup / role required before starting
Steps         : Numbered browser actions
Expected      : What you should see / verify
Pass/Fail     : [ ]
Notes         : Test data, edge cases, shortcuts
```

---

## Test Accounts Required

| Role | Email | Notes |
|---|---|---|
| Admin | eas-admin@ejada.com | Full access, bypass-approval available |
| SPOC | spoc-bfsi@ejada.com | BFSI practice SPOC |
| Contributor | test-contributor@ejada.com | BFSI practice, no admin rights |
| New user | use a fresh email each run | For signup tests |

> Use Supabase Dashboard → Authentication to verify DB state after each test.

---

## Section 1 — Authentication

---

### TC-AUTH-01 | Login with valid credentials

**Pre-condition:** Valid account exists in both `auth.users` and `public.users`

**Steps:**
1. Open `login.html`
2. Enter a valid email and correct password
3. Click **Sign In**

**Expected:**
- Spinner appears on button while loading
- Redirected to `index.html`
- Sidebar shows correct name, role, and practice
- `localStorage.eas_user_profile` is set with `id`, `name`, `email`, `role`, `practice`, `is_active`
- `localStorage.eas_user_profile_ts` is set (non-empty timestamp)

**Pass/Fail:** [ ]

**Notes:** Open DevTools → Application → Local Storage to verify cache entries.

---

### TC-AUTH-02 | Login with wrong password

**Pre-condition:** Valid email exists in system

**Steps:**
1. Open `login.html`
2. Enter a valid email and an incorrect password
3. Click **Sign In**

**Expected:**
- Red error banner: "Invalid email or password. Please try again."
- Button re-enabled
- Not redirected

**Pass/Fail:** [ ]

---

### TC-AUTH-03 | Login with unregistered email

**Pre-condition:** None

**Steps:**
1. Open `login.html`
2. Enter an email that does not exist in the system
3. Enter any password
4. Click **Sign In**

**Expected:**
- Red error banner appears (invalid credentials message)
- Not redirected

**Pass/Fail:** [ ]

---

### TC-AUTH-04 | Login — auth account exists but no profile row

**Pre-condition:** A Supabase auth account exists with no matching row in `public.users` and no `user_metadata` (simulates pre-signup-RPC accounts with no recovery data)

**Steps:**
1. Open `login.html`
2. Enter credentials for the orphaned account
3. Click **Sign In**

**Expected:**
- Error message shown: "Your account was created but your profile needs to be completed…" with the user's email
- User is signed out automatically
- Not redirected to dashboard

**Pass/Fail:** [ ]

**Notes:** Create a test auth account directly in Supabase Dashboard → Authentication → Users, without going through the signup page.

---

### TC-AUTH-05 | Signup — full happy path (auto-confirm)

**Pre-condition:** Supabase email confirmation is disabled (auto-confirm on). Use a fresh email.

**Steps:**
1. Open `signup.html`
2. Select department **EAS** → practice **BFSI**
3. Enter name, email, skill/title
4. Select **Yes** for Copilot access
5. Click **Continue**
6. Enter a password (≥ 8 chars, mixed case + number)
7. Confirm password
8. Click **Create Account**

**Expected:**
- Success screen shown: "Welcome aboard!"
- Clicking **Go to Dashboard** redirects to `index.html`
- `public.users` row created with `role = 'contributor'`, `practice = 'BFSI'`
- `public.copilot_users` row created with `status = 'access granted'`
- `localStorage.eas_user_profile` contains `email`, `role = 'contributor'`

**Pass/Fail:** [ ]

---

### TC-AUTH-06 | Signup — duplicate email

**Pre-condition:** The email is already registered

**Steps:**
1. Open `signup.html`
2. Complete Step 1 with an already-registered email
3. Set a password and click **Create Account**

**Expected:**
- Error message: "This email is already registered. Please sign in instead."
- Stays on signup page

**Pass/Fail:** [ ]

---

### TC-AUTH-07 | Signup — password validation failures

**Pre-condition:** None

**Steps (run each independently):**
1. Enter a password shorter than 8 characters → click **Create Account**
2. Enter two different passwords in the password / confirm fields → click **Create Account**

**Expected (step 1):** Error "Password must be at least 8 characters."
**Expected (step 2):** Error "Passwords do not match."
**Button never disabled for more than 1 second (no spinner freeze)**

**Pass/Fail:** [ ]

---

### TC-AUTH-08 | Change password

**Pre-condition:** Logged in as any user. Know the current password.

**Steps (happy path):**
1. Open sidebar → Settings → Change Password
2. Enter correct current password
3. Enter a new password (≥ 6 chars, different from current)
4. Confirm new password
5. Click **Change Password**

**Expected:** Success message shown. Modal closes after ~2 seconds.

**Steps (wrong current password):**
1. Repeat above with an incorrect current password

**Expected:** Error "Current password is incorrect." Button re-enabled.

**Pass/Fail:** [ ]

---

## Section 2 — Projects

---

### TC-PROJ-01 | SPOC adds a new project (all fields)

**Pre-condition:** Logged in as SPOC

**Steps:**
1. Navigate to **Projects** page
2. Click **Add Project**
3. Fill in all fields: name, practice, code, customer, PM, start date, end date, contract value, revenue type
4. Click **Save Project**

**Expected:**
- Modal closes only after save succeeds
- New project appears in the projects table
- Toast: "Project added!"
- Row visible in Supabase `projects` table

**Pass/Fail:** [ ]

---

### TC-PROJ-02 | SPOC adds a project with only required fields

**Pre-condition:** Logged in as SPOC

**Steps:**
1. Click **Add Project**
2. Fill in only **Name** and **Practice** (leave all others blank)
3. Click **Save Project**

**Expected:**
- Project saves successfully
- Optional fields stored as `null` in DB, not empty string
- Toast: "Project added!"

**Pass/Fail:** [ ]

---

### TC-PROJ-03 | Add project — save fails — modal must stay open (regression TC-REG-04)

**Pre-condition:** Logged in as SPOC. Open DevTools → Network tab.

**Steps:**
1. Click **Add Project**
2. Fill in name and practice
3. In Network tab, block requests to `supabase.co` (DevTools → Network → right-click a request → Block request domain)
4. Click **Save Project**

**Expected:**
- Modal **remains open** with form data intact
- Toast: "Failed to save project — check console"
- Unblocking the domain and clicking Save again succeeds

**Pass/Fail:** [ ]

**Notes:** Alternatively, temporarily break the Supabase anon key in config.js and restore after.

---

### TC-PROJ-04 | SPOC edits an existing project

**Pre-condition:** Logged in as SPOC. At least one project exists.

**Steps:**
1. Navigate to **Projects** page
2. Click **Edit** on an existing project
3. Change the project name and contract value
4. Click **Save Project**

**Expected:**
- Modal closes after save
- Updated values appear in the table immediately
- Toast: "Project updated!"
- DB row reflects new values

**Pass/Fail:** [ ]

---

### TC-PROJ-05 | Edit project — save fails — modal must stay open (regression TC-REG-05 mirror)

**Pre-condition:** Logged in as SPOC. At least one project exists.

**Steps:**
1. Click **Edit** on a project
2. Change the name
3. Block Supabase network requests (same as TC-PROJ-03)
4. Click **Save Project**

**Expected:**
- Modal **remains open** with edited data intact
- Error toast shown

**Pass/Fail:** [ ]

---

### TC-PROJ-06 | Admin deletes a project

**Pre-condition:** Logged in as Admin. A project with no linked tasks exists (safe to delete).

**Steps:**
1. Navigate to **Projects**
2. Click **Delete** on the target project
3. Confirm in the confirmation dialog

**Expected:**
- Project removed from table
- Toast: "Project deleted"
- Row gone from Supabase `projects` table

**Pass/Fail:** [ ]

---

## Section 3 — Task Submission

---

### TC-TASK-01 | Submit task with < 5h saved (auto-approve)

**Pre-condition:** Logged in as SPOC or Admin.

**Steps:**
1. Open **Log Task** modal
2. Fill all required fields
3. Set **Time without AI = 3h**, **Time with AI = 1h** (2h saved)
4. Click **Save Task**

**Expected:**
- Exactly **one** toast: "Task submitted — Auto-approved (2.0 hrs saved)"
- In Supabase `tasks`, row has `approval_status = 'approved'`
- No row created in `submission_approvals`

**Pass/Fail:** [ ]

---

### TC-TASK-02 | Submit task with 5–10h saved (SPOC review)

**Pre-condition:** Logged in as SPOC.

**Steps:**
1. Open **Log Task** modal
2. Set **Time without AI = 12h**, **Time with AI = 5h** (7h saved)
3. Fill all required fields
4. Click **Save Task**

**Expected:**
- Toast: "Task submitted — SPOC review (7.0 hrs saved)"
- `tasks.approval_status = 'pending'`
- `submission_approvals` row created with `approval_status = 'spoc_review'`

**Pass/Fail:** [ ]

---

### TC-TASK-03 | Submit task with > 10h saved (SPOC → Admin review)

**Pre-condition:** Logged in as SPOC.

**Steps:**
1. Open **Log Task** modal
2. Set **Time without AI = 20h**, **Time with AI = 5h** (15h saved)
3. Fill all required fields
4. Click **Save Task**

**Expected:**
- Toast: "Task submitted — SPOC → Admin review (15.0 hrs saved)"
- `submission_approvals` row created with `approval_status = 'spoc_review'` and `admin_id` pre-filled

**Pass/Fail:** [ ]

---

### TC-TASK-04 | Submit task — missing required fields

**Pre-condition:** Logged in as SPOC. Log Task modal open.

**Steps (run each independently):**
1. Leave Practice blank → click Save Task
2. Leave Employee blank → click Save Task
3. Leave Task Description blank → click Save Task
4. Leave Time Without AI at 0 → click Save Task

**Expected:** Each case shows a specific error toast and does not submit.

**Pass/Fail:** [ ]

---

### TC-TASK-05 | Submit task — time with AI ≥ time without AI

**Pre-condition:** Log Task modal open.

**Steps:**
1. Set Time without AI = 5, Time with AI = 5
2. Click Save Task

**Expected:** Error toast: "Time with AI must be less than time without AI — time saved must be positive"

**Steps:**
1. Set Time without AI = 3, Time with AI = 6
2. Click Save Task

**Expected:** Same error toast.

**Pass/Fail:** [ ]

---

### TC-TASK-06 | Admin submits task with bypass-approval

**Pre-condition:** Logged in as Admin.

**Steps:**
1. Open **Log Task** modal
2. Fill all required fields with any hours
3. Check **Bypass Approval**
4. Click **Save Task**

**Expected:**
- Task saved directly via `insertTask` (no approval record)
- `tasks.approval_status` remains at its default
- No row in `submission_approvals`

**Pass/Fail:** [ ]

---

### TC-TASK-07 | New task submission shows exactly one toast (regression)

**Pre-condition:** Logged in as SPOC. Watch for toast notifications carefully.

**Steps:**
1. Open **Log Task** modal
2. Fill all required fields
3. Click **Save Task**
4. Count how many toast notifications appear

**Expected:**
- Exactly **one** toast notification (from `Phase8.submitWithApproval`)
- No second "Task logged successfully…" toast from `saveTask`

**Pass/Fail:** [ ]

---

## Section 4 — Task Edit

---

### TC-EDIT-01 | Edit task with < 5h saved → auto-approved (regression)

**Pre-condition:** Logged in as SPOC. An existing task is in `approved` or `pending` state.

**Steps:**
1. Click **Edit** on any task
2. Set Time without AI = 3, Time with AI = 1 (2h saved)
3. Click **Update Task**

**Expected:**
- Modal closes after save
- Toast: "Task updated — pending re-approval by Admin/SPOC"
- In Supabase `tasks`: `approval_status = 'approved'`, `approval_id = null`
- No new row in `submission_approvals`

**Pass/Fail:** [ ]

**Notes:** This is the primary regression test for the auto-approve bug. Verify DB directly.

---

### TC-EDIT-02 | Edit task with 5–10h saved → SPOC review

**Pre-condition:** Logged in as SPOC. An existing task exists.

**Steps:**
1. Click **Edit** on any task
2. Set Time without AI = 12, Time with AI = 5 (7h saved)
3. Click **Update Task**

**Expected:**
- `tasks.approval_status = 'pending'`
- Old `submission_approvals` record deleted
- New `submission_approvals` row created with `approval_status = 'spoc_review'`
- `tasks.approval_id` updated to new approval record ID

**Pass/Fail:** [ ]

---

### TC-EDIT-03 | Edit task with > 10h saved → SPOC → Admin review

**Pre-condition:** Logged in as SPOC. An existing task exists.

**Steps:**
1. Click **Edit** on a task
2. Set Time without AI = 20, Time with AI = 5 (15h saved)
3. Click **Update Task**

**Expected:**
- New `submission_approvals` row with `approval_status = 'spoc_review'` and `admin_id` populated
- `tasks.approval_status = 'pending'`

**Pass/Fail:** [ ]

---

### TC-EDIT-04 | Edit task — save fails — modal stays open with data intact

**Pre-condition:** Logged in as SPOC. An existing task exists. DevTools open.

**Steps:**
1. Click **Edit** on a task — note the current field values
2. Change the task description
3. Block Supabase network requests
4. Click **Update Task**

**Expected:**
- Modal **remains open**
- Error toast shown
- Form fields still contain the edited values (not reverted, not cleared)

**Pass/Fail:** [ ]

---

### TC-EDIT-05 | Admin edits task — approval status unchanged

**Pre-condition:** Logged in as Admin. An existing task with `approval_status = 'approved'` exists.

**Steps:**
1. Click **Edit** on the task
2. Change any field (e.g., notes)
3. Click **Update Task**

**Expected:**
- `tasks.approval_status` remains `'approved'` (not reset to `'pending'`)
- No new `submission_approvals` record created
- Existing `approval_id` unchanged

**Pass/Fail:** [ ]

---

## Section 5 — Accomplishment Submission

---

### TC-ACC-01 | Submit accomplishment — always routes to full review (never auto-approves)

**Pre-condition:** Logged in as SPOC.

**Steps:**
1. Open **Log Accomplishment** modal
2. Fill all required fields
3. Set **Effort Saved = 1** (below the 5h task auto-approve threshold)
4. Click **Save**

**Expected:**
- `submission_approvals` row created with `approval_status = 'spoc_review'`
- `accomplishments.approval_status = 'pending'`
- No auto-approve even though effort saved < 5h

**Pass/Fail:** [ ]

**Notes:** Accomplishments always require SPOC → Admin review regardless of hours.

---

### TC-ACC-02 | Submit accomplishment — missing required fields

**Pre-condition:** Log Accomplishment modal open.

**Steps:**
1. Leave Practice blank → click Save
2. Leave Title blank → click Save

**Expected:** Each case shows a specific error toast without submitting.

**Pass/Fail:** [ ]

---

### TC-ACC-03 | Admin submits accomplishment with bypass-approval

**Pre-condition:** Logged in as Admin.

**Steps:**
1. Open **Log Accomplishment** modal
2. Fill all required fields
3. Check **Bypass Approval**
4. Click **Save**

**Expected:**
- Accomplishment saved directly via `insertAccomplishment`
- No row created in `submission_approvals`

**Pass/Fail:** [ ]

---

### TC-ACC-04 | Edit accomplishment — approval reset to pending

**Pre-condition:** Logged in as SPOC. An approved accomplishment exists.

**Steps:**
1. Click **Edit** on an approved accomplishment
2. Change the title
3. Click **Update**

**Expected:**
- `accomplishments.approval_status = 'pending'`
- Old `submission_approvals` record deleted
- New `submission_approvals` record created with `approval_status = 'spoc_review'`

**Pass/Fail:** [ ]

---

### TC-ACC-05 | Edit accomplishment — save fails — modal stays open

**Pre-condition:** Logged in as SPOC. An existing accomplishment. DevTools open.

**Steps:**
1. Click **Edit** on an accomplishment — note field values
2. Change the title
3. Block Supabase network requests
4. Click **Update**

**Expected:**
- Modal **remains open** with edited data intact
- Error toast shown

**Pass/Fail:** [ ]

---

## Section 6 — Approval Workflow

---

### TC-APPR-01 | SPOC approves spoc_review task with ≤ 10h → approved

**Pre-condition:** Logged in as SPOC. A task exists in `spoc_review` with saved hours ≤ 10.

**Steps:**
1. Navigate to **Approvals**
2. Click the pending task → **View Details**
3. Add optional approval notes
4. Click **Approve**

**Expected:**
- Toast: "Submission fully approved!"
- `submission_approvals.approval_status = 'approved'`
- `tasks.approval_status = 'approved'`
- `submission_approvals.spoc_reviewed_by` = SPOC's user ID
- `submission_approvals.spoc_reviewed_at` populated

**Pass/Fail:** [ ]

---

### TC-APPR-02 | SPOC approves spoc_review task with > 10h → advances to admin_review

**Pre-condition:** Logged in as SPOC. A task in `spoc_review` with saved hours > 10.

**Steps:**
1. Navigate to **Approvals**
2. Open the high-hours pending task → **View Details**
3. Click **Approve**

**Expected:**
- Toast: "SPOC approved — forwarded to Admin for final review (≥15h saved)"
- `submission_approvals.approval_status = 'admin_review'`
- `tasks.approval_status = 'pending'` (not yet fully approved)
- Task disappears from SPOC's approvals list
- Task now visible in Admin's approvals list

**Pass/Fail:** [ ]

---

### TC-APPR-03 | SPOC approves spoc_review accomplishment → always advances to admin_review

**Pre-condition:** Logged in as SPOC. An accomplishment in `spoc_review` with effort saved < 5h.

**Steps:**
1. Navigate to **Approvals**
2. Open the accomplishment → **View Details**
3. Click **Approve**

**Expected:**
- `submission_approvals.approval_status = 'admin_review'` (never skips to approved)
- `accomplishments.approval_status = 'pending'`

**Pass/Fail:** [ ]

---

### TC-APPR-04 | Admin approves admin_review task → fully approved

**Pre-condition:** Logged in as Admin. A task in `admin_review`.

**Steps:**
1. Navigate to **Approvals**
2. Open the admin_review task → **View Details**
3. Add approval notes
4. Click **Approve**

**Expected:**
- Toast: "Submission fully approved!"
- `submission_approvals.approval_status = 'approved'`
- `tasks.approval_status = 'approved'`
- `submission_approvals.approved_by_name` = Admin's name
- `submission_approvals.approved_at` populated

**Pass/Fail:** [ ]

---

### TC-APPR-05 | Admin approves at any stage → immediate approval

**Pre-condition:** Logged in as Admin. A task still in `spoc_review`.

**Steps:**
1. Navigate to **Approvals** (Admin sees all statuses)
2. Open a `spoc_review` task → **View Details**
3. Click **Approve**

**Expected:**
- Status jumps directly to `approved` (bypasses admin_review state)
- Toast: "Submission fully approved!"

**Pass/Fail:** [ ]

---

### TC-APPR-06 | SPOC rejects a task — rejection_reason saved correctly (regression)

**Pre-condition:** Logged in as SPOC. A task in `spoc_review`.

**Steps:**
1. Navigate to **Approvals**
2. Open a pending task → **View Details**
3. Enter rejection reason: "Insufficient evidence of AI usage"
4. Click **Reject**

**Expected:**
- Toast: "Submission rejected"
- `submission_approvals.approval_status = 'rejected'`
- `submission_approvals.rejection_reason = 'Insufficient evidence of AI usage'` (verify in Supabase)
- `tasks.approval_status = 'rejected'`

**Pass/Fail:** [ ]

**Notes:** This directly verifies the `rejection_reason` column fix (TC-REG-02).

---

### TC-APPR-07 | Admin rejects a task

**Pre-condition:** Logged in as Admin. A task in `admin_review`.

**Steps:**
1. Navigate to **Approvals**
2. Open an `admin_review` task → **View Details**
3. Enter rejection reason: "Hours claimed are not realistic"
4. Click **Reject**

**Expected:**
- `submission_approvals.rejection_reason = 'Hours claimed are not realistic'`
- `submission_approvals.approval_status = 'rejected'`
- `tasks.approval_status = 'rejected'`

**Pass/Fail:** [ ]

---

### TC-APPR-08 | Reject without providing a reason — blocked

**Pre-condition:** Logged in as SPOC or Admin. A pending approval exists.

**Steps:**
1. Open an approval → **View Details**
2. Leave the notes/reason field empty
3. Click **Reject**

**Expected:**
- Action blocked
- Toast: "Please provide a reason for rejection"
- Approval status unchanged

**Pass/Fail:** [ ]

---

## Section 7 — Regression Cases (Bugs Fixed 2026-04-19)

---

### TC-REG-01 | updateTask auto-approve — approval_status must become 'approved'

**Bug fixed:** `updateTask` edit path never set `approval_status = 'approved'` for tasks with < 5h saved.

**Pre-condition:** Logged in as SPOC (non-admin). Any existing task.

**Steps:**
1. Edit any task — set Time without AI = 4, Time with AI = 2 (2h saved)
2. Click **Update Task**
3. Open Supabase → `tasks` table → find the row

**Expected:**
- `tasks.approval_status = 'approved'`
- `tasks.approval_id = null`
- No new row in `submission_approvals`

**Fail condition:** `approval_status` remains `'pending'` — regression present.

**Pass/Fail:** [ ]

---

### TC-REG-02 | rejection_reason column populated on reject

**Bug fixed:** `updateSubmissionApproval` wrote to `rejected_reason` (wrong column) instead of `rejection_reason`.

**Pre-condition:** Logged in as SPOC. A task in `spoc_review`.

**Steps:**
1. Approve a task, then submit a new one to reject
2. Navigate to Approvals → open the task → enter reason "Test rejection reason" → click Reject
3. Open Supabase → `submission_approvals` → find the row

**Expected:**
- `rejection_reason = 'Test rejection reason'` (not null)

**Fail condition:** `rejection_reason` is null — regression present.

**Pass/Fail:** [ ]

---

### TC-REG-03 | Login stores full profile with cache timestamp

**Bug fixed:** `login.html` fetched only `id, name, role, practice` and never wrote `eas_user_profile_ts`.

**Pre-condition:** Clear all `eas_*` localStorage keys before test. Open DevTools → Application → Local Storage.

**Steps:**
1. Open `login.html`
2. Log in with valid credentials
3. Immediately after redirect to `index.html`, check localStorage

**Expected:**
- `eas_user_profile` contains `email`, `is_active`, `role`, `practice`, `name`, `id`
- `eas_user_profile_ts` is set to a recent Unix timestamp (within last 10 seconds)

**Fail condition:** `eas_user_profile_ts` is missing or `email` is absent — regression present.

**Pass/Fail:** [ ]

---

### TC-REG-04 | saveProject — modal stays open on save failure

**Bug fixed:** `closeModal('project')` was called before the async save, losing form data on failure.

**Pre-condition:** Logged in as SPOC. DevTools open.

**Steps:**
1. Click **Add Project** — fill in name and practice
2. Block Supabase requests (Network tab → block domain)
3. Click **Save Project**

**Expected:**
- Modal **remains open** with the entered name still in the form
- Error toast shown

**Fail condition:** Modal closes before the save result is known — regression present.

**Pass/Fail:** [ ]

---

### TC-REG-05 | saveTask edit — modal stays open on save failure

**Bug fixed:** `closeModal('task')` was called before `await EAS_DB.updateTask`, losing form data on failure.

**Pre-condition:** Logged in as SPOC. An existing task. DevTools open.

**Steps:**
1. Click **Edit** on any task — change the description
2. Block Supabase network requests
3. Click **Update Task**

**Expected:**
- Modal **remains open** with the edited description still visible
- Error toast shown

**Fail condition:** Modal closes and form is cleared before save result is known — regression present.

**Pass/Fail:** [ ]

---

### TC-REG-06 | New task submission shows exactly one toast

**Bug fixed:** `Phase8.submitWithApproval` and `saveTask` both called `showToast` on new submissions.

**Pre-condition:** Logged in as SPOC. Watch the bottom of the screen carefully.

**Steps:**
1. Open **Log Task** modal
2. Fill all required fields — use 7h saved (SPOC review path)
3. Click **Save Task**
4. Count toast notifications that appear

**Expected:**
- Exactly **one** toast appears: "Task submitted — SPOC review (X.X hrs saved)"
- No second toast (e.g., "Task logged successfully…") appears

**Fail condition:** Two toast notifications appear in sequence — regression present.

**Pass/Fail:** [ ]

---

## Summary

| Section | Cases | Key Coverage |
|---|---|---|
| 1. Authentication | 8 | Login, signup, session, change password |
| 2. Projects | 6 | Add, edit, delete, failure handling |
| 3. Task Submission | 7 | All approval routing paths, validation |
| 4. Task Edit | 5 | Re-approval trigger, auto-approve on edit |
| 5. Accomplishments | 5 | Submit, edit, bypass, failure handling |
| 6. Approval Workflow | 8 | State machine, SPOC/Admin approve/reject |
| 7. Regression | 6 | All 6 bugs fixed 2026-04-19 |
| **Total** | **45** | |

---

*Last updated: 2026-04-19 — EAS AI Adoption Tracker v1.0 test plan*
