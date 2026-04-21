# Executive Summary Dashboard Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the crashing weekly trend chart, add department-level breakdowns, tiered KPI metrics, cumulative growth line, and updated exports to the Executive Summary dashboard.

**Architecture:** Single RPC enhancement — extend `get_executive_summary` with new JSONB keys (`total_licensed_users`, `adoption_rate`, `hours_per_resource`, `department_breakdown`, `detailed_metrics`) and fix `weekly_trend`. All rendering stays in `index.html` inline JS. New CSS goes in `dashboard.css`.

**Tech Stack:** PostgreSQL (Supabase RPC), vanilla JS, Chart.js 4.x, jsPDF, PptxGenJS, CSS transitions.

**Spec:** `docs/superpowers/specs/2026-04-21-executive-summary-enhancement-design.md`

---

### Task 1: Fix `weekly_trend` crash in the RPC

**Files:**
- Modify: `sql/010_executive_role.sql:124-137` — weekly_trend subquery

- [ ] **Step 1: Update the `weekly_trend` subquery**

In `sql/010_executive_role.sql`, replace the `weekly_trend` subquery (lines 124-137) with:

```sql
    'weekly_trend', (
      SELECT COALESCE(jsonb_agg(row_to_json(wt)), '[]'::jsonb)
      FROM (
        SELECT
          week_number,
          COUNT(*) AS task_count,
          COALESCE(SUM(time_without_ai - time_with_ai), 0) AS hours_saved,
          SUM(COUNT(*)) OVER (ORDER BY week_number) AS cumulative_tasks,
          SUM(COALESCE(SUM(time_without_ai - time_with_ai), 0)) OVER (ORDER BY week_number) AS cumulative_hours
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
          AND week_number IS NOT NULL
        GROUP BY week_number
        ORDER BY week_number
      ) wt
    ),
```

Key changes: added `AND week_number IS NOT NULL`, added `cumulative_tasks` and `cumulative_hours` window function columns.

- [ ] **Step 2: Deploy the migration via Supabase MCP**

Run the updated `CREATE OR REPLACE FUNCTION get_executive_summary(...)` through Supabase MCP `execute_sql`. The function uses `CREATE OR REPLACE` so it's safe to re-run.

- [ ] **Step 3: Verify the fix**

Call the RPC via Supabase MCP:

```sql
SELECT get_executive_summary(NULL);
```

Confirm: `weekly_trend` array has no entries with `week_number: null`, and each entry has `cumulative_tasks` and `cumulative_hours` fields.

- [ ] **Step 4: Commit**

```bash
git add sql/010_executive_role.sql
git commit -m "fix: filter null week_number in exec summary weekly_trend + add cumulative columns"
```

---

### Task 2: Add new RPC keys — KPI and detailed metrics

**Files:**
- Modify: `sql/010_executive_role.sql:78-164` — `get_executive_summary` function body

- [ ] **Step 1: Add `total_licensed_users`, `adoption_rate`, `hours_per_resource` keys**

In `sql/010_executive_role.sql`, inside the `jsonb_build_object(...)` call (after the existing `'active_users'` key around line 95), add these three new keys:

```sql
    'total_licensed_users', (
      SELECT COUNT(*) FROM copilot_users
      WHERE practice = ANY(v_practices)
    ),
    'adoption_rate', (
      SELECT CASE
        WHEN (SELECT COUNT(*) FROM copilot_users WHERE practice = ANY(v_practices)) = 0 THEN 0
        ELSE ROUND(
          COUNT(DISTINCT t.employee_email)::numeric * 100 /
          (SELECT COUNT(*) FROM copilot_users WHERE practice = ANY(v_practices)),
          1
        )
      END
      FROM tasks t
      WHERE t.practice = ANY(v_practices)
        AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
    ),
    'hours_per_resource', (
      SELECT CASE
        WHEN (SELECT COUNT(*) FROM copilot_users WHERE practice = ANY(v_practices)) = 0 THEN 0
        ELSE ROUND(
          COALESCE(SUM(time_without_ai - time_with_ai), 0)::numeric /
          (SELECT COUNT(*) FROM copilot_users WHERE practice = ANY(v_practices)),
          1
        )
      END
      FROM tasks
      WHERE practice = ANY(v_practices)
        AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
        AND approval_status = 'approved'
    ),
```

- [ ] **Step 2: Add `detailed_metrics` key**

After the `'tool_usage'` key (around line 163), add:

```sql
    'detailed_metrics', jsonb_build_object(
      'avg_quality', (
        SELECT ROUND(AVG(NULLIF(quality_rating, 0))::numeric, 1)
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
      ),
      'approval_rate', (
        SELECT CASE WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(COUNT(*) FILTER (WHERE approval_status = 'approved')::numeric * 100 / COUNT(*), 1)
        END
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
      ),
      'avg_efficiency', (
        SELECT ROUND(AVG(
          CASE WHEN time_without_ai > 0
            THEN (time_without_ai - time_with_ai)::numeric / time_without_ai * 100
            ELSE 0
          END
        )::numeric, 1)
        FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
          AND approval_status = 'approved'
      ),
      'top_tool', (
        SELECT ai_tool FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
          AND ai_tool IS NOT NULL AND ai_tool != ''
        GROUP BY ai_tool ORDER BY COUNT(*) DESC LIMIT 1
      ),
      'top_tool_count', (
        SELECT COUNT(*) FROM tasks
        WHERE practice = ANY(v_practices)
          AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
          AND ai_tool = (
            SELECT ai_tool FROM tasks
            WHERE practice = ANY(v_practices)
              AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
              AND ai_tool IS NOT NULL AND ai_tool != ''
            GROUP BY ai_tool ORDER BY COUNT(*) DESC LIMIT 1
          )
      )
    )
```

