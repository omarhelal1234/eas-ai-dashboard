# Code Architecture — EAS AI Dashboard

> **Last Updated:** April 13, 2026 | **Phase:** 10 (IDE Task Logger)
>
> **Layout note (2026-04-11):** All HTML entry points now live under `src/pages/`. Shared assets in `css/` and `js/` are referenced from those pages via `../../css/…` and `../../js/…`. See §2 for the updated tree and §6 for path examples.

---

## 1. System Overview

The EAS AI Dashboard is a **static-first web application** hosted on GitHub Pages with a Supabase (PostgreSQL) backend. It tracks AI tool adoption across 6 practices with integrated AI-assisted task/accomplishment submissions and multi-layer approval workflow in Ejada's Enterprise Application Solutions (EAS) department.

### Architecture Pattern

```
┌─────────────────────────────────────────────────────┐
│                   GitHub Pages                       │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │login.html│  │index.html│  │admin.html│  │signup.html│  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │              │              │                 │
│  ┌────┴──────────────┴──────────────┴────────────────┐     │
│  │              JS Modules Layer                │     │
│  │  config.js │ auth.js │ db.js │ utils.js     │     │
│  └──────────────────────┬──────────────────────┘     │
└─────────────────────────┼───────────────────────────┘
                          │ HTTPS (anon key)
                          ▼
┌─────────────────────────────────────────────────────┐
│                   Supabase                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐      │
│  │  Auth     │  │ PostgreSQL│  │  RLS Policies │      │
│  │  (JWT)    │  │  (9 tables)│  │  (per-role)   │      │
│  └──────────┘  └──────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────┘
```

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| No build step | Vanilla JS | GitHub Pages hosting, simple deployment |
| Supabase over Firebase | PostgreSQL + built-in Auth | Better SQL support, RLS, free tier |
| CDN libraries | Chart.js, SheetJS, jsPDF, PptxGenJS, html2canvas, Supabase JS | No npm build needed for frontend || AI Integration | OpenAI GPT-4 via Edge Functions | Suggestions and validation without exposing API keys |
| Approval Workflow | Multi-layer routing (AI → SPOC → Admin) | Smart triage based on saved hours and validation || Dark/Light theme | CSS custom properties + `[data-theme]` toggle | User preference, localStorage persistence |
| Single-page per HTML file | Multi-page SPA pattern | Works with GitHub Pages routing |
| WCAG 2.1 AA | Semantic HTML, ARIA, focus-visible | Accessibility compliance |

---

## 2. File Structure

