# Onboarding Guide

# EAS AI Adoption Dashboard

> **Version:** 2.1 | **Last Updated:** April 11, 2026 (Phase 8 Complete)

---

## 1. Quick Start

### Live Dashboard

| Resource | URL |
|----------|-----|
| **Dashboard** | https://omarhelal1234.github.io/eas-ai-dashboard/ |
| **Login Page** | https://omarhelal1234.github.io/eas-ai-dashboard/login.html |
| **Signup Page** | https://omarhelal1234.github.io/eas-ai-dashboard/signup.html |

### Default Credentials

| User | Email | Password | Role | Practice |
|------|-------|----------|------|----------|
| Omar Ibrahim | oibrahim@ejada.com | *(contact admin)* | Admin | BFSI |
| Norah Al Wabel | norah.alwabel@ejada.com | EAS@2026! | SPOC | CES |
| Reham Ibrahim | reham.ibrahim@ejada.com | EAS@2026! | SPOC | ERP |
| Yousef Milhem | ymilhem@ejada.com | EAS@2026! | SPOC | EPS |
| Mohamed Essam | messam@ejada.com | EAS@2026! | SPOC | GRC |
| Ahmed Shaheen | ashaheen@ejada.com | EAS@2026! | SPOC | EPCS |

> **Important:** Change your password after first login.

---

## 2. Self-Signup (New Contributors)

If you don’t have an account yet, you can register yourself:

1. Navigate to **https://omarhelal1234.github.io/eas-ai-dashboard/signup.html**  
   *(or click "Sign up" on the login page)*
2. **Step 1 — Profile Info:**
   - Department: EAS (pre-selected)
   - Practice: Select from dropdown (BFSI, CES, EPCS, EPS, ERP Solutions, GRC)
   - Full Name
   - Ejada Email Address
   - Skill / Job Title
   - Do you have GitHub Copilot access? (Yes / No)
3. **Step 2 — Create Password:**
   - Minimum 8 characters; strength indicator shows progress
   - Confirm your password
4. Click **Create Account**
5. You will be either:
   - **Auto-logged in** (if auto-confirm is enabled) → redirected to dashboard
   - **Sent a confirmation email** → click the link, then log in normally

### What happens on signup

| Copilot Access | `copilot_users.status` | `copilot_access_date` |
|----------------|------------------------|----------------------|
| Yes | Active | null (to be updated by admin) |
| No | Pending | "Not Granted" |

Your user profile is created with the **contributor** role.

---

## Phase 8: AI-Assisted Task Submission

### New Features (April 11, 2026)

When submitting a **Task** or **Accomplishment**, you now have access to:

#### 1. **AI Suggestions** ("Powered by AI" button)
- Click the **✨ Powered by AI** button in the "Why is this task valuable?" field
- Receive **3 AI-generated suggestions** for your task description
- Click a suggestion to insert it into the field
- Text completion dropdown appears as you type (shows AI suggestions in real-time)

#### 2. **Smart Saved Hours Calculation**
- Enter "Time without AI" (hours)
- Enter "Time with AI" (hours)
- System auto-calculates: **Saved Hours = Without - With**
- Minimum **2 hours saved** required for approval routing

#### 3. **AI Validation Check**
Before submission, the system validates:
- ✅ **Minimum 2 hours saved** (required)
- ✅ **Mentions specific AI tool** (ChatGPT, Copilot, Claude, etc.)
- ✅ **Quantifiable metrics/outcomes** (reduces 50% time, improves accuracy by X%, etc.)
- ✅ **Quality check** (coherence, professional tone)

#### 4. **Multi-Layer Approval Routing**
After submission, your task goes through:

| Scenario | Route | Approver | Timeline |
|----------|-------|----------|----------|
| **Saved Hours ≥ 15** | Admin Review | Omar Ibrahim | 2-3 days |
| **Saved Hours < 15 + Validation Passed** | SPOC Review | Your practice manager | 1-2 days |
| **Validation Failed** | SPOC Manual Review | Your practice manager | 2-3 days |

#### 5. **Track Your Approvals**
- Navigate to **My Tasks** → **View Task Status** (new link)
- Or go directly to [employee-status.html](../employee-status.html)
- See:
  - Total tasks submitted
  - Approved tasks
  - Pending approvals
  - Rejected tasks (with feedback)
  - Detailed approval timeline

---

## 3. Login

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

## 4. Dashboard Overview

After login, you'll see the main dashboard with:

### Sidebar Navigation

