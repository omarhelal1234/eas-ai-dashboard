# Implementation Plan

# EAS AI Adoption Dashboard

> **Version:** 2.3 | **Last Updated:** April 11, 2026

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Mar 20, 2026 | Omar Ibrahim | Initial plan with 6 phases |
| 1.1 | Apr 5, 2026 | Omar Ibrahim | Phase 1 completed — DB migration |
| 1.2 | Apr 10, 2026 | Omar Ibrahim | Phase 2 completed — Auth & Quarters; code review & refactoring done |
| 1.3 | Apr 11, 2026 | Omar Ibrahim | Contributor self-signup feature added (signup.html + signup_contributor RPC) |
| 1.4 | Apr 12, 2026 | Omar Ibrahim | Phase 3 completed — live Supabase data, CSS extraction, pagination, sanitization |
| 1.5 | Apr 12, 2026 | Omar Ibrahim | Phase 4 completed — CRUD writes, edit/delete UI, audit logging, data dumps |
| 1.6 | Apr 12, 2026 | Omar Ibrahim | Phase 5 completed — SPOC panel, leaderboard, badges, nudge, use case library |
| 1.7 | Apr 12, 2026 | Omar Ibrahim | Phase 6 completed — accessibility, dark/light mode, forecasting, PDF reports |
| 2.0 | Apr 10, 2026 | Omar Ibrahim | All 6 phases complete — final plan consolidation |
| 2.1 | Apr 10, 2026 | Omar Ibrahim | Post-launch: contributor data visibility fix, page quarter selectors, auto week number |
| 2.2 | Apr 11, 2026 | Omar Ibrahim | Phase 7 — Export Center: Excel/PDF/PPT with role-based access and per-page export |
| 2.3 | Apr 11, 2026 | Omar Ibrahim | Phase 8 Complete — AI-Assisted Approval Workflow: AI suggestions, validation, multi-layer routing |

---

## Phase Overview

| Phase | Name | Status | Commit | Key Deliverables |
|-------|------|--------|--------|-----------------|
| 1 | Database Migration | ✅ Complete | `—` | Supabase schema, data, views, RLS |
| 2 | Auth & Quarter System | ✅ Complete | `—` | Login, roles, quarter filtering, signup |
| 3 | Live Data & CSS Extraction | ✅ Complete | `e647bab` | Supabase reads, modular CSS, pagination |
| 4 | Admin Panel & Writes | ✅ Complete | `f5120ce` | CRUD writes, edit/delete UI, audit logging |
| 5 | SPOC Panel & Gamification | ✅ Complete | `1643a9a` | Leaderboard, badges, nudge, use case library |
| 6 | Polish & Advanced Features | ✅ Complete | `fad8237` | PDF export, forecasting, accessibility, dark/light mode |
| 7 | Export Center | ✅ Complete | `—` | Excel/PDF/PPT export, per-page buttons, role-based access |
| 8 | AI-Assisted Approval Workflow | ✅ Complete | `—` | Edge Functions, AI validation, multi-layer routing, admin approvals tab |

---

## Phase 1: Database Migration ✅

**Status:** Complete | **Dates:** Mar 20–25, 2026

### Deliverables

- [x] Supabase project created and configured
- [x] PostgreSQL schema: 9 tables (practices, quarters, tasks, accomplishments, copilot_users, projects, users, targets, audit_log)
- [x] Migration scripts: `001_create_tables`, `002_indexes_triggers`, `003_rls_policies`, `004_summary_views`
- [x] Seed data migrated from `data.js` (all 6 practices, tasks, accomplishments, copilot users, projects)
- [x] Database views: `practice_summary`, `quarter_summary`, `adoption_rates`
- [x] RLS policies enabled on all tables
- [x] Q2-2026 set as active quarter

### Artifacts

| File | Purpose |
|------|---------|
| `scripts/create-schema.mjs` | Creates tables and views |
| `scripts/run-migration.mjs` | Migrates data from data.js |
| `data.js` | Source data (retained as fallback) |

---

## Phase 2: Auth & Quarter System ✅

**Status:** Complete | **Dates:** Apr 1–10, 2026

### Deliverables

- [x] Supabase Auth users created (1 admin + 5 SPOCs)
- [x] `login.html` with branded Supabase Auth form
- [x] `js/auth.js` module (EAS_Auth) — getUser, roles, guards, visibility
- [x] `js/db.js` module (EAS_DB) — quarters, filtering, Supabase queries
- [x] `js/config.js` — Supabase client factory
- [x] Quarter selector in dashboard header
- [x] All render functions filter by selected quarter
- [x] Role-based sidebar link visibility
- [x] User profile display with logout
- [x] Auth loading overlay during boot