```
./
│
├── index.html              # Redirect stub → src/pages/index.html
├── login.html              # Redirect stub → src/pages/login.html
├── signup.html             # Redirect stub → src/pages/signup.html
├── admin.html              # Redirect stub → src/pages/admin.html
├── employee-status.html    # Redirect stub → src/pages/employee-status.html
├── migrate.html            # Redirect stub → src/pages/migrate.html
│
├── src/
│   └── pages/              # Canonical HTML entry points (moved 2026-04-11)
│       ├── index.html              # Main app shell — 10 in-page views (~2,253 lines)
│       │                           # Dashboard, Practices, Tasks,
│       │                           # Accomplishments, Copilot, Projects,
│       │                           # SPOC Panel, Leaderboard, My Tasks, Use Cases
│       ├── login.html              # Supabase Auth login (email/password)
│       ├── signup.html             # Contributor self-registration (2-step form)
│       ├── admin.html              # Admin CRUD panel + Approvals tab
│       ├── employee-status.html    # Employee task approval status tracker
│       └── migrate.html            # One-time data migration tool
│
├── css/
│   ├── variables.css       # Design tokens, dark/light theme definitions, base reset
│   └── dashboard.css       # Component styles (sidebar, KPIs, charts, tables, modals, accessibility, theme toggle)
│
├── js/
│   ├── config.js           # Supabase URL + anon key + client factory
│   ├── auth.js             # EAS_Auth module: session, roles, guards
│   ├── db.js               # EAS_DB module: quarters, queries, CRUD writes, RPCs, audit, approved use cases
│   ├── phase8-submission.js # Phase 8 IIFE: AI suggestions, validation, approval workflow
│   └── utils.js            # EAS_Utils: format, sanitize, colors, dates
│
├── sql/
│   ├── 001_schema.sql      # Full Supabase schema (core tables, views, RLS, triggers)
│   ├── 002_approval_workflow.sql # Phase 8 approval workflow schema
│   ├── 003_use_cases.sql    # AI Innovation approved use cases seed data (40 EAS use cases)
│   └── 006_ide_api.sql      # Phase 10 IDE API schema (source column on tasks/accomplishments)
│
├── scripts/                # Node.js admin/migration scripts
│   ├── create-auth-users.mjs   # One-time auth user creation
│   ├── run-migration.mjs       # One-time data.js → Supabase migration
│   └── create-schema.mjs       # Schema execution (superseded by MCP)
│
├── docs/                   # Project documentation
│   ├── BRD.md                       # Business requirements
│   ├── HLD.md                       # High-level design
│   ├── CODE_ARCHITECTURE.md         # This file
│   ├── IMPLEMENTATION_NOTES.md      # Implementation details
│   ├── IMPLEMENTATION_PLAN.md       # Phased delivery roadmap
│   ├── ONBOARDING_GUIDE.md          # Setup & usage guide
│   ├── approval/                    # Approval workflow rules, setup, quickfix
│   ├── deployment/                  # Deployment notes, READY.txt, Phase 8 release doc
│   ├── phase8/                      # Phase 8 specs, test results, handover
│   └── testing/                     # Test plans
│
├── supabase/                # Supabase Edge Functions
│   └── functions/
│       ├── ai-suggestions/          # GPT-4 suggestion generation
│       ├── ai-validate/             # AI submission validation
│       └── ide-task-log/            # Phase 10: IDE Task Logger API (JWT auth, task submission)
│
├── vscode-extension/        # Phase 10: VS Code Extension
│   ├── src/
│   │   ├── extension.ts             # Entry point, command registration
│   │   ├── auth.ts                  # Supabase Auth (email/password → JWT)
│   │   ├── api.ts                   # Edge Function API client
│   │   ├── sidebar.ts               # Webview sidebar panel (task form + My Tasks)
│   │   ├── quickLog.ts              # Command Palette 5-step wizard
│   │   └── statusBar.ts             # Status bar item
│   ├── media/sidebar-icon.svg
│   ├── package.json             # Extension manifest + settings
│   └── tsconfig.json
│
├── server/                 # Node.js backend
│   ├── adoption-agent-endpoint.js   # Express API + Claude integration
│   ├── package.json
│   ├── README.md
│   └── SETUP_GUIDE.md
│
├── deploy/                 # Deployment shell scripts (DEPLOYMENT_MIGRATION.sh)
├── .github/                # Source-of-truth copilot-instructions.md, agents/, skills/
├── .env.example            # Environment variable template
├── .gitignore              # Ignores: .env, node_modules, logs
├── package.json            # Dependencies
├── CHANGELOG.md            # Append-only change log — every task adds an entry
└── README.md               # Project overview
```

### Path convention after 2026-04-11

HTML pages are at depth 2 (`src/pages/*.html`), so shared assets resolve as:

```html
<link rel="stylesheet" href="../../css/variables.css">
<link rel="stylesheet" href="../../css/dashboard.css">
<script src="../../js/config.js"></script>
<script src="../../js/auth.js"></script>
<script src="../../js/db.js"></script>
```

Cross-page navigation stays flat (same directory): `window.location.href = 'login.html'` from `admin.html` still resolves correctly because both live in `src/pages/`.

---

## 3. Module Architecture

### JS Modules (Browser-side)

All modules use the **Revealing Module Pattern** (IIFE returning a public API):

