# High-Level Design (HLD)

# EAS AI Adoption Dashboard

> **Version:** 2.2 | **Date:** April 13, 2026  
> **Status:** Phase 10 In Progress - IDE Task Logger

---

## 1. System Overview

```
┌────────────────────────────────────────────────────────────┐
│                    USERS (Browser)                         │
│  Admin · SPOC · Contributor                                │
├────────────────────────────────────────────────────────────┤
│           GitHub Pages (Static Hosting)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                   │
│  │login.html│ │index.html│ │signup.html│                   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘                   │
│       │             │            │                          │
│  ┌────┴─────────────┴────────────┴─────────────────────────┐     │
│  │                     JavaScript Modules                   │     │
│  │  config.js │ auth.js │ db.js │ utils.js                 │     │
│  └─────────────────────┬───────────────────────────────────┘     │
├────────────────────────┼──────────────────────────────────┤
│                        │ HTTPS (REST + Realtime)          │
│                        ▼                                   │
│  ┌──────────────────────────────────────────────────┐     │
│  │              Supabase Cloud                       │     │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │     │
│  │  │   Auth   │  │ PostgREST │  │  PostgreSQL   │  │     │
│  │  │  (JWT)   │  │  (API)    │  │  (10 tables)  │  │     │
│  │  └──────────┘  └───────────┘  └──────────────┘  │     │
│  │  ┌──────────┐  ┌───────────┐                     │     │
│  │  │   RLS    │  │  6 RPCs   │                     │     │
│  │  │(Policies)│  │ (server)  │                     │     │
│  │  └──────────┘  └───────────┘                     │     │
│  └──────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Hosting** | GitHub Pages | Free, HTTPS, CI-friendly |
| **Frontend** | Vanilla HTML/CSS/JS | Zero build step, fast load |
| **Charting** | Chart.js 4.4.1 (CDN, deferred) | Lightweight, responsive |
| **Spreadsheet** | SheetJS 0.18.5 (CDN, deferred) | Excel import/export |
| **PDF** | jsPDF 2.5.2 (CDN, deferred) | Quarterly report generation |
| **Auth** | Supabase Auth (JWT) | Managed, email/password |
| **Database** | Supabase PostgreSQL (14 tables) | Free tier, RLS, REST API, audit trails |
| **API** | Supabase PostgREST + Edge Functions | Auto-generated REST, OpenAI integration |
| **AI Services** | OpenAI GPT-4 (suggestions & validation) | Suggestions: 3 options, Validation: 4 criteria |
| **Approval Workflow** | Multi-layer routing engine | AI → SPOC → Admin based on impact |
| **IDE Integration** | VS Code Extension + Edge Function | Direct task logging from developer IDE |
| **CSS** | Custom properties + dark/light theme | `[data-theme]` toggle, localStorage |
| **Accessibility** | WCAG 2.1 AA | Skip link, ARIA, focus-visible, reduced motion |

---

## 3. Architecture Decisions

### ADR-01: Static SPA over Framework

**Decision:** Single-page application using vanilla JS, no React/Vue/Angular.

**Rationale:**
- Zero build toolchain = simpler deployment
- GitHub Pages serves static files only
- Dashboard is read-heavy with limited interactivity
- Team familiarity with vanilla JS

**Trade-off:** Larger HTML files, manual DOM management, no component reuse across pages.

### ADR-02: Supabase over Firebase

**Decision:** Use Supabase (PostgreSQL) as the backend.

**Rationale:**
- SQL-native (familiar to team)
- Row Level Security built-in
- Free tier adequate (500MB, 50K monthly users)
- REST API auto-generated from schema

### ADR-03: Client-Side Data Filtering

**Decision:** Fetch data once per session, filter in browser.

**Rationale:**
- Dataset is small (<5,000 rows expected in Year 1)
- Reduces API calls (Supabase free tier limits)
- Enables instant quarter switching
- Offline-capable after initial load

**Trade-off:** Initial load is heavier; will need pagination for >10K rows.

### ADR-04: Module Pattern (IIFE)

**Decision:** Use IIFE module pattern (`window.EAS_Auth`, `window.EAS_DB`, etc.) instead of ES modules.

**Rationale:**
- Avoids CORS issues on GitHub Pages
- Simpler CDN integration
- Script load order controlled via HTML

---

## 4. Security Architecture

### Authentication Flow

```
User → login.html → Supabase Auth → JWT Token → localStorage
                                                      │
                                                      ▼
                               index.html → auth.js → getUser() (server-validated)
                                                      │
                                            ┌─────────┴─────────┐
                                            │ Valid             │ Invalid
                                            ▼                   ▼
                                     Load Dashboard      Redirect to login.html


User → signup.html (2-step form)
  │
  ├── Step 1: Profile info (dept, practice, name, email, skill, copilot)
  ├── Step 2: Password creation
  ├── supabase.auth.signUp()
  │     ├── Auto-confirm ON  → signup_contributor() RPC → Dashboard
  │     └── Auto-confirm OFF → localStorage stash → Confirm email → Login → RPC
