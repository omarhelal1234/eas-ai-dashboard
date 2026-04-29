# Conservative ROI Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a conservative, defensible ROI metric (final hours saved + gross SAR value) to admins (org-wide) and Dept SPOCs (their practice only) on the Executive Summary view.

**Architecture:** New `app_config` table holds tunable constants. SECURITY DEFINER RPC `get_conservative_roi(p_practice)` returns JSON with three independently-computed hour figures, takes their MIN, applies a 0.5 humility coefficient, and converts to SAR using a configurable rate. Frontend mounts a single `roi-card.js` module gated by role.

**Tech Stack:** PostgreSQL (Supabase), JSONB, vanilla JS IIFE module pattern, existing `get_user_role()` / `get_user_practice()` helpers, existing `tasks.is_licensed_tool` generated column.

**Spec:** [`docs/superpowers/specs/2026-04-29-conservative-roi-design.md`](../specs/2026-04-29-conservative-roi-design.md). Note: spec referenced `sql/033`; the next available migration number is `sql/056`. This plan uses 056.

**Verification approach:** This codebase has no JS test runner. Verification is (a) SQL-level RPC tests via `mcp__claude_ai_Supabase__execute_sql` impersonating different `auth.uid()`s, and (b) manual UI checks across role logins. No mocks — the real DB is the test surface.

---

## File Plan

| File | Action | Purpose |
|---|---|---|
| `sql/056_conservative_roi.sql` | Create | `app_config` table + seed + RLS + `get_conservative_roi` RPC + `is_licensed_tool_value(text)` helper |
| `js/db.js` | Modify | Add `getConservativeROI(practice)` wrapper |
| `js/roi-card.js` | Create | Single-purpose render module |
| `src/pages/index.html` | Modify | Add `<div id="roi-card-slot">` to exec summary, include `<script>` for `roi-card.js`, add mount call in `renderExecSummary()` |
| `CHANGELOG.md` | Modify | Append unreleased entry |
| `README.md` | Modify | Add ROI feature blurb |
| `docs/BRD.md` | Modify | New KPI: Conservative ROI |
| `docs/HLD.md` | Modify | New table + RPC + role gating |
| `docs/CODE_ARCHITECTURE.md` | Modify | New module + migration |
| `docs/IMPLEMENTATION_NOTES.md` | Modify | Formula derivation, why MIN-of-3, why 0.5/8h, codex review notes |

---

## Task 1: SQL — `app_config` table

**Files:**
- Create: `sql/056_conservative_roi.sql` (start of file)

- [ ] **Step 1.1: Create the migration file with `app_config` table**

```sql
-- ============================================================
-- Migration 056 — Conservative ROI
-- Date: 2026-04-29
-- Adds:
--   1. app_config         — tunable constants (admin-editable)
--   2. is_licensed_tool_value() — pure helper to classify any ai_tool string
--   3. get_conservative_roi(p_practice) — admin/SPOC-only RPC
-- ============================================================

-- 1. Tunable constants table
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config_read_admin_spoc" ON app_config;
CREATE POLICY "app_config_read_admin_spoc" ON app_config
  FOR SELECT USING (
    get_user_role() IN ('admin', 'spoc', 'team_lead')
  );

DROP POLICY IF EXISTS "app_config_write_admin" ON app_config;
CREATE POLICY "app_config_write_admin" ON app_config
  FOR ALL USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 2. Seed ROI constants
INSERT INTO app_config (key, value) VALUES
  ('roi.cap',           '8'::jsonb),
  ('roi.coef',          '0.5'::jsonb),
  ('roi.usd_per_day',   '250'::jsonb),
  ('roi.hours_per_day', '8'::jsonb),
  ('roi.sar_per_usd',   '3.75'::jsonb)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 1.2: Verify table + seeds via MCP**

```sql
SELECT key, value FROM app_config WHERE key LIKE 'roi.%' ORDER BY key;
```
Expected: 5 rows with values `8`, `0.5`, `250`, `8`, `3.75`.

- [ ] **Step 1.3: Verify RLS read for admin and spoc, denied for contributor**

Run via MCP `execute_sql` (uses service role, so RLS bypassed) — instead inspect policy definitions:
```sql
SELECT polname, polcmd, pg_get_expr(polqual, polrelid)
FROM pg_policy WHERE polrelid = 'app_config'::regclass;
```
Expected: two policies present, read includes `'admin'`, `'spoc'`, `'team_lead'`; write only `'admin'`.

---

## Task 2: SQL — `is_licensed_tool_value()` helper

**Files:**
- Modify: `sql/056_conservative_roi.sql` (append)

- [ ] **Step 2.1: Add the helper function**

Append to `sql/056_conservative_roi.sql`:

```sql
-- 3. Pure helper: classify any ai_tool string as licensed.
--    Mirrors the rule used by tasks.is_licensed_tool generated column
--    (sql/004) so single-source-of-truth lives here going forward.
CREATE OR REPLACE FUNCTION is_licensed_tool_value(p_ai_tool TEXT)
RETURNS BOOLEAN AS $$
  SELECT
    CASE
      WHEN p_ai_tool IS NULL THEN false
      WHEN LOWER(p_ai_tool) LIKE '%github copilot%' THEN true
      WHEN LOWER(p_ai_tool) LIKE '%m365 copilot%'  THEN true
      ELSE false
    END;
