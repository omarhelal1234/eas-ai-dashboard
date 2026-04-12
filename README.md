# EAS AI Adoption Dashboard

Enterprise AI adoption tracking platform for Enterprise Application Solutions (EAS), covering 6 practices and 120+ licensed users across GitHub Copilot, Claude, ChatGPT, and other AI tools. **Phase 10 In Progress:** VS Code extension for logging AI tasks directly from the IDE, backed by a new Supabase Edge Function API.

## Live URLs

| Page | URL |
|------|-----|
| **Dashboard** | https://omarhelal1234.github.io/eas-ai-dashboard/ |
| **Login** | https://omarhelal1234.github.io/eas-ai-dashboard/login.html |
| **Signup** | https://omarhelal1234.github.io/eas-ai-dashboard/signup.html |

> The root URLs above are thin redirect stubs that forward to the canonical pages under `src/pages/`. Existing bookmarks and OAuth redirect URIs continue to work unchanged.

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS, Chart.js 4.4.1, SheetJS 0.18.5, jsPDF 2.5.2
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Edge Functions)
- **AI Services:** OpenAI GPT-4 (suggestions & validation)
- **Hosting:** GitHub Pages (static site) + Supabase Cloud
- **Design:** Dark/Light theme toggle, Inter font, responsive sidebar navigation
- **Approval Workflow:** Multi-layer routing engine with smart triage
- **Accessibility:** WCAG 2.1 AA compliant

## Project Structure

```
./
├── src/
│   └── pages/                      # All HTML entry points
│       ├── index.html              # Main dashboard (10 role-aware pages + inline CRUD)
│       ├── login.html              # Authentication page
│       ├── signup.html             # Contributor self-registration
│       ├── admin.html              # Admin CRUD panel + Approvals management tab
│       ├── employee-status.html    # Employee task approval status tracker
│       └── migrate.html            # Browser-based migration tool
│
├── css/
│   ├── variables.css               # Design tokens, dark/light theme definitions
│   └── dashboard.css               # Dashboard component styles, accessibility, theme toggle
│
├── js/
│   ├── config.js                   # Supabase client configuration
│   ├── auth.js                     # Authentication & session management (EAS_Auth)
│   ├── db.js                       # Full Supabase data layer — reads, writes, RPCs, audit
│   ├── phase8-submission.js        # Phase 8 AI submission module
│   └── utils.js                    # Shared utilities (formatting, sanitize, colors)
│
├── sql/
│   ├── 001_schema.sql              # Complete database schema
│   └── 002_approval_workflow.sql   # Phase 8 approval workflow schema
│
├── supabase/
│   └── functions/                  # Supabase Edge Functions
│       ├── ai-suggestions/         # GPT-4 suggestion generation
│       ├── ai-validate/            # AI validation of submissions
│       └── ide-task-log/           # Phase 10: IDE Task Logger API
│
├── vscode-extension/               # Phase 10: VS Code Extension
│   ├── src/                        # TypeScript source (auth, api, sidebar, quickLog)
│   ├── media/                      # Extension icons
│   └── package.json                # Extension manifest
│
├── scripts/                        # Node.js dev/admin scripts + verify-setup.sh
│   ├── create-auth-users.mjs
│   ├── run-migration.mjs
│   ├── create-schema.mjs
│   └── verify-setup.sh
│
├── deploy/                         # Deployment shell scripts
│   └── DEPLOYMENT_MIGRATION.sh
│
├── docs/                           # Project documentation
│   ├── BRD.md                      # Business requirements
│   ├── HLD.md                      # High-level architecture
│   ├── CODE_ARCHITECTURE.md        # System design and file structure
│   ├── IMPLEMENTATION_PLAN.md      # Phased delivery roadmap
│   ├── IMPLEMENTATION_NOTES.md     # Technical implementation details
│   ├── ONBOARDING_GUIDE.md         # Setup and usage guide
│   ├── EDGE_FUNCTIONS_DEPLOYED.md  # Edge Function deployment guide
│   ├── SUPABASE_EDGE_FUNCTIONS.md  # Edge Function reference
│   ├── QUICK_TEST_DEPLOY.md        # Quick testing guide
│   ├── EAS_AI_Dashboard_Enhancement_Prompt.md
│   ├── approval/                   # Approval workflow docs (setup, quickfix)
│   ├── deployment/                 # Deployment notes (PHASE8, READY.txt)
│   ├── phase8/                     # Phase 8 specs, test results, handover
│   └── testing/                    # Test plans
│
├── server/                         # AI Adoption Agent backend
│   ├── adoption-agent-endpoint.js  # Express API (Claude + Supabase)
│   ├── package.json                # Backend dependencies
│   ├── .env.example                # Environment template
│   ├── README.md                   # API documentation
│   ├── SETUP_GUIDE.md              # Deployment guide
│   └── QUICK_START.md              # 5-minute setup
│
├── .github/
│   ├── copilot-instructions.md     # Source-of-truth instructions for Claude + Copilot
│   ├── agents/                     # Agent definitions
│   └── skills/                     # UI/UX Pro, Superpowers, Supabase skills
├── .env.example                    # Environment variable template
├── .gitignore
├── CHANGELOG.md                    # Append-only change log
├── package.json
└── README.md
```

