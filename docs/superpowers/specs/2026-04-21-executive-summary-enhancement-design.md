# Executive Summary Dashboard Enhancement — Design Spec

**Date:** 2026-04-21
**Author:** Omar Ibrahim + Claude
**Status:** Approved
**Approach:** Single RPC Enhancement (Approach A)

---

## 1. Overview

Enhance the Executive Summary dashboard to fix the crashing weekly trend chart, add department-wise breakdowns, introduce tiered KPI metrics, and update exports. The audience remains the `executive` role only.

### Goals

- Fix the weekly trend chart crash (null `week_number` + broken dual-axis spread)
- Add department-level aggregation with expand/collapse drill-down
- Expand KPIs from 4 to 6 primary + 4 secondary detailed metrics
- Add cumulative growth line to the weekly trend chart
- Update PDF and PPTX exports to include all new sections

### Non-Goals

- Changing role access (executive-only, no new roles)
- Sparklines, quarter-over-quarter deltas, or progress bars on KPI cards
- Excel export for exec summary

---

## 2. Page Layout Structure

Top to bottom:

1. **Header** — title, user context, quarter selector, export button (unchanged)
2. **Primary KPIs** — 6 cards in a single row (`grid-template-columns: repeat(6, 1fr)`)
3. **Charts Row 1** — Weekly Trend (left) + Copilot Adoption by Practice (right)
4. **Charts Row 2** — Approval Pipeline doughnut (left) + AI Tools Usage bars (right)
5. **Department Drill-Down** — expandable department rows with nested practice rows
6. **Secondary Metrics** — collapsible section with 4 smaller metric cards

Responsive: on narrow screens, KPI grid wraps to 3x2, charts stack vertically, secondary metrics wrap to 2x2.

---

## 3. Primary KPIs (6 cards)

| # | Label | Color | Value Source | Sub-label |
|---|-------|-------|-------------|-----------|
| 1 | Total Tasks | blue `#3b82f6` | `COUNT(*)` tasks in assigned practices | "across all practices" |
| 2 | Hours Saved | green `#10b981` | `SUM(time_without_ai - time_with_ai)` for approved tasks | "approved tasks only" |
| 3 | Active Users | yellow `#f59e0b` | `COUNT(DISTINCT employee_email)` | "unique contributors" |
| 4 | Adoption Rate | purple `#8b5cf6` | `active_users / total_licensed_users * 100` | "X / Y licensed" |
| 5 | Hrs / Resource | cyan `#06b6d4` | `total_hours_saved / total_licensed_users` | "X hrs / Y resources" |
| 6 | Practices | pink `#ec4899` | `array_length(v_practices, 1)` | "under your oversight" |

**Design:** Clean cards — label (11px muted), large value (28px bold colored), sub-label (11px muted). No icons, sparklines, or progress bars.

---

## 4. Weekly Trend Chart — Bug Fix + Cumulative Line

### Bug Fix

**Problem 1 — Null week numbers:** The `weekly_trend` subquery in `get_executive_summary` does not filter out tasks with `week_number IS NULL`. This produces `"Wnull"` labels that break Chart.js.

**Fix:** Add `AND week_number IS NOT NULL` to the WHERE clause of the `weekly_trend` subquery.

**Problem 2 — Broken dual-axis scales:** The chart config uses `...baseOptions.scales` then overrides `y` and adds `y1`. The spread shallow-copies, and the override can conflict.

**Fix:** Build the `scales` object explicitly instead of spreading:

```javascript
scales: {
  x: { ticks: { color: tickColor, font: { size: 11 } }, grid: { color: gridColor } },
  y: { ticks: { color: tickColor, font: { size: 11 } }, grid: { color: gridColor }, beginAtZero: true, title: { display: true, text: 'Tasks', color: tickColor } },
  y1: { position: 'right', ticks: { color: '#10b981', font: { size: 11 } }, grid: { drawOnChartArea: false }, beginAtZero: true, title: { display: true, text: 'Hours', color: '#10b981' } },
  y2: { position: 'right', display: false, beginAtZero: true }
}
```

**Problem 3 — Empty data guard:** If `weeklyData` exists but all values are 0, show a "No weekly data" message instead of rendering an empty chart.

### Cumulative Growth Line

