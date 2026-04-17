# AI News Feed — Design Spec

**Date:** 2026-04-17
**Author:** Omar Ibrahim + Claude
**Status:** Approved

---

## Overview

Replace the static AI News page (5 hard-coded cards) with a live, daily-refreshed news feed aggregated from 8+ AI industry sources. A Supabase Edge Function fetches RSS/Atom feeds daily, stores parsed articles in a new `ai_news` table, and the frontend renders them as a filterable, chronological feed.

## Goals

1. Keep EAS users informed about AI developments relevant to their adoption journey
2. Refresh automatically — no manual curation required for daily operation
3. Cover the full spectrum: new models, new skills, API updates, research, enterprise tools, industry news
4. Match existing dashboard UX patterns (dark theme, filter pills, card layout)

## Non-Goals

- Real-time/streaming news (daily batch is sufficient)
- User-generated content or comments on articles
- AI-powered summarization of articles (just display feed excerpts)
- Push notifications for breaking news

---

## 1. Database Schema

### Table: `ai_news`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `title` | `text` | NOT NULL | Article headline |
| `summary` | `text` | | 1-2 sentence excerpt from feed |
| `url` | `text` | NOT NULL, UNIQUE | Canonical link, used for dedup |
| `source` | `text` | NOT NULL | One of: `anthropic`, `openai`, `google`, `github`, `microsoft`, `huggingface`, `verge`, `techcrunch`, `skills_sh` |
| `topic` | `text` | NOT NULL | One of: `new_model`, `new_skill`, `api_update`, `research`, `enterprise`, `industry` |
| `image_url` | `text` | | Optional og:image / thumbnail |
| `published_at` | `timestamptz` | NOT NULL | Original publish date from feed |
| `fetched_at` | `timestamptz` | default `now()` | When the Edge Function ingested it |
| `created_at` | `timestamptz` | default `now()` | Row creation time |

### Indexes

- `idx_ai_news_published` on `published_at DESC` — chronological feed queries
- `idx_ai_news_source` on `source` — source filter queries

### RLS Policy

- **SELECT:** All authenticated users (`auth.role() = 'authenticated'`)
- **INSERT/UPDATE/DELETE:** None from client. Only the Edge Function writes via service role key.

### Cleanup

- `pg_cron` job runs nightly: `DELETE FROM ai_news WHERE published_at < now() - interval '30 days'`

---

## 2. Edge Function: `ai-news-aggregator`

### Trigger

- **Primary:** `pg_cron` scheduled daily at 06:00 UTC (09:00 AST)
- **Secondary:** Admin-triggered manual refresh via authenticated HTTP POST

### RSS Feed Sources

| Source | Feed URL |
|---|---|
| Anthropic | `https://www.anthropic.com/rss.xml` |
| OpenAI | `https://openai.com/blog/rss.xml` |
| Google AI | `https://blog.google/technology/ai/rss/` |
| GitHub Blog | `https://github.blog/feed/` |
| Microsoft AI | `https://blogs.microsoft.com/ai/feed/` |
| Hugging Face | `https://huggingface.co/blog/feed.xml` |
| The Verge AI | `https://www.theverge.com/rss/ai-artificial-intelligence/index.xml` |
| TechCrunch AI | `https://techcrunch.com/category/artificial-intelligence/feed/` |

### skills.sh Integration

No RSS available. The function performs a lightweight fetch of the skills.sh homepage and parses trending/new skills from the HTML. Falls back gracefully if the page structure changes.

### Processing Pipeline

1. Fetch all RSS/Atom feeds in parallel (5-second timeout per feed)
2. Parse XML — extract title, summary/description, link, pubDate, image (og:image or media:content)
3. Auto-classify `topic` using keyword matching on title + summary:
   - `new_model`: model, claude, gpt, gemini, llama, release, launch
   - `new_skill`: skill, agent, plugin, extension, marketplace
   - `api_update`: api, sdk, endpoint, developer, function calling
   - `research`: paper, research, benchmark, safety, alignment
   - `enterprise`: enterprise, copilot, microsoft 365, workspace, business
   - `industry`: fallback