```

### Authorization Matrix

| Resource | Admin | SPOC | Contributor |
|----------|-------|------|-------------|
| Dashboard (all practices) | ✅ | ✅ (read) | ✅ (read) |
| Dashboard (own practice) | ✅ | ✅ | ✅ |
| Task CRUD (all) | ✅ | ✔ | ✖ |
| Task CRUD (own practice) | ✅ | ✅ | Own tasks only |
| SPOC panel (My Practice) | ✅ | ✅ | ✖ |
| My Tasks (personal) | ✅ | ✅ | ✅ |
| Leaderboard | ✅ | ✅ | ✅ |
| Use Case Library | ✅ | ✅ | ✅ |
| Admin panel | ✅ | ✖ | ✖ |
| User management | ✅ | ✖ | ✖ |
| Export data | ✅ | ✅ | ✖ |
| PDF report | ✅ | ✅ | ✖ |
| Dark/Light toggle | ✅ | ✅ | ✅ |

### Row Level Security (RLS)

All database tables have RLS enabled with policies that enforce:
- **Read:** Authenticated users can read practice-level summaries
- **Write (tasks):** Users can only insert/update tasks for their own assignment
- **Write (users):** Users can only update their own `last_login` field
- **Admin override:** Admin role users have full read/write on all tables

### Approval Gating

- **Analytics and KPIs** (dashboard, forecasts, exports) use **approved-only** tasks/accomplishments.
- **Pending submissions** remain visible in lists with approval badges but are excluded from calculations.

---

## 5. Data Architecture

### Database Schema (ERD)

```
┌─────────────┐       ┌──────────────┐       ┌───────────────┐
│  quarters   │       │   practices  │       │    users      │
│─────────────│       │──────────────│       │───────────────│
│ id (PK)     │──┐    │ id (PK)      │──┐    │ id (PK)       │
│ label       │  │    │ name         │  │    │ auth_id (FK)  │
│ start_date  │  │    │ head         │  │    │ email         │
│ end_date    │  │    │ spoc         │  │    │ name          │
│ is_active   │  │    └──────────────┘  │    │ role          │
│ is_locked   │  │                      │    │ practice      │
│ targets     │  │                      │    │ is_active     │
└─────────────┘  │                      │    └───────────────┘
                 │                      │
      ┌──────────┴──────────┐           │
      │                     │           │
┌─────┴───────┐  ┌──────────┴──────┐   │
│   tasks     │  │accomplishments  │   │
│─────────────│  │─────────────────│   │
│ id (PK)     │  │ id (PK)         │   │
│ quarter_id  │  │ quarter_id      │   │
│ practice    │  │ practice        │   │
│ employee_*  │  │ title           │   │
│ category    │  │ ai_tool         │   │
│ ai_tool     │  │ impact/gains    │   │
│ time_*      │  │ status          │   │
│ quality_*   │  └─────────────────┘   │
└─────────────┘                        │
                                       │
┌──────────────┐    ┌──────────────────┤
│copilot_users │    │    projects      │
│──────────────│    │──────────────────│
│ id (PK)      │    │ id (PK)          │
│ practice     │────│ practice         │
│ name         │    │ project_name     │
│ email        │    │ project_code     │
│ status       │    │ customer         │
│ has_logged_  │    │ contract_value   │
│  task        │    │ start/end_date   │
└──────────────┘    └──────────────────┘
```

### Database Views

| View | Purpose |
|------|---------|
| `practice_summary` | Per-practice KPIs aggregated from tasks |
| `quarter_summary` | Per-quarter totals across all practices |
| `adoption_rates` | Licensed vs. active user calculations |

### use_cases Table

Stores AI Innovation approved reference use cases (40 EAS use cases from the AI Use Case Asset Template). Key columns: `asset_id`, `name`, `description`, `practice`, `sdlc_phase`, `category`, `subcategory`, `ai_tools`, `validation_detail`, `is_approved_reference`. Used by the Use Case Library UI and AI validation edge function.

---

## 6. Frontend Architecture

### Page Structure

| Page | Route | Role | Description |
|------|-------|------|-------------|
| `login.html` | / (unauthenticated) | All | Supabase Auth login form |
| `signup.html` | /signup.html | Public | 2-step contributor self-registration |
| `index.html` | / (authenticated) | All | Main SPA with 10 role-aware sections |
| `admin.html` | /admin.html | Admin | Legacy CRUD panel (deprecated — merged into index.html) |

### SPA Navigation (index.html)

```
Sidebar Menu
├── Dashboard         → renderDashboard()       (all roles)
├── Practices         → renderPractices()       (admin, spoc)
├── Tasks             → renderTasks()           (admin, spoc)
├── Accomplishments   → renderAccomplishments() (admin, spoc)
├── Copilot Users     → renderCopilotUsers()    (admin, spoc)
├── Projects          → renderProjects()        (admin, spoc)
├── SPOC Panel        → renderSPOCPanel()       (spoc only)
├── Leaderboard       → renderLeaderboard()     (all roles)
├── My Tasks          → renderMyTasks()         (contributor)
└── Use Cases         → renderUseCases()        (all roles) — AI Innovation approved + community
```

### JavaScript Module Dependencies

```
index.html
  ├── js/config.js (Supabase client, anon key)
  ├── js/auth.js   (EAS_Auth — login, roles, guards)
  ├── js/db.js     (EAS_DB — quarters, queries, filters)
  ├── js/utils.js  (EAS_Utils — formatting, sanitization)
  └── Chart.js + SheetJS (CDN)