- [ ] **Step 3: Deploy and verify**

Deploy via Supabase MCP `execute_sql`, then call:

```sql
SELECT get_executive_summary(NULL);
```

Confirm the response includes `total_licensed_users`, `adoption_rate`, `hours_per_resource`, and `detailed_metrics` with `avg_quality`, `approval_rate`, `avg_efficiency`, `top_tool`, `top_tool_count`.

- [ ] **Step 4: Commit**

```bash
git add sql/010_executive_role.sql
git commit -m "feat: add KPI and detailed_metrics keys to exec summary RPC"
```

---

### Task 3: Add `department_breakdown` to the RPC

**Files:**
- Modify: `sql/010_executive_role.sql` — add `department_breakdown` key inside `jsonb_build_object`

- [ ] **Step 1: Add the `department_breakdown` key**

After the `'detailed_metrics'` key added in Task 2, add:

```sql
    'department_breakdown', (
      SELECT COALESCE(jsonb_agg(dept_row ORDER BY dept_name), '[]'::jsonb)
      FROM (
        SELECT
          d.name AS dept_name,
          jsonb_build_object(
            'department', d.name,
            'department_id', d.id,
            'practice_count', COUNT(DISTINCT p.name),
            'task_count', COUNT(t.id),
            'hours_saved', COALESCE(SUM(t.time_without_ai - t.time_with_ai) FILTER (WHERE t.approval_status = 'approved'), 0),
            'active_users', COUNT(DISTINCT t.employee_email),
            'total_resources', (
              SELECT COUNT(*) FROM copilot_users cu
              WHERE cu.practice = ANY(ARRAY(SELECT p2.name FROM practices p2 WHERE p2.department_id = d.id AND p2.name = ANY(v_practices)))
            ),
            'adoption_rate', CASE
              WHEN (
                SELECT COUNT(*) FROM copilot_users cu
                WHERE cu.practice = ANY(ARRAY(SELECT p2.name FROM practices p2 WHERE p2.department_id = d.id AND p2.name = ANY(v_practices)))
              ) = 0 THEN 0
              ELSE ROUND(
                COUNT(DISTINCT t.employee_email)::numeric * 100 / (
                  SELECT COUNT(*) FROM copilot_users cu
                  WHERE cu.practice = ANY(ARRAY(SELECT p2.name FROM practices p2 WHERE p2.department_id = d.id AND p2.name = ANY(v_practices)))
                ), 1
              )
            END,
            'practices', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'practice', sub.practice,
                  'task_count', sub.task_count,
                  'hours_saved', sub.hours_saved,
                  'active_users', sub.active_users,
                  'avg_quality', sub.avg_quality
                ) ORDER BY sub.practice
              )
              FROM (
                SELECT
                  t2.practice,
                  COUNT(*) AS task_count,
                  COALESCE(SUM(t2.time_without_ai - t2.time_with_ai), 0) AS hours_saved,
                  COUNT(DISTINCT t2.employee_email) AS active_users,
                  ROUND(AVG(NULLIF(t2.quality_rating, 0))::numeric, 2) AS avg_quality
                FROM tasks t2
                JOIN practices p2 ON p2.name = t2.practice
                WHERE p2.department_id = d.id
                  AND t2.practice = ANY(v_practices)
                  AND (p_quarter_id IS NULL OR t2.quarter_id = p_quarter_id)
                GROUP BY t2.practice
              ) sub
            ), '[]'::jsonb)
          ) AS dept_row
        FROM departments d
        JOIN practices p ON p.department_id = d.id AND p.name = ANY(v_practices)
        LEFT JOIN tasks t ON t.practice = p.name
          AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
        WHERE d.is_active = true
        GROUP BY d.id, d.name
      ) dept_rows
    )
```

- [ ] **Step 2: Deploy and verify**

Deploy via Supabase MCP `execute_sql`, then call:

```sql
SELECT get_executive_summary(NULL);
```

Confirm: `department_breakdown` is an array of objects, each with `department`, `department_id`, `practice_count`, `task_count`, `hours_saved`, `active_users`, `total_resources`, `adoption_rate`, and `practices` (nested array). Departments sorted alphabetically.

- [ ] **Step 3: Commit**

```bash
git add sql/010_executive_role.sql
git commit -m "feat: add department_breakdown to exec summary RPC"
```

---

### Task 4: Update HTML — expanded KPI grid + department section + secondary metrics

**Files:**
- Modify: `src/pages/index.html:1440-1500` — executive summary page HTML

- [ ] **Step 1: Replace the KPI grid HTML**

In `src/pages/index.html`, replace the existing KPI grid (lines 1442-1447):

```html
      <div class="kpi-grid" id="exec-kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Total Tasks</div><div class="kpi-value blue" id="exec-kpi-tasks">—</div><div class="kpi-sub">across assigned practices</div></div>
        <div class="kpi-card"><div class="kpi-label">Hours Saved</div><div class="kpi-value green" id="exec-kpi-hours">—</div><div class="kpi-sub">approved tasks only</div></div>
        <div class="kpi-card"><div class="kpi-label">Active Users</div><div class="kpi-value yellow" id="exec-kpi-users">—</div><div class="kpi-sub">unique contributors</div></div>
        <div class="kpi-card"><div class="kpi-label">Practices</div><div class="kpi-value purple" id="exec-kpi-practices">—</div><div class="kpi-sub">under your oversight</div></div>
      </div>
```

