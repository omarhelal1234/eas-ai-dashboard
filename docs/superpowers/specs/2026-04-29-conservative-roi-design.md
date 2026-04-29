# Conservative ROI Card — Design Spec

**Date:** 2026-04-29
**Author:** Omar Ibrahim (with Claude)
**Status:** Approved (pending user review of written spec)
**Implementation note:** Codex consulted at three checkpoints during implementation (post-SQL, post-frontend, pre-commit).

---

## 1. Goal

Surface a **conservative, defensible ROI metric** to Department SPOCs and Admins that reports the financial value of AI adoption based on hours saved, deliberately under-claiming so the number is humble and credible to leadership.

## 2. Audience & Visibility

| Role | Sees | Scope |
|---|---|---|
| `admin` | Yes | Org-wide totals + per-practice breakdown |
| `spoc` / `team_lead` (Dept SPOC) | Yes | Their own practice(s) only, auto-filtered via `spoc_practices` |
| `contributor`, `viewer`, `executive` | **No** | Card is not rendered, RPC returns null |

Enforcement is dual-layer: UIGuard hides the card client-side; the RPC re-checks the caller's role and returns an empty payload to non-permitted roles. RLS on supporting tables blocks direct table reads.

## 3. Data Source Filter (Conservative — Source A)

A row is eligible only when **all** of the following are true:

- `tasks.approval_status = 'approved'`
- `tasks.ai_tool` ∈ licensed-tool set (Copilot, Cursor, Claude — same set used by `practice_summary.licensed_hours_saved`)
- `tasks.time_saved > 0`

Accomplishments (`accomplishments.effort_saved`) are excluded — self-reported effort lacks task-level audit and would inflate the number.

## 4. Conservative Formula (A + B + C + Cap)

```
Constants (stored in app_config):
  cap          = 8     -- hours per task ceiling
  coef         = 0.5   -- humility coefficient
  usd_per_day  = 250   -- average daily rate
  hours_per_day= 8
  sar_per_usd  = 3.75
  rate_sar_hr  = (usd_per_day / hours_per_day) * sar_per_usd
               = (250 / 8) * 3.75
               = 117.1875 SAR/hour

Three independent hour computations (over the eligible row set):

  method1 = SUM( LEAST(tasks.time_saved, cap) )
              -- per-task cap suppresses outliers

  method2 = SUM( tasks.time_saved )
              -- raw uncapped sum

  method3 = licensed_active_users * AVG(time_saved per active user)
              -- aggregate sanity check; collapses to total
              -- but excludes anyone with zero approved licensed
              -- contribution from the "active" denominator

Take the minimum, then apply humility:

  hours_min   = LEAST(method1, method2, method3)
  final_hours = hours_min * coef
  gross_sar   = final_hours * rate_sar_hr
```

Method 2 is uncapped on purpose — when caps would inflate vs. raw, the cap path "wins"; when raw is somehow lower (unusual but possible after filtering), raw wins. The MIN guarantees we never claim more than the most pessimistic of the three.

The humility coefficient is applied **once at the end** so it doesn't compound onto method-level estimates.

## 5. Backend

### 5.1 Migration `sql/033_conservative_roi.sql`

- `app_config` table:
  - `key TEXT PRIMARY KEY`
  - `value JSONB NOT NULL`
  - `updated_at TIMESTAMPTZ DEFAULT now()`
  - `updated_by UUID REFERENCES auth.users(id)`
  - Seeded rows: `roi.cap`, `roi.coef`, `roi.usd_per_day`, `roi.hours_per_day`, `roi.sar_per_usd`.
  - RLS: read = admin + spoc + team_lead; write = admin only.

- RPC `get_conservative_roi(p_practice TEXT DEFAULT NULL) RETURNS JSONB`:
  - `SECURITY DEFINER`, `SET search_path = public, pg_catalog`.
  - Internal role check via `app_role()` helper:
    - `admin`: respects `p_practice` (NULL = org-wide); returns `by_practice` array.
    - `spoc` / `team_lead`: ignores `p_practice`, auto-scopes to caller's `spoc_practices`. Returns one row per assigned practice + their combined total.
    - other roles: returns `NULL`.
  - Returns:
    ```json
    {
      "scope": "org" | "practice",
      "practices_in_scope": ["..."],
      "method1_hours": 0,
      "method2_hours": 0,
      "method3_hours": 0,
      "hours_min": 0,
      "coef": 0.5,
      "cap": 8,
      "final_hours": 0,
      "rate_sar_hr": 117.1875,
      "gross_sar": 0,
      "by_practice": [
         { "practice": "...", "final_hours": 0, "gross_sar": 0 }
      ],
      "computed_at": "2026-04-29T..."
    }
    ```

