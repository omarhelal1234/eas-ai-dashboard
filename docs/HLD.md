# High-Level Design (HLD)

# EAS AI Adoption Dashboard

> **Version:** 1.0 | **Date:** April 10, 2026  
> **Status:** Phase 2 Complete

---

## 1. System Overview

```
┌────────────────────────────────────────────────────────────┐
│                    USERS (Browser)                         │
│  Admin · SPOC · Contributor                                │
├────────────────────────────────────────────────────────────┤
│           GitHub Pages (Static Hosting)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │login.html│ │index.html│ │admin.html│ │ spoc.html│     │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘     │
│       │             │            │             │           │
│  ┌────┴─────────────┴────────────┴─────────────┴────┐     │
│  │              JavaScript Modules                   │     │
│  │  config.js │ auth.js │ db.js │ utils.js          │     │
│  └─────────────────────┬────────────────────────────┘     │
├────────────────────────┼──────────────────────────────────┤
│                        │ HTTPS (REST + Realtime)          │
│                        ▼                                   │
│  ┌──────────────────────────────────────────────────┐     │
│  │              Supabase Cloud                       │     │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │     │
│  │  │   Auth   │  │ PostgREST │  │  PostgreSQL   │  │     │
│  │  │  (JWT)   │  │  (API)    │  │  (Database)   │  │     │
│  │  └──────────┘  └───────────┘  └──────────────┘  │     │
│  │  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │     │
│  │  │   RLS    │  │  Storage  │  │  Realtime     │  │     │
│  │  │(Policies)│  │  (future) │  │  (future)     │  │     │
│  │  └──────────┘  └───────────┘  └──────────────┘  │     │
│  └──────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Hosting** | GitHub Pages | Free, HTTPS, CI-friendly |
| **Frontend** | Vanilla HTML/CSS/JS | Zero build step, fast load |
| **Charting** | Chart.js 4.x (CDN) | Lightweight, responsive |
| **Spreadsheet** | SheetJS (CDN) | Excel import/export |
| **Auth** | Supabase Auth (JWT) | Managed, email/password |
| **Database** | Supabase PostgreSQL | Free tier, RLS, REST API |
| **API** | Supabase PostgREST | Auto-generated from schema |
| **CSS** | Custom properties + utility classes | Consistent design tokens |

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
```

### Authorization Matrix

| Resource | Admin | SPOC | Contributor |
|----------|-------|------|-------------|
| Dashboard (all practices) | ✅ | ✅ (read) | ❌ |
| Dashboard (own practice) | ✅ | ✅ | ✅ |
| Task CRUD (all) | ✅ | ❌ | ❌ |
| Task CRUD (own practice) | ✅ | ✅ | Own tasks only |
| Admin panel | ✅ | ❌ | ❌ |
| SPOC panel | ✅ | ✅ | ❌ |
| User management | ✅ | ❌ | ❌ |
| Export data | ✅ | ✅ | ❌ |

### Row Level Security (RLS)

All database tables have RLS enabled with policies that enforce:
- **Read:** Authenticated users can read practice-level summaries
- **Write (tasks):** Users can only insert/update tasks for their own assignment
- **Write (users):** Users can only update their own `last_login` field
- **Admin override:** Admin role users have full read/write on all tables

---

## 5. Data Architecture

### Database Schema (ERD)