with:

```html
      <!-- Primary KPIs (6 cards) -->
      <div class="exec-kpi-grid" id="exec-kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Total Tasks</div><div class="kpi-value blue" id="exec-kpi-tasks">—</div><div class="kpi-sub">across all practices</div></div>
        <div class="kpi-card"><div class="kpi-label">Hours Saved</div><div class="kpi-value green" id="exec-kpi-hours">—</div><div class="kpi-sub">approved tasks only</div></div>
        <div class="kpi-card"><div class="kpi-label">Active Users</div><div class="kpi-value yellow" id="exec-kpi-users">—</div><div class="kpi-sub">unique contributors</div></div>
        <div class="kpi-card"><div class="kpi-label">Adoption Rate</div><div class="kpi-value purple" id="exec-kpi-adoption">—</div><div class="kpi-sub" id="exec-kpi-adoption-sub">— / — licensed</div></div>
        <div class="kpi-card"><div class="kpi-label">Hrs / Resource</div><div class="kpi-value cyan" id="exec-kpi-hrsres">—</div><div class="kpi-sub" id="exec-kpi-hrsres-sub">— hrs / — resources</div></div>
        <div class="kpi-card"><div class="kpi-label">Practices</div><div class="kpi-value pink" id="exec-kpi-practices">—</div><div class="kpi-sub">under your oversight</div></div>
      </div>
```

- [ ] **Step 2: Add department drill-down section after charts row 2**

After the second `exec-charts-row` div (line 1491), before the empty state div, insert:

```html
      <!-- Department Drill-Down -->
      <div class="exec-section-header" style="margin-top:28px">
        <span class="exec-section-label">Department Breakdown</span>
      </div>
      <div class="exec-dept-drilldown" id="exec-dept-drilldown"></div>

      <!-- Secondary Metrics (collapsible) -->
      <div class="exec-section-header exec-section-toggle" id="exec-detailed-toggle" style="margin-top:28px;cursor:pointer" onclick="toggleExecDetailed()">
        <span class="exec-section-chevron" id="exec-detailed-chevron">▾</span>
        <span class="exec-section-label">Detailed Metrics</span>
      </div>
      <div class="exec-detailed-grid" id="exec-detailed-grid">
        <div class="exec-detail-card"><div class="exec-detail-label">Avg Quality Rating</div><div class="exec-detail-value" id="exec-detail-quality">—</div></div>
        <div class="exec-detail-card"><div class="exec-detail-label">Approval Rate</div><div class="exec-detail-value green" id="exec-detail-approval">—</div></div>
        <div class="exec-detail-card"><div class="exec-detail-label">Avg Efficiency Gain</div><div class="exec-detail-value purple" id="exec-detail-efficiency">—</div></div>
        <div class="exec-detail-card"><div class="exec-detail-label">Top AI Tool</div><div class="exec-detail-value blue" id="exec-detail-toptool">—</div><div class="exec-detail-sub" id="exec-detail-toptool-sub"></div></div>
      </div>
```

- [ ] **Step 3: Verify HTML structure**

Open the page in a browser and confirm the new elements render (even with placeholder "—" values). Check that the empty state div is still present and correctly placed after the new sections.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.html
git commit -m "feat: expand exec summary HTML — 6 KPIs, dept drill-down, secondary metrics"
```

---

### Task 5: Add CSS styles for new executive summary sections

**Files:**
- Modify: `css/dashboard.css` — add styles after the existing exec-summary rules (~line 1943)

- [ ] **Step 1: Add the CSS rules**

At the end of `css/dashboard.css`, append the following styles:

```css
/* ======== EXECUTIVE SUMMARY ENHANCEMENTS ======== */

/* 6-column KPI grid */
.exec-kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 16px;
  margin-bottom: 4px;
}
@media (max-width: 1200px) {
  .exec-kpi-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 640px) {
  .exec-kpi-grid { grid-template-columns: repeat(2, 1fr); }
}

/* KPI color additions */
.kpi-value.cyan { color: #06b6d4; }
.kpi-value.pink { color: #ec4899; }

/* Section headers */
.exec-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.exec-section-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-muted);
  font-weight: 600;
}
.exec-section-chevron {
  color: var(--text-secondary);
  font-size: 14px;
  transition: transform 0.2s ease;
}
.exec-section-toggle:hover .exec-section-label {
  color: var(--text-secondary);
}