- **Dashboard** — KPI cards, charts, forecasting, adoption rate across all practices
- **Practices** — Per-practice breakdown with adoption rates
- **Tasks** — Full task list with filters and search
- **Accomplishments** — Key AI implementation wins
- **Copilot Users** — Licensed user management
- **Projects** — Project portfolio tracking
- **SPOC Panel** — *(SPOC only)* Practice-specific dashboard with team management
- **Leaderboard** — Practice + employee rankings with badges
- **My Tasks** — *(Contributor only)* Personal task log with KPIs
- **Use Cases** — Searchable AI use case library

### Header Controls

- **Quarter Selector** — Switch between quarters (e.g., Q2-2026, Q1-2026, All Time)
- **Theme Toggle** — Switch between dark and light mode (persists via localStorage)
- **User Profile** — Your name and role displayed in the sidebar
- **Logout** — Click your profile area to sign out

---

## 5. Role-Based Access

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

### Contributor (Licensed Users)

Self-registered users with contributor role:
- View all practices’ summary data
- Log their own AI tasks (Phase 5)
- View personal statistics (Phase 5)
- See practice leaderboard (Phase 5)

---

## 6. Key Features

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

### PDF Report

1. Navigate to the **Dashboard** page
2. Click the **Generate PDF** button (admin/SPOC only)
3. A PDF report downloads with Executive Summary, Practice Breakdown, Top Contributors, and Accomplishments

### Dark/Light Mode

1. Click the **theme toggle** button in the sidebar
2. The theme switches between dark and light mode
3. Your preference is saved and persists across sessions and pages

### Leaderboard & Badges

1. Navigate to **Leaderboard** in the sidebar
2. View practice rankings (weighted scoring) and employee rankings
3. Badges are earned automatically: First Task, Streak, Time Saver, Efficiency Pro, Quality Champion, Prolific, Centurion

---

## 7. For Developers

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
./
├── index.html          # Main dashboard (10 role-aware pages)
├── login.html          # Authentication page
├── signup.html         # Contributor self-registration
├── admin.html          # Admin panel (legacy — deprecated)
├── data.js             # Static data (fallback)
├── css/
│   ├── variables.css   # Design tokens, dark/light themes
│   └── dashboard.css   # Component styles, accessibility
├── js/
│   ├── config.js       # Supabase client
│   ├── auth.js         # Authentication module (EAS_Auth)
│   ├── db.js           # Data layer — reads, writes, RPCs, audit
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
├── .agents/            # Copilot agent skills
├── .github/            # GitHub config
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

### Supabase Auth Configuration

| Setting | Value | Reason |
|---------|-------|--------|
| **Confirm Email** | OFF (auto-confirm) | Internal enterprise tool; avoids bounced emails from Supabase's built-in mailer |
| **Email Rate Limit** | Default (4/hour) | Supabase free tier limit |

> **Important:** Keep "Confirm Email" disabled. Enabling it causes Supabase to send confirmation emails via their built-in mailer. Since this is an internal @ejada.com tool, bounced test emails can trigger Supabase email privilege restrictions. If email confirmation is ever needed, configure a custom SMTP provider first.

### Key Technologies

| Technology | Version | CDN |
|-----------|---------|-----|
| Supabase JS | v2 | `cdn.jsdelivr.net/npm/@supabase/supabase-js@2` |
| Chart.js | 4.4.1 | `cdn.jsdelivr.net/npm/chart.js` (deferred) |
| SheetJS | 0.18.5 | `cdn.sheetjs.com/xlsx-0.18.5/package/dist/xlsx.full.min.js` (deferred) |
| jsPDF | 2.5.2 | `cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js` (deferred) |
| Inter Font | Variable | `fonts.googleapis.com/css2?family=Inter` |

---

## 8. Documentation Index

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Project overview and quick start |
| [CODE_ARCHITECTURE.md](CODE_ARCHITECTURE.md) | Detailed code-level architecture |
| [BRD.md](BRD.md) | Business Requirements Document |
| [HLD.md](HLD.md) | High-Level Design |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | 6-phase delivery plan with revision history |
| This Guide | Onboarding and usage instructions |

---

## 9. Support

| Contact | Role | Email |
|---------|------|-------|
| Omar Ibrahim | Admin / Overall AI SPOC | oibrahim@ejada.com |

For issues:
- **Login problems:** Contact the admin
- **Data corrections:** Use the Admin Panel or contact your practice SPOC
- **Bug reports:** Open a GitHub issue at https://github.com/omarhelal1234/eas-ai-dashboard/issues

---

*All 6 implementation phases are complete. This guide reflects the final delivered state of the dashboard.*