- Compute cumulative totals client-side from the `weekly_trend` array:
  ```javascript
  let cumTasks = 0;
  const cumulativeData = weeklyData.map(w => { cumTasks += w.task_count; return cumTasks; });
  ```
- Add a third dataset:
  - Label: `"Cumulative Tasks"`
  - Type: `line`
  - Color: `#f59e0b` (gold)
  - Style: dashed (`borderDash: [6, 3]`), no fill, `pointRadius: 3`
  - Y-axis: `y2` (right side, hidden — shares scale space with `y1` but grid lines are off)
  - `order: 0` (drawn on top)

---

## 5. Department Drill-Down

### Data Source

New RPC key `department_breakdown` — joins `tasks` to `practices` via `practices.name = tasks.practice`, then joins `practices.department_id` to `departments.id`.

**Shape:**
```json
[
  {
    "department": "EAS",
    "department_id": "uuid",
    "practice_count": 4,
    "task_count": 842,
    "hours_saved": 2310,
    "active_users": 62,
    "total_resources": 79,
    "adoption_rate": 78.5,
    "practices": [
      {
        "practice": "Digital Banking",
        "task_count": 312,
        "hours_saved": 890,
        "active_users": 24,
        "avg_quality": 4.2
      }
    ]
  }
]
```

### UI Behavior

- Each department renders as a row inside a `table-card` container
- **Collapsed by default** — shows department name, practice count badge, and summary stats (tasks, hours, users, adoption rate)
- Chevron indicator: `▸` collapsed, `▾` expanded
- Clicking toggles practice rows with `max-height` CSS transition (~200ms ease)
- Practice rows are indented (left padding ~44px) with slightly darker background (`rgba` overlay)
- Practice rows show: name, task count, hours saved, active users, avg quality

### Sorting

- Departments: alphabetical
- Practices within department: alphabetical

### Edge Cases

- Department with 0 tasks: show row with "—" for all metrics, no expandable content
- Practice with 0 tasks: still listed in expanded view with zeroes (shows coverage gaps)
- Single department: still renders as expandable row (consistent UI, no special case)

---

## 6. Secondary Metrics Section

### Layout

- Section header: "Detailed Metrics" with toggle chevron
- **Expanded by default** on first load
- Clicking header toggles visibility with `max-height` transition
- 4 cards in a `grid-template-columns: repeat(4, 1fr)` row
- Responsive: wraps to 2x2 on narrow viewports

### The 4 Metrics

| Card | Value Format | SQL Source |
|------|-------------|------------|
| Avg Quality Rating | `X.X / 5` | `AVG(NULLIF(quality_rating, 0))` across assigned practices |
| Approval Rate | `XX.X%` | `COUNT(*) FILTER (WHERE approval_status = 'approved') / COUNT(*) * 100` |
| Avg Efficiency Gain | `XX.X%` | `AVG((time_without_ai - time_with_ai) / NULLIF(time_without_ai, 0) * 100)` for approved tasks |
| Top AI Tool | Tool name + count | `MODE() WITHIN GROUP (ORDER BY ai_tool)` or max count from `tool_usage` |

### Design

- Smaller than primary KPIs: value at `22px` font-size vs `28px`
- Same clean style: label, value, optional sub-text
- No icons or progress bars

---

## 7. RPC Changes — `get_executive_summary`

### New Keys

Add to the existing `jsonb_build_object`:

