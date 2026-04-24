# Upcoming Events — Design Spec

**Date:** 2026-04-24
**Status:** Approved (brainstorm)
**Author:** Omar Ibrahim (with Claude)
**Context seed:** `ReferencesAndGuidance/Fw_ From AI strategy to execution_ join Microsoft AI Learning Summit online.msg` — a forwarded invitation to the Microsoft AI Learning Summit (May 5–6, 2026, online, with an external registration URL). This event is the canonical first seed record.

---

## 1. Goal

Allow admins to publish upcoming events (AI sessions, summits, licensed certifications, workshops, webinars, etc.) that are surfaced to every authenticated user as a post-login pop-up, with hybrid RSVP tracking (internal registration row + optional redirect to an external registration URL).

## 2. Requirements (from brainstorm)

| # | Decision | Value |
|---|---|---|
| Q1 | Registration model | **Hybrid**: internal RSVP row + optional redirect to external registration URL |
| Q2 | Pop-up frequency | **Admin-controlled per event** (`force_on_every_login` flag); default = once per user per event |
| Q3 | Audience targeting | **All authenticated users** see every published event |
| Q4 | Admin-entered fields | Title, short desc, start/end datetime, event type, location type (+venue), registration URL (required); long desc (markdown), cover image URL, registration deadline, `force_on_every_login`, `is_published` (optional). No capacity, speakers, or tags in v1. |
| Q5 | Admin surface | **Dedicated "Events" tab** in `admin.html` with list, create/edit form, and per-event registrations view with CSV export. No extra analytics widgets in v1. |

## 3. Data Model

Migration: `sql/031_events.sql`.

### 3.1 `events`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| title | text NOT NULL | |
| short_description | text NOT NULL | shown on the card |
| long_description | text | markdown, optional |
| event_type | text NOT NULL | CHECK IN (`ai_session`,`summit`,`certification`,`workshop`,`webinar`,`other`) |
| location_type | text NOT NULL | CHECK IN (`online`,`in_person`,`hybrid`) |
| venue | text | optional free text |
| start_datetime | timestamptz NOT NULL | |
| end_datetime | timestamptz NOT NULL | CHECK (> start_datetime) |
| registration_url | text | external link (optional) |
| registration_deadline | timestamptz | defaults to `start_datetime` at query time if NULL |
| cover_image_url | text | |
| force_on_every_login | boolean NOT NULL DEFAULT false | |
| is_published | boolean NOT NULL DEFAULT false | |
| created_by | uuid REFERENCES auth.users | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | trigger-updated |

Indexes: `(is_published, end_datetime)` for the active-events lookup; `(start_datetime)` for ordering.

### 3.2 `event_registrations`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| event_id | uuid | REFERENCES events ON DELETE CASCADE |
| user_id | uuid | REFERENCES auth.users |
| registered_at | timestamptz DEFAULT now() | |
| external_link_clicked | boolean DEFAULT false | |
| external_clicked_at | timestamptz | |
| UNIQUE(event_id, user_id) | | one RSVP per user per event |

### 3.3 `event_dismissals`
| Column | Type | Notes |
|---|---|---|
| event_id | uuid | REFERENCES events ON DELETE CASCADE |
| user_id | uuid | REFERENCES auth.users |
| dismissed_at | timestamptz DEFAULT now() | |
| PRIMARY KEY (event_id, user_id) | | |

### 3.4 View `v_active_events_for_user`
Returns rows for events that are:
- `is_published = true`
- `end_datetime > now()`
- Not in `event_dismissals` for `auth.uid()` **unless** `force_on_every_login = true`
- Not in `event_registrations` for `auth.uid()` **unless** `force_on_every_login = true`

The view joins `event_registrations` (LEFT) to expose a per-row `already_registered` boolean so the UI can render the "✓ Registered" disabled state when forced events resurface.

Ordered by `start_datetime ASC`.

## 4. RLS Policies

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| events | authenticated where `is_published AND end_datetime > now()`; admin → all | admin only | admin only | admin only |
| event_registrations | own rows; admin → all | own rows only (user_id = auth.uid()) | own rows only | admin only |
| event_dismissals | own rows only | own rows only | — | own rows only |

## 5. UX — Pop-up

### Trigger
`js/auth.js` gains a post-auth hook that runs **once per page load** after session restore or fresh login. It calls `EventsModal.openForCurrentUser()`, which queries `v_active_events_for_user`; if the result set is non-empty, the modal opens.

### EventsModal (`js/events-modal.js` + `css/events.css`)
- Centered modal, dimmed backdrop, ESC/click-outside closes.
- Multiple events render as a **vertical stack** of cards, most imminent first (no carousel).
- Each card: cover image (or type-based gradient fallback), title, type badge, date/time formatted in `Asia/Riyadh`, location badge + venue (if in-person/hybrid), short description, **Details** expander revealing rendered markdown long description.
- Buttons per card:
  - **Register** → insert into `event_registrations` → if `registration_url` present, `window.open(url, '_blank')` and update the row with `external_link_clicked = true, external_clicked_at = now()`. Card transitions to "✓ Registered" state (button disabled).
  - **Dismiss** → insert into `event_dismissals` (skipped when `force_on_every_login = true`).
- Footer **Close all** button dismisses all non-forced events shown and closes the modal.

### Header bell/badge
In the top navigation of `src/pages/index.html`, `src/pages/admin.html`, and `src/pages/employee-status.html`:
- Bell icon with a numeric badge equal to the count of currently-active published events the user has not yet registered for.
- Click reopens `EventsModal` with the full active list (including already-dismissed events) so users can revisit anything they closed.
- When count is 0, bell renders in a muted style and still opens an empty-state modal ("No upcoming events.").

