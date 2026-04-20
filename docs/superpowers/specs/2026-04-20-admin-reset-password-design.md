# Design Spec: Admin Reset Password

**Date:** 2026-04-20  
**Status:** Approved  
**Scope:** Replace magic link button in admin user table with a set-password action

---

## Problem

Admins currently use the "Magic Link" button to help users regain access. Magic links are one-time login URLs, not a password reset — the user still has no password afterward. Admins need to directly set a known password for a user (e.g., a temporary `12345678` that the user changes on first login).

---

## Solution

Replace the magic link button and its supporting code with a **Reset Password** action that lets an admin type a new password for any user. The password is set server-side via a new Edge Function using the Supabase Admin Auth API.

---

## Architecture

### Components

| Component | Location | Responsibility |
|---|---|---|
| Key icon button | `admin.html` — user row actions | Triggers reset password modal |
| Reset password modal | `admin.html` — `#modal-reset-password` | Password input UI |
| `resetUserPassword(email)` | `admin.html` JS | Opens modal, sets target email |
| `_doResetPassword(email, password)` | `admin.html` JS | Validates input, calls Edge Function |
| `admin-reset-password` Edge Function | `supabase/functions/admin-reset-password/index.ts` | Verifies caller is admin, sets password via Auth Admin API |

---

## UI Changes (admin.html)

### Remove
- `#modal-magic-link` modal (entire block)
- `MAGIC_LINK_URL` constant
- `generateMagicLink(email)` function
- `_doGenerateMagicLink(email)` function
- Magic link `btn-icon` button in user row actions

### Add
- Key icon `btn-icon` button in user row actions:
  - `onclick="resetUserPassword('${escapeHtml(u.email)}')`
  - `title="Reset password"`
  - Color: `var(--warning)` (amber — distinct from Edit blue)
  - Icon: key SVG

- `#modal-reset-password` modal:
  - Header: "Reset Password" with key icon
  - Body: email shown as read-only label + password `<input type="password">` (min 8 chars, required)
  - Footer: Cancel + "Set Password" (primary) buttons

### JS Functions
```js
function resetUserPassword(email) {
  // populate modal email label, clear password input, open modal
}

async function _doResetPassword(email, password) {
  // validate: password.length >= 8
  // call POST /functions/v1/admin-reset-password with { email, password }
  // on success: close modal, showToast success
  // on error: showToast error
}
```

---

## Edge Function: admin-reset-password

**Path:** `supabase/functions/admin-reset-password/index.ts`  
**Auth:** Requires valid Supabase JWT; caller's role in `public.users` must be `admin`  
**Method:** POST  

### Request body
```json
{ "email": "user@example.com", "password": "newpassword" }
```

### Logic
1. Parse and validate `email` and `password` (non-empty, password ≥ 8 chars)
2. Verify caller JWT via `supabase.auth.getUser(token)`
3. Query `public.users` where `id = caller.id` — confirm `role = 'admin'`
4. Look up target user in `auth.users` by email via Admin API (`listUsers` or `getUserByEmail`)
5. Call `supabase.auth.admin.updateUserById(targetUserId, { password })`
6. Return `{ success: true, email }` or `{ error: "message" }` with appropriate HTTP status

### Response
```json
{ "success": true, "email": "user@example.com" }
```

### Error cases
| Condition | HTTP | Message |
|---|---|---|
| Missing/invalid body | 400 | "email and password required" |
| Password < 8 chars | 400 | "password must be at least 8 characters" |
| Caller not authenticated | 401 | "unauthorized" |
| Caller not admin | 403 | "forbidden" |
| Target user not found | 404 | "user not found" |
| Supabase Admin API error | 500 | forwarded message |

---

## Security Considerations

- Service role key remains server-side only (Edge Function env var `SUPABASE_SERVICE_ROLE_KEY`)
- Caller authorization checked on every request — cannot be bypassed client-side
- No plain-text password is stored or logged
- CORS restricted to the app's origin

---

## Files Changed

| File | Change |
|---|---|
| `src/pages/admin.html` | Remove magic link UI/JS; add reset password modal + JS |
| `supabase/functions/admin-reset-password/index.ts` | New Edge Function |
| `CHANGELOG.md` | New entry |
| `docs/IMPLEMENTATION_NOTES.md` | Rationale entry |

---

## Out of Scope

- Force-change-on-next-login flag (Supabase Auth does not expose this natively)
- Password strength policy enforcement beyond minimum length (can be added later)
- Audit log of who reset whose password (future enhancement)