```sql
'total_licensed_users', (
  SELECT COUNT(*) FROM copilot_users
  WHERE practice = ANY(v_practices)
),
'adoption_rate', (
  SELECT CASE
    WHEN COUNT(*) = 0 THEN 0
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
'department_breakdown', (
  SELECT COALESCE(jsonb_agg(dept_row), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'department', d.name,
      'department_id', d.id,
      'practice_count', COUNT(DISTINCT p.name),
      'task_count', COUNT(t.id),
      'hours_saved', COALESCE(SUM(t.time_without_ai - t.time_with_ai) FILTER (WHERE t.approval_status = 'approved'), 0),
      'active_users', COUNT(DISTINCT t.employee_email),
      'total_resources', (SELECT COUNT(*) FROM copilot_users cu WHERE cu.practice = ANY(array_agg(DISTINCT p.name))),
      'adoption_rate', CASE
        WHEN (SELECT COUNT(*) FROM copilot_users cu WHERE cu.practice = ANY(array_agg(DISTINCT p.name))) = 0 THEN 0
        ELSE ROUND(COUNT(DISTINCT t.employee_email)::numeric * 100 / (SELECT COUNT(*) FROM copilot_users cu WHERE cu.practice = ANY(array_agg(DISTINCT p.name))), 1)
      END,
      'practices', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'practice', sub.practice,
          'task_count', sub.task_count,
          'hours_saved', sub.hours_saved,
          'active_users', sub.active_users,
          'avg_quality', sub.avg_quality
        ) ORDER BY sub.practice)
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
    LEFT JOIN tasks t ON t.practice = p.name AND (p_quarter_id IS NULL OR t.quarter_id = p_quarter_id)
    WHERE d.is_active = true
    GROUP BY d.id, d.name
    ORDER BY d.name
  ) dept_rows
),
'detailed_metrics', jsonb_build_object(
  'avg_quality', (
    SELECT ROUND(AVG(NULLIF(quality_rating, 0))::numeric, 1)
    FROM tasks WHERE practice = ANY(v_practices) AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
  ),
  'approval_rate', (
    SELECT CASE WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND(COUNT(*) FILTER (WHERE approval_status = 'approved')::numeric * 100 / COUNT(*), 1)
    END
    FROM tasks WHERE practice = ANY(v_practices) AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id)
  ),
  'avg_efficiency', (
    SELECT ROUND(AVG(
      CASE WHEN time_without_ai > 0
        THEN (time_without_ai - time_with_ai)::numeric / time_without_ai * 100
        ELSE 0 END
    )::numeric, 1)
    FROM tasks WHERE practice = ANY(v_practices) AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id) AND approval_status = 'approved'
  ),
  'top_tool', (SELECT ai_tool FROM tasks WHERE practice = ANY(v_practices) AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id) AND ai_tool IS NOT NULL AND ai_tool != '' GROUP BY ai_tool ORDER BY COUNT(*) DESC LIMIT 1),
  'top_tool_count', (SELECT COUNT(*) FROM tasks WHERE practice = ANY(v_practices) AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id) AND ai_tool = (SELECT ai_tool FROM tasks WHERE practice = ANY(v_practices) AND (p_quarter_id IS NULL OR quarter_id = p_quarter_id) AND ai_tool IS NOT NULL AND ai_tool != '' GROUP BY ai_tool ORDER BY COUNT(*) DESC LIMIT 1))
)
```

### Modified Key — `weekly_trend`

Add `AND week_number IS NOT NULL` filter and cumulative columns:

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
)
```

---

## 8. Export Updates

### PDF

- After "Practice Breakdown" table, add "Department Breakdown" section:
  - Department name as bold header row
  - Indented practice rows with stats
  - Department subtotals
- Add "Detailed Metrics" section: 2x2 grid of the 4 secondary metrics
- Weekly trend chart canvas capture automatically includes the cumulative line

### PPTX

- Add new slide "Department Overview":
  - Table with department rows, columns: Department, Practices, Tasks, Hours Saved, Users, Adoption Rate
- Add the 4 detailed metrics as a footer row on the existing "Executive Summary" KPI slide
- Weekly trend chart slide automatically includes cumulative line (canvas capture)

### No Changes

- Export modal UI (same buttons and options)
- No Excel export for exec summary

---

## 9. Files Affected

| File | Change |
|------|--------|
| `sql/010_executive_role.sql` | Update `get_executive_summary` RPC — new keys, weekly_trend fix |
| `src/pages/index.html` | HTML: new KPI slots, department section, secondary metrics. JS: `renderExecSummary`, `renderExecCharts`, department drill-down logic, export functions |
| `css/dashboard.css` | Styles for department drill-down rows, secondary metrics cards, collapse animations |

---

## 10. Edge Cases

- **No departments in DB:** Fall back to flat practice list (no department grouping)
- **Executive with no practices assigned:** Existing empty state handles this (unchanged)
- **All tasks have null week_number:** Weekly chart shows "No weekly data available" message
- **No copilot_users data:** Adoption rate and hrs/resource show 0 with "0 / 0 licensed" sub-label
- **Single department:** Renders normally as one expandable row
- **Quarter = "all":** All aggregations use NULL quarter filter (existing behavior, unchanged)
