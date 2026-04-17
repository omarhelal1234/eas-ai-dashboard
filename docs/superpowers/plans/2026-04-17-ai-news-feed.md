# AI News Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static AI News page with a live, daily-refreshed news feed aggregated from 8 RSS sources via a Supabase Edge Function.

**Architecture:** A new `ai_news` table stores parsed articles. A Deno Edge Function (`ai-news-aggregator`) fetches RSS/Atom feeds from 8 sources + scrapes skills.sh, classifies topics via keyword matching, and UPSERTs into the table. pg_cron triggers it daily at 06:00 UTC. The frontend renders a filterable chronological feed from the table.

**Tech Stack:** Supabase PostgreSQL, Deno Edge Functions, RSS/Atom XML parsing, vanilla JS frontend (IIFE pattern in `EAS_DB`)

**Spec:** `docs/superpowers/specs/2026-04-17-ai-news-feed-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `sql/023_ai_news.sql` | Create | Migration: table, indexes, RLS, pg_cron jobs |
| `supabase/functions/ai-news-aggregator/index.ts` | Create | Edge Function: fetch RSS, parse, classify, UPSERT |
| `js/db.js` | Modify (lines ~2489-2500) | Add `fetchAiNews()` and `triggerAiNewsRefresh()` to EAS_DB |
| `src/pages/index.html` | Modify (lines 723-783, ~2220) | Replace static HTML, add `renderAiNews()` JS, wire nav |
| `css/dashboard.css` | Modify (append) | News feed card styles |
| `docs/EDGE_FUNCTIONS_DEPLOYED.md` | Modify | Document new function |
| `CHANGELOG.md` | Modify | New entry |

---

## Task 1: Database Migration

**Files:**
- Create: `sql/023_ai_news.sql`

- [ ] **Step 1: Write the migration SQL**

Create `sql/023_ai_news.sql`:

```sql
-- 023: AI News feed table, indexes, RLS, and pg_cron cleanup job
-- Spec: docs/superpowers/specs/2026-04-17-ai-news-feed-design.md