### Post-Phase Refactoring (Apr 10)

- [x] **Security:** Removed hardcoded service role keys from all scripts
- [x] **Security:** Changed `requireAuth()` from `getSession()` to `getUser()` (server-validated)
- [x] **Structure:** Created `css/`, `scripts/`, `docs/` folders
- [x] **Shared CSS:** Created `css/variables.css` (design tokens, base styles, components)
- [x] **Shared Utils:** Created `js/utils.js` (EAS_Utils — formatting, sanitization, helpers)
- [x] **Env:** Created `.env.example`, updated `.gitignore`
- [x] **Docs:** Created CODE_ARCHITECTURE.md, BRD.md, HLD.md, this plan, onboarding guide
- [x] **README:** Full project overview with structure and links

### Contributor Self-Signup (Apr 11)

- [x] **signup.html:** 2-step registration form (profile info → password creation)
- [x] **signup_contributor() RPC:** SECURITY DEFINER function — creates `users` row + `copilot_users` row based on copilot access flag
- [x] **Copilot routing:** Copilot=Yes → Active status (null copilot_access_date); Copilot=No → Pending status ("Not Granted")
- [x] **Pending signup flow:** localStorage-based handoff for email-confirmation-enabled projects
- [x] **login.html updated:** Added "Sign up" link + pending-signup completion on first login
- [x] **Practices dropdown:** Loaded dynamically from Supabase `practices` table
- [x] **Password strength:** Visual strength indicator with 4 criteria bars

---

## Phase 3: Live Data & CSS Extraction ✅

**Status:** Complete | **Completed:** April 12, 2026

### Deliverables

- [x] Removed ~3,700 lines of static `APP_DATA` JSON from index.html
- [x] Deleted legacy `data.js` file
- [x] Created `get_practice_summary(p_quarter_id)` Supabase RPC function (quarter-aware)
- [x] Rewrote `js/db.js` with full Supabase data layer:
  - `fetchAllData(quarterId)` — parallel fetches all 6 data types
  - `fetchTasks()`, `fetchAccomplishments()`, `fetchCopilotUsers()`, `fetchProjects()`, `fetchLovs()`, `fetchPracticeSummary()`
  - snake_case → camelCase transform layer (preserves render function compatibility)
- [x] Rewired `boot()` to fetch live data from Supabase before rendering
- [x] Quarter-change handler re-fetches all data from server (no client-side cache)
- [x] Removed client-side quarter filtering (`getFilteredData()` now returns server-filtered data)
- [x] Removed `recalcFilteredSummary()` (server provides pre-computed summaries)
- [x] Extracted 525-line inline CSS to `css/dashboard.css`
- [x] Added `EAS_Utils.sanitizeDataset()` for XSS prevention on all fetched data
- [x] Added pagination to tasks table (25 rows/page with navigation)
- [x] Added null guards to all render functions
- [x] index.html reduced from ~5,474 lines to ~1,235 lines (77% reduction)

### Size Impact

| File | Before | After | Change |
|------|--------|-------|--------|
| `index.html` | 5,474 lines | 1,235 lines | -77% |
| `js/db.js` | 205 lines | 392 lines | +91% (full data layer) |
| `js/utils.js` | 161 lines | 182 lines | +13% (sanitizeDataset) |
| `css/dashboard.css` | — | 380 lines | New file |
| `data.js` | 3,717 lines | — | Deleted |

### New Supabase Function

| Function | Type | Purpose |
|----------|------|--------|
| `get_practice_summary(p_quarter_id text)` | SECURITY INVOKER | Returns practice-level aggregated stats, optionally filtered by quarter |

---

## Phase 4: Admin Panel & Writes ✅

**Status:** Complete | **Commit:** `f5120ce`

### Objectives

1. ✅ Add CRUD write operations to Supabase (insert, update, delete for tasks, accomplishments, copilot users)
2. ✅ Wire existing modals to Supabase writes (create + edit reuse same modal)
3. ✅ Add edit/delete action buttons to all entity tables
4. ✅ Implement audit trail logging to `activity_log` table
5. ✅ Add data backup/dump capability to `data_dumps` table
6. ✅ Remove legacy admin.html dependencies (handleExcelUpload, recalcSummary)

### Tasks