### Edge cases
| Case | Behavior |
|---|---|
| `force_on_every_login = true` and user already registered | Card shows "✓ Registered" with disabled Register button. |
| `registration_deadline < now()` but event not ended | Card shows "Registration closed"; Register button disabled. |
| No active events | Modal does not auto-open; bell badge = 0. |
| User dismisses, admin later toggles `force_on_every_login = true` | Event reappears on next login (view logic bypasses dismissals when forced). |
| Event ends while user session is open | Remains visible for the session; next query filters it out. |

## 6. Admin Surface — "Events" tab in `admin.html`

### 6.1 Access control
Whole tab hidden unless `user.role === 'admin'` (existing `UIGuard` pattern). SPOCs, Team Leads, and other roles do not see it in v1.

### 6.2 Events list (default sub-view)
Columns: Title · Type · Start · End · Location · Published · Force-on-login · RSVP count · Actions.
Filters: Upcoming (default) / Past / Drafts / All. Search by title.
Row actions: Edit · View registrations · Duplicate · Publish/Unpublish toggle · Delete (confirm modal, cascades).
Top-right: **+ New Event**.

### 6.3 Create/Edit form
Grouped in two columns:

- **Basics** — Title, Type (dropdown), Short description (textarea, 280-char soft limit), Long description (markdown textarea with preview pane).
- **When** — Start datetime, End datetime, Registration deadline (optional).
- **Where** — Location type (radio: Online / In-person / Hybrid), Venue (text, shown unless Online).
- **Registration** — Registration URL.
- **Display** — Cover image URL (live preview), `force_on_every_login` toggle, `is_published` toggle.

Footer: **Save as draft**, **Save & publish**, **Cancel**. Client-side validation: required fields, `end > start`, `deadline ≤ start`.

### 6.4 Per-event registrations view
Header: event title + key counters — Registered (N), External link clicked (M), Days to event (X).
Table columns: User name · Email · Practice · Role · Registered at · External link clicked (✓/✗) · Clicked at.
Sort any column, filter by practice.
**Export CSV** downloads current filtered rows with all columns.

## 7. File Layout

### Create
- `sql/031_events.sql`
- `js/events-modal.js` — IIFE: `EventsModal.openForCurrentUser()`, `EventsModal.openAll(events)`
- `js/admin-events.js` — IIFE: `AdminEvents.init(container)`
- `css/events.css`

### Modify
- `js/db.js` — new `events` namespace:
  - user: `listActiveForCurrentUser()`, `register(eventId)`, `dismiss(eventId)`, `markExternalClicked(eventId)`
  - admin: `listAll(filter)`, `create(payload)`, `update(id, payload)`, `delete(id)`, `listRegistrations(eventId)`
- `js/auth.js` — invoke `EventsModal.openForCurrentUser()` after successful session restore / login, guarded to run once per page load.
- `src/pages/index.html` — header bell markup; load `events-modal.js`, `events.css`.
- `src/pages/admin.html` — new "Events" tab nav entry and `#events-tab` section; load `admin-events.js`.
- `src/pages/employee-status.html` — include modal assets so the pop-up fires there too.
- `CHANGELOG.md`, `README.md`, `docs/BRD.md`, `docs/HLD.md`, `docs/CODE_ARCHITECTURE.md`, `docs/IMPLEMENTATION_NOTES.md` — documentation sweep per CLAUDE.md §4.

## 8. Integration Notes

- **Supabase MCP** is used for every migration, RLS test, and schema inspection (CLAUDE.md §3).
- **Timezone**: stored as `timestamptz` (UTC); rendered with `Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', ... })`.
- **Auth hook placement**: inside the shared `auth.js` post-auth chain so every page that uses the shared auth module inherits the behavior uniformly; no per-page wiring beyond asset inclusion.
- **No new Edge Functions.** All reads/writes go directly through the Supabase JS client under RLS.

## 9. Testing Plan

1. **Migration** — apply `031_events.sql` via Supabase MCP on a branch; assert tables, view, RLS with `set role` (anon denied, authenticated filtered, admin full).
2. **Seed** — insert the Microsoft AI Learning Summit (May 5–6, 2026, online, external URL from the source .msg) as the first active event.
3. **Manual E2E**:
   - Contributor login → modal opens → Register → external tab opens, card flips to "Registered" → reload → modal does not reopen; event absent.
   - Second contributor → Dismiss → reload → not shown → click bell → modal reopens with card.
   - Admin toggles `force_on_every_login = true` → both users' next login re-shows the event (disabled Register for the one already registered).
   - Event passes `end_datetime` → modal empty, bell = 0, event moves to Past filter in admin.
   - Admin flows: create / edit / publish / unpublish / delete / duplicate; registrations tab rows match `event_registrations`; CSV export matches filtered view.
4. **RLS negatives**:
   - Non-admin INSERT/UPDATE/DELETE on `events` denied.
   - User A cannot read user B's rows in `event_registrations` or `event_dismissals`.
   - Anonymous client denied all access.

## 10. Portability (CLAUDE.md §8)

**Risk: Low.** Two tables, one view, and RLS policies — all standard Postgres. No new SaaS vendor, no Edge Functions, no external service dependency. Only `auth.uid()` references would need adapting if the stack moved off Supabase, consistent with every other table in the repo.

## 11. Out of Scope (v1)

- Audience targeting (practice/role/department/user filters)
- Capacity limits / waitlists
- `.ics` calendar invites
- Email or push notifications
- Event comments, Q&A, speakers, tags
- Analytics dashboards beyond the registrations list + counters
- SPOC/Team-Lead authoring permissions