4. Scrape skills.sh for new/trending skills
5. UPSERT into `ai_news` (keyed on `url` for deduplication)
6. Delete rows older than 30 days
7. Return summary: `{ inserted: N, skipped: N, errors: [] }`

### Error Handling

- Individual feed failures are logged but do not block other feeds
- If all feeds fail, return error response but preserve cached data
- skills.sh scrape failure is non-fatal — logged as warning

### Admin Manual Refresh

- Same Edge Function, invoked via HTTP POST with admin JWT
- Validates `role = 'admin'` from JWT before proceeding
- Returns the same summary object as the scheduled run

---

## 3. Frontend Design

### Page Structure (replaces existing `#page-ainews`)

1. **Page header**
   - Title: "AI News"
   - Subtitle: "Stay up to date with the latest AI developments" + "Last updated: X ago"
   - Admin-only "Refresh Now" button (top-right)

2. **Topic filter pills** (single-select, "All" default)
   - All | New Models | New Skills | API Updates | Research | Enterprise | Industry

3. **Source filter badges** (multi-select toggle)
   - Color-coded per source: Anthropic (amber), OpenAI (emerald), Google (blue), GitHub (purple), Microsoft (cyan), Hugging Face (orange), The Verge (rose), TechCrunch (green), skills.sh (violet)

4. **Results count** — e.g. "47 articles from 8 sources"

5. **News card feed** (chronological, newest first)
   - **Featured card** (first item): gradient highlight border, larger title
   - **Standard cards**: source badge, topic badge, relative time, title, summary, external link
   - All cards link to the original article (opens in new tab)

6. **Load More button** — initial load = 20 items, shows remaining count

### Data Flow

1. On page load, query `ai_news` ordered by `published_at DESC`, limit 20
2. Filter pills apply client-side for the loaded set; if filtered count < 5, fetch more from DB with the filter as a WHERE clause
3. "Load More" fetches next 20 with offset
4. "Refresh Now" (admin) calls the Edge Function, then re-fetches the feed

### Responsive Behavior

- Cards stack vertically on mobile
- Filter pills wrap on narrow screens
- Source badges become horizontally scrollable on mobile

---

## 4. Scheduling & Maintenance

### pg_cron Jobs

1. **Daily fetch:** `SELECT net.http_post(...)` calling the Edge Function at 06:00 UTC
2. **Nightly cleanup:** `DELETE FROM ai_news WHERE published_at < now() - interval '30 days'` at 03:00 UTC

### Staleness Handling

- Frontend shows "Last updated: X" timestamp (derived from max `fetched_at`)
- Admin can manually trigger refresh at any time
- If data is older than 48 hours, no special warning — the timestamp speaks for itself

---

## 5. Portability Assessment

| Concern | Rating | Notes |
|---|---|---|
| Vendor lock-in | **Low** | RSS parsing is standard; Supabase table could be any PostgreSQL |
| Network requirements | **Low** | Needs outbound HTTPS to public RSS feeds — standard for any server |
| Auth coupling | **None** | News is read-only for authenticated users; any auth system works |
| Infrastructure | **Low** | Edge Function could be replaced by any cron + HTTP service |
| Data residency | **None** | Aggregates public blog posts, no PII involved |

**Overall migration difficulty: Low** — the core is just "fetch RSS, store in PostgreSQL, render in HTML."

---

## 6. Files Affected

| File | Change |
|---|---|
| `sql/022_ai_news.sql` | New migration: table, indexes, RLS, pg_cron jobs |
| `supabase/functions/ai-news-aggregator/index.ts` | New Edge Function |
| `src/pages/index.html` | Replace `#page-ainews` HTML + add JS for feed rendering |
| `css/dashboard.css` | News card styles (if not fully inline) |
| `js/db.js` | Add `fetchAiNews()` and `refreshAiNews()` methods |
| `docs/EDGE_FUNCTIONS_DEPLOYED.md` | Document new function |
| `CHANGELOG.md` | New entry |
