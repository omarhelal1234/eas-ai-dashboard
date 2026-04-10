# EAS AI Adoption Dashboard — Full Enhancement Prompt for GitHub Copilot

> **Context:** This is a GitHub Pages-hosted static website (`index.html` + `data.js` + Chart.js) for tracking AI adoption across Ejada's EAS department (6 practices, 120+ licensed users). The current version has no authentication, no quarter separation, and stores everything in a flat `data.js` JSON blob. I want to transform it into a proper multi-role, quarter-aware dashboard with a free backend database.

---

## CURRENT STATE (What Already Exists)

**Tech stack:** Single `index.html` (5200 lines) + `data.js` (3700 lines), Chart.js for charts, SheetJS for Excel import/export, Google Fonts (Inter), dark theme with CSS variables. Hosted on GitHub Pages.

**Current pages:**
1. **Dashboard** — KPI cards (tasks, hours saved, efficiency, quality), 6 charts (tasks by practice, time saved, efficiency, tools usage, categories, weekly trend)
2. **Practice Tracking** — 6 practice cards with stats + drill-down to practice-level task table
3. **All Tasks** — filterable table (practice, category, tool, status) with search
4. **Accomplishments** — card-based view of notable AI wins with impact details
5. **Copilot Access** — user management table for GitHub Copilot licenses
6. **Projects** — project listing table with metadata (customer, value, dates, PM)

**Current data model (in data.js):**
- `summary.practices[]` — per-practice aggregates (tasks, time, efficiency, quality, projects)
- `summary.totals` — program-level aggregates
- `tasks[]` — individual task records (practice, week, project, employee, task, category, aiTool, timeWithout, timeWith, timeSaved, efficiency, quality, status, notes)
- `accomplishments[]` — achievement records (practice, date, project, employees, title, details, tool, category, before/after, impact, gains, effort, status)
- `copilotUsers[]` — user records (practice, name, email, skill, status)
- `projects[]` — project records (practice, name, code, customer, value, start, end, revenueType, pm)

**Six practices:**
| Practice | Head | AI SPOC | Licensed Users |
|----------|------|---------|---------------|
| BFSI | Mohab ElHaddad | Omar Ibrahim | ~41 |
| CES | Osama Nagdy | Norah Al Wabel | ~13 |
| ERP | Amer Farghaly | Reham Ibrahim | 60+ |
| EPS | Mohamed Ziaudin | Yousef Milhem | ~2 |
| GRC | Ahmed Madkour | Mohamed Essam | ~3 |
| EPCS | Mohamed Mobarak | Ahmed Shaheen | ~3 |

---

## ENHANCEMENT REQUIREMENTS

### 1. BACKEND & DATABASE (Free Tier)

Replace the static `data.js` with a real backend. Use one of these free options:
- **Supabase** (PostgreSQL, free tier: 500MB, built-in auth) — **RECOMMENDED**
- OR Firebase (Firestore, free tier)
- OR PocketBase (self-hosted, SQLite)

**Database schema:**

