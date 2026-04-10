# EAS AI Adoption Dashboard

Enterprise AI adoption tracking platform for Enterprise Application Solutions (EAS), covering 6 practices and 120+ licensed users across GitHub Copilot, Claude, ChatGPT, and other AI tools.

## Live URLs

| Page | URL |
|------|-----|
| **Dashboard** | https://omarhelal1234.github.io/eas-ai-dashboard/ |
| **Login** | https://omarhelal1234.github.io/eas-ai-dashboard/login.html |
| **Signup** | https://omarhelal1234.github.io/eas-ai-dashboard/signup.html |

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS, Chart.js 4.4.1, SheetJS 0.18.5, jsPDF 2.5.2
- **Backend:** Supabase (PostgreSQL + Auth + RLS + RPCs)
- **Hosting:** GitHub Pages (static site)
- **Design:** Dark/Light theme toggle, Inter font, responsive sidebar navigation
- **Accessibility:** WCAG 2.1 AA compliant

## Project Structure

```
./
├── index.html              # Main dashboard (10 role-aware pages + inline CRUD)
├── login.html              # Authentication page
├── signup.html             # Contributor self-registration
├── admin.html              # Legacy admin panel (deprecated — CRUD merged into dashboard)
├── migrate.html            # Browser-based migration tool
│
├── css/
│   ├── variables.css       # Design tokens, dark/light theme definitions
│   └── dashboard.css       # Dashboard component styles, accessibility, theme toggle
│
├── js/
│   ├── config.js           # Supabase client configuration
│   ├── auth.js             # Authentication & session management (EAS_Auth)
│   ├── db.js               # Full Supabase data layer — reads, writes, RPCs, audit (~838 lines)
│   └── utils.js            # Shared utilities (formatting, sanitize, colors)
│
├── sql/
│   └── 001_schema.sql      # Complete database schema
│
├── scripts/                # Node.js dev/admin scripts
│   ├── create-auth-users.mjs
│   ├── run-migration.mjs
│   └── create-schema.mjs
│
├── docs/                   # Project documentation
│   ├── CODE_ARCHITECTURE.md
│   ├── BRD.md
│   ├── HLD.md
│   ├── IMPLEMENTATION_PLAN.md
│   └── ONBOARDING_GUIDE.md
│
├── server/                 # AI Adoption Agent backend
│   ├── adoption-agent-endpoint.js  # Express API (Claude + Supabase)
│   ├── package.json                # Backend dependencies
│   ├── .env.example                # Environment template
│   ├── README.md                   # API documentation
│   ├── SETUP_GUIDE.md              # Deployment guide
│   └── QUICK_START.md              # 5-minute setup
│
├── .agents/                # Copilot agent skills (Superpowers)
├── .github/                # GitHub config (copilot-instructions.md, AI Adoption Agent)
├── .env.example            # Environment variable template
├── .gitignore
├── package.json
└── README.md
```

## Getting Started

1. Clone the repository
2. Copy `.env.example` to `.env` and add your Supabase keys
3. Run `npm install`
4. Open `login.html` in browser (or serve via local server)

### AI Adoption Agent (Chat Widget)

The admin portal includes an embedded AI chat widget powered by Claude 3.5 Sonnet with live Supabase data:

```bash
cd server/
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY from https://console.anthropic.com/
npm start
```

Then open admin.html and click the 💬 button. See [server/QUICK_START.md](server/QUICK_START.md) for details.

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
