# Business Requirements Document (BRD)

# EAS AI Adoption Dashboard

> **Version:** 2.1 | **Date:** April 11, 2026 | **Author:** Omar Ibrahim  
> **Department:** Enterprise Application Solutions (EAS) | **Sponsor:** EAS Leadership
> **Status:** Phase 8 Complete - AI-Assisted Approval Workflow Implemented

---

## 1. Executive Summary

The EAS AI Adoption Dashboard is a web-based platform to track, measure, and drive AI tool adoption across Ejada's Enterprise Application Solutions (EAS) department. It replaces manual Excel-based tracking with a real-time, multi-role dashboard that provides visibility into AI usage, productivity gains, and adoption gaps across 6 practices and 120+ licensed users. **Phase 8 adds intelligent task submission with AI-assisted suggestions, smart validation, and multi-layer approval workflow.**

### Business Objectives

| # | Objective | KPI | Target |
|---|-----------|-----|--------|
| 1 | Increase adoption rate | Active users / Licensed users | 30% (from ~13%) |
| 2 | Track productivity gains | Hours saved per quarter | 500+ hrs/quarter |
| 3 | Ensure data quality | Tasks with all fields complete | >80% |
| 4 | Enable quarter-over-quarter reporting | Quarter comparison metrics | Automated |
| 5 | Drive accountability | Per-practice task logging | All 6 active |

---

## 2. Stakeholders

| Stakeholder | Role | Interest |
|-------------|------|----------|
| Omar Ibrahim | Overall AI SPOC / Admin | Full program oversight, reporting |
| Practice Heads (6) | Department leaders | Practice-level AI impact |
| AI SPOCs (6) | Practice AI champions | Team adoption, task quality |
| Licensed Users (120+) | Contributors | Log AI tasks, see personal stats |
| EAS Leadership | Executive | Quarterly reports, ROI visibility |

---

## 3. Scope

### In Scope

- Dashboard with KPIs, charts, and drill-downs
- Quarter segregation for all data views
- Role-based access (Admin, SPOC, Team Lead, Contributor, Viewer, Executive)
- Task logging with **AI suggestions and smart validation** (Phase 8)
- **Multi-layer approval workflow** (AI → SPOC → Admin) (Phase 8)
- Accomplishment tracking
- Copilot license management
- Project portfolio tracking
- Excel import/export
- Admin panel with user management + Approvals tab (Phase 8)
- SPOC practice dashboard
- Employee task status tracking (Phase 8)
- Leaderboard and gamification
- Data quality monitoring

### Out of Scope

- Mobile native applications
- Integration with JIRA/DevOps tools
- Automated AI usage detection
- Financial ROI calculations
- Billing/invoicing features

---

## 4. Functional Requirements

### FR-01: Authentication & Authorization

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01.1 | Email/password login via Supabase Auth | P1 |
| FR-01.2 | Six roles: Admin, SPOC, Team Lead, Contributor, Viewer, Executive | P1 |
| FR-01.3 | Role-based page/section visibility | P1 |
| FR-01.4 | Session persistence across page refreshes | P1 |
| FR-01.5 | Password change capability | P2 |
| FR-01.6 | Admin can create/deactivate users | P2 |
| FR-01.7 | Contributor self-signup with profile info + copilot access flag | P1 ✅ |
| FR-01.8 | Signup auto-creates users and copilot_users rows via RPC | P1 ✅ |
| FR-01.9 | Self-signup always registers as Contributor; Admin assigns SPOC/Admin roles | P1 ✅ |

### FR-02: Quarter Segregation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02.1 | Quarter selector in dashboard header | P1 |
| FR-02.2 | All pages filter by selected quarter | P1 |
| FR-02.3 | Default to current active quarter | P1 |
| FR-02.4 | "All Time" cumulative view option | P1 |
| FR-02.5 | Quarter comparison deltas on KPIs | P2 |
| FR-02.6 | Admin can set per-quarter targets | P2 |
| FR-02.7 | Admin can lock/close a quarter | P2 |

### FR-03: Dashboard

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-03.1 | KPI cards: tasks, hours saved, efficiency, quality | P1 ✅ |
| FR-03.2 | Charts: tasks by practice, time saved, efficiency, tools, categories, trend | P1 ✅ |
| FR-03.3 | Adoption rate widget (active/licensed users) | P2 ✅ |
| FR-03.4 | Practice heatmap (green/yellow/red) | P2 ✅ |
| FR-03.5 | Inactive users widget | P2 ✅ |
| FR-03.6 | Trend forecasting (linear regression, 4-week projection) | P3 ✅ |
| FR-03.7 | Dark/Light mode toggle with localStorage persistence | P3 ✅ |
| FR-03.8 | KPIs/charts/forecasts use approved-only data; pending items show approval badges | P1 ✅ |

### FR-04: Task Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-04.1 | Log new AI tasks with all fields | P1 ✅ |
| FR-04.2 | Filter tasks by practice, category, tool, status | P1 ✅ |
| FR-04.3 | Search tasks by keyword | P1 ✅ |
| FR-04.4 | Edit/delete tasks (role-restricted) | P2 ✅ |
| FR-04.5 | Auto-calculate time saved and efficiency | P1 ✅ |