```sql
-- Users & Auth
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'spoc', 'contributor')),
  practice TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Quarters
CREATE TABLE quarters (
  id TEXT PRIMARY KEY, -- e.g., 'Q1-2026', 'Q2-2026'
  label TEXT NOT NULL, -- e.g., 'Q1 2026'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT false,
  targets JSONB DEFAULT '{}' -- per-quarter targets like adoption_rate_target, task_target, etc.
);

-- Tasks (the core tracking table)
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter_id TEXT REFERENCES quarters(id),
  practice TEXT NOT NULL,
  week_number INT,
  week_start DATE,
  week_end DATE,
  project TEXT,
  project_code TEXT,
  employee_name TEXT NOT NULL,
  employee_email TEXT,
  task_description TEXT NOT NULL,
  category TEXT NOT NULL, -- Development, Documentation, Testing, Database, Code Review, etc.
  ai_tool TEXT NOT NULL, -- GitHub Copilot, Claude, ChatGPT, M365 Copilot, Cursor, etc.
  prompt_used TEXT,
  time_without_ai NUMERIC(8,2),
  time_with_ai NUMERIC(8,2),
  time_saved NUMERIC(8,2) GENERATED ALWAYS AS (time_without_ai - time_with_ai) STORED,
  efficiency NUMERIC(5,4) GENERATED ALWAYS AS (
    CASE WHEN time_without_ai > 0 THEN (time_without_ai - time_with_ai) / time_without_ai ELSE 0 END
  ) STORED,
  quality_rating NUMERIC(2,1) CHECK (quality_rating BETWEEN 1 AND 5),
  status TEXT DEFAULT 'Completed',
  notes TEXT,
  logged_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Accomplishments
CREATE TABLE accomplishments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter_id TEXT REFERENCES quarters(id),
  practice TEXT NOT NULL,
  date DATE,
  project TEXT,
  spoc TEXT,
  employees TEXT,
  title TEXT NOT NULL,
  details TEXT,
  ai_tool TEXT,
  category TEXT,
  before_baseline TEXT,
  after_result TEXT,
  quantified_impact TEXT,
  business_gains TEXT,
  effort_saved NUMERIC(8,2),
  status TEXT DEFAULT 'Completed',
  logged_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Copilot Users (license management)
CREATE TABLE copilot_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role_skill TEXT,
  status TEXT DEFAULT 'access granted', -- access granted, pending, revoked
  has_logged_task BOOLEAN DEFAULT false,
  last_task_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  customer TEXT,
  value_sar NUMERIC(12,2),
  start_date DATE,
  end_date DATE,
  revenue_type TEXT,
  pm TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Activity log (audit trail)
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL, -- 'task_created', 'task_edited', 'user_added', etc.
  entity_type TEXT, -- 'task', 'accomplishment', 'user', etc.
  entity_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Row-Level Security (RLS) policies:**
- Admin (Omar): full read/write access to everything
- SPOC: full read/write for their own practice, read-only for other practices' aggregated data (not individual records)
- Contributor: can log tasks for their own practice, read their own tasks, read program-level aggregates

---

### 2. AUTHENTICATION & ROLE-BASED ACCESS

Implement auth using Supabase Auth (or Firebase Auth). Three roles:

**Admin (Omar Ibrahim — oibrahim@ejada.com):**
- Sees EVERYTHING across all 6 practices
- Full CRUD on all records
- Access to admin panel, user management, quarter management
- Can export data, generate reports
- Sees data quality alerts and risk indicators

**AI SPOC (one per practice):**
- Default view: their own practice dashboard
- Can see program-level aggregates (but not other practices' individual tasks)
- Full CRUD on their own practice's tasks and accomplishments
- Can manage their practice's copilot users
- Can see their practice vs. program averages for benchmarking
- Cannot access admin panel or user management

**Contributor (regular licensed users):**
- Can log their own tasks via a simplified form
- Can see their personal stats (tasks logged, hours saved, efficiency)
- Can see their practice's leaderboard
- Cannot edit other people's tasks
- Cannot see admin/SPOC management features

**Login page:** clean, branded login with Ejada/EAS branding. Support email/password auth. After login, redirect based on role.

---

### 3. QUARTER SEGREGATION

This is critical. Every data view must be quarter-aware.

**Quarter Selector:** a prominent dropdown/tab in the page header that filters ALL data on ALL pages. Options: Q1 2026, Q2 2026, Q3 2026, Q4 2026 (auto-generate future quarters). Also include an "All Time" option for cumulative views.

**Per-Quarter Features:**
- Each quarter has independent KPIs, charts, and tables
- Dashboard shows CURRENT quarter by default, with comparison deltas to previous quarter (e.g., "↑ 23% vs Q1" or "↓ 5% vs Q1")
- Quarter comparison mode: side-by-side or overlaid charts comparing any two quarters
- Quarter targets: admin can set per-quarter goals (e.g., Q2 target: 100 tasks, 500 hrs saved, 25% adoption rate) — show progress bars against these targets
- Quarter summary cards: at the top of the dashboard, show the selected quarter's headline metrics

**Quarter Data Isolation:**
- When user logs a task, auto-assign it to the current active quarter based on the date
- Historical tasks remain in their original quarter
- Accomplishments, copilot user changes, etc., all tagged with quarter

**Quarter Transition:**
- Admin can "close" a quarter (marks it read-only for contributors)
- Admin can "open" a new quarter
- Previous quarter data remains accessible for viewing

---

### 4. ADMIN PANEL (New Section — Admin Only)

Add a new "Admin" section in the sidebar (visible only to admin role). Include these sub-pages:

#### 4a. Program Command Center
- **Risk Radar:** a visual grid (6 practice cards) colored green/yellow/red based on:
  - Green: adoption rate > 20%, tasks logged this quarter, data quality > 80%
  - Yellow: adoption rate 10-20%, or data quality 60-80%, or declining from last quarter
  - Red: adoption rate < 10%, or zero tasks, or data quality < 60%
- **Key Alerts Panel:** auto-generated alerts like:
  - "ERP has 60+ licenses but 0 tasks logged in Q2"
  - "3 copilot users have never logged a task in 60+ days"
  - "EPCS tasks are missing time data — efficiency cannot be calculated"
  - "EPS has only 2 licensed users — consider expanding"
- **Quarter Progress:** large progress bars showing current quarter vs. targets

#### 4b. User Management
- Full table of all users in the system (admin, SPOCs, contributors)
- Add/edit/deactivate users
- Assign roles and practices
- See each user's activity: last login, tasks logged, last task date
- Bulk actions: invite users, reset passwords
- **License Utilization:** show licensed users vs. active users per practice, flag waste

#### 4c. Quarter Management
- Create/edit/close quarters
- Set per-quarter targets: task count target, hours saved target, adoption rate target, quality target
- View quarter-over-quarter trend charts
- Export quarterly reports (PDF/Excel)

#### 4d. Data Quality Monitor
- Table showing data completeness per practice per quarter
- Flag: tasks without employee names, blank time fields, missing status, quality = 0
- Data quality score per practice (% of tasks with all mandatory fields filled)
- Action items: "12 tasks in BFSI are missing quality ratings — notify SPOC"

#### 4e. Audit Trail
- Activity log showing who did what and when
- Filterable by user, action type, date range
- Actions tracked: task_created, task_edited, task_deleted, user_added, user_deactivated, quarter_created, export_generated

---

### 5. AI SPOC PANEL (New Section — SPOC Only)

When a SPOC logs in, they see their practice-specific dashboard as the default. Add these SPOC-specific features:

#### 5a. My Practice Dashboard
- Same KPI cards and charts as the main dashboard, but filtered to their practice only
- **Adoption Rate Widget:** large visual showing (active contributors / licensed users) with the 30% target line
- **vs. Program Average:** show their practice's metrics compared to the EAS average (e.g., "Your efficiency: 52.2% | EAS avg: 73.7%")
- **Quarter Trend:** mini sparkline charts showing their practice's task count and efficiency trend across quarters

#### 5b. My Team
- Table of all licensed users in their practice
- Columns: name, email, role, tasks logged (this quarter), last task date, status (active/inactive/never-logged)
- **Nudge Button:** click to mark a user as "nudged" (records the date, shows a badge) — helps SPOCs track follow-ups
- **Inactive Alert:** highlight users who haven't logged a task in 14+ days in yellow, 30+ days in red
- Quick add: add a new team member to the copilot users list

#### 5c. Use Case Library
- Pre-populated list of AI use cases organized by role (Developer, BA, PM, Tester, DBA, Architect)
- Each use case: title, description, recommended AI tool, estimated time saving, difficulty (easy/medium/hard)
- SPOC can mark use cases as "tried" or "not applicable" for their practice
- SPOC can add custom use cases specific to their practice
- Use cases with sample data:

| Role | Use Case | Tool | Est. Time Saving | Difficulty |
|------|----------|------|-----------------|------------|
| Developer | Code generation for repetitive patterns | GitHub Copilot | 40-60% | Easy |
| Developer | Unit test scaffolding | GitHub Copilot | 50-70% | Easy |
| Developer | Code refactoring assistance | GitHub Copilot / Claude | 30-50% | Medium |
| Developer | API integration boilerplate | GitHub Copilot | 40-60% | Easy |
| Developer | Database query optimization | GitHub Copilot / Claude | 30-50% | Medium |
| BA | Requirements documentation (HLD/FSD) | Claude / ChatGPT | 40-60% | Easy |
| BA | User story writing from specs | Claude / ChatGPT | 50-70% | Easy |
| BA | Data validation scripts | GitHub Copilot | 30-50% | Medium |
| BA | Process flow documentation | ChatGPT + Eraser AI | 40-60% | Easy |
| PM | Status report drafting | Claude / M365 Copilot | 50-70% | Easy |
| PM | Meeting minutes from transcripts | M365 Copilot | 60-80% | Easy |
| PM | Risk register updates | Claude / ChatGPT | 30-50% | Easy |
| PM | Stakeholder email drafting | Claude / ChatGPT | 40-60% | Easy |
| Tester | Test case generation | Claude / GitHub Copilot | 50-70% | Easy |
| Tester | Test data creation | GitHub Copilot | 40-60% | Medium |
| Tester | Regression test planning | Claude | 30-50% | Medium |
| DBA | SQL query optimization | GitHub Copilot / Claude | 40-60% | Medium |
| DBA | PL/SQL conversion and migration | GitHub Copilot | 30-50% | Hard |
| Architect | RFP response drafting | Claude | 40-60% | Medium |
| Architect | Architecture decision documentation | Claude | 50-70% | Easy |
| Architect | Technical debt assessment | Claude | 30-50% | Medium |

#### 5d. Task Approval Queue (Optional)
- If enabled, contributor-submitted tasks go to "pending approval" state
- SPOC can review and approve/reject/request-edit before they count in metrics
- This ensures data quality without needing the admin to police everything

---

### 6. CONTRIBUTOR VIEW (Simplified Interface)

When a contributor (regular user) logs in, they see a simplified view:

#### 6a. My Dashboard
- Personal stats: tasks logged this quarter, total hours saved, average efficiency, quality rating
- Streak/badge: "5 tasks this quarter!" or "First task logged!" gamification
- Quick log button: prominent "Log AI Task" button

#### 6b. Log Task (Simplified Form)
- Pre-filled: practice (from their profile), employee name (from their profile), quarter (current)
- They only need to fill: project (dropdown), task description, category, AI tool, time without AI, time with AI, quality rating, notes
- Auto-calculated: time saved, efficiency
- Submit → task goes to SPOC's approval queue (if enabled) or directly to the database

#### 6c. My Tasks
- Table of their own submitted tasks with edit/delete capability (within current quarter only)
- Cannot see other contributors' tasks

#### 6d. Practice Leaderboard
- Anonymous or named leaderboard showing top contributors in their practice by tasks logged, hours saved
- Motivates engagement

---

### 7. ENHANCED DASHBOARD FEATURES (For All Roles)

Upgrade the existing dashboard with:

#### 7a. Quarter Comparison Widget
- Toggle: "Compare with previous quarter"
- Shows delta arrows on every KPI card: ↑ +23% or ↓ -5%
- Overlaid chart option: current quarter vs. previous quarter line charts

#### 7b. Adoption Rate Tracking
- New KPI card: "Adoption Rate" = active contributors / licensed users
- Target line at 30%
- Broken down by practice in a horizontal bar chart
- Highlight: currently ~13% (16 out of 120+) — this is the most important metric to visualize

#### 7c. Tool Diversification Tracker
- Chart showing tool usage distribution over time
- Currently 95% GitHub Copilot — show a "diversification score" and trend
- Track Claude, ChatGPT, M365 Copilot, Cursor adoption over quarters

#### 7d. Inactive Users Widget (Admin/SPOC only)
- Card showing: "X users have licenses but haven't logged a task in 30+ days"
- Click to expand: see the list, with practice and last activity date
- Action buttons: "Nudge SPOC" or "Send Reminder"

#### 7e. Data Quality Score
- Overall data quality % shown as a small badge on the dashboard
- Calculated: (tasks with all fields filled / total tasks) × 100
- Drill-down: which fields are most commonly missing

#### 7f. Practice Heatmap
- 6-cell grid, one per practice
- Color: green (on track), yellow (needs attention), red (critical gap)
- Show: practice name, task count, adoption rate, trend arrow
- Click to drill down to practice detail

---

### 8. LEADERBOARD & GAMIFICATION (New Page)

Add a new "Leaderboard" page accessible to all roles:

- **Individual Rankings:** top contributors by tasks logged, hours saved, highest efficiency
- **Practice Rankings:** practices ranked by composite score (weighted: 40% adoption rate, 30% task volume, 20% efficiency, 10% quality)
- **Badges:** visual badges awarded automatically:
  - "First Task" — logged their first AI task
  - "Power User" — 10+ tasks in a quarter
  - "Time Saver" — saved 50+ hours total
  - "Quality Champion" — average quality ≥ 4.5
  - "Tool Explorer" — used 3+ different AI tools
  - "Streak Master" — logged tasks in 4+ consecutive weeks
- **Quarterly Awards:** "Practice of the Quarter," "Most Improved Practice," "Top Contributor"

---

### 9. NOTIFICATIONS & ALERTS

#### 9a. In-App Notifications
- Bell icon in the header with notification count
- Notifications for:
  - Admin: new tasks logged, data quality issues, quarter milestones reached
  - SPOC: new tasks from their team, inactive user alerts, practice milestone reached
  - Contributor: badge earned, task approved/rejected, weekly reminder to log tasks

#### 9b. Email Digests (Optional, using Supabase Edge Functions or similar)
- Weekly summary email to SPOCs: tasks logged, active users, gaps
- Monthly summary to admin: program-level metrics, quarter progress, risk alerts

---

### 10. REPORTS & EXPORTS (Admin Only)

Enhance the existing export with:

- **Quarterly Report Generator:** one-click generation of a formatted summary including all KPIs, charts (as images), practice breakdown, top accomplishments, and recommendations
- **Practice Report:** export a single practice's data for sharing with practice heads
- **Excel Export:** enhanced with proper formatting, multiple sheets (summary, tasks, accomplishments, users), quarter-filtered
- **PDF Export:** formatted executive summary with charts

---

### 11. RESPONSIVE & UX IMPROVEMENTS

- **Dark/Light Mode Toggle:** add a theme switcher (currently dark only)
- **Onboarding Flow:** first-time users see a quick tour explaining the dashboard
- **Loading States:** skeleton screens while data loads from Supabase
- **Error Handling:** friendly error messages, retry buttons, offline detection
- **Accessibility:** ARIA labels, keyboard navigation, screen reader support
- **Mobile Improvements:** the current mobile layout works but needs better touch targets and a simplified mobile navigation

---

### 12. TECHNICAL IMPLEMENTATION NOTES

**Migration strategy from current static site:**
1. Keep the current `index.html` structure and styling (dark theme, sidebar nav, CSS variables)
2. Replace `data.js` with Supabase client API calls
3. Add authentication flow (login page → role-based routing)
4. Add quarter selector to the header (persists across page navigation)
5. Split the monolithic `index.html` into components if migrating to a framework, OR keep as enhanced vanilla JS with modules

**Recommended approach:**
- Keep it as a static site on GitHub Pages (no framework migration needed)
- Use Supabase JS client (`@supabase/supabase-js`) loaded via CDN
- Supabase handles: auth, database, real-time subscriptions, row-level security
- All business logic stays in the frontend (dashboard calculations, chart rendering)
- Use Supabase Edge Functions for any server-side logic (email digests, scheduled reports)

**Key Supabase CDN import:**
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
```