```
┌──────────────┐     ┌──────────────┐
│  config.js   │────▶│  Supabase    │
│  (client)    │     │  CDN Library  │
└──────┬───────┘     └──────────────┘
       │
       ├──────────────┐
       ▼              ▼
┌──────────────┐  ┌──────────────┐
│   auth.js    │  │    db.js     │
│  (EAS_Auth)  │  │  (EAS_DB)   │
│              │  │              │
│ - getSession │  │ - quarters   │
│ - getUser    │  │ - filtering  │
│ - roles      │  │ - Supabase   │
│ - signOut    │  │   queries    │
│ - UI guards  │  │ - selectors  │
└──────────────┘  └──────────────┘
       │              │
       └──────┬───────┘
              ▼
       ┌──────────────┐
       │  utils.js    │
       │ (EAS_Utils)  │
       │              │
       │ - sanitize   │
       │ - format     │
       │ - colors     │
       │ - dates      │
       └──────────────┘
```

| Module | Global Name | Responsibility |
|--------|-------------|----------------|
| `config.js` | `getSupabaseClient()` | Supabase client singleton |
| `auth.js` | `EAS_Auth` | Session management, role checks, auth guards, UI visibility |
| `db.js` | `EAS_DB` | Quarter loading/selection, full Supabase data layer (fetchAllData, per-entity fetches, CRUD writes, audit logging, data dumps, leaderboard RPCs) |
| `utils.js` | `EAS_Utils` | Formatting, XSS sanitization (sanitize, sanitizeObj, sanitizeDataset), practice mappings, chart colors, date parsing |

### Load Order (Critical)

```html
<!-- CSS -->
<link rel="stylesheet" href="css/variables.css">
<link rel="stylesheet" href="css/dashboard.css">

<!-- Core JS (sync, order-dependent) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="js/config.js"></script>   <!-- Must be first: creates Supabase client -->
<script src="js/utils.js"></script>    <!-- Pure utilities, no dependencies -->
<script src="js/auth.js"></script>     <!-- Depends on config.js -->
<script src="js/db.js"></script>       <!-- Depends on config.js -->

<!-- CDN Libraries (deferred for performance) -->
<script defer src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script defer src="https://cdn.sheetjs.com/.../xlsx.full.min.js"></script>
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js"></script>
<script defer src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
```

---

## 4. Database Schema

### Tables (10)

| Table | Purpose | Row Count (Phase 1) |
|-------|---------|---------------------|
| `practices` | 6 EAS practices (reference) | 6 |
| `quarters` | Q1-Q4 2026 with targets | 4 |
| `users` | App users with auth linkage | 6 |
| `tasks` | AI task log (core data) | 108 |
| `accomplishments` | Notable AI wins | 4 |
| `copilot_users` | License management | 146 |
| `projects` | Project portfolio | 22 |
| `lovs` | Lists of values (dropdowns) | 18 |
| `activity_log` | Audit trail (all CRUD operations) | Dynamic |
| `data_dumps` | JSON backup snapshots (admin) | Dynamic |

### Computed Columns

`tasks` table has two generated columns:
- `time_saved = time_without_ai - time_with_ai`
- `efficiency = (time_without - time_with) / time_without`
- `is_licensed_tool = LOWER(ai_tool) LIKE '%github copilot%' OR LOWER(ai_tool) LIKE '%m365 copilot%'` (Phase 9)

### Database Functions

| Function | Type | Purpose |
|----------|------|--------|
| `get_user_role()` | SQL | Returns role of currently authenticated user from `users` |
| `get_user_practice()` | SQL | Returns practice of currently authenticated user from `users` |
| `signup_contributor()` | SECURITY DEFINER | Creates `users` row + `copilot_users` row for new signups (role forced to `contributor`) |
| `get_practice_summary()` | SECURITY INVOKER | Quarter-aware practice summary (approved-only tasks) |
| `get_employee_leaderboard()` | SECURITY INVOKER | Employee rankings by approved tasks, hours saved, efficiency |
| `get_practice_leaderboard()` | SECURITY INVOKER | Practice rankings with weighted scoring (approved-only tasks/accomplishments) |
| `get_licensed_tool_adoption()` | SECURITY INVOKER | Per-practice licensed vs other tool task/hours breakdown (Phase 9) |

#### `signup_contributor()` Parameters

| Param | Type | Description |
|-------|------|------------|
| `p_auth_id` | uuid | Supabase Auth user ID |
| `p_name` | text | Full name |
| `p_email` | text | Ejada email |
| `p_practice` | text | Practice name |
| `p_skill` | text | Job title / skill |
| `p_has_copilot` | boolean | Has Copilot access? |