### FR-05: Practice Tracking

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-05.1 | 6 practice cards with summary stats | P1 |
| FR-05.2 | Drill-down to practice task detail | P1 |
| FR-05.3 | SPOC default view: own practice | P2 |
| FR-05.4 | Practice vs. program average comparison | P2 |

### FR-06: Accomplishment Tracking

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-06.1 | Card-based accomplishment view | P1 |
| FR-06.2 | Create/edit accomplishments | P1 |
| FR-06.3 | Impact details (before/after, gains) | P1 |

### FR-07: Copilot User Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-07.1 | Table of all licensed users | P1 |
| FR-07.2 | Filter by practice and status | P1 |
| FR-07.3 | Add/edit copilot users | P2 |
| FR-07.4 | Track has_logged_task status | P2 |

### FR-08: Projects

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-08.1 | Project portfolio table | P1 |
| FR-08.2 | Filter by practice | P1 |
| FR-08.3 | Project metadata (customer, value, dates) | P1 |

### FR-09: Admin Panel

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-09.1 | Program command center with risk radar | P2 ✅ |
| FR-09.2 | User management (CRUD) | P2 ✅ |
| FR-09.3 | Quarter management | P2 ✅ |
| FR-09.4 | Data quality monitor | P2 ✅ |
| FR-09.5 | Audit trail viewer | P3 ✅ |

### FR-10: SPOC Panel

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10.1 | Practice-specific dashboard | P2 ✅ |
| FR-10.2 | Team management with inactive alerts | P2 ✅ |
| FR-10.3 | Nudge system for follow-ups | P3 ✅ |
| FR-10.4 | Use case library | P3 ✅ |

### FR-11: Contributor View

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-11.1 | Simplified task logging form | P2 ✅ |
| FR-11.2 | Personal stats dashboard | P2 ✅ |
| FR-11.3 | Practice leaderboard | P3 ✅ |

### FR-12: Reports & Export

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-12.1 | Excel export with multiple sheets | P1 ✅ |
| FR-12.2 | Excel import capability | P1 (deprecated — replaced by Supabase writes) |
| FR-12.3 | Quarterly report generation | P3 ✅ |
| FR-12.4 | PDF export | P3 ✅ |
| FR-12.5 | Export Center modal with format selection (Excel/PDF/PPT) | P2 ✅ |
| FR-12.6 | Per-page export buttons on all pages | P2 ✅ |
| FR-12.7 | PowerPoint export (Executive + Data-heavy styles) | P2 ✅ |
| FR-12.8 | Role-based export access (Admin=full, SPOC=practice, Contributor=own tasks) | P2 ✅ |

### FR-12b: Featured Spotlight Banner & Likes

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-12b.1 | Auto-rotating spotlight banner on dashboard (all roles) | P2 ✅ |
| FR-12b.2 | Banner shows top tasks, accomplishments, prompts, use cases with contributor/practice/department | P2 ✅ |
| FR-12b.3 | Hybrid selection: admin pins → user likes → metric fallback | P2 ✅ |
| FR-12b.4 | Global permanent like system (heart button) on Tasks, Accomplishments, Use Cases | P2 ✅ |
| FR-12b.5 | Prompt likes reuse existing prompt_votes system | P2 ✅ |
| FR-12b.6 | Auto-rotate every 5 seconds with pause on hover + manual arrows + dot indicators | P3 ✅ |
| FR-12b.7 | Admin-configurable slot allocation per content type (default 10 total) | P3 ✅ |
| FR-12b.8 | Admin can pin/unpin items to banner with custom badge labels | P3 ✅ |
| FR-12b.9 | Client-side daily cache with calendar-day reset | P3 ✅ |
| FR-12b.10 | ARIA carousel roles, keyboard navigation, prefers-reduced-motion | P2 ✅ |

### FR-12c: Upcoming Events (Admin-managed event broadcasts)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-12c.1 | Admin can create, edit, publish, unpublish, duplicate, and delete events (AI sessions, summits, certifications, workshops, webinars, other) | P2 ✅ |
| FR-12c.2 | Each event carries title, short + long (markdown) descriptions, type, location (online/in-person/hybrid + optional venue), start/end datetime (Asia/Riyadh), external registration URL, cover image, deadline, and a `force_on_every_login` flag | P2 ✅ |
| FR-12c.3 | Published events appear as a pop-up to every authenticated user after login, surfaced once per user per event by default | P2 ✅ |
| FR-12c.4 | Hybrid RSVP: internal registration row + redirect to the external registration URL in a new tab; both recorded | P2 ✅ |
| FR-12c.5 | User can dismiss a card (persisted), re-open all active events via a header bell with unread-count badge | P2 ✅ |
| FR-12c.6 | `force_on_every_login` events reappear every login regardless of prior dismissal/registration; Register button is disabled once RSVP'd | P3 ✅ |
| FR-12c.7 | Admin can view per-event registration list with user name/email/practice/role/registered-at/external-clicked, filter by practice, and export CSV | P2 ✅ |
| FR-12c.8 | RLS: non-admins cannot write `events`; users can only read their own `event_registrations` / `event_dismissals` | P1 ✅ |

