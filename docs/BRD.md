# Business Requirements Document (BRD)

# EAS AI Adoption Dashboard

> **Version:** 1.0 | **Date:** April 10, 2026 | **Author:** Omar Ibrahim  
> **Department:** Ejada Advanced Solutions (EAS) | **Sponsor:** EAS Leadership

---

## 1. Executive Summary

The EAS AI Adoption Dashboard is a web-based platform to track, measure, and drive AI tool adoption across Ejada's EAS department. It replaces manual Excel-based tracking with a real-time, multi-role dashboard that provides visibility into AI usage, productivity gains, and adoption gaps across 6 practices and 120+ licensed users.

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
- Role-based access (Admin, SPOC, Contributor)
- Task logging, accomplishment tracking
- Copilot license management
- Project portfolio tracking
- Excel import/export
- Admin panel with user management
- SPOC practice dashboard
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
| FR-01.2 | Three roles: Admin, SPOC, Contributor | P1 |
| FR-01.3 | Role-based page/section visibility | P1 |
| FR-01.4 | Session persistence across page refreshes | P1 |
| FR-01.5 | Password change capability | P2 |
| FR-01.6 | Admin can create/deactivate users | P2 |

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
| FR-03.1 | KPI cards: tasks, hours saved, efficiency, quality | P1 |
| FR-03.2 | Charts: tasks by practice, time saved, efficiency, tools, categories, trend | P1 |
| FR-03.3 | Adoption rate widget (active/licensed users) | P2 |
| FR-03.4 | Practice heatmap (green/yellow/red) | P2 |
| FR-03.5 | Inactive users widget | P2 |

### FR-04: Task Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-04.1 | Log new AI tasks with all fields | P1 |
| FR-04.2 | Filter tasks by practice, category, tool, status | P1 |
| FR-04.3 | Search tasks by keyword | P1 |
| FR-04.4 | Edit/delete tasks (role-restricted) | P2 |
| FR-04.5 | Auto-calculate time saved and efficiency | P1 |

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
| FR-09.1 | Program command center with risk radar | P2 |
| FR-09.2 | User management (CRUD) | P2 |
| FR-09.3 | Quarter management | P2 |
| FR-09.4 | Data quality monitor | P2 |
| FR-09.5 | Audit trail viewer | P3 |

### FR-10: SPOC Panel

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10.1 | Practice-specific dashboard | P2 |
| FR-10.2 | Team management with inactive alerts | P2 |
| FR-10.3 | Nudge system for follow-ups | P3 |
| FR-10.4 | Use case library | P3 |

### FR-11: Contributor View

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-11.1 | Simplified task logging form | P2 |
| FR-11.2 | Personal stats dashboard | P2 |
| FR-11.3 | Practice leaderboard | P3 |

### FR-12: Reports & Export

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-12.1 | Excel export with multiple sheets | P1 |
| FR-12.2 | Excel import capability | P1 |
| FR-12.3 | Quarterly report generation | P3 |
| FR-12.4 | PDF export | P3 |

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
| Tasks | practice, employee, category, ai_tool, times, quality | → quarter, practice |
| Accomplishments | practice, title, impact, gains | → quarter, practice |
| Copilot Users | name, email, practice, status | → practice |
| Projects | name, customer, value, dates | → practice |
| Users | email, role, practice | → auth.users |
| Quarters | id, dates, targets, is_active | — |

---

## 8. Acceptance Criteria

| # | Criteria |
|---|---------|
| 1 | Admin can log in and see all 6 practices' data |
| 2 | Quarter selector filters all dashboard views correctly |
| 3 | SPOC can log tasks for their practice only |
| 4 | KPI cards show accurate totals for selected quarter |
| 5 | Charts render correctly with practice-level data |
| 6 | Excel export includes all filtered data |
| 7 | No unauthorized access to other practices' individual data |
| 8 | Page loads in under 3 seconds on standard connection |

---

*This BRD will be updated as phases are delivered. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for delivery timeline.*