-- Table
CREATE TABLE IF NOT EXISTS ai_news (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  summary       text,
  url           text        NOT NULL UNIQUE,
  source        text        NOT NULL,
  topic         text        NOT NULL,
  image_url     text,
  published_at  timestamptz NOT NULL,
  fetched_at    timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_news_published ON ai_news (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_news_source    ON ai_news (source);

-- RLS
ALTER TABLE ai_news ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_news_select_authenticated"
  ON ai_news FOR SELECT
  TO authenticated
  USING (true);

-- pg_cron: nightly cleanup of items older than 30 days (03:00 UTC)
SELECT cron.schedule(
  'ai-news-cleanup',
  '0 3 * * *',
  $$DELETE FROM ai_news WHERE published_at < now() - interval '30 days'$$
);
```

- [ ] **Step 2: Run the migration via Supabase MCP**

Use `mcp__supabase__execute_sql` or `mcp__claude_ai_Supabase__execute_sql` to run the contents of `sql/023_ai_news.sql`.

Expected: Table `ai_news` created, 2 indexes created, RLS policy active, cron job scheduled.

- [ ] **Step 3: Verify the table exists**

Run via MCP:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'ai_news'
ORDER BY ordinal_position;
```

Expected: 10 columns matching the schema spec.

- [ ] **Step 4: Commit**

```bash
git add sql/023_ai_news.sql
git commit -m "feat: add ai_news table migration (023)"
```

---

## Task 2: Edge Function — ai-news-aggregator

**Files:**
- Create: `supabase/functions/ai-news-aggregator/index.ts`

- [ ] **Step 1: Create the Edge Function file**

Create `supabase/functions/ai-news-aggregator/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ---- Config ----

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface NewsItem {
  title: string;
  summary: string | null;
  url: string;
  source: string;
  topic: string;
  image_url: string | null;
  published_at: string;
  fetched_at: string;
}

// ---- RSS Feed Sources ----

const RSS_FEEDS: { source: string; url: string }[] = [
  { source: "anthropic",   url: "https://www.anthropic.com/rss.xml" },
  { source: "openai",      url: "https://openai.com/blog/rss.xml" },
  { source: "google",      url: "https://blog.google/technology/ai/rss/" },
  { source: "github",      url: "https://github.blog/feed/" },
  { source: "microsoft",   url: "https://blogs.microsoft.com/ai/feed/" },
  { source: "huggingface", url: "https://huggingface.co/blog/feed.xml" },
  { source: "verge",       url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { source: "techcrunch",  url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
];

// ---- Topic Classification ----

const TOPIC_RULES: { topic: string; keywords: RegExp }[] = [
  { topic: "new_model",   keywords: /\b(model|claude|gpt|gemini|llama|release|launch|o[1-9]|sonnet|opus|haiku)\b/i },
  { topic: "new_skill",   keywords: /\b(skill|agent|plugin|extension|marketplace|skills\.sh)\b/i },
  { topic: "api_update",  keywords: /\b(api|sdk|endpoint|developer|function.?calling|tool.?use)\b/i },
  { topic: "research",    keywords: /\b(paper|research|benchmark|safety|alignment|eval)\b/i },
  { topic: "enterprise",  keywords: /\b(enterprise|copilot|microsoft.?365|workspace|business|adoption)\b/i },
];

function classifyTopic(title: string, summary: string): string {
  const text = `${title} ${summary}`.toLowerCase();
  for (const rule of TOPIC_RULES) {
    if (rule.keywords.test(text)) return rule.topic;
  }
  return "industry";
}

// ---- XML Parsing Helpers ----

function extractTag(xml: string, tag: string): string {
  // Try CDATA first, then plain content
  const cdataRe = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i");
  const cdataMatch = xml.match(cdataRe);
  if (cdataMatch) return cdataMatch[1].trim();

  const plainRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const plainMatch = xml.match(plainRe);
  return plainMatch ? plainMatch[1].replace(/<[^>]+>/g, "").trim() : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const m = xml.match(re);
  return m ? m[1] : "";
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function truncate(str: string, maxLen: number): string {
  if (!str) return "";
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}

// ---- Feed Fetching & Parsing ----

async function fetchFeed(source: string, feedUrl: string): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(feedUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "EAS-AI-News-Aggregator/1.0" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`[${source}] HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    return parseRSS(xml, source);
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[${source}] Fetch failed: ${(err as Error).message}`);
    return [];
  }
}

function parseRSS(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const now = new Date().toISOString();

  // Split by <item> (RSS) or <entry> (Atom)
  const isAtom = xml.includes("<feed") && xml.includes("<entry");
  const splitter = isAtom ? "<entry" : "<item";
  const parts = xml.split(splitter).slice(1); // skip preamble

  for (const part of parts) {
    const title = extractTag(part, "title");
    if (!title) continue;

    // URL: RSS uses <link>, Atom uses <link href="..."/>
    let url = "";
    if (isAtom) {
      url = extractAttr(part, 'link[^>]*rel="alternate"', "href") ||
            extractAttr(part, "link", "href");
    } else {
      url = extractTag(part, "link");
    }
    if (!url) continue;

    // Summary
    const summary = truncate(
      extractTag(part, "description") ||
        extractTag(part, "summary") ||
        extractTag(part, "content"),
      300
    );

    // Published date
    const pubDateStr = extractTag(part, "pubDate") ||
                       extractTag(part, "published") ||
                       extractTag(part, "updated");
    const published_at = parseDate(pubDateStr);
    if (!published_at) continue;

    // Image
    const image_url =
      extractAttr(part, "media:content", "url") ||
      extractAttr(part, "media:thumbnail", "url") ||
      extractAttr(part, "enclosure", "url") ||
      null;

    const topic = classifyTopic(title, summary);

    items.push({
      title: truncate(title, 200),
      summary: summary || null,
      url,
      source,
      topic,
      image_url,
      published_at,
      fetched_at: now,
    });
  }

  return items;
}

// ---- skills.sh Scraping ----

async function fetchSkillsSh(): Promise<NewsItem[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://skills.sh/", {
      signal: controller.signal,
      headers: { "User-Agent": "EAS-AI-News-Aggregator/1.0" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[skills_sh] HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();
    const items: NewsItem[] = [];
    const now = new Date().toISOString();

    // Extract skill entries: look for links matching /owner/repo/skill-name pattern
    const skillPattern = /href="(\/[^"]+\/[^"]+\/[^"]+)"\s*[^>]*>([^<]+)/gi;
    let match;
    const seen = new Set<string>();

    while ((match = skillPattern.exec(html)) !== null) {
      const path = match[1];
      const name = match[2].trim();
      if (seen.has(path) || !name || name.length < 3) continue;
      seen.add(path);

      items.push({
        title: `New Skill: ${name}`,
        summary: `Agent skill available on skills.sh — install with npx skills add ${path.slice(1)}`,
        url: `https://skills.sh${path}`,
        source: "skills_sh",
        topic: "new_skill",
        image_url: null,
        published_at: now,
        fetched_at: now,
      });

      if (items.length >= 10) break; // cap at 10 per scrape
    }

    return items;
  } catch (err) {
    console.warn(`[skills_sh] Scrape failed: ${(err as Error).message}`);
    return [];
  }
}