### 5.2 Licensed-tool list

Reuse the existing canonical list from `practice_summary` / migration 032 (`licensed_hours_saved`). Do **not** redefine it here. If that list lives in a CTE today, extract it to a function `is_licensed_tool(text)` so both call sites share one source of truth.

## 6. Frontend

### 6.1 `js/db.js`
Add:
```js
db.getConservativeROI = async function (practice = null) {
  const { data, error } = await supa.rpc('get_conservative_roi', { p_practice: practice });
  if (error) throw error;
  return data; // null for non-permitted roles
};
```

### 6.2 `js/roi-card.js` (new module — single purpose)
- Renders a single card titled **"ROI (Conservative)"**.
- Headline metrics:
  - **Final Hours Saved** (large, primary)
  - **Gross Value (SAR)** (secondary, formatted with thousands separators)
- Sub-line caption (small, muted): *"Approved + licensed-tool tasks only · min of 3 methods · 0.5 humility factor · 8h/task cap"*
- Expandable detail (`<details>`): shows `method1`, `method2`, `method3`, the chosen min, the rate, and `computed_at`. Transparency reinforces credibility.
- Admin-only: per-practice list rendered below the headline.
- Skeleton state while loading; empty state if data is `null` (non-permitted role) — but the card shouldn't even mount in that case.

### 6.3 Mount point
- `index.html` Executive Summary section.
- Mount guard:
  ```js
  if (auth.hasRole(['admin', 'spoc', 'team_lead'])) {
    roiCard.mount('#roi-card-slot');
  }
  ```

## 7. Conservative-by-design Justification

Each layer addresses a specific over-claiming risk:

| Layer | Risk it mitigates |
|---|---|
| Approved-only filter | Unverified or pending tasks |
| Licensed-tool filter | Free/personal-tool work that didn't cost the org |
| Per-task 8h cap | One outlier task claiming a full week |
| MIN of 3 methods | Any single method having a structural bias |
| 0.5 humility coefficient | Self-reporting bias on `time_without_ai` |

When a leader asks "how confident are we in this number?" the answer is built into the metric.

## 8. Documentation Sweep (per CLAUDE.md §4)

- **CHANGELOG.md** — `## [Unreleased]` entry under 2026-04-29.
- **README.md** — brief blurb in features list.
- **docs/BRD.md** — new KPI: Conservative ROI.
- **docs/HLD.md** — `app_config` table + `get_conservative_roi` RPC + role gating.
- **docs/CODE_ARCHITECTURE.md** — `js/roi-card.js` module + `sql/033`.
- **docs/IMPLEMENTATION_NOTES.md** — formula derivation, why MIN-of-3 + 0.5 + 8h cap, why 117.1875 SAR/hr.
- **docs/IMPLEMENTATION_PLAN.md** — phase status if applicable.

## 9. Portability (per CLAUDE.md §8)

- All SQL is standard Postgres (`LEAST`, `SUM`, `JSONB`, RLS).
- No vendor-specific features.
- Constants live in `app_config` so currency, rate, and humility are configurable for other deployments.
- **Migration difficulty: Low.**

## 10. Testing

| Case | Expected |
|---|---|
| Admin, no practice arg | Org-wide totals + full `by_practice` array |
| Admin, `p_practice='AI'` | Practice-scoped totals only |
| SPOC of practice X | Practice X totals; `p_practice` arg ignored |
| SPOC of multiple practices | Combined total + per-practice rows for assigned only |
| Contributor / viewer / executive | RPC returns `NULL`; card not mounted |
| Zero approved licensed tasks | All hour values = 0; card still renders with zeros |
| Single task with `time_saved=200` | `method1` contributes 8h (cap), `method2` contributes 200h → `method1` likely wins MIN |

## 11. Open Items

None. All key parameters confirmed by user (cap=8, coef=0.5, gross-only, role gate admin+spoc, placement on Executive Summary with admin-org / spoc-practice scoping).