| # | Task | Est. Hours | Priority | Status |
|---|------|-----------|----------|--------|
| 4.1 | Add 11 write functions to db.js (insert/update/delete for tasks, accomplishments, copilot users + logActivity, createDump) | 8h | P1 | ✅ Done |
| 4.2 | Wire saveTask/saveAccomplishment/saveCopilotUser to Supabase | 6h | P1 | ✅ Done |
| 4.3 | Add edit/delete action buttons to task rows, accomplishment cards, copilot user rows | 6h | P1 | ✅ Done |
| 4.4 | Edit mode reuses existing modals with pre-fill and updated titles | 4h | P2 | ✅ Done |
| 4.5 | Confirmation dialogs for all destructive (delete) actions | 2h | P2 | ✅ Done |
| 4.6 | All mutations logged to activity_log table | 4h | P2 | ✅ Done |
| 4.7 | Admin "Backup Data" button creates JSON snapshots in data_dumps table | 4h | P3 | ✅ Done |
| 4.8 | Removed handleExcelUpload, recalcSummary, Upload Excel button, admin.html link | 2h | P2 | ✅ Done |
| 4.9 | Added RLS policies: copilot_spoc_delete, acc_contributor_insert | 2h | P2 | ✅ Done |

### Acceptance Criteria

- [x] All CRUD operations write to Supabase (no client-side-only state)
- [x] Edit reuses the same modal as create, pre-filling existing values
- [x] Confirmation dialog before every delete
- [x] Activity log records user, action, entity, and timestamp
- [x] Backup creates a JSON dump of selected tables in data_dumps
- [x] Legacy admin panel code removed

---

## Phase 5: SPOC Panel & Gamification ✅

**Status:** Complete | **Completed:** Phase 5 delivered in index.html

### Objectives

1. ✅ Build SPOC "My Practice" page with practice-specific views (inside index.html)
2. ✅ Add leaderboard (practice + employee rankings) and achievement badges (7 types)
3. ✅ Implement nudge system (in-app) for inactive users
4. ✅ Build use case library (searchable, filterable)
5. ✅ Contributor "My Tasks" page with personal KPIs and badges

### Tasks

| # | Task | Est. Hours | Priority | Status |
|---|------|-----------|----------|--------|
| 5.1 | Role-aware views in `index.html` (SPOC My Practice page) | 8h | P2 | ✅ Done |
| 5.2 | SPOC team management with inactive alerts | 6h | P2 | ✅ Done |
| 5.3 | Practice + employee leaderboard (tasks, hours saved, score) | 6h | P3 | ✅ Done |
| 5.4 | Achievement badges (7: first-task, streak, time-saver, efficiency-pro, quality-champion, prolific, centurion) | 4h | P3 | ✅ Done |
| 5.5 | Nudge system (in-app) for inactive users | 6h | P3 | ✅ Done |
| 5.6 | Use case library (searchable, categorized, filterable) | 4h | P3 | ✅ Done |
| 5.7 | Contributor simplified view (My Tasks + read-only dashboard) | 4h | P2 | ✅ Done |

### Acceptance Criteria

- [x] SPOC sees "My Practice" as default page with practice-scoped data
- [x] Leaderboard shows both practice rankings (weighted score) and employee rankings
- [x] Inactive users flagged after 14 days, nudge button updates `nudged_at`
- [x] 7 badge types computed client-side with earned/locked visual states
- [x] Use case library searchable with practice/category/tool filters
- [x] Contributor sees personal dashboard + My Tasks tab with edit capability
- [x] Role-aware navigation using `data-role` attributes on sidebar items

---

## Phase 6: Polish & Advanced Features ✅

**Status:** Complete | **Commit:** `fad8237`

### Objectives

1. ✅ PDF report generation (jsPDF manual layout)
2. ✅ Advanced analytics and forecasting (linear regression, all KPIs)
3. ✅ Performance optimization (defer CDN scripts, preconnect, reorder loads)
4. ✅ Accessibility audit and fixes (WCAG 2.1 AA)
5. ✅ Keyboard navigation + focus-visible styles
6. ✅ Dark/light mode toggle (CSS custom properties, localStorage)
7. ✅ Final documentation update

### Tasks

| # | Task | Est. Hours | Priority | Status |
|---|------|-----------|----------|--------|
| 6.1 | Quarterly PDF report generation (jsPDF) | 8h | P3 | ✅ Done |
| 6.2 | Trend forecasting (linear regression, all KPIs, 2 forecast charts) | 4h | P3 | ✅ Done |
| 6.3 | Accessibility audit (WCAG 2.1 AA): skip link, landmarks, aria-labels, table captions | 6h | P2 | ✅ Done |
| 6.4 | Performance: defer Chart.js/xlsx/jsPDF, preconnect fonts, optimized load order | 4h | P2 | ✅ Done |
| 6.5 | Keyboard navigation: focus-visible rings, nav item tabindex/role, reduced-motion | 4h | P2 | ✅ Done |
| 6.6 | Dark/light mode toggle with localStorage persistence | 3h | P3 | ✅ Done |
| 6.7 | Final documentation update | 4h | P1 | ✅ Done |
| 6.8 | User acceptance testing | 8h | P1 | ✅ Done |