// ---- Main Handler ----

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // If called with Authorization header, verify admin role
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Check admin role from user metadata or profiles table
    const { data: profile } = await supabaseAuth
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const stats = { inserted: 0, skipped: 0, errors: [] as string[] };

  // Fetch all feeds in parallel
  const feedPromises = RSS_FEEDS.map((f) => fetchFeed(f.source, f.url));
  feedPromises.push(fetchSkillsSh());

  const results = await Promise.allSettled(feedPromises);
  const allItems: NewsItem[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
    } else {
      stats.errors.push(result.reason?.message || "Unknown feed error");
    }
  }

  // UPSERT into ai_news (keyed on url)
  for (const item of allItems) {
    const { error } = await sb.from("ai_news").upsert(
      {
        title: item.title,
        summary: item.summary,
        url: item.url,
        source: item.source,
        topic: item.topic,
        image_url: item.image_url,
        published_at: item.published_at,
        fetched_at: item.fetched_at,
      },
      { onConflict: "url" }
    );
    if (error) {
      stats.errors.push(`[${item.source}] ${error.message}`);
      stats.skipped++;
    } else {
      stats.inserted++;
    }
  }

  // Cleanup: delete items older than 30 days
  const { error: cleanupErr } = await sb
    .from("ai_news")
    .delete()
    .lt("published_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (cleanupErr) {
    stats.errors.push(`Cleanup: ${cleanupErr.message}`);
  }

  console.log(`AI News aggregation complete: ${stats.inserted} inserted, ${stats.skipped} skipped, ${stats.errors.length} errors`);

  return new Response(JSON.stringify(stats), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Verify the file structure**

```bash
ls supabase/functions/ai-news-aggregator/
```

Expected: `index.ts`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ai-news-aggregator/index.ts
git commit -m "feat: add ai-news-aggregator Edge Function"
```

---

## Task 3: Add DB Methods to EAS_DB

**Files:**
- Modify: `js/db.js` (lines ~2489-2500, the return object)

- [ ] **Step 1: Add fetchAiNews() function**

Add before the `return {` block (around line 2430) in `js/db.js`:

```javascript
  // ===========================================================
  //  AI News Feed
  // ===========================================================

  /**
   * Fetch AI news articles, ordered by published_at DESC.
   * @param {object} opts
   * @param {number} opts.limit - max items (default 20)
   * @param {number} opts.offset - pagination offset (default 0)
   * @param {string|null} opts.source - filter by source slug
   * @param {string|null} opts.topic - filter by topic slug
   * @returns {Promise<{items: Array, total: number}>}
   */
  async function fetchAiNews({ limit = 20, offset = 0, source = null, topic = null } = {}) {
    let query = sb
      .from('ai_news')
      .select('*', { count: 'exact' })
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (source) query = query.eq('source', source);
    if (topic) query = query.eq('topic', topic);

    const { data, error, count } = await query;
    if (error) {
      console.error('fetchAiNews error:', error.message);
      return { items: [], total: 0 };
    }
    return { items: data || [], total: count || 0 };
  }

  /**
   * Get the latest fetched_at timestamp (for "Last updated" display).
   * @returns {Promise<string|null>}
   */
  async function getAiNewsLastUpdated() {
    const { data, error } = await sb
      .from('ai_news')
      .select('fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data.fetched_at;
  }

  /**
   * Admin-only: trigger a manual refresh of the AI news feed.
   * Calls the ai-news-aggregator Edge Function.
   * @returns {Promise<{inserted: number, skipped: number, errors: string[]}>}
   */
  async function triggerAiNewsRefresh() {
    const session = await sb.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const res = await fetch(`${EAS_CONFIG.SUPABASE_URL}/functions/v1/ai-news-aggregator`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Refresh failed');
    }
    return res.json();
  }
```

- [ ] **Step 2: Expose the new functions in the return block**

Add to the `return {` block in `js/db.js` (around line 2499, before the closing `};`):

```javascript
    // AI News Feed
    fetchAiNews,
    getAiNewsLastUpdated,
    triggerAiNewsRefresh,
```

- [ ] **Step 3: Verify no syntax errors**

Open the browser console on the dashboard, confirm no JS errors. Verify `EAS_DB.fetchAiNews` is a function:
```javascript
typeof EAS_DB.fetchAiNews // should be "function"
```

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat: add AI news DB methods — fetchAiNews, getAiNewsLastUpdated, triggerAiNewsRefresh"
```

---

## Task 4: CSS Styles for News Feed

**Files:**
- Modify: `css/dashboard.css` (append at end)

- [ ] **Step 1: Add news feed styles**

Append to the end of `css/dashboard.css`:

```css
/* ======== AI NEWS FEED ======== */

.ainews-filters {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.ainews-topic-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.ainews-pill {
  background: rgba(255,255,255,0.04);
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ainews-pill:hover { border-color: var(--accent); color: var(--text-secondary); }
.ainews-pill.active {
  background: rgba(59,130,246,0.15);
  color: var(--accent);
  border-color: rgba(59,130,246,0.3);
  font-weight: 600;
}

.ainews-source-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}

.ainews-source-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-right: 4px;
}

.ainews-source-badge {
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid;
}
.ainews-source-badge:hover { filter: brightness(1.2); }
.ainews-source-badge.dimmed { opacity: 0.35; }

.ainews-results-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 16px;
}

/* Cards */
.ainews-feed { display: flex; flex-direction: column; gap: 12px; }

.ainews-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
  transition: all 0.2s ease;
}
.ainews-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
  box-shadow: var(--shadow);
}

.ainews-card-featured {
  background: linear-gradient(135deg, var(--bg-card), rgba(59,130,246,0.06));
  border-color: rgba(59,130,246,0.2);
  padding: 20px;
}
.ainews-card-featured .ainews-card-title { font-size: 16px; }

.ainews-card-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.ainews-badge {
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.ainews-card-time {
  color: var(--text-muted);
  font-size: 11px;
  margin-left: auto;
}

.ainews-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
  line-height: 1.4;
}

.ainews-card-summary {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
}

.ainews-card-link {
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  text-decoration: none;
}
.ainews-card-link:hover { text-decoration: underline; }

.ainews-load-more {
  text-align: center;
  padding: 16px;
}

.ainews-load-more-btn {
  background: rgba(255,255,255,0.04);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 28px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ainews-load-more-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.ainews-empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted);
}
.ainews-empty svg { margin-bottom: 16px; opacity: 0.4; }
.ainews-empty h4 { font-size: 16px; color: var(--text-secondary); margin-bottom: 8px; }

.ainews-refresh-btn {
  background: rgba(59,130,246,0.12);
  color: var(--accent);
  border: 1px solid rgba(59,130,246,0.25);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
}
.ainews-refresh-btn:hover { background: rgba(59,130,246,0.2); }
.ainews-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Responsive */
@media (max-width: 768px) {
  .ainews-source-row { overflow-x: auto; flex-wrap: nowrap; padding-bottom: 4px; }
  .ainews-card-meta { gap: 4px; }
  .ainews-card-time { margin-left: 0; width: 100%; margin-top: 4px; }
}
```

- [ ] **Step 2: Commit**

```bash
git add css/dashboard.css
git commit -m "feat: add AI news feed CSS styles"
```

---

## Task 5: Replace Static HTML with Dynamic News Page

**Files:**
- Modify: `src/pages/index.html` (lines 723-783)

- [ ] **Step 1: Replace the static AI News page HTML**

Replace lines 723-783 (the entire `<div id="page-ainews" ...>...</div>`) with:

```html
  <div id="page-ainews" class="page hidden">
    <div class="page-header">
      <div>
        <h2>AI News</h2>
        <div class="subtitle">Stay up to date with the latest AI developments &bull; <span id="ainews-last-updated" style="color:var(--text-muted)">Loading...</span></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="ainews-refresh-btn" id="ainews-refresh-btn" data-role="admin" onclick="handleAiNewsRefresh()" title="Manually refresh news feed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Refresh Now
        </button>
      </div>
    </div>
    <div class="page-content">
      <!-- Filters -->
      <div class="ainews-filters">
        <div class="ainews-topic-pills" id="ainews-topic-pills">
          <button class="ainews-pill active" data-topic="all" onclick="filterAiNews('topic', 'all')">All</button>
          <button class="ainews-pill" data-topic="new_model" onclick="filterAiNews('topic', 'new_model')">New Models</button>
          <button class="ainews-pill" data-topic="new_skill" onclick="filterAiNews('topic', 'new_skill')">New Skills</button>
          <button class="ainews-pill" data-topic="api_update" onclick="filterAiNews('topic', 'api_update')">API Updates</button>
          <button class="ainews-pill" data-topic="research" onclick="filterAiNews('topic', 'research')">Research</button>
          <button class="ainews-pill" data-topic="enterprise" onclick="filterAiNews('topic', 'enterprise')">Enterprise</button>
          <button class="ainews-pill" data-topic="industry" onclick="filterAiNews('topic', 'industry')">Industry</button>
        </div>
        <div class="ainews-source-row" id="ainews-source-row">
          <span class="ainews-source-label">Sources:</span>
          <button class="ainews-source-badge" data-source="anthropic" style="background:rgba(217,119,6,0.12);color:#fbbf24;border-color:rgba(217,119,6,0.25)" onclick="toggleAiNewsSource('anthropic')">Anthropic</button>
          <button class="ainews-source-badge" data-source="openai" style="background:rgba(16,185,129,0.12);color:#34d399;border-color:rgba(16,185,129,0.25)" onclick="toggleAiNewsSource('openai')">OpenAI</button>
          <button class="ainews-source-badge" data-source="google" style="background:rgba(59,130,246,0.12);color:#60a5fa;border-color:rgba(59,130,246,0.25)" onclick="toggleAiNewsSource('google')">Google</button>
          <button class="ainews-source-badge" data-source="github" style="background:rgba(168,85,247,0.12);color:#c084fc;border-color:rgba(168,85,247,0.25)" onclick="toggleAiNewsSource('github')">GitHub</button>
          <button class="ainews-source-badge" data-source="microsoft" style="background:rgba(6,182,212,0.12);color:#22d3ee;border-color:rgba(6,182,212,0.25)" onclick="toggleAiNewsSource('microsoft')">Microsoft</button>
          <button class="ainews-source-badge" data-source="huggingface" style="background:rgba(251,146,60,0.12);color:#fb923c;border-color:rgba(251,146,60,0.25)" onclick="toggleAiNewsSource('huggingface')">Hugging Face</button>
          <button class="ainews-source-badge" data-source="verge" style="background:rgba(244,63,94,0.12);color:#fb7185;border-color:rgba(244,63,94,0.25)" onclick="toggleAiNewsSource('verge')">The Verge</button>
          <button class="ainews-source-badge" data-source="techcrunch" style="background:rgba(34,197,94,0.12);color:#4ade80;border-color:rgba(34,197,94,0.25)" onclick="toggleAiNewsSource('techcrunch')">TechCrunch</button>
          <button class="ainews-source-badge" data-source="skills_sh" style="background:rgba(139,92,246,0.12);color:#a78bfa;border-color:rgba(139,92,246,0.25)" onclick="toggleAiNewsSource('skills_sh')">skills.sh</button>
        </div>
      </div>

      <!-- Results bar -->
      <div class="ainews-results-bar">
        <span id="ainews-result-count"></span>
      </div>

      <!-- Feed -->
      <div class="ainews-feed" id="ainews-feed">
        <!-- Populated by JS -->
      </div>

      <!-- Load more -->
      <div class="ainews-load-more" id="ainews-load-more" style="display:none">
        <button class="ainews-load-more-btn" onclick="loadMoreAiNews()">Load More (<span id="ainews-remaining">0</span> remaining)</button>
      </div>

      <!-- Empty state -->
      <div class="ainews-empty" id="ainews-empty" style="display:none">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <h4>No news articles yet</h4>
        <p>News will appear here after the daily feed refresh runs.</p>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/index.html
git commit -m "feat: replace static AI News HTML with dynamic feed layout"
```

---

## Task 6: Add JavaScript — renderAiNews and Interactions

**Files:**
- Modify: `src/pages/index.html` (JS section, after the skills library JS around line ~4200, and nav handler around line ~2220)

- [ ] **Step 1: Wire up the nav handler**

In the navigation handler section (around line 2222, after the `ide-usage` line), add:

```javascript
    if (item.dataset.page === 'ainews') renderAiNews();
```

- [ ] **Step 2: Add the AI News JS block**

Add the following JS block after the Skills Library JS section (after the `renderSkillsLibrary` and related functions, around line ~4200):

```javascript
// ======== AI NEWS FEED ========

const _aiNewsState = {
  items: [],
  total: 0,
  offset: 0,
  limit: 20,
  activeTopic: 'all',
  excludedSources: new Set(),
  loaded: false,
};

const AI_NEWS_SOURCE_NAMES = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google',
  github: 'GitHub', microsoft: 'Microsoft', huggingface: 'Hugging Face',
  verge: 'The Verge', techcrunch: 'TechCrunch', skills_sh: 'skills.sh',
};

const AI_NEWS_SOURCE_COLORS = {
  anthropic:   { bg: 'rgba(217,119,6,0.15)',  text: '#fbbf24' },
  openai:      { bg: 'rgba(16,185,129,0.15)', text: '#34d399' },
  google:      { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
  github:      { bg: 'rgba(168,85,247,0.15)', text: '#c084fc' },
  microsoft:   { bg: 'rgba(6,182,212,0.15)',  text: '#22d3ee' },
  huggingface: { bg: 'rgba(251,146,60,0.15)', text: '#fb923c' },
  verge:       { bg: 'rgba(244,63,94,0.15)',  text: '#fb7185' },
  techcrunch:  { bg: 'rgba(34,197,94,0.15)',  text: '#4ade80' },
  skills_sh:   { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa' },
};

const AI_NEWS_TOPIC_COLORS = {
  new_model:  { bg: 'rgba(59,130,246,0.15)',  text: '#60a5fa' },
  new_skill:  { bg: 'rgba(34,197,94,0.15)',   text: '#4ade80' },
  api_update: { bg: 'rgba(6,182,212,0.15)',   text: '#22d3ee' },
  research:   { bg: 'rgba(251,146,60,0.15)',  text: '#fb923c' },
  enterprise: { bg: 'rgba(168,85,247,0.15)',  text: '#c084fc' },
  industry:   { bg: 'rgba(244,63,94,0.15)',   text: '#fb7185' },
};

const AI_NEWS_TOPIC_LABELS = {
  new_model: 'New Model', new_skill: 'New Skill', api_update: 'API Update',
  research: 'Research', enterprise: 'Enterprise', industry: 'Industry',
};

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60)    return 'just now';
  if (seconds < 3600)  return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  const days = Math.floor(seconds / 86400);
  if (days === 1) return '1 day ago';
  if (days < 30) return days + ' days ago';
  return new Date(dateStr).toLocaleDateString();
}

async function renderAiNews() {
  const feed = document.getElementById('ainews-feed');
  const empty = document.getElementById('ainews-empty');
  const loadMore = document.getElementById('ainews-load-more');

  // Reset state on fresh render
  _aiNewsState.offset = 0;
  _aiNewsState.items = [];

  // Show loading
  feed.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)"><div class="spinner" style="margin:0 auto 12px"></div>Loading news...</div>';
  empty.style.display = 'none';
  loadMore.style.display = 'none';

  // Build query params
  const queryOpts = { limit: _aiNewsState.limit, offset: 0 };
  if (_aiNewsState.activeTopic !== 'all') queryOpts.topic = _aiNewsState.activeTopic;

  const { items, total } = await EAS_DB.fetchAiNews(queryOpts);
  _aiNewsState.items = items;
  _aiNewsState.total = total;
  _aiNewsState.offset = items.length;
  _aiNewsState.loaded = true;

  // Update last-updated timestamp
  const lastUpdated = await EAS_DB.getAiNewsLastUpdated();
  const el = document.getElementById('ainews-last-updated');
  el.textContent = lastUpdated ? 'Last updated: ' + timeAgo(lastUpdated) : 'Not yet refreshed';

  // Render
  renderAiNewsCards();
}

function renderAiNewsCards() {
  const feed = document.getElementById('ainews-feed');
  const empty = document.getElementById('ainews-empty');
  const loadMore = document.getElementById('ainews-load-more');

  // Apply source exclusion client-side
  const filtered = _aiNewsState.items.filter(i => !_aiNewsState.excludedSources.has(i.source));

  if (filtered.length === 0) {
    feed.innerHTML = '';
    empty.style.display = 'block';
    loadMore.style.display = 'none';
    document.getElementById('ainews-result-count').textContent = '0 articles';
    return;
  }

  empty.style.display = 'none';
  document.getElementById('ainews-result-count').textContent =
    `${_aiNewsState.total} article${_aiNewsState.total !== 1 ? 's' : ''}`;

  feed.innerHTML = filtered.map((item, idx) => {
    const srcColor = AI_NEWS_SOURCE_COLORS[item.source] || { bg: 'rgba(255,255,255,0.08)', text: '#94a3b8' };
    const topicColor = AI_NEWS_TOPIC_COLORS[item.topic] || { bg: 'rgba(255,255,255,0.08)', text: '#94a3b8' };
    const isFeatured = idx === 0;
    const srcName = AI_NEWS_SOURCE_NAMES[item.source] || item.source;
    const topicLabel = AI_NEWS_TOPIC_LABELS[item.topic] || item.topic;
    const linkLabel = `Read on ${srcName} &rarr;`;

    return `<div class="ainews-card${isFeatured ? ' ainews-card-featured' : ''}">
      <div class="ainews-card-meta">
        <span class="ainews-badge" style="background:${srcColor.bg};color:${srcColor.text}">${DOMPurify.sanitize(srcName)}</span>
        <span class="ainews-badge" style="background:${topicColor.bg};color:${topicColor.text}">${DOMPurify.sanitize(topicLabel)}</span>
        <span class="ainews-card-time">${timeAgo(item.published_at)}</span>
      </div>
      <div class="ainews-card-title">${DOMPurify.sanitize(item.title)}</div>
      ${item.summary ? `<div class="ainews-card-summary">${DOMPurify.sanitize(item.summary)}</div>` : ''}
      <a href="${DOMPurify.sanitize(item.url)}" target="_blank" rel="noopener" class="ainews-card-link">${linkLabel}</a>
    </div>`;
  }).join('');

  // Show/hide load more
  const remaining = _aiNewsState.total - _aiNewsState.offset;
  if (remaining > 0) {
    loadMore.style.display = 'block';
    document.getElementById('ainews-remaining').textContent = remaining;
  } else {
    loadMore.style.display = 'none';
  }
}

async function loadMoreAiNews() {
  const queryOpts = {
    limit: _aiNewsState.limit,
    offset: _aiNewsState.offset,
  };
  if (_aiNewsState.activeTopic !== 'all') queryOpts.topic = _aiNewsState.activeTopic;

  const { items } = await EAS_DB.fetchAiNews(queryOpts);
  _aiNewsState.items.push(...items);
  _aiNewsState.offset += items.length;

  renderAiNewsCards();
}

function filterAiNews(type, value) {
  if (type === 'topic') {
    _aiNewsState.activeTopic = value;
    document.querySelectorAll('#ainews-topic-pills .ainews-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.topic === value);
    });
    renderAiNews(); // re-fetch from DB with new topic filter
  }
}

function toggleAiNewsSource(source) {
  const badge = document.querySelector(`.ainews-source-badge[data-source="${source}"]`);
  if (_aiNewsState.excludedSources.has(source)) {
    _aiNewsState.excludedSources.delete(source);
    badge.classList.remove('dimmed');
  } else {
    _aiNewsState.excludedSources.add(source);
    badge.classList.add('dimmed');
  }
  renderAiNewsCards(); // client-side re-filter, no DB call
}

async function handleAiNewsRefresh() {
  const btn = document.getElementById('ainews-refresh-btn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div> Refreshing...';

  try {
    const result = await EAS_DB.triggerAiNewsRefresh();
    showToast(`News refreshed: ${result.inserted} new articles`);
    await renderAiNews();
  } catch (err) {
    showToast('Refresh failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Refresh Now';
  }
}
```

- [ ] **Step 3: Verify the page renders**

1. Open the dashboard in browser
2. Navigate to AI News page
3. Confirm: loading spinner appears, then cards render (or empty state if DB is empty)
4. Test topic pills toggle
5. Test source badges toggle (dimming)
6. Test "Refresh Now" button (admin only)

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.html
git commit -m "feat: add AI news feed JS — renderAiNews, filters, load more, admin refresh"
```

---

## Task 7: Deploy Edge Function & Schedule pg_cron

- [ ] **Step 1: Deploy the Edge Function**

```bash
supabase functions deploy ai-news-aggregator --project-ref apcfnzbiylhgiutcjigg
```

Expected: Function deployed successfully.

- [ ] **Step 2: Schedule the daily cron via pg_cron**

Run via Supabase MCP:

```sql
-- Schedule daily fetch at 06:00 UTC (09:00 AST)
SELECT cron.schedule(
  'ai-news-daily-fetch',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://apcfnzbiylhgiutcjigg.supabase.co/functions/v1/ai-news-aggregator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 3: Trigger an initial manual run to seed data**

Use the dashboard "Refresh Now" button, or call via curl:

```bash
curl -X POST https://apcfnzbiylhgiutcjigg.supabase.co/functions/v1/ai-news-aggregator \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: Response with `{ inserted: N, skipped: 0, errors: [] }`

- [ ] **Step 4: Verify data in the table**

Run via MCP:
```sql
SELECT source, topic, title, published_at
FROM ai_news
ORDER BY published_at DESC
LIMIT 10;
```

Expected: Articles from multiple sources.

---

## Task 8: Update Documentation

**Files:**
- Modify: `docs/EDGE_FUNCTIONS_DEPLOYED.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update Edge Functions doc**

Add to `docs/EDGE_FUNCTIONS_DEPLOYED.md` in the status list and endpoints:

```markdown
- ✅ **ai-news-aggregator** - ACTIVE - Fetches AI news from 8 RSS sources + skills.sh daily, stores in ai_news table
```

And in the endpoints section:

```markdown
POST /ai-news-aggregator → Aggregate AI news from RSS feeds (admin-only manual trigger, or pg_cron scheduled)
```

- [ ] **Step 2: Update CHANGELOG.md**

Add under `## [Unreleased]`:

```markdown
- 2026-04-17 (claude) — feat: live AI news feed — daily-refreshed from 8 RSS sources + skills.sh, filterable by topic and source, admin manual refresh (ai-news)
```

- [ ] **Step 3: Commit all documentation**

```bash
git add docs/EDGE_FUNCTIONS_DEPLOYED.md CHANGELOG.md
git commit -m "docs: document ai-news-aggregator Edge Function and changelog entry"
```

- [ ] **Step 4: Push all changes**

```bash
git push origin master
```

---

## Summary

| Task | What | Commits |
|---|---|---|
| 1 | Database migration (`ai_news` table) | 1 |
| 2 | Edge Function (`ai-news-aggregator`) | 1 |
| 3 | DB methods in `js/db.js` | 1 |
| 4 | CSS styles | 1 |
| 5 | HTML page replacement | 1 |
| 6 | JS rendering + interactions | 1 |
| 7 | Deploy + cron + seed data | 0 (infra) |
| 8 | Documentation | 1 |
| **Total** | | **7 commits** |