/* Department drill-down */
.exec-dept-drilldown {
  background: var(--card-bg);
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  overflow: hidden;
}
.exec-dept-row {
  border-bottom: 1px solid var(--border-primary);
  cursor: pointer;
  transition: background 0.15s ease;
}
.exec-dept-row:last-child { border-bottom: none; }
.exec-dept-row:hover { background: var(--hover-bg, rgba(59,130,246,0.04)); }
.exec-dept-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
}
.exec-dept-name {
  display: flex;
  align-items: center;
  gap: 10px;
}
.exec-dept-name strong {
  font-size: 14px;
  color: var(--text-primary);
}
.exec-dept-badge {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--badge-bg, var(--border-primary));
  padding: 2px 8px;
  border-radius: 10px;
}
.exec-dept-stats {
  display: flex;
  gap: 24px;
  font-size: 12px;
  color: var(--text-secondary);
}
.exec-dept-stats strong { font-weight: 600; }
.exec-dept-chevron {
  color: var(--text-muted);
  font-size: 14px;
  transition: transform 0.2s ease;
  margin-right: 4px;
}
.exec-dept-chevron.open {
  transform: rotate(90deg);
}
.exec-dept-practices {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
}
.exec-dept-practices.open {
  max-height: 500px;
}
.exec-practice-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 18px 10px 44px;
  font-size: 12px;
  border-top: 1px solid var(--border-secondary, rgba(51,65,85,0.3));
  background: var(--nested-bg, rgba(0,0,0,0.02));
}
[data-theme="dark"] .exec-practice-row {
  background: rgba(15,23,42,0.5);
}
.exec-practice-row span:first-child {
  color: var(--text-primary);
}
.exec-practice-stats {
  display: flex;
  gap: 24px;
  color: var(--text-secondary);
}