### Acceptance Criteria

- [x] PDF report generates with Executive Summary, Practice Breakdown, Top Contributors, Accomplishments
- [x] Forecast section shows projected tasks, hours saved, efficiency, adoption for next 4 weeks
- [x] Two forecast charts (tasks + hours) with actual vs. forecast dashed lines
- [x] Skip-to-content link, `<main>` landmark, aria-labels on all filters/buttons/tables
- [x] Focus-visible rings on all interactive elements (buttons, nav items, inputs)
- [x] Dark/light theme toggle persists via localStorage, affects all 3 pages
- [x] Light theme overrides in `[data-theme="light"]` with proper contrast
- [x] Chart.js colors update on theme switch
- [x] Duplicate `:root` blocks removed from login.html/signup.html
- [x] prefers-reduced-motion respected

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|-----------|
| Supabase free tier exceeded | High | Low | Monitor usage; upgrade if needed |
| Single developer bandwidth | Medium | High | Prioritize P1 items; defer P3 |
| Data migration errors | High | Low | Retain data.js fallback; validate queries |
| Browser compatibility issues | Medium | Medium | Test on Chrome, Edge, Safari |
| Security vulnerability | Critical | Medium | Regular code review; RLS enforced |

---

## Effort Summary

| Phase | Estimated Hours | Status | Key Metrics |
|-------|----------------|--------|-------------|
| Phase 1 | 20h | ✅ Complete | 9 tables, 4 migrations, seed data |
| Phase 2 | 24h | ✅ Complete | Auth, quarters, signup, 6 users |
| Phase 3 | 51h | ✅ Complete | 77% code reduction, live Supabase |
| Phase 4 | 38h | ✅ Complete | 11 write functions, audit logging |
| Phase 5 | 38h | ✅ Complete | 4 new pages, 7 badges, 2 RPCs |
| Phase 6 | 41h | ✅ Complete | PDF, forecast, a11y, dark/light mode |
| Phase 7 | 20h | ✅ Complete | Export Center: Excel/PDF/PPT, per-page exports |
| **Total** | **232h** | **✅ All Complete** | **7 phases delivered** |

---

## Phase 7: Export Center ✅

**Status:** Complete | **Date:** April 11, 2026

### Deliverables

- [x] Export Center modal with tab-based format selection (Excel / PDF / PPT)
- [x] Per-page export buttons on all pages (Dashboard, Practices, Tasks, etc.)
- [x] Sidebar "Export Center" button opens global modal
- [x] Excel export: role-based (Admin=all, SPOC=practice, Contributor=my tasks), multi-sheet
- [x] PDF export: modular sections (Dashboard, Practices, My Practice, Leaderboard, Accomplishments, My Tasks)
- [x] PPT export: two styles (Executive Summary / Data-Heavy) with KPI slides, practice cards, leaderboard, accomplishments
- [x] Role-based access: Admin=full, SPOC=practice-filtered, Contributor=my tasks + summary only
- [x] PPT tab hidden for Contributors; Copilot/Projects/Leaderboard exports hidden for Contributors
- [x] Context-aware checkbox pre-selection when opened from page-specific export buttons
- [x] PptxGenJS and html2canvas CDN libraries added
- [x] Export modal CSS with responsive grid, tabs, checkbox cards, radio cards
- [x] Legacy `exportToExcel()` and `generatePDFReport()` functions preserved as wrappers

### CDN Libraries Added
| Library | Version | Purpose |
|---------|---------|--------|
| PptxGenJS | 3.12.0 | PowerPoint generation |
| html2canvas | 1.4.1 | Screenshot-to-image for PDF/PPT charts |

---

*See [BRD.md](BRD.md) for full business requirements.*  
*See [HLD.md](HLD.md) for system architecture design.*

---

## Structural Update — 2026-04-11

HTML entry points were relocated from the repository root into `src/pages/`. Shared assets in `css/` and `js/` now resolve via `../../css/…` and `../../js/…`. Cross-page navigation between pages in `src/pages/` stays flat (e.g. `window.location.href = 'login.html'`).

See `docs/CODE_ARCHITECTURE.md` §2 for the authoritative tree and path convention, and `.github/copilot-instructions.md` for the mandatory workflow governing future changes (skills, Supabase MCP, full docs sweep, commit & push).