## Getting Started

1. Clone the repository
2. Copy `.env.example` to `.env` and add your Supabase keys
3. Run `npm install`
4. Set up Supabase tables and RLS policies (see [docs/phase8/PHASE_8_SETUP.md](docs/phase8/PHASE_8_SETUP.md))
5. Deploy Edge Functions via Supabase CLI
6. Open `src/pages/login.html` in a browser (or serve the repo root via a local static server)

## Phase 8: AI-Assisted Approval Workflow

**Key Features:**
- **AI Suggestions Generator:** 3 AI-powered suggestions for task/accomplishment context
- **Smart Validation:** Checks min 2 hours saved, tool mentions, quantified outcomes, quality
- **Multi-Layer Approval:** Routes to appropriate layer (AI → SPOC → Admin) based on saved hours and validation
- **Admin Approvals Tab:** Manage pending submissions, approvals, rejections
- **Employee Status Page:** Track personal task approval progress
- **Approval Analytics:** Dashboard KPIs showing approval metrics and time savings
- **Approval Gating:** KPIs, charts, exports, and forecasts use approved-only tasks/accomplishments; pending items show approval badges

See [docs/phase8/PHASE_8_IMPLEMENTATION.md](docs/phase8/PHASE_8_IMPLEMENTATION.md) and [docs/approval/APPROVAL_WORKFLOW.md](docs/approval/APPROVAL_WORKFLOW.md) for complete details.

### AI Adoption Agent (Chat Widget)

The admin portal includes an embedded AI chat widget powered by Claude 3.5 Sonnet with live Supabase data:

```bash
cd server/
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY from https://console.anthropic.com/
npm start
```

Then open `src/pages/admin.html` and click the 💬 button. See [server/QUICK_START.md](server/QUICK_START.md) for details.

See [docs/ONBOARDING_GUIDE.md](docs/ONBOARDING_GUIDE.md) for full setup instructions.

## Documentation

- [Code Architecture](docs/CODE_ARCHITECTURE.md) — System design and file structure
- [Business Requirements (BRD)](docs/BRD.md) — Full feature requirements
- [High-Level Design (HLD)](docs/HLD.md) — Technical architecture
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) — Phased delivery roadmap
- [Onboarding Guide](docs/ONBOARDING_GUIDE.md) — Setup, URLs, credentials

## Roles

| Role | Access | Example User |
|------|--------|-------------|
| **Admin** | Full CRUD all practices, data dumps, user management | Omar Ibrahim |
| **SPOC** | Own practice CRUD, team management, nudge system, leaderboard | Norah Al Wabel (CES) |
| **Contributor** | Personal dashboard, My Tasks, badges, practice leaderboard | Self-registered users |

> Note: Self-signup always registers users as **Contributor**. Admins assign SPOC/Admin roles.

## Changelog

### AI Adoption Agent — Chat Widget (Apr 10, 2026)
- **Embedded chat widget** in admin portal (admin.html) — click 💬 button to open
- **Backend endpoint** (server/adoption-agent-endpoint.js) — Express + Claude 3.5 Sonnet + live Supabase data
- **Live metrics injection** — Adoption rate, tasks, hours saved, per-practice breakdown injected into AI context
- **Role-aware filtering** — Admin sees all practices; SPOC sees only their practice
- **Markdown rendering** — Agent responses render bold, headers, lists, code blocks
- **Conversation history** — Up to 20 exchanges maintained for contextual follow-ups
- **Input validation** — Query length limit (2000 chars), conversation sanitization, CORS configuration
- **Mobile responsive** — Widget adapts to screen size (70vh on mobile)