$$ LANGUAGE sql IMMUTABLE
   SET search_path = public, pg_catalog;
```

- [ ] **Step 2.2: Verify helper matches the generated column**

```sql
SELECT
  COUNT(*) FILTER (WHERE is_licensed_tool = is_licensed_tool_value(ai_tool)) AS matches,
  COUNT(*) FILTER (WHERE is_licensed_tool <> is_licensed_tool_value(ai_tool)) AS mismatches,
  COUNT(*) AS total
FROM tasks;
```
Expected: `mismatches = 0`. If non-zero, fix the helper before continuing.

---

## Task 3: SQL — `get_conservative_roi` RPC

**Files:**
- Modify: `sql/056_conservative_roi.sql` (append)

- [ ] **Step 3.1: Append the RPC**

```sql
-- 4. Conservative ROI RPC (admin + spoc/team_lead only)
CREATE OR REPLACE FUNCTION get_conservative_roi(p_practice TEXT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_role        TEXT := get_user_role();
  v_cap         NUMERIC;
  v_coef        NUMERIC;
  v_usd_per_day NUMERIC;
  v_hrs_per_day NUMERIC;
  v_sar_per_usd NUMERIC;
  v_rate_sar_hr NUMERIC;
  v_practices   TEXT[];
  v_scope       TEXT;
  v_m1 NUMERIC; v_m2 NUMERIC; v_m3 NUMERIC;
  v_active_users INT;
  v_avg_per_user NUMERIC;
  v_hours_min   NUMERIC;
  v_final_hours NUMERIC;
  v_gross_sar   NUMERIC;
  v_by_practice JSONB;
BEGIN
  -- Role gate
  IF v_role NOT IN ('admin', 'spoc', 'team_lead') THEN
    RETURN NULL;
  END IF;

  -- Pull constants
  SELECT (value)::numeric INTO v_cap         FROM app_config WHERE key = 'roi.cap';
  SELECT (value)::numeric INTO v_coef        FROM app_config WHERE key = 'roi.coef';
  SELECT (value)::numeric INTO v_usd_per_day FROM app_config WHERE key = 'roi.usd_per_day';
  SELECT (value)::numeric INTO v_hrs_per_day FROM app_config WHERE key = 'roi.hours_per_day';
  SELECT (value)::numeric INTO v_sar_per_usd FROM app_config WHERE key = 'roi.sar_per_usd';

  v_rate_sar_hr := (v_usd_per_day / v_hrs_per_day) * v_sar_per_usd;

  -- Determine practices in scope
  IF v_role = 'admin' THEN
    IF p_practice IS NULL THEN
      v_scope     := 'org';
      v_practices := ARRAY(SELECT DISTINCT practice FROM practices ORDER BY practice);
    ELSE
      v_scope     := 'practice';
      v_practices := ARRAY[p_practice];
    END IF;
  ELSE
    -- SPOC / team_lead: ignore p_practice arg, use practice_spoc assignment
    v_scope := 'practice';
    v_practices := ARRAY(
      SELECT DISTINCT ps.practice
      FROM practice_spoc ps
      JOIN public.users u ON u.id = ps.spoc_id
      WHERE u.auth_id = auth.uid()
        AND COALESCE(ps.is_active, true) = true
    );
    -- Fallback: if no practice_spoc rows, use users.practice
    IF v_practices IS NULL OR cardinality(v_practices) = 0 THEN
      v_practices := ARRAY(
        SELECT practice FROM public.users
        WHERE auth_id = auth.uid() AND practice IS NOT NULL
      );
    END IF;
  END IF;

  -- If no practices in scope, return zeros
  IF v_practices IS NULL OR cardinality(v_practices) = 0 THEN
    RETURN jsonb_build_object(
      'scope', v_scope,
      'practices_in_scope', '[]'::jsonb,
      'method1_hours', 0, 'method2_hours', 0, 'method3_hours', 0,
      'hours_min', 0, 'coef', v_coef, 'cap', v_cap,
      'final_hours', 0, 'rate_sar_hr', v_rate_sar_hr, 'gross_sar', 0,
      'by_practice', '[]'::jsonb,
      'computed_at', now()
    );
  END IF;

  -- Method 1: SUM(LEAST(time_saved, cap)) over approved + licensed-tool tasks
  SELECT COALESCE(SUM(LEAST(t.time_saved, v_cap)), 0)
    INTO v_m1
  FROM tasks t
  WHERE t.approval_status = 'approved'
    AND t.is_licensed_tool = true
    AND t.time_saved > 0
    AND t.practice = ANY(v_practices);

  -- Method 2: SUM(time_saved) uncapped
  SELECT COALESCE(SUM(t.time_saved), 0)
    INTO v_m2
  FROM tasks t
  WHERE t.approval_status = 'approved'
    AND t.is_licensed_tool = true
    AND t.time_saved > 0
    AND t.practice = ANY(v_practices);

  -- Method 3: licensed_active_users * AVG(time_saved per active user)
  WITH per_user AS (
    SELECT t.employee_email, SUM(t.time_saved) AS user_total
    FROM tasks t
    WHERE t.approval_status = 'approved'
      AND t.is_licensed_tool = true
      AND t.time_saved > 0
      AND t.practice = ANY(v_practices)
    GROUP BY t.employee_email
  )
  SELECT
    COUNT(*)::int,
    COALESCE(AVG(user_total), 0)
    INTO v_active_users, v_avg_per_user
  FROM per_user;
  v_m3 := v_active_users * v_avg_per_user;

  v_hours_min   := LEAST(v_m1, v_m2, v_m3);
  v_final_hours := v_hours_min * v_coef;
  v_gross_sar   := v_final_hours * v_rate_sar_hr;

  -- Per-practice breakdown (admins always; SPOCs see their assigned)
  WITH per_practice AS (
    SELECT
      t.practice,
      COALESCE(SUM(LEAST(t.time_saved, v_cap)), 0) AS m1_p,
      COALESCE(SUM(t.time_saved), 0)               AS m2_p
    FROM tasks t
    WHERE t.approval_status = 'approved'
      AND t.is_licensed_tool = true
      AND t.time_saved > 0
      AND t.practice = ANY(v_practices)
    GROUP BY t.practice
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'practice',    pp.practice,
      'final_hours', LEAST(pp.m1_p, pp.m2_p) * v_coef,
      'gross_sar',   LEAST(pp.m1_p, pp.m2_p) * v_coef * v_rate_sar_hr
    ) ORDER BY pp.practice
  ), '[]'::jsonb)
    INTO v_by_practice
  FROM per_practice pp;

  RETURN jsonb_build_object(
    'scope', v_scope,
    'practices_in_scope', to_jsonb(v_practices),
    'method1_hours', v_m1,
    'method2_hours', v_m2,
    'method3_hours', v_m3,
    'hours_min',     v_hours_min,
    'coef',          v_coef,
    'cap',           v_cap,
    'final_hours',   v_final_hours,
    'rate_sar_hr',   v_rate_sar_hr,
    'gross_sar',     v_gross_sar,
    'by_practice',   v_by_practice,
    'computed_at',   now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
   SET search_path = public, pg_catalog;

REVOKE ALL ON FUNCTION get_conservative_roi(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_conservative_roi(TEXT) TO authenticated;
```

- [ ] **Step 3.2: Apply migration via MCP**

```
mcp__claude_ai_Supabase__apply_migration(
  name = '056_conservative_roi',
  query = <full file contents>
)
```
Expected: Success.

- [ ] **Step 3.3: Smoke-test the RPC as service role**

```sql
SELECT get_conservative_roi(NULL);
```
Note: when called as service role, `get_user_role()` returns NULL → RPC returns NULL. That confirms the role gate works (negative case).

- [ ] **Step 3.4: Smoke-test impersonating an admin user**

```sql
SET LOCAL request.jwt.claims = '{"sub":"<admin-auth-uid>"}';
SELECT get_conservative_roi(NULL);
```
Where `<admin-auth-uid>` is a real admin's `auth.uid()`. Find one:
```sql
SELECT u.auth_id FROM public.users u WHERE u.role = 'admin' LIMIT 1;
```
Expected: JSON object, `scope = 'org'`, `practices_in_scope` array length > 0, `final_hours` ≥ 0, `gross_sar` ≥ 0, `by_practice` is array.

- [ ] **Step 3.5: Smoke-test as a SPOC user**

```sql
SELECT u.auth_id, ps.practice
FROM public.users u
JOIN practice_spoc ps ON ps.spoc_id = u.id
WHERE u.role IN ('spoc','team_lead') AND COALESCE(ps.is_active,true)=true
LIMIT 1;

-- Then with the auth_id from above:
SET LOCAL request.jwt.claims = '{"sub":"<spoc-auth-uid>"}';
SELECT get_conservative_roi(NULL);
SELECT get_conservative_roi('Some Other Practice');  -- should still scope to their assigned, not Some Other
```
Expected: `scope = 'practice'`, `practices_in_scope` matches their assignment, p_practice argument is ignored for non-admins.

- [ ] **Step 3.6: Codex review checkpoint #1 — SQL**

Open codex (separate session) and paste the full `sql/056_conservative_roi.sql` file. Ask:
> "Review this Postgres migration for security (SECURITY DEFINER + role gating), correctness (math, RLS, NULL handling, search_path), and any race conditions or injection risks. Be terse — list findings only."

Apply any blocking issues, re-test Steps 3.4–3.5.

- [ ] **Step 3.7: Commit SQL**

```bash
git add sql/056_conservative_roi.sql
git commit -m "feat(sql): conservative ROI RPC with admin + SPOC role gating

- New app_config table with seeded ROI constants (cap=8, coef=0.5,
  rate=117.1875 SAR/hr from \$250/day × 3.75)
- New is_licensed_tool_value() pure helper mirroring sql/004 rule
- New get_conservative_roi(p_practice) RPC: SECURITY DEFINER,
  returns NULL for non-permitted roles; admins see org-wide or
  filtered, SPOCs auto-scoped to their practice_spoc assignments.
  Computes 3 hour methods, takes MIN, applies humility coef."
```

---

## Task 4: Frontend — `db.js` wrapper

**Files:**
- Modify: [`js/db.js`](../../../js/db.js) (append a method to the existing `db` IIFE namespace; locate where other RPC wrappers like `getExecutiveSummary` live and add next to it)

- [ ] **Step 4.1: Locate insertion point**

```bash
grep -n "getExecutiveSummary\|get_executive_summary" js/db.js
```
Expected: a line where `db.getExecutiveSummary` is defined. Add the new method immediately below it.

- [ ] **Step 4.2: Add the wrapper**

Add to `js/db.js`:

```js
/**
 * Fetch conservative ROI metrics. Returns null for non-admin/non-spoc roles.
 * @param {string|null} practice - admin-only filter; ignored for SPOC callers.
 * @returns {Promise<object|null>}
 */
db.getConservativeROI = async function (practice = null) {
  const { data, error } = await supa.rpc('get_conservative_roi', { p_practice: practice });
  if (error) {
    console.error('[db.getConservativeROI]', error);
    throw error;
  }
  return data; // null when role gate denies
};
```

(Use whatever client variable name matches the surrounding code — `supa`, `client`, `sb`. Match the existing pattern.)

- [ ] **Step 4.3: Verify in browser console**

Serve the app locally, log in as admin, open devtools:
```js
await db.getConservativeROI();
```
Expected: an object with `final_hours`, `gross_sar`, `by_practice`, etc.

- [ ] **Step 4.4: Commit**

```bash
git add js/db.js
git commit -m "feat(db): add getConservativeROI wrapper for ROI RPC"
```

---

## Task 5: Frontend — `roi-card.js` module

**Files:**
- Create: `js/roi-card.js`

- [ ] **Step 5.1: Create the module**

```js
/**
 * Conservative ROI Card
 * Single-purpose render module. Mounts when caller has admin/spoc/team_lead role.
 *
 * Headline: Final Hours Saved + Gross Value (SAR)
 * Sub-line: methodology summary (humility transparency)
 * <details>: per-method breakdown so reviewers can see how the number was built
 * Admin-only: per-practice list
 */
(function (global) {
  'use strict';

  const SAR = (n) =>
    new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' SAR';
  const HRS = (n) =>
    new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n) + ' h';

  function template(data, isAdmin) {
    const byPractice = Array.isArray(data.by_practice) ? data.by_practice : [];
    const adminBlock = isAdmin && byPractice.length
      ? `<div class="roi-by-practice">
           <h5>By Practice</h5>
           <ul>${byPractice.map(p =>
             `<li><span>${p.practice}</span> <strong>${HRS(p.final_hours)}</strong> · ${SAR(p.gross_sar)}</li>`
           ).join('')}</ul>
         </div>`
      : '';

    return `
      <div class="kpi-card roi-card">
        <div class="kpi-label">ROI (Conservative)</div>
        <div class="roi-headline">
          <div class="roi-stat">
            <div class="roi-stat-value">${HRS(data.final_hours)}</div>
            <div class="roi-stat-label">Final Hours Saved</div>
          </div>
          <div class="roi-stat">
            <div class="roi-stat-value">${SAR(data.gross_sar)}</div>
            <div class="roi-stat-label">Gross Value</div>
          </div>
        </div>
        <div class="roi-caption">
          Approved + licensed-tool tasks · min of 3 methods · ${data.coef}× humility · ${data.cap}h/task cap
        </div>
        <details class="roi-detail">
          <summary>How this is calculated</summary>
          <table>
            <tr><td>Method 1 (capped sum)</td><td>${HRS(data.method1_hours)}</td></tr>
            <tr><td>Method 2 (raw sum)</td><td>${HRS(data.method2_hours)}</td></tr>
            <tr><td>Method 3 (users × avg)</td><td>${HRS(data.method3_hours)}</td></tr>
            <tr><td>MIN of methods</td><td>${HRS(data.hours_min)}</td></tr>
            <tr><td>× humility (${data.coef})</td><td>${HRS(data.final_hours)}</td></tr>
            <tr><td>Rate (SAR/hr)</td><td>${data.rate_sar_hr.toFixed(4)}</td></tr>
          </table>
        </details>
        ${adminBlock}
      </div>
    `;
  }

  async function mount(slotSelector) {
    const slot = document.querySelector(slotSelector);
    if (!slot) return;

    if (!auth || !auth.hasRole || !auth.hasRole(['admin', 'spoc', 'team_lead'])) {
      slot.innerHTML = '';
      return;
    }

    slot.innerHTML = '<div class="kpi-card roi-card roi-loading">Loading ROI…</div>';
    try {
      const data = await db.getConservativeROI();
      if (!data) { slot.innerHTML = ''; return; }
      const isAdmin = auth.hasRole(['admin']);
      slot.innerHTML = template(data, isAdmin);
    } catch (e) {
      slot.innerHTML = '<div class="kpi-card roi-card roi-error">ROI unavailable</div>';
      console.error('[roi-card]', e);
    }
  }

  global.roiCard = { mount };
})(window);
```

- [ ] **Step 5.2: Add minimal styles**

Append to `css/dashboard.css` (or matching existing file — check what `kpi-card` styles use):

```css
.roi-card { grid-column: span 2; }
.roi-headline { display: flex; gap: 24px; margin: 8px 0; }
.roi-stat-value { font-size: 1.6rem; font-weight: 600; }
.roi-stat-label { font-size: 0.8rem; color: var(--muted, #888); }
.roi-caption    { font-size: 0.75rem; color: var(--muted, #888); margin-top: 4px; }
.roi-detail     { margin-top: 8px; font-size: 0.8rem; }
.roi-detail table { width: 100%; border-collapse: collapse; }
.roi-detail td { padding: 2px 4px; }
.roi-detail td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.roi-by-practice ul { list-style: none; padding: 0; margin: 6px 0 0 0; font-size: 0.8rem; }
.roi-by-practice li { display: flex; justify-content: space-between; padding: 2px 0; }
.roi-loading, .roi-error { color: var(--muted, #888); font-size: 0.85rem; }
```

- [ ] **Step 5.3: Commit**

```bash
git add js/roi-card.js css/dashboard.css
git commit -m "feat(ui): roi-card module with humility-transparent breakdown"
```

---

## Task 6: Mount in Executive Summary

**Files:**
- Modify: [`src/pages/index.html`](../../../src/pages/index.html)

- [ ] **Step 6.1: Add the mount slot**

In `src/pages/index.html`, immediately after the closing `</div>` of `exec-kpi-grid` (around line 1485), insert:

```html
      <!-- Conservative ROI card (admin + Dept SPOC only) -->
      <div id="roi-card-slot" style="margin-top:20px"></div>
```

- [ ] **Step 6.2: Include the script**

Find where other `js/*.js` files are sourced near the bottom of `index.html` (e.g. `<script src="../../js/db.js"></script>`) and add:

```html
<script src="../../js/roi-card.js"></script>
```

Place it *after* `db.js` and *after* `auth.js` since `roi-card.js` depends on both globals.

- [ ] **Step 6.3: Wire the mount call**

Locate `renderExecSummary()` in `index.html` (near line 7520-ish). At the **end** of that function (after the existing `exec-kpi-*` updates), add:

```js
    if (window.roiCard) { roiCard.mount('#roi-card-slot'); }
```

- [ ] **Step 6.4: Manual test — admin login**

1. Log in as admin user.
2. Navigate to Executive Summary.
3. Confirm: ROI card renders below KPI grid; shows hours + SAR; "By Practice" list visible; details `<summary>` expands to show 3 methods.
4. Open devtools → Network → confirm a single `rpc/get_conservative_roi` call.

- [ ] **Step 6.5: Manual test — SPOC login**

1. Log in as a Dept SPOC.
2. Navigate to Executive Summary (if accessible — verify route is open to SPOC).
3. Confirm: ROI card renders; "By Practice" block shows ONLY their assigned practice(s); numbers ≠ admin's org-wide numbers.

- [ ] **Step 6.6: Manual test — contributor / viewer / executive**

1. Log in as each of the three.
2. Navigate to Executive Summary.
3. Confirm: ROI card slot is empty (no card rendered, no error in console).
4. In devtools: `await db.getConservativeROI()` returns `null`.

- [ ] **Step 6.7: Codex review checkpoint #2 — Frontend**

Paste `js/roi-card.js`, the mount block in `index.html`, and the CSS into codex. Ask:
> "Review for XSS (we're injecting practice names into innerHTML), role gating coherence, accessibility (the `<details>` and table), and any race conditions on mount. Terse list."

Fix blocking issues. Note: practice names from the DB are trusted (admin-curated `practices` table) but if codex flags it, switch to `textContent` building or escape.

- [ ] **Step 6.8: Commit**

```bash
git add src/pages/index.html
git commit -m "feat(ui): mount conservative ROI card on Executive Summary"
```

---

## Task 7: Documentation Sweep

**Files:** `CHANGELOG.md`, `README.md`, `docs/BRD.md`, `docs/HLD.md`, `docs/CODE_ARCHITECTURE.md`, `docs/IMPLEMENTATION_NOTES.md`

- [ ] **Step 7.1: CHANGELOG**

Append under `## [Unreleased]`:
```
- 2026-04-29 (claude) — feat: conservative ROI card on Executive Summary; admin sees org-wide, Dept SPOCs see their practice (sql/056, js/roi-card.js)
```

- [ ] **Step 7.2: README**

In the features list, add a bullet:
> - **Conservative ROI** (admin + Dept SPOC) — Min-of-three-methods hours saved with 0.5 humility factor and 8h/task cap, converted to SAR at $250/day blended rate.

- [ ] **Step 7.3: BRD**

Add a new KPI row to the KPI section: *Conservative ROI (Final Hours Saved, Gross SAR)* — visibility: admin org-wide / SPOC practice-scoped.

- [ ] **Step 7.4: HLD**

Document `app_config` table, `is_licensed_tool_value()` helper, and `get_conservative_roi(p_practice)` RPC. Note the role gate and SECURITY DEFINER.

- [ ] **Step 7.5: CODE_ARCHITECTURE**

Add `js/roi-card.js` to the modules list with one-line description. Add `sql/056_conservative_roi.sql` to the migrations list.

- [ ] **Step 7.6: IMPLEMENTATION_NOTES**

Append a section "Conservative ROI (2026-04-29)" with:
- Why MIN-of-3 (each method mitigates a different bias).
- Why 0.5 coefficient (self-reporting bias on time_without_ai).
- Why 8h/task cap (suppresses single-task outliers).
- Why $250/day × 3.75 SAR/USD = 117.1875 SAR/hr (user-supplied blended rate).
- Codex review notes from checkpoints 1 and 2.

- [ ] **Step 7.7: Commit docs**

```bash
git add CHANGELOG.md README.md docs/BRD.md docs/HLD.md docs/CODE_ARCHITECTURE.md docs/IMPLEMENTATION_NOTES.md
git commit -m "docs: conservative ROI sweep (CHANGELOG, README, BRD, HLD, ARCH, NOTES)"
```

---

## Task 8: Final Codex Review + Push

- [ ] **Step 8.1: Codex review checkpoint #3 — pre-commit holistic**

Provide codex with the full diff:
```bash
git log --oneline master..HEAD
git diff master..HEAD
```
Ask:
> "Review the entire ROI feature diff: SQL, JS, HTML, CSS, docs. Look for: contradictions between docs and code, missed reference-integrity (CLAUDE.md §6), security holes, and anything that conflicts with the spec at docs/superpowers/specs/2026-04-29-conservative-roi-design.md. Terse list."

Address blocking issues, amend or add new commits as needed.

- [ ] **Step 8.2: Push**

```bash
git push origin master
```
Expected: push succeeds.

---

## Self-Review (run after writing the plan)

**Spec coverage:**
- §2 Audience & Visibility — covered Tasks 3 (RPC role gate), 5 (UIGuard), 6 (mount checks).
- §3 Data Source Filter — covered Task 3 (approved + is_licensed_tool + time_saved>0).
- §4 Conservative Formula — covered Task 3 (m1, m2, m3, MIN, coef, rate).
- §5 Backend — covered Tasks 1–3.
- §6 Frontend — covered Tasks 4–6.
- §7 Justification — covered in §7.6 IMPLEMENTATION_NOTES.
- §8 Doc sweep — Task 7.
- §9 Portability — no new vendor-specific deps; verified Low difficulty.
- §10 Testing matrix — Steps 3.3–3.5 (SQL) + 6.4–6.6 (UI).
- §11 Open items — none.

**Placeholder scan:** No "TBD" / "TODO" / "implement later". CSS step says "or matching existing file — check" because we don't know the project's CSS organization without opening it; that's an accurate instruction, not a placeholder.

**Type/name consistency:** Method names match across files: `db.getConservativeROI()` ↔ `roiCard.mount()` ↔ RPC `get_conservative_roi(p_practice)`. Constants `cap`, `coef`, `rate_sar_hr` consistent. JSON shape from RPC matches what `template()` consumes.

**Spec→plan filename note:** Spec said `sql/033`; plan corrected to `sql/056` (next available). This is reconciled at the top of the plan.
