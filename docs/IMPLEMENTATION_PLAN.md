# Implementation Plan

# EAS AI Adoption Dashboard

> **Version:** 1.4 | **Last Updated:** April 12, 2026

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Mar 20, 2026 | Omar Ibrahim | Initial plan with 6 phases |
| 1.1 | Apr 5, 2026 | Omar Ibrahim | Phase 1 completed — DB migration |
| 1.2 | Apr 10, 2026 | Omar Ibrahim | Phase 2 completed — Auth & Quarters; code review & refactoring done |
| 1.3 | Apr 11, 2026 | Omar Ibrahim | Contributor self-signup feature added (signup.html + signup_contributor RPC) |
| 1.4 | Apr 12, 2026 | Omar Ibrahim | Phase 3 completed — live Supabase data, CSS extraction, pagination, sanitization |

---

## Phase Overview

| Phase | Name | Status | Timeline | Key Deliverables |
|-------|------|--------|----------|-----------------|
| 1 | Database Migration | ✅ Complete | Mar 20–25 | Supabase schema, data, views, RLS |
| 2 | Auth & Quarter System | ✅ Complete | Apr 1–10 | Login, roles, quarter filtering |
| 3 | Live Data & CSS Extraction | ✅ Complete | Apr 12 | Supabase reads, modular CSS, pagination |
| 4 | Admin Panel & Writes | 🔲 Planned | May 1–15 | Supabase Auth for admin, CRUD writes |
| 5 | SPOC Panel & Gamification | 🔲 Planned | May 18–30 | SPOC dashboard, leaderboard |
| 6 | Polish & Advanced Features | 🔲 Planned | Jun 1–15 | PDF export, analytics, performance |

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

## Phase 4: Admin Panel & Writes 🔲

**Status:** Planned | **Target:** May 1–15, 2026

### Objectives

1. Migrate `admin.html` from client-side auth to Supabase Auth
2. Add CRUD write operations for all entities
3. Implement audit trail logging
4. Add data quality monitoring

### Tasks

| # | Task | Est. Hours | Priority |
|---|------|-----------|----------|
| 4.1 | Replace admin.html client-side auth with Supabase Auth | 6h | P1 |
| 4.2 | Implement task create/edit/delete via Supabase | 8h | P1 |
| 4.3 | Implement accomplishment CRUD | 6h | P1 |
| 4.4 | Implement copilot user CRUD | 4h | P2 |
| 4.5 | Implement project CRUD | 4h | P2 |
| 4.6 | User management (create/edit/deactivate) | 6h | P2 |
| 4.7 | Quarter management (create, set active, lock) | 4h | P2 |
| 4.8 | Audit trail logging on all writes | 4h | P2 |
| 4.9 | Data quality dashboard (missing fields, stale data) | 6h | P3 |

### Acceptance Criteria

- [ ] Admin login via Supabase Auth (no hardcoded credentials)
- [ ] All CRUD operations write to Supabase
- [ ] Optimistic UI with rollback on error
- [ ] Audit log records who changed what and when

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

## Phase 6: Polish & Advanced Features 🔲

**Status:** Complete | **Completed:** All 8 tasks delivered

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

| Phase | Estimated Hours | P1 | P2 | P3 |
|-------|----------------|-----|-----|-----|
| Phase 1 | 20h | - | - | - |
| Phase 2 | 24h | - | - | - |
| Phase 3 | 51h | 29h | 16h | 6h |
| Phase 4 | 48h | 20h | 24h | 4h |
| Phase 5 | 38h | 0h | 18h | 20h |
| Phase 6 | 41h | 12h | 17h | 12h |
| **Total** | **222h** | **61h** | **75h** | **42h** |

---

*See [BRD.md](BRD.md) for full business requirements.*  
*See [HLD.md](HLD.md) for system architecture design.*