**Data migration:**
- Write a one-time migration script that reads the current `data.js` and inserts all existing records into the Supabase tables
- Tag all migrated data as quarter_id = 'Q1-2026'
- After migration, `data.js` is no longer needed

**File structure after enhancement:**
```
eas-ai-dashboard/
├── index.html              # Main app shell with all pages
├── css/
│   └── styles.css          # Extracted from inline styles
├── js/
│   ├── config.js           # Supabase URL, anon key
│   ├── auth.js             # Login, logout, session management
│   ├── db.js               # Supabase CRUD operations
│   ├── dashboard.js        # Dashboard rendering & charts
│   ├── practices.js        # Practice tracking page
│   ├── tasks.js            # Task management page
│   ├── accomplishments.js  # Accomplishments page
│   ├── copilot.js          # Copilot user management
│   ├── projects.js         # Projects page
│   ├── admin.js            # Admin panel pages
│   ├── spoc.js             # SPOC-specific features
│   ├── leaderboard.js      # Leaderboard & gamification
│   ├── notifications.js    # In-app notification system
│   ├── reports.js          # Export & report generation
│   └── app.js              # App initialization, routing, nav
├── migrate-data.js         # One-time migration from data.js
└── README.md
```

---

## PRIORITY ORDER FOR IMPLEMENTATION