### Post-Launch Enhancements (Apr 10, 2026)
- **Contributor data visibility fix**: Added broad authenticated-read RLS policies on tasks, accomplishments, copilot_users, and users tables so all logged-in users see program-wide data
- **Page-level quarter selectors**: Leaderboard, My Tasks, and Accomplishments pages each have their own independent quarter dropdown — no longer tied to the global dashboard selector
- **Auto week number**: Week # is auto-calculated as quarter-relative (1–13) based on the task date; field is read-only
- **Week date defaults**: Week Start and Week End default to the current work week (Sun–Thu) if not manually entered
- **Auto employee info**: Employee name and email auto-populated from the logged-in user's profile on new tasks

### Phase 6 — Polish & Advanced Features
- **Dark/Light mode**: Theme toggle in sidebar, persists via localStorage, applies across all 3 pages
- **Trend forecasting**: Linear regression on tasks, hours saved, efficiency, and adoption for next 4 weeks with 2 forecast charts
- **PDF report generation**: Quarterly report with Executive Summary, Practice Breakdown, Top Contributors, Accomplishments (jsPDF)
- **Accessibility (WCAG 2.1 AA)**: Skip-to-content link, `<main>` landmark, aria-labels on all interactive elements, focus-visible rings
- **Keyboard navigation**: All nav items, buttons, and filters fully keyboard accessible
- **Performance**: Deferred loading of Chart.js, xlsx, jsPDF; font preconnect; optimized script order
- **prefers-reduced-motion**: Animations disabled when user prefers reduced motion

### Phase 8 — Approval Workflow (Apr 11, 2026)
- **Multi-layer approval system**: Task submissions routed through AI validation → SPOC → Admin as needed
- **Smart routing logic**: 
  - High-value tasks (≥15 hours saved) → Admin (Omar Ibrahim)
  - AI validation failures → SPOC for practice
  - Standard tasks → AI validation first, then SPOC
- **Admin Approvals tab**: Dashboard for managing pending/completed approvals with filters and actions
- **Employee Task Status page**: Employees can track approval progress and see who task is pending with
- **Practice-SPOC mapping**: Database table links practices to SPOCs for proper routing
- **Audit trail**: Full submission_approvals table with timestamps and decision history
- **⚠️ IMPORTANT**: Run SQL migration `sql/002_approval_workflow.sql` in Supabase to enable this feature — see [docs/approval/SETUP_APPROVAL_WORKFLOW.md](docs/approval/SETUP_APPROVAL_WORKFLOW.md)

### Phase 5 — SPOC Panel & Gamification
- **My Practice** (SPOC): Practice-specific KPIs, team leaderboard, inactive member alerts with nudge button
- **Leaderboard** (all roles): Practice rankings (weighted scoring) + employee rankings
- **My Tasks** (contributor): Personal task log, KPIs, achievement badges (7 types)
- **Use Case Library**: Searchable, filterable catalog of AI use cases from task data
- **Achievement Badges**: First Task, Streak, Time Saver, Efficiency Pro, Quality Champion, Prolific, Centurion
- **Nudge System**: SPOCs can nudge inactive team members (14+ days without a task)
- **Role-aware navigation**: Sidebar items scoped by role using `data-role` attributes

### Phase 4 — Admin Panel & Writes
- **Supabase CRUD**: All save/edit/delete operations write directly to Supabase (tasks, accomplishments, copilot users)
- **Edit/Delete UI**: Inline edit and delete buttons on task rows, accomplishment cards, and copilot user rows
- **Audit logging**: All write operations are logged to `activity_log` table with user ID and details
- **Data dumps**: Admin can create JSON snapshots of data stored in `data_dumps` table
- **Excel upload removed**: Replaced by direct Supabase writes (Excel export still available)
- **Admin panel deprecated**: CRUD functionality merged into main dashboard; admin.html is legacy
- **Confirmation dialogs**: All destructive actions require user confirmation
- **Form reset**: Edit modals properly reset titles and form fields

### Phase 3 — Live Data & Cleanup
- Removed ~3,700 lines of static APP_DATA JSON (77% code reduction)
- Full Supabase data layer with live queries per quarter
- Extracted CSS to `css/dashboard.css`
- Added XSS sanitization and pagination (25 rows/page)

## License

Internal — Enterprise Application Solutions © 2026