```
┌─────────────┐       ┌──────────────┐       ┌───────────────┐
│  quarters   │       │   practices  │       │    users      │
│─────────────│       │──────────────│       │───────────────│
│ id (PK)     │──┐    │ id (PK)      │──┐    │ id (PK)       │
│ name        │  │    │ name         │  │    │ auth_id (FK)  │
│ start_date  │  │    │ short_name   │  │    │ email         │
│ end_date    │  │    │ head         │  │    │ full_name     │
│ is_active   │  │    │ spoc         │  │    │ role          │
│ targets     │  │    │ description  │  │    │ practice_id   │
└─────────────┘  │    └──────────────┘  │    └───────────────┘
                 │                      │
      ┌──────────┴──────────┐           │
      │                     │           │
┌─────┴───────┐  ┌──────────┴──────┐   │
│   tasks     │  │accomplishments  │   │
│─────────────│  │─────────────────│   │
│ id (PK)     │  │ id (PK)         │   │
│ quarter_id  │  │ quarter_id (FK) │   │
│ practice_id │  │ practice_id (FK)│   │
│ employee    │  │ title           │   │
│ category    │  │ description     │   │
│ ai_tool     │  │ impact          │   │
│ time_*      │  │ gains           │   │
│ quality_*   │  └─────────────────┘   │
└─────────────┘                        │
                                       │
┌──────────────┐    ┌──────────────────┤
│copilot_users │    │    projects      │
│──────────────│    │──────────────────│
│ id (PK)      │    │ id (PK)          │
│ practice_id  │────│ practice_id (FK) │
│ name         │    │ name             │
│ email        │    │ customer         │
│ status       │    │ value            │
│ has_logged   │    │ dates            │
└──────────────┘    └──────────────────┘
```

### Database Views

| View | Purpose |
|------|---------|
| `practice_summary` | Per-practice KPIs aggregated from tasks |
| `quarter_summary` | Per-quarter totals across all practices |
| `adoption_rates` | Licensed vs. active user calculations |

---

## 6. Frontend Architecture

### Page Structure

| Page | Route | Role | Description |
|------|-------|------|-------------|
| `login.html` | / (unauthenticated) | All | Supabase Auth login form |
| `index.html` | / (authenticated) | All | Main SPA with 6 sections |
| `admin.html` | /admin.html | Admin | Full CRUD admin panel |
| `spoc.html` | /spoc.html | SPOC+ | Practice-specific dashboard (Phase 5) |

### SPA Navigation (index.html)

```
Sidebar Menu
├── Dashboard     → renderDashboard()
├── Practices     → renderPractices()
├── Tasks         → renderTasks()
├── Accomplishments → renderAccomplishments()
├── Copilot Users → renderCopilotUsers()
└── Projects      → renderProjects()
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
css/variables.css (shared tokens + base styles)
├── :root          → Color, spacing, typography tokens
├── * reset        → Box-sizing, margin reset
├── .btn-*         → Button variants
├── .status-*      → Status badge colors
├── .toast         → Toast notification component
└── .hidden, .text-*, .fw-* → Utility classes

index.html <style>    → Page-specific layout, sidebar, cards, charts
login.html <style>    → Login page specific styles
admin.html <style>    → Admin panel specific styles
```

---

## 7. Integration Points

| Integration | Protocol | Direction | Auth |
|------------|----------|-----------|------|
| Supabase Auth | HTTPS REST | Bi-directional | API Key |
| Supabase DB (PostgREST) | HTTPS REST | Read/Write | JWT + RLS |
| GitHub Pages | HTTPS | Serve static | None |
| SheetJS (CDN) | HTTPS | Client load | None |
| Chart.js (CDN) | HTTPS | Client load | None |

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
| CDN dependency | Chart.js and SheetJS loaded from reliable CDNs |
| Supabase rate limits | Batch reads; minimize writes; debounce filters |
| HTML monolith (5400 lines) | Phase 3: extract to separate modules/templates |

---

## 10. Future Architecture (Phases 3-6)

| Phase | Architectural Change |
|-------|---------------------|
| Phase 3 | Extract inline CSS to modules; split index.html; connect to Supabase reads |
| Phase 4 | Admin panel to Supabase Auth; add SPOC panel; Supabase writes |
| Phase 5 | Add Realtime subscriptions; leaderboard; notification system |
| Phase 6 | PDF export; advanced analytics; potential migration to Next.js/Vite |

---

*See [CODE_ARCHITECTURE.md](CODE_ARCHITECTURE.md) for detailed code-level architecture.*  
*See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for phased delivery schedule.*