```

### CSS Architecture

```
css/variables.css (∼188 lines — shared tokens + dark/light themes)
├── :root              → Dark theme tokens (default)
├── [data-theme="light"] → Light theme overrides
├── * reset            → Box-sizing, margin reset
├── .btn-*             → Button variants
├── .status-*          → Status badge colors
├── .toast             → Toast notification component
└── .hidden, .text-*, .fw-* → Utility classes

css/dashboard.css (∼789 lines — component styles)
├── Sidebar, KPIs, charts, tables, modals
├── Leaderboard, badges, SPOC panel
├── .skip-link         → Accessibility skip-to-content
├── .sr-only           → Screen-reader-only text
├── focus-visible      → Focus rings on interactive elements
├── .theme-toggle      → Dark/light mode switch
└── @media (prefers-reduced-motion) → Disable animations

login.html <style>     → Login page specific styles
signup.html <style>    → Signup page specific styles
```

---

## 7. Integration Points

| Integration | Protocol | Direction | Auth |
|------------|----------|-----------|------|
| Supabase Auth | HTTPS REST | Bi-directional | API Key |
| Supabase DB (PostgREST) | HTTPS REST | Read/Write | JWT + RLS |
| GitHub Pages | HTTPS | Serve static | None |
| SheetJS (CDN, deferred) | HTTPS | Client load | None |
| Chart.js (CDN, deferred) | HTTPS | Client load | None |
| jsPDF (CDN, deferred) | HTTPS | Client load | None |

---

## 8. Deployment Architecture

```
Developer Workstation
       │
       │ git push (master branch)
       ▼
GitHub Repository (omarhelal1234/eas-ai-dashboard)
       │
       │ GitHub Pages auto-deploy
       ▼
GitHub Pages CDN
       │
       │ HTTPS
       ▼
End User Browser ←──HTTPS──→ Supabase Cloud API
```

### Environments

| Environment | URL | Purpose |
|-------------|-----|---------|
| Production | `https://omarhelal1234.github.io/eas-ai-dashboard/` | Live dashboard |
| Supabase | `https://apcfnzbiylhgiutcjigg.supabase.co` | Backend API + DB |

---

## 9. Performance Considerations

| Concern | Mitigation |
|---------|-----------|
| Large dataset initial load | Client-side caching; pagination for >1000 rows |
| Chart rendering | Lazy-render charts on tab switch; destroy/recreate |
| CDN dependency | Chart.js, SheetJS, jsPDF loaded from reliable CDNs (deferred) |
| Supabase rate limits | Batch reads; minimize writes; debounce filters |
| Script load time | Chart.js/xlsx/jsPDF deferred; font preconnect; critical CSS inlined |
| Theme flash | Inline `<head>` script applies `data-theme` before first paint |

---

## 10. Architecture Evolution

| Phase | Architectural Change | Status |
|-------|---------------------|--------|
| Phase 1 | Supabase schema, migration, RLS, views | ✅ Complete |
| Phase 2 | Supabase Auth, quarter system, signup | ✅ Complete |
| Phase 3 | Live Supabase reads, modular CSS, pagination | ✅ Complete |
| Phase 4 | CRUD writes, audit logging, legacy removal | ✅ Complete |
| Phase 5 | SPOC panel, leaderboard, badges, nudge system | ✅ Complete |
| Phase 6 | PDF export, forecasting, accessibility, dark/light mode | ✅ Complete |
| Phase 7-9 | Export Center, AI Approval Workflow, Licensed Tool Tracking | ✅ Complete |
| Phase 10 | IDE Task Logger: VS Code extension + Edge Function API | 🚧 In Progress |

---

*See [CODE_ARCHITECTURE.md](CODE_ARCHITECTURE.md) for detailed code-level architecture.*  
*See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for phased delivery schedule.*

---

## Structural Update — 2026-04-11

HTML entry points were relocated from the repository root into `src/pages/`. Shared assets in `css/` and `js/` now resolve via `../../css/…` and `../../js/…`. Cross-page navigation between pages in `src/pages/` stays flat (e.g. `window.location.href = 'login.html'`).

See `docs/CODE_ARCHITECTURE.md` §2 for the authoritative tree and path convention, and `.github/copilot-instructions.md` for the mandatory workflow governing future changes (skills, Supabase MCP, full docs sweep, commit & push).