Returns `jsonb` with `{status, user_id, copilot_id?}`. Copilot logic:
- `true` → `copilot_users` row with `status = 'Active'`, `copilot_access_date = null`
- `false` → `copilot_users` row with `status = 'Pending'`, `copilot_access_date = 'Not Granted'`

### Views

- `practice_summary` — Aggregated stats per practice (approved-only tasks)
- `quarter_summary` — Aggregated stats per quarter (approved-only tasks)

### Row-Level Security

| Role | Scope |
|------|-------|
| **Admin** | Full read/write on all tables |
| **SPOC** | Read/write own practice, read aggregates |
| **Contributor** | Insert own tasks, read own data |

---

## 5. Authentication Flow

```
User → login.html
  │
  ├── supabase.auth.signInWithPassword(email, password)
  │     │
  │     ├── ✅ Success → fetch user profile from public.users
  │     │     │
  │     │     ├── Profile found → store in localStorage, redirect to index.html
  │     │     └── Profile NOT found → check localStorage for pending signup
  │     │           │
  │     │           ├── Found → call signup_contributor() RPC, then redirect
  │     │           └── Not found → show "profile not found" error
  │     │
  │     └── ❌ Fail → show error message
  │
index.html (on load)
  │
  ├── EAS_Auth.requireAuth()
  │     │
  │     ├── getUser() → validates JWT with Supabase server
  │     │     │
  │     │     ├── ✅ Valid → load profile, continue
  │     │     └── ❌ Invalid → redirect to login.html
  │     │
  │     └── EAS_Auth.applyRoleVisibility()
  │           └── Show/hide elements with data-role attributes
```

### Signup Flow

```
User → signup.html
  │
  ├── Step 1: Fill profile (dept, practice, name, email, skill, copilot Y/N)
  │
  ├── Step 2: Create password
  │
  ├── supabase.auth.signUp(email, password)
  │     │
  │     ├── Auto-confirm ON → session returned immediately
  │     │     └── Call signup_contributor() RPC → redirect to dashboard
  │     │
  │     └── Auto-confirm OFF → no session
  │           └── Store profile in localStorage (eas_pending_signup)
  │           └── Show "check email" screen
  │           └── On first login → login.html completes RPC call
```

---

## 6. Data Flow (Phase 3: Full Supabase)

All dashboard data is now fetched live from Supabase:

```
boot() → EAS_DB.fetchAllData(quarterId)
       │
       ├─ fetchPracticeSummary() via RPC get_practice_summary()
       ├─ fetchTasks()            via tasks table (quarter-filtered)
       ├─ fetchAccomplishments()  via accomplishments table (quarter-filtered)
       ├─ fetchCopilotUsers()     via copilot_users table (all quarters)
       ├─ fetchProjects()         via projects table (all quarters)
       └─ fetchLovs()             via lovs table
       │
       ▼
  EAS_Utils.sanitizeDataset(data)  →  XSS-safe data object
       │
       ▼
  renderDashboard() / renderTasks() / etc.
```

### Quarter Switching

When the user changes the quarter selector:
1. `quarter-changed` event fires
2. `EAS_DB.fetchAllData(newQuarter)` re-fetches all data
3. Data is sanitized and stored in `data` variable
4. All visible pages re-render

### Data Shape

The `fetchAllData()` function returns an object matching the legacy APP_DATA structure:

```js
{
  summary: { practices: [...], totals: {...} },
  tasks: [...],
  accomplishments: [...],
  copilotUsers: [...],
  projects: [...],
  lovs: { taskCategories: [...], aiTools: [...], licensedTools: [...], otherTools: [...] },
  licensedToolAdoption: [...],   // Phase 9: per-practice licensed/other breakdown
  licensedTotals: { licensedTasks, otherTasks, licensedHours, otherHours }  // Phase 9
}
```

The db.js transform layer converts snake_case DB columns to camelCase, ensuring render functions work unchanged.

### Licensed Tool Constants (Phase 9)

