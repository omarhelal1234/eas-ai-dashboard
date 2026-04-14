# Changelog

All notable changes to the E-AI-S (EAS AI Adoption Tracker) project are recorded here.

Format: `- YYYY-MM-DD (channel) — description (scope)`
Channels: `claude` · `copilot` · `commit` · `manual`
This changelog is **append-only**. Every task, regardless of origin, must add an entry under `## [Unreleased]` per `.github/copilot-instructions.md` §4.

---

## [Unreleased]

- 2026-04-15 (claude) — **AI Prompt Improver (admin-only)** — New "Improve with AI" workflow on the admin Prompt Library page. Admin enters a raw English prompt; OpenAI (`gpt-4o-mini`) qualifies it into a structured prompt (ROLE/TASK/CONTEXT/INPUT/FORMAT/CONSTRAINTS), then Anthropic (`claude-sonnet-4-5`) refines it. Admin reviews side-by-side output and chooses to save to `prompt_library` or discard. Backend: new Supabase Edge Function `prompt-improver` (`supabase/functions/prompt-improver/`) holds API keys as secrets (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) and re-verifies admin role via the caller's JWT against `public.users.role`. Client uses the user session token; no API keys ever reach the browser. (feat/admin)

- 2026-04-15 (copilot) — **SPOC IDE Usage Stats Page** — New standalone page (`grafana-stats.html`) showing Grafana Copilot IDE usage stats scoped to the SPOC's practice users. SPOCs see only their practice; admins see all with a practice filter. Features: 6 KPI summary cards (total users, avg days active, interactions, generations, acceptances, LOC added), sortable/filterable user table with sparkline bars, data period banner, CSV export. Added `fetchGrafanaStats(practice)` to `db.js`. Navigation link added to sidebar under Management section for admin/spoc roles. (feat/ui)

- 2026-04-14 (copilot) — **IDE Usage Analytics Page in Admin Panel** — Added new "IDE Usage" page to admin panel showing Grafana Copilot IDE telemetry data. Features: 6 KPI summary cards (active users, code generations, acceptances, LOC added, agent days, chat days), filterable/sortable table with 13 columns, practice filter, search by name/username, CSV export. Data queried live from `copilot_users` IDE columns via Supabase. Accessible at `admin.html#ide-usage`. (feat/ui)

- 2026-04-14 (copilot) — **Fix: Task Count Mismatch — Show Both Total & Approved Counts** — Dashboard KPI "Total Tasks" sourced from `practice_summary` (approved-only) while nav badge and All Tasks tab counted all tasks regardless of approval status. Updated all locations to show both: Dashboard KPI now shows total tasks with "X approved" subtitle, nav badges show `N (M ✓)`, All Tasks pagination shows `(X approved)`, and My Tasks badge includes approved count. Applied same fix to admin.html. (fix/ui)

- 2026-04-15 (copilot) — **Community Prompt Library: Submit + Like/Dislike Voting** — Any authenticated user can submit prompts to the library (immediately visible). Like/dislike voting with toggle support. Prompts with ≥10 likes highlighted as "🔥 Popular". Prompts with ≥10 dislikes hard-deleted. New `prompt_votes` table, 3 SECURITY DEFINER RPCs (`vote_prompt`, `get_prompt_vote_counts`, `add_community_prompt`), updated RLS on `prompt_library`. New modal "Submit a Prompt" with role/category/text fields. Author name displayed on community prompts. (feat/ui+db)