Build in this order:

1. **Supabase setup** — create project, define tables, set up auth, RLS policies
2. **Authentication** — login page, role detection, route protection
3. **Quarter segregation** — quarter selector, quarter-aware queries, quarter management
4. **Data migration** — move existing data.js into Supabase as Q1-2026
5. **Admin panel** — command center, user management, data quality monitor
6. **SPOC panel** — practice dashboard, my team, nudge system
7. **Contributor view** — simplified task logging, personal stats
8. **Enhanced dashboard** — adoption rate tracking, quarter comparison, heatmap
9. **Leaderboard & gamification** — badges, rankings
10. **Use case library** — pre-populated, SPOC-manageable
11. **Notifications** — in-app alerts
12. **Reports & exports** — enhanced export capabilities
13. **UX polish** — theme toggle, onboarding, loading states

---

## DESIGN GUIDELINES

- **Keep the existing dark theme** as the default — it looks professional and modern
- **Color system:** use the existing CSS variables (--accent: blue, --success: green, --warning: yellow, --danger: red)
- **Typography:** keep Inter font family
- **Cards & borders:** maintain the current rounded card style with subtle borders
- **Charts:** keep Chart.js, maintain consistent color palette across all charts
- **Animations:** subtle hover effects and transitions (already in place), add skeleton loading screens
- **Branding:** keep "EAS AI Adoption" header, add Ejada logo if available

---

## IMPORTANT CONTEXT FOR AI TOOL

When implementing, keep in mind:
- This is for an enterprise department (EAS) at Ejada, a Saudi Arabia-based IT services company
- The primary admin user is Omar Ibrahim (oibrahim@ejada.com) — Overall AI SPOC and BFSI SPOC
- Q1 2026 is the baseline quarter (50 tasks, 206 hrs saved, 73.7% efficiency, 4.2 quality)
- ERP is the critical gap: 60+ licenses, historically zero tasks — needs special attention in the UI
- Only ~13% of licensed users are active — adoption rate is THE key metric
- GitHub Copilot is ~95% of tool usage — diversification is a goal
- The dashboard must work well for executive presentations (clean, data-driven, professional)
