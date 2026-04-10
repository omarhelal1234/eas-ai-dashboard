# Implementation Plan

# EAS AI Adoption Dashboard

> **Version:** 1.2 | **Last Updated:** April 10, 2026

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Mar 20, 2026 | Omar Ibrahim | Initial plan with 6 phases |
| 1.1 | Apr 5, 2026 | Omar Ibrahim | Phase 1 completed — DB migration |
| 1.2 | Apr 10, 2026 | Omar Ibrahim | Phase 2 completed — Auth & Quarters; code review & refactoring done |

---

## Phase Overview

| Phase | Name | Status | Timeline | Key Deliverables |
|-------|------|--------|----------|-----------------|
| 1 | Database Migration | ✅ Complete | Mar 20–25 | Supabase schema, data, views, RLS |
| 2 | Auth & Quarter System | ✅ Complete | Apr 1–10 | Login, roles, quarter filtering |
| 3 | Live Data & CSS Extraction | 🔲 Planned | Apr 14–28 | Supabase reads, modular CSS, split HTML |
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

---

## Phase 3: Live Data & CSS Extraction 🔲

**Status:** Planned | **Target:** Apr 14–28, 2026

### Objectives

1. Replace static `APP_DATA` reads with Supabase queries
2. Extract inline CSS from HTML files into modular stylesheets
3. Split `index.html` monolith into manageable sections
4. Integrate `EAS_Utils.sanitize()` into all `innerHTML` calls

### Tasks

| # | Task | Est. Hours | Priority |
|---|------|-----------|----------|
| 3.1 | Replace dashboard data reads with Supabase `fetchPracticeSummary()` | 8h | P1 |
| 3.2 | Replace task list reads with Supabase `fetchTasks()` | 6h | P1 |
| 3.3 | Replace accomplishment reads with Supabase queries | 4h | P1 |
| 3.4 | Replace copilot user reads with Supabase queries | 4h | P1 |
| 3.5 | Replace project reads with Supabase queries | 3h | P1 |
| 3.6 | Extract `index.html` inline CSS to `css/dashboard.css` | 6h | P2 |
| 3.7 | Extract `login.html` inline CSS to `css/login.css` | 2h | P2 |
| 3.8 | Extract `admin.html` inline CSS to `css/admin.css` | 3h | P2 |
| 3.9 | Add `sanitize()` to all innerHTML assignments | 4h | P1 |
| 3.10 | Add loading states and error handling for API calls | 4h | P2 |
| 3.11 | Add table pagination (tasks, copilot users) | 4h | P2 |
| 3.12 | Replace `EAS_Utils` usage for duplicate functions in index.html | 3h | P2 |

### Acceptance Criteria

- [ ] Dashboard loads data from Supabase, not APP_DATA
- [ ] Quarter switching queries Supabase or filters cached data
- [ ] No inline `<style>` blocks in HTML files (except minimal critical CSS)
- [ ] All user-facing text rendered via sanitize()
- [ ] Tables paginate at 50 rows

### Dependencies

- Supabase database operational (Phase 1 ✅)
- Auth system working (Phase 2 ✅)

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

## Phase 5: SPOC Panel & Gamification 🔲

**Status:** Planned | **Target:** May 18–30, 2026

### Objectives

1. Build dedicated SPOC dashboard (`spoc.html`)
2. Add leaderboard and achievement badges
3. Implement nudge/notification system
4. Build use case library

### Tasks

| # | Task | Est. Hours | Priority |
|---|------|-----------|----------|
| 5.1 | Create `spoc.html` with practice-specific views | 8h | P2 |
| 5.2 | SPOC team management with inactive alerts | 6h | P2 |
| 5.3 | Practice leaderboard (tasks, hours saved) | 6h | P3 |
| 5.4 | Achievement badges (first task, streak, top saver) | 4h | P3 |
| 5.5 | Nudge system (email or in-app) for inactive users | 6h | P3 |
| 5.6 | Use case library (searchable, categorized) | 4h | P3 |
| 5.7 | Contributor simplified view | 4h | P2 |

### Acceptance Criteria

- [ ] SPOC sees only their practice on login
- [ ] Leaderboard updates in real-time
- [ ] Inactive users flagged after 2 weeks

---

## Phase 6: Polish & Advanced Features 🔲

**Status:** Planned | **Target:** Jun 1–15, 2026

### Objectives

1. PDF report generation
2. Advanced analytics and forecasting
3. Performance optimization
4. Accessibility audit and fixes
5. Final documentation

### Tasks

| # | Task | Est. Hours | Priority |
|---|------|-----------|----------|
| 6.1 | Quarterly PDF report generation | 8h | P3 |
| 6.2 | Trend forecasting (simple linear) | 4h | P3 |
| 6.3 | Accessibility audit (WCAG 2.1 AA) | 6h | P2 |
| 6.4 | Performance audit (Lighthouse) | 4h | P2 |
| 6.5 | Keyboard navigation for all interactive elements | 4h | P2 |
| 6.6 | Dark/light mode toggle | 3h | P3 |
| 6.7 | Final documentation update | 4h | P1 |
| 6.8 | User acceptance testing | 8h | P1 |

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
