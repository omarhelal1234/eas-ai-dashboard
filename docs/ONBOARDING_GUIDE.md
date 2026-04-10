# Onboarding Guide

# EAS AI Adoption Dashboard

> **Version:** 1.0 | **Last Updated:** April 10, 2026

---

## 1. Quick Start

### Live Dashboard

| Resource | URL |
|----------|-----|
| **Dashboard** | https://omarhelal1234.github.io/eas-ai-dashboard/ |
| **Login Page** | https://omarhelal1234.github.io/eas-ai-dashboard/login.html |
| **Admin Panel** | https://omarhelal1234.github.io/eas-ai-dashboard/admin.html |

### Default Credentials

| User | Email | Password | Role | Practice |
|------|-------|----------|------|----------|
| Omar Ibrahim | oibrahim@ejada.com | *(contact admin)* | Admin | BFSI |
| Norah Al Wabel | nalwabel@ejada.com | EAS@2026! | SPOC | CES |
| Reham Ibrahim | ribrahim@ejada.com | EAS@2026! | SPOC | ERP |
| Yousef Milhem | ymilhem@ejada.com | EAS@2026! | SPOC | EPS |
| Mohamed Essam | messam@ejada.com | EAS@2026! | SPOC | GRC |
| Ahmed Shaheen | ashaheen@ejada.com | EAS@2026! | SPOC | EPCS |

> **Important:** Change your password after first login.

---

## 2. Login

1. Navigate to **https://omarhelal1234.github.io/eas-ai-dashboard/login.html**
2. Enter your **Ejada email** and **password**
3. Click **Sign In**
4. You will be redirected to the main dashboard

### Troubleshooting Login

| Issue | Solution |
|-------|---------|
| "Invalid login credentials" | Check email and password; contact admin for reset |
| Page stuck on "Checking authentication..." | Clear browser cache; try incognito window |
| Redirected back to login | Session expired; log in again |

---

## 3. Dashboard Overview

After login, you'll see the main dashboard with:

### Sidebar Navigation

- **Dashboard** — KPI cards and charts across all practices
- **Practices** — Per-practice breakdown with adoption rates
- **Tasks** — Full task list with filters and search
- **Accomplishments** — Key AI implementation wins
- **Copilot Users** — Licensed user management
- **Projects** — Project portfolio tracking
- **Admin Panel** — *(Admin only)* Full CRUD management

### Header Controls

- **Quarter Selector** — Switch between quarters (e.g., Q2-2026, Q1-2026, All Time)
- **User Profile** — Your name and role displayed in the sidebar
- **Logout** — Click your profile area to sign out

---

## 4. Role-Based Access

### Admin (Omar Ibrahim)

Full access to everything:
- View all practices' data
- Access Admin Panel for data management
- Manage users and quarters
- Export data to Excel
- View all dashboard pages

### SPOC (Practice AI Champions)

Practice-focused access:
- View all practices' summary data
- Manage tasks for their own practice
- View accomplishments and projects
- Export practice data

### Contributor (Licensed Users — Future)

Limited access (Phase 5):
- Log their own AI tasks
- View personal statistics
- See practice leaderboard

---

## 5. Key Features

### Quarter Filtering

The quarter selector in the top header filters **all** pages:

1. Click the quarter dropdown in the header
2. Select a quarter (e.g., "Q2-2026") or "All Time"
3. All KPIs, charts, tables, and cards update instantly

### Dashboard KPIs

| KPI | Description |
|-----|-------------|
| Total Tasks | Number of AI tasks logged in selected quarter |
| Total Hours Saved | Sum of time saved across all tasks |
| Avg. Efficiency | Average efficiency gain percentage |
| Overall Quality | Average quality rating (1-10 scale) |

### Task Management

1. Navigate to **Tasks** in the sidebar
2. Use filters: Practice, Category, AI Tool, Status
3. Use the search bar for keyword search
4. Click column headers to sort

### Excel Export

1. Navigate to any data page (Tasks, Users, Projects)
2. Click the **Export** button (if available)
3. An `.xlsx` file downloads with the filtered data

---

## 6. For Developers

### Local Setup

```bash
# Clone the repository
git clone https://github.com/omarhelal1234/eas-ai-dashboard.git
cd eas-ai-dashboard

# No build step — open in browser
# Use VS Code Live Server or similar
```

### Project Structure

```
eas-ai-dashboard/
├── index.html          # Main dashboard (SPA)
├── login.html          # Authentication page
├── admin.html          # Admin panel
├── data.js             # Static data (fallback)
├── css/
│   └── variables.css   # Shared design tokens
├── js/
│   ├── config.js       # Supabase client
│   ├── auth.js         # Authentication module
│   ├── db.js           # Database queries
│   └── utils.js        # Shared utilities
├── scripts/
│   ├── create-schema.mjs   # DB schema creation
│   ├── run-migration.mjs   # Data migration
│   └── create-auth-users.mjs  # User creation
├── docs/
│   ├── CODE_ARCHITECTURE.md
│   ├── BRD.md
│   ├── HLD.md
│   ├── IMPLEMENTATION_PLAN.md
│   └── ONBOARDING_GUIDE.md
└── README.md
```

### Environment Variables

For running migration scripts locally, create a `.env` file (never commit):

```bash
SUPABASE_URL=https://apcfnzbiylhgiutcjigg.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

See `.env.example` for the template.

### Supabase Dashboard

| Resource | URL |
|----------|-----|
| Supabase Project | https://supabase.com/dashboard/project/apcfnzbiylhgiutcjigg |
| Database Tables | https://supabase.com/dashboard/project/apcfnzbiylhgiutcjigg/editor |
| Auth Users | https://supabase.com/dashboard/project/apcfnzbiylhgiutcjigg/auth/users |
| RLS Policies | https://supabase.com/dashboard/project/apcfnzbiylhgiutcjigg/auth/policies |
| API Docs | https://supabase.com/dashboard/project/apcfnzbiylhgiutcjigg/api |

### Key Technologies

| Technology | Version | CDN |
|-----------|---------|-----|
| Supabase JS | v2 | `cdn.jsdelivr.net/npm/@supabase/supabase-js@2` |
| Chart.js | 4.x | `cdn.jsdelivr.net/npm/chart.js` |
| SheetJS | Latest | `cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js` |
| Inter Font | Variable | `fonts.googleapis.com/css2?family=Inter` |

---

## 7. Documentation Index

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Project overview and quick start |
| [CODE_ARCHITECTURE.md](CODE_ARCHITECTURE.md) | Detailed code-level architecture |
| [BRD.md](BRD.md) | Business Requirements Document |
| [HLD.md](HLD.md) | High-Level Design |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | 6-phase delivery plan with revision history |
| This Guide | Onboarding and usage instructions |

---

## 8. Support

| Contact | Role | Email |
|---------|------|-------|
| Omar Ibrahim | Admin / Overall AI SPOC | oibrahim@ejada.com |

For issues:
- **Login problems:** Contact the admin
- **Data corrections:** Use the Admin Panel or contact your practice SPOC
- **Bug reports:** Open a GitHub issue at https://github.com/omarhelal1234/eas-ai-dashboard/issues

---

*This guide will be updated as new features are delivered in Phases 3–6.*