### FR-13: Accessibility & UX

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-13.1 | WCAG 2.1 AA compliance (skip link, ARIA, focus-visible) | P2 ✅ |
| FR-13.2 | Keyboard navigation for all interactive elements | P2 ✅ |
| FR-13.3 | prefers-reduced-motion support | P3 ✅ |
| FR-13.4 | Dark/Light mode toggle | P3 ✅ |

---

## 5. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | Page load time | < 3 seconds |
| NFR-02 | Works on Chrome, Edge, Safari | Latest 2 versions |
| NFR-03 | Mobile responsive | Usable on 375px+ screens |
| NFR-04 | Zero-cost hosting | GitHub Pages (free) |
| NFR-05 | Database free tier | Supabase free (500MB) |
| NFR-06 | Data at rest encryption | Via Supabase (default) |
| NFR-07 | HTTPS | Via GitHub Pages (default) |
| NFR-08 | Concurrent users | Up to 50 simultaneous |

---

## 6. Six Practices

| Practice | Abbreviation | Head | AI SPOC | Licensed Users |
|----------|-------------|------|---------|---------------|
| Financial Services | BFSI | Mohab ElHaddad | Omar Ibrahim | ~41 |
| Customer Engagement | CES | Osama Nagdy | Norah Al Wabel | ~13 |
| ERP Solutions | ERP | Amer Farghaly | Reham Ibrahim | 60+ |
| Payments Solutions | EPS | Mohamed Ziaudin | Yousef Milhem | ~2 |
| GRC | GRC | Ahmed Madkour | Mohamed Essam | ~3 |
| Enterprise Portfolio & Content | EPCS | Mohamed Mobarak | Ahmed Shaheen | ~3 |

---

## 7. Data Model Summary

| Entity | Key Fields | Relationships |
|--------|-----------|---------------|
| Tasks | practice, employee_name, category, ai_tool, time_*, quality_rating | → quarter_id |
| Accomplishments | practice, title, ai_tool, quantified_impact, business_gains | → quarter_id |
| Copilot Users | name, email, practice, status, has_logged_task | — |
| Projects | project_name, project_code, customer, contract_value, practice | — |
| Users | email, name, role, practice, auth_id | → auth.users |
| Quarters | id, label, start_date, end_date, is_active, is_locked | — |

### Database Functions

| Function | Purpose |
|----------|--------|
| `signup_contributor()` | SECURITY DEFINER RPC — creates user + copilot_users row for self-signup |
| `get_practice_summary()` | Quarter-aware practice aggregation |
| `get_employee_leaderboard()` | Employee rankings by tasks, hours, efficiency |
| `get_practice_leaderboard()` | Practice rankings with weighted scoring |
| `toggle_like()` | SECURITY DEFINER — toggles like on task/accomplishment/use_case, returns `{liked, like_count}` |

---

## 8. Acceptance Criteria

| # | Criteria | Status |
|---|---------|--------|
| 1 | Admin can log in and see all 6 practices' data | ✅ |
| 2 | Quarter selector filters all dashboard views correctly | ✅ |
| 3 | SPOC can log tasks for their practice only | ✅ |
| 4 | KPI cards show accurate totals for selected quarter | ✅ |
| 5 | Charts render correctly with practice-level data | ✅ |
| 6 | Excel export includes all filtered data | ✅ |
| 7 | No unauthorized access to other practices' individual data | ✅ |
| 8 | Page loads in under 3 seconds on standard connection | ✅ |
| 9 | Self-signup creates correct user and copilot records | ✅ |
| 10 | All CRUD operations write to Supabase with audit logging | ✅ |
| 11 | Leaderboard shows practice + employee rankings with badges | ✅ |
| 12 | SPOC panel shows practice-specific team with nudge capability | ✅ |
| 13 | PDF report generates with Executive Summary and charts | ✅ |
| 14 | Dark/Light theme toggle persists across sessions and pages | ✅ |
| 15 | Accessibility: skip link, ARIA labels, keyboard nav, focus-visible | ✅ |
| 16 | Featured spotlight banner auto-rotates with top-liked/pinned content | ✅ |
| 17 | Like buttons on Tasks, Accomplishments, Use Cases, and Prompt Library | ✅ |
| 18 | Admin can configure banner slots and pin/unpin items | ✅ |

---

*All 6 implementation phases are complete. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for delivery details and commit history.*

---

## Structural Update — 2026-04-11

HTML entry points were relocated from the repository root into `src/pages/`. Shared assets in `css/` and `js/` now resolve via `../../css/…` and `../../js/…`. Cross-page navigation between pages in `src/pages/` stays flat (e.g. `window.location.href = 'login.html'`).

See `docs/CODE_ARCHITECTURE.md` §2 for the authoritative tree and path convention, and `.github/copilot-instructions.md` for the mandatory workflow governing future changes (skills, Supabase MCP, full docs sweep, commit & push).