```js
EAS_DB.LICENSED_TOOLS  // ['Github Copilot', 'M365 Copilot']
EAS_DB.isLicensedTool('Github Copilot')  // true
EAS_DB.isLicensedTool('Claude')           // false
```

---

## 7. CSS Architecture

### Design Tokens (`css/variables.css`)

All colors, spacing, and component styles are defined as CSS custom properties in `:root` (dark theme default). The light theme is defined in `[data-theme="light"]` which overrides all color tokens.

### Theme System

- **Dark theme** (default): `:root` block in `variables.css`
- **Light theme**: `[data-theme="light"]` block in `variables.css` overrides color tokens
- **Toggle**: Sidebar button calls `toggleTheme()`, persists to `localStorage('eas-theme')`
- **Persistence**: All 3 pages (index, login, signup) have an inline `<head>` script that applies the theme before first paint
- **Charts**: `updateChartTheme()` reads computed CSS and updates Chart.js tick/grid/legend colors

### Style Scoping

- `variables.css` (~188 lines) — Design tokens, dark + light theme definitions, base reset, shared components
- `dashboard.css` (~789 lines) — Component styles (sidebar, KPIs, charts, tables, modals, leaderboard, badges, accessibility, theme toggle)
- Inline `<style>` blocks — Remaining in login.html, signup.html, admin.html (page-specific layout only)

### Accessibility Styles

- `.skip-link` — Hidden skip-to-content link, visible on focus
- `.sr-only` — Screen-reader-only text
- `focus-visible` — Focus rings on all interactive elements (buttons, nav items, inputs, pagination)
- `@media (prefers-reduced-motion)` — Disables all animations and transitions

### Color System

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#3b82f6` | Primary actions, links |
| `--success` | `#10b981` | Positive metrics, completed |
| `--warning` | `#f59e0b` | Caution, pending |
| `--danger` | `#ef4444` | Errors, destructive |
| `--purple` | `#8b5cf6` | Quality ratings, EPS practice |
| `--pink` | `#ec4899` | GRC practice |
| `--info` | `#06b6d4` | EPCS practice, informational |

---

## 8. Security Model

### Keys & Secrets

| Key | Location | Access Level |
|-----|----------|-------------|
| Anon Key | `js/config.js` (public) | Read with RLS enforcement |
| Service Role Key | `.env` only (never committed) | Full admin, bypasses RLS |

### XSS Prevention

`EAS_Utils.sanitize()` escapes HTML entities before any `innerHTML` insertion. All user-facing data should pass through this function.

### Client-Side Role Limitation

Role checks via `EAS_Auth.isAdmin()` control **UI visibility only**. Actual data access is enforced by Supabase RLS policies server-side.

---

## 9. Known Technical Debt

| # | Issue | Priority | Status |
|---|-------|----------|--------|
| 1 | ~~`index.html` is ~5,400 lines (monolith)~~ Reduced to ~2,253 lines (10 pages) | ~~HIGH~~ DONE | Phase 3 ✅ |
| 2 | ~~`admin.html` uses hardcoded auth~~ CRUD merged into index.html; admin.html deprecated | ~~HIGH~~ DONE | Phase 4 ✅ |
| 3 | ~~Dashboard reads static `APP_DATA`~~ Now reads live from Supabase | ~~HIGH~~ DONE | Phase 3 ✅ |
| 4 | ~~CSS partially duplicated~~ dashboard.css extracted | ~~MEDIUM~~ DONE | Phase 3 ✅ |
| 5 | ~~`data.js` summary rows contaminate task data~~ data.js removed | ~~MEDIUM~~ DONE | Phase 3 ✅ |
| 6 | ~~No pagination on tables~~ Tasks table paginated (25/page) | ~~LOW~~ DONE | Phase 3 ✅ |
| 7 | ~~No error boundary on boot failure~~ Loading states and error handling added | ~~LOW~~ DONE | Phase 6 ✅ |
| 8 | ~~Save functions write to in-memory only~~ All CRUD writes to Supabase | ~~HIGH~~ DONE | Phase 4 ✅ |
| 9 | login.html / signup.html CSS still inline | LOW | Remaining (cosmetic) |

---

*Document maintained as part of the EAS AI Dashboard project. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for phase details.*