/* Secondary Metrics */
.exec-detailed-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  overflow: hidden;
  transition: max-height 0.25s ease, opacity 0.2s ease;
  max-height: 200px;
  opacity: 1;
}
.exec-detailed-grid.collapsed {
  max-height: 0;
  opacity: 0;
}
@media (max-width: 900px) {
  .exec-detailed-grid { grid-template-columns: repeat(2, 1fr); }
}
.exec-detail-card {
  background: var(--card-bg);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  padding: 14px;
}
.exec-detail-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.exec-detail-value {
  font-size: 22px;
  font-weight: 600;
  color: var(--text-primary);
}
.exec-detail-value.green { color: #10b981; }
.exec-detail-value.purple { color: #8b5cf6; }
.exec-detail-value.blue { color: #3b82f6; }
.exec-detail-sub {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}
```

- [ ] **Step 2: Verify styles render**

Open the dashboard in a browser, navigate to Executive Summary. Confirm:
- KPI grid shows 6 columns on wide screens, 3 on medium, 2 on mobile
- Department drill-down container has rounded corners and border
- Secondary metrics section renders 4 cards in a row

- [ ] **Step 3: Commit**

```bash
git add css/dashboard.css
git commit -m "feat: add CSS for exec summary 6-col KPIs, dept drill-down, detailed metrics"
```

---

### Task 6: Update `renderExecSummary` JS — populate new KPIs and secondary metrics

**Files:**
- Modify: `src/pages/index.html:7057-7102` — `renderExecSummary` function body

- [ ] **Step 1: Update the KPI population code**

In `src/pages/index.html`, replace the existing KPI population block (lines 7058-7061):

```javascript
    document.getElementById('exec-kpi-tasks').textContent = fmt(summary.total_tasks, 0);
    document.getElementById('exec-kpi-hours').textContent = fmt(summary.total_hours_saved, 1);
    document.getElementById('exec-kpi-users').textContent = fmt(summary.active_users, 0);
    document.getElementById('exec-kpi-practices').textContent = summary.practices.length;
```

with:

```javascript
    // ---- Primary KPIs ----
    document.getElementById('exec-kpi-tasks').textContent = fmt(summary.total_tasks, 0);
    document.getElementById('exec-kpi-hours').textContent = fmt(summary.total_hours_saved, 1);
    document.getElementById('exec-kpi-users').textContent = fmt(summary.active_users, 0);
    document.getElementById('exec-kpi-adoption').textContent = (summary.adoption_rate || 0) + '%';
    document.getElementById('exec-kpi-adoption-sub').textContent = `${fmt(summary.active_users, 0)} / ${fmt(summary.total_licensed_users || 0, 0)} licensed`;
    document.getElementById('exec-kpi-hrsres').textContent = fmt(summary.hours_per_resource || 0, 1);
    document.getElementById('exec-kpi-hrsres-sub').textContent = `${fmt(summary.total_hours_saved, 0)} hrs / ${fmt(summary.total_licensed_users || 0, 0)} resources`;
    document.getElementById('exec-kpi-practices').textContent = summary.practices.length;
```

- [ ] **Step 2: Add secondary metrics population**

After the line `renderExecCharts(summary);` (line 7097), add:

```javascript
    // ---- Department Drill-Down ----
    renderExecDepartments(summary.department_breakdown || []);

    // ---- Secondary Metrics ----
    const dm = summary.detailed_metrics || {};
    document.getElementById('exec-detail-quality').textContent = dm.avg_quality != null ? dm.avg_quality + '/5' : '—';
    document.getElementById('exec-detail-approval').textContent = dm.approval_rate != null ? dm.approval_rate + '%' : '—';
    document.getElementById('exec-detail-efficiency').textContent = dm.avg_efficiency != null ? dm.avg_efficiency + '%' : '—';
    document.getElementById('exec-detail-toptool').textContent = dm.top_tool || '—';
    document.getElementById('exec-detail-toptool-sub').textContent = dm.top_tool_count ? fmt(dm.top_tool_count, 0) + ' uses' : '';
```

- [ ] **Step 3: Verify in browser**

Navigate to Executive Summary. Confirm:
- 6 KPI cards show real data (Adoption Rate has "X / Y licensed" sub-label, Hrs/Resource has "X hrs / Y resources")
- Secondary metrics section at bottom shows quality, approval rate, efficiency, top tool

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.html
git commit -m "feat: populate 6 primary KPIs + secondary metrics in exec summary"
```

---

### Task 7: Fix weekly trend chart JS + add cumulative line

**Files:**
- Modify: `src/pages/index.html:7127-7179` — weekly trend chart rendering in `renderExecCharts`

- [ ] **Step 1: Replace the weekly trend chart code**

In `src/pages/index.html`, replace the weekly trend chart block (from `// 1. Weekly Trend` comment at line 7127 through line 7180) with:

```javascript
  // 1. Weekly Trend (combo: bars=tasks, line=hours, dashed line=cumulative)
  const weeklyData = summary.weekly_trend || [];
  const weeklyCanvas = document.getElementById('exec-chart-weekly');
  if (weeklyCanvas && weeklyData.length === 0) {
    const ctx = weeklyCanvas.getContext('2d');
    ctx.clearRect(0, 0, weeklyCanvas.width, weeklyCanvas.height);
    ctx.fillStyle = tickColor;
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No weekly data available', weeklyCanvas.width / 2, weeklyCanvas.height / 2);
  }
  if (weeklyCanvas && weeklyData.length > 0) {
    // Compute cumulative totals client-side as fallback / validation
    let cumTasks = 0;
    const cumulativeData = weeklyData.map(w => {
      cumTasks += (w.task_count || 0);
      return w.cumulative_tasks || cumTasks;
    });

    execCharts.weekly = new Chart(weeklyCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: weeklyData.map(w => 'W' + w.week_number),
        datasets: [
          {
            label: 'Tasks',
            data: weeklyData.map(w => w.task_count),
            backgroundColor: 'rgba(59,130,246,0.7)',
            borderRadius: 4,
            order: 2,
            yAxisID: 'y'
          },
          {
            label: 'Hours Saved',
            data: weeklyData.map(w => w.hours_saved),
            type: 'line',
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            order: 1,
            yAxisID: 'y1'
          },
          {
            label: 'Cumulative Tasks',
            data: cumulativeData,
            type: 'line',
            borderColor: '#f59e0b',
            borderDash: [6, 3],
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: '#f59e0b',
            order: 0,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: tickColor, padding: 12, font: { size: 12 } } }
        },
        scales: {
          x: { ticks: { color: tickColor, font: { size: 11 } }, grid: { color: gridColor } },
          y: {
            ticks: { color: tickColor, font: { size: 11 } },
            grid: { color: gridColor },
            beginAtZero: true,
            title: { display: true, text: 'Tasks', color: tickColor }
          },
          y1: {
            position: 'right',
            ticks: { color: '#10b981', font: { size: 11 } },
            grid: { drawOnChartArea: false },
            beginAtZero: true,
            title: { display: true, text: 'Hours', color: '#10b981' }
          },
          y2: {
            position: 'right',
            display: false,
            beginAtZero: true
          }
        }
      }
    });
  }
```

Key changes:
- Scales are built explicitly (no `...baseOptions.scales` spread)
- Third dataset for cumulative tasks (dashed gold line on hidden `y2` axis)
- Explicit `yAxisID` on all datasets
- Client-side cumulative fallback using `w.cumulative_tasks` from RPC

- [ ] **Step 2: Verify in browser**

Navigate to Executive Summary. Confirm:
- Weekly trend chart renders without crash
- Shows blue bars (tasks), green line (hours), gold dashed line (cumulative tasks)
- No "Wnull" labels on x-axis
- Legend shows all three dataset labels

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.html
git commit -m "fix: rebuild weekly trend chart with explicit scales + add cumulative growth line"
```

---

### Task 8: Add department drill-down JS rendering + toggle logic

**Files:**
- Modify: `src/pages/index.html` — add `renderExecDepartments` and `toggleExecDept` and `toggleExecDetailed` functions after `renderExecCharts`

- [ ] **Step 1: Add the department rendering function**

After the closing `}` of `renderExecCharts` (around line 7286), add:

```javascript
// ======== EXEC DEPARTMENT DRILL-DOWN ========
function renderExecDepartments(departments) {
  const container = document.getElementById('exec-dept-drilldown');
  if (!container) return;

  if (!departments || departments.length === 0) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">No department data available</div>';
    return;
  }

  container.innerHTML = departments.map((dept, idx) => {
    const practiceRows = (dept.practices || []).map(p => `
      <div class="exec-practice-row">
        <span>${escapeHtml(p.practice)}</span>
        <div class="exec-practice-stats">
          <span>Tasks: <strong style="color:#3b82f6">${fmt(p.task_count, 0)}</strong></span>
          <span>Hours: <strong style="color:#10b981">${fmt(p.hours_saved, 0)}</strong></span>
          <span>Users: <strong style="color:#f59e0b">${fmt(p.active_users, 0)}</strong></span>
          <span>Quality: <strong>${p.avg_quality ? fmt(p.avg_quality, 1) + '/5' : '—'}</strong></span>
        </div>
      </div>
    `).join('');

    return `
      <div class="exec-dept-row">
        <div class="exec-dept-header" onclick="toggleExecDept(${idx})">
          <div class="exec-dept-name">
            <span class="exec-dept-chevron" id="exec-dept-chev-${idx}">▸</span>
            <strong>${escapeHtml(dept.department)}</strong>
            <span class="exec-dept-badge">${dept.practice_count} practice${dept.practice_count !== 1 ? 's' : ''}</span>
          </div>
          <div class="exec-dept-stats">
            <span>Tasks: <strong style="color:#3b82f6">${fmt(dept.task_count, 0)}</strong></span>
            <span>Hours: <strong style="color:#10b981">${fmt(dept.hours_saved, 0)}</strong></span>
            <span>Users: <strong style="color:#f59e0b">${fmt(dept.active_users, 0)}</strong></span>
            <span>Adoption: <strong style="color:#8b5cf6">${dept.adoption_rate || 0}%</strong></span>
          </div>
        </div>
        <div class="exec-dept-practices" id="exec-dept-practices-${idx}">
          ${practiceRows}
        </div>
      </div>
    `;
  }).join('');
}

function toggleExecDept(idx) {
  const practices = document.getElementById(`exec-dept-practices-${idx}`);
  const chevron = document.getElementById(`exec-dept-chev-${idx}`);
  if (!practices) return;
  const isOpen = practices.classList.toggle('open');
  if (chevron) {
    chevron.classList.toggle('open', isOpen);
    chevron.textContent = isOpen ? '▾' : '▸';
  }
}

function toggleExecDetailed() {
  const grid = document.getElementById('exec-detailed-grid');
  const chevron = document.getElementById('exec-detailed-chevron');
  if (!grid) return;
  const isCollapsed = grid.classList.toggle('collapsed');
  if (chevron) chevron.textContent = isCollapsed ? '▸' : '▾';
}
```

- [ ] **Step 2: Verify in browser**

Navigate to Executive Summary. Confirm:
- Department rows render with summary stats
- Clicking a department row expands/collapses practice rows with smooth animation
- Chevron rotates between ▸ and ▾
- "Detailed Metrics" header toggles the secondary metrics grid
- Departments with 0 practices show "No department data available"

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.html
git commit -m "feat: add department drill-down rendering + collapsible detailed metrics toggle"
```

---

### Task 9: Update PDF export with department breakdown + detailed metrics

**Files:**
- Modify: `src/pages/index.html:6330-6332` — PDF export, after the practice breakdown section

- [ ] **Step 1: Add department breakdown to PDF**

In `src/pages/index.html`, after the practice breakdown table in `exportPDF` (after `y += 10;` around line 6330, still inside the `if (document.getElementById('exp-pdf-dashboard')?.checked)` block), add:

```javascript
    // Department Breakdown
    if (y > H - 80) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text('Department Breakdown', M, y); y += 8;

    const execSb = getSupabaseClient();
    const execQSel = document.getElementById('exec-quarter-selector');
    const execRawQ = execQSel?.value || EAS_DB.getSelectedQuarter() || null;
    const execQId = (execRawQ === 'all') ? null : execRawQ;
    let deptBreakdown = [];
    try {
      const { data: execData } = await execSb.rpc('get_executive_summary', { p_quarter_id: execQId });
      deptBreakdown = execData?.department_breakdown || [];
    } catch (e) { /* fall through with empty */ }

    if (deptBreakdown.length === 0) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text('No department data available', M, y + 5);
      y += 12;
    } else {
      deptBreakdown.forEach(dept => {
        if (y > H - 50) { doc.addPage(); y = M; }
        // Department header row
        doc.setFillColor(30, 41, 59);
        doc.roundedRect(M, y, pw, 9, 2, 2, 'F');
        doc.setTextColor(241, 245, 249);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(`${dept.department} (${dept.practice_count} practices)`, M + 4, y + 6.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Tasks: ${fmt(dept.task_count, 0)} | Hours: ${fmt(dept.hours_saved, 0)} | Users: ${fmt(dept.active_users, 0)} | Adoption: ${dept.adoption_rate || 0}%`, M + pw / 2, y + 6.5);
        y += 11;

        // Practice rows
        (dept.practices || []).forEach((p, pIdx) => {
          if (y > H - 20) { doc.addPage(); y = M; }
          if (pIdx % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(M + 8, y, pw - 8, 7, 'F'); }
          doc.setTextColor(15, 23, 42);
          doc.setFontSize(9);
          doc.setFont('helvetica', 'normal');
          cx = M + 12;
          [escapeHtml(p.practice), fmt(p.task_count, 0), fmt(p.hours_saved, 0), fmt(p.active_users, 0), p.avg_quality ? fmt(p.avg_quality, 1) + '/5' : '—'].forEach((val, i) => {
            doc.text(val.toString(), cx, y + 5);
            cx += [45, 25, 30, 25, 25][i];
          });
          y += 7;
        });
        y += 6;
      });
    }

    // Detailed Metrics
    if (y > H - 40) { doc.addPage(); y = M; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(15, 23, 42);
    doc.text('Detailed Metrics', M, y); y += 8;

    const detailMetrics = [
      ['Avg Quality', document.getElementById('exec-detail-quality')?.textContent || '—'],
      ['Approval Rate', document.getElementById('exec-detail-approval')?.textContent || '—'],
      ['Avg Efficiency', document.getElementById('exec-detail-efficiency')?.textContent || '—'],
      ['Top AI Tool', (document.getElementById('exec-detail-toptool')?.textContent || '—') + ' (' + (document.getElementById('exec-detail-toptool-sub')?.textContent || '') + ')']
    ];
    const dmW = pw / 2;
    detailMetrics.forEach((dm, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const dx = M + col * dmW;
      const dy = y + row * 16;
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(dx, dy, dmW - 4, 12, 3, 3, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(dm[0], dx + 4, dy + 5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text(dm[1], dx + 4, dy + 10);
    });
    y += Math.ceil(detailMetrics.length / 2) * 16 + 10;
```

- [ ] **Step 2: Verify PDF export**

Open the dashboard, go to Executive Summary, click Export → PDF. Confirm:
- "Department Breakdown" section appears with department headers and practice rows
- "Detailed Metrics" section appears with 4 metric cards
- Page breaks work correctly (no overflow)

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.html
git commit -m "feat: add department breakdown + detailed metrics to exec summary PDF export"
```

---

### Task 10: Update PPTX export with department overview slide + detailed metrics

**Files:**
- Modify: `src/pages/index.html:6586-6617` — PPTX export, after the dashboard KPIs slide

- [ ] **Step 1: Add department overview slide to PPTX**

In `src/pages/index.html`, after the existing Dashboard KPIs slide block in `exportPPT` (after the closing `}` around line 6617, before the `// === Practice Summary Slide ===` comment), add:

```javascript
  // === Department Overview Slide (exec-specific) ===
  if (document.getElementById('exp-ppt-dashboard')?.checked && role === 'executive') {
    const execSb2 = getSupabaseClient();
    const execQSel2 = document.getElementById('exec-quarter-selector');
    const execRawQ2 = execQSel2?.value || EAS_DB.getSelectedQuarter() || null;
    const execQId2 = (execRawQ2 === 'all') ? null : execRawQ2;
    let pptDeptBreakdown = [];
    let pptDetailedMetrics = {};
    try {
      const { data: execData2 } = await execSb2.rpc('get_executive_summary', { p_quarter_id: execQId2 });
      pptDeptBreakdown = execData2?.department_breakdown || [];
      pptDetailedMetrics = execData2?.detailed_metrics || {};
    } catch (e) { /* fall through */ }

    if (pptDeptBreakdown.length > 0) {
      slide = pptx.addSlide();
      slide.addText('Department Overview', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, fontFace: 'Arial', bold: true, color: DARK });

      const deptTblRows = [
        [{ text: 'Department', options: { bold: true, color: WHITE, fill: { color: BLUE } } },
         { text: 'Practices', options: { bold: true, color: WHITE, fill: { color: BLUE } } },
         { text: 'Tasks', options: { bold: true, color: WHITE, fill: { color: BLUE } } },
         { text: 'Hours Saved', options: { bold: true, color: WHITE, fill: { color: BLUE } } },
         { text: 'Users', options: { bold: true, color: WHITE, fill: { color: BLUE } } },
         { text: 'Adoption', options: { bold: true, color: WHITE, fill: { color: BLUE } } }]
      ];
      pptDeptBreakdown.forEach(dept => {
        deptTblRows.push([
          dept.department,
          (dept.practice_count || 0).toString(),
          fmt(dept.task_count, 0),
          fmt(dept.hours_saved, 0),
          fmt(dept.active_users, 0),
          (dept.adoption_rate || 0) + '%'
        ]);
      });

      slide.addTable(deptTblRows, {
        x: 0.5, y: 1.2, w: 9,
        fontSize: 11, fontFace: 'Arial',
        border: { type: 'solid', pt: 0.5, color: 'CBD5E1' },
        colW: [2.5, 1.2, 1.2, 1.5, 1.0, 1.1],
        rowH: 0.5,
        autoPage: true,
        autoPageRepeatHeader: true
      });

      // Add detailed metrics as footer on this slide
      const dmItems = [
        { label: 'Avg Quality', value: pptDetailedMetrics.avg_quality != null ? pptDetailedMetrics.avg_quality + '/5' : '—' },
        { label: 'Approval Rate', value: pptDetailedMetrics.approval_rate != null ? pptDetailedMetrics.approval_rate + '%' : '—' },
        { label: 'Avg Efficiency', value: pptDetailedMetrics.avg_efficiency != null ? pptDetailedMetrics.avg_efficiency + '%' : '—' },
        { label: 'Top Tool', value: pptDetailedMetrics.top_tool || '—' }
      ];
      dmItems.forEach((dm, i) => {
        const dx = 0.5 + i * 2.3;
        const dy = 5.5;
        slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: dx, y: dy, w: 2.1, h: 1.2, fill: { color: LIGHT_BG }, rectRadius: 0.1 });
        slide.addText(dm.label, { x: dx + 0.15, y: dy + 0.1, w: 1.8, h: 0.35, fontSize: 10, fontFace: 'Arial', color: SLATE });
        slide.addText(dm.value, { x: dx + 0.15, y: dy + 0.5, w: 1.8, h: 0.5, fontSize: 20, fontFace: 'Arial', bold: true, color: DARK });
      });
    }
  }
```

- [ ] **Step 2: Verify PPTX export**

Open the dashboard, go to Executive Summary, click Export → PPTX. Confirm:
- "Department Overview" slide appears with a table of departments
- Bottom of slide has 4 detailed metric cards
- Slide only appears for executive role

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.html
git commit -m "feat: add department overview slide + detailed metrics to exec summary PPTX export"
```

---

### Task 11: Remove old practice breakdown table (replaced by department drill-down)

**Files:**
- Modify: `src/pages/index.html:1449-1468` — HTML practice breakdown table
- Modify: `src/pages/index.html:7063-7093` — JS practice breakdown rendering

- [ ] **Step 1: Remove the practice breakdown table HTML**

In `src/pages/index.html`, remove the entire practice breakdown table block (lines 1449-1468):

```html
      <!-- Practice Breakdown Table -->
      <div class="table-card" style="margin-top:24px">
        ...
      </div>
```

The department drill-down (added in Task 4) now serves this purpose with richer department-grouped data.

- [ ] **Step 2: Remove the practice breakdown JS rendering**

In `src/pages/index.html`, remove the practice breakdown table rendering code (lines 7063-7094, from `// ---- Practice Breakdown Table ----` through the closing of the `if (execPracticeTbody)` block).

Also remove the `execPracticeTbody` variable from line 7015:
```javascript
  const execPracticeTbody = document.getElementById('exec-practice-tbody');
```

And remove the reference to `.table-card` in the show/hide logic around lines 7047 and 7055:
```javascript
      document.querySelector('#page-exec-summary .table-card')?.style.setProperty('display', 'none');
```
and:
```javascript
    document.querySelector('#page-exec-summary .table-card')?.style.setProperty('display', '');
```

- [ ] **Step 3: Verify in browser**

Navigate to Executive Summary. Confirm:
- Old practice breakdown table no longer appears
- Department drill-down section shows the practice-level data instead
- No JS console errors

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.html
git commit -m "refactor: remove old practice breakdown table, replaced by department drill-down"
```

---

### Task 12: End-to-end verification and documentation update

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/IMPLEMENTATION_NOTES.md`

- [ ] **Step 1: Full manual test**

Open the dashboard as an executive user and verify:
1. 6 primary KPI cards render with correct data
2. Weekly trend chart loads without crash, shows 3 datasets (bars, hours line, cumulative dashed line)
3. Copilot adoption, approval pipeline, and AI tools charts render normally
4. Department drill-down renders all departments collapsed
5. Clicking a department expands practice rows with smooth animation
6. Clicking again collapses
7. "Detailed Metrics" section shows 4 metrics, clicking header collapses/expands
8. Quarter selector filters all sections correctly
9. Export PDF includes department breakdown and detailed metrics
10. Export PPTX includes department overview slide with detailed metrics footer
11. Empty state still works when no practices are assigned

- [ ] **Step 2: Update CHANGELOG.md**

Add under `## [Unreleased]`:

```markdown
- 2026-04-21 (claude) — Enhanced Executive Summary dashboard: fixed weekly trend chart crash (null week_number + broken dual-axis), expanded to 6 primary KPIs (adoption rate, hrs/resource), added department drill-down with expand/collapse, secondary detailed metrics section, cumulative growth line on weekly trend, updated PDF/PPTX exports
```

- [ ] **Step 3: Update IMPLEMENTATION_NOTES.md**

Append:

```markdown
## 2026-04-21 — Executive Summary Dashboard Enhancement

**Weekly trend crash fix:** Two root causes — (1) `week_number IS NULL` rows produced "Wnull" chart labels, fixed by filtering in the RPC; (2) `...baseOptions.scales` spread caused shallow-copy conflicts with dual-axis config, fixed by building scales explicitly.

**Department breakdown:** New `department_breakdown` key in `get_executive_summary` RPC joins tasks→practices→departments. Nested JSONB structure allows single-query department+practice aggregation. Client renders as expand/collapse drill-down.

**Tiered KPIs:** Primary tier (6 cards, 28px values) for at-a-glance metrics. Secondary tier (4 cards, 22px values, collapsible) for quality/efficiency/approval detail.

**Cumulative growth line:** Window functions (`SUM() OVER`) compute running totals server-side. Rendered as dashed gold line on hidden y2 axis to avoid cluttering the dual-axis layout.
```

- [ ] **Step 4: Commit all docs**

```bash
git add CHANGELOG.md docs/IMPLEMENTATION_NOTES.md
git commit -m "docs: update changelog and implementation notes for exec summary enhancement"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Fix weekly trend crash (null week_number) — Task 1
- [x] Fix weekly trend crash (broken scales spread) — Task 7
- [x] Add cumulative growth line — Task 1 (RPC) + Task 7 (JS)
- [x] Expand to 6 primary KPIs — Task 4 (HTML) + Task 5 (CSS) + Task 6 (JS)
- [x] Add department drill-down — Task 3 (RPC) + Task 4 (HTML) + Task 5 (CSS) + Task 8 (JS)
- [x] Add secondary detailed metrics — Task 2 (RPC) + Task 4 (HTML) + Task 5 (CSS) + Task 6 (JS)
- [x] Update PDF export — Task 9
- [x] Update PPTX export — Task 10
- [x] Remove old practice breakdown table — Task 11
- [x] Documentation update — Task 12

**Placeholder scan:** No TBDs, TODOs, or vague steps found. All code blocks are complete.

**Type consistency:** `renderExecDepartments`, `toggleExecDept`, `toggleExecDetailed` — names consistent across Task 4 (HTML onclick), Task 6 (call site), and Task 8 (definitions). CSS classes (`exec-dept-*`, `exec-detail-*`) match between Task 4 HTML and Task 5 CSS. RPC keys (`department_breakdown`, `detailed_metrics`, `total_licensed_users`, `adoption_rate`, `hours_per_resource`) match between Tasks 1-3 (SQL) and Task 6 (JS consumption).
