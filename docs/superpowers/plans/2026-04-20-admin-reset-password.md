# Admin Reset Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Magic Link button in the admin user table with a Reset Password action that lets admins set a specific password for any user via a new Supabase Edge Function.

**Architecture:** A new Edge Function (`admin-reset-password`) mirrors the auth/authorization pattern of `admin-magic-link` — verifies caller JWT, confirms admin role, then calls `supabase.auth.admin.updateUserById` with the new password. The admin panel replaces all magic link UI and JS with a password-input modal and a matching fetch call.

**Tech Stack:** Deno/TypeScript (Edge Function), Supabase JS SDK v2 Admin API, vanilla JS + HTML (admin panel)

---

## File Map

| File | Action | What changes |
|---|---|---|
| `supabase/functions/admin-reset-password/index.ts` | **Create** | New Edge Function — auth check + password update |
| `src/pages/admin.html` | **Modify** | Remove magic link modal + JS; add reset password modal + JS |
| `CHANGELOG.md` | **Modify** | New entry under `[Unreleased]` |
| `docs/IMPLEMENTATION_NOTES.md` | **Modify** | Rationale entry |

---

## Task 1: Create the Edge Function

**Files:**
- Create: `supabase/functions/admin-reset-password/index.ts`

- [ ] **Step 1: Create the file with full implementation**

Create `supabase/functions/admin-reset-password/index.ts` with this exact content:

```typescript
// ============================================================
// EAS AI Adoption Dashboard — Admin Reset Password
// Supabase Edge Function: admin-reset-password
//
// Sets a new password for any user.
// Only callable by authenticated admin users.
//
// POST / { email: string, password: string }
// Returns: { success: true, email: string }
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  try {
    // ---- 1. Authenticate the caller using their JWT ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header." }, 401);
    }

    const token = authHeader.replace("Bearer ", "");

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user: callerAuth },
      error: authError,
    } = await callerClient.auth.getUser(token);

    if (authError || !callerAuth) {
      return jsonResponse({ error: "Invalid or expired token." }, 401);
    }

    // ---- 2. Verify caller is an active admin ----
    const { data: callerProfile, error: profileError } = await callerClient
      .from("users")
      .select("id, role, is_active")
      .eq("auth_id", callerAuth.id)
      .single();

    if (profileError || !callerProfile) {
      return jsonResponse({ error: "Caller profile not found." }, 403);
    }

    if (callerProfile.role !== "admin") {
      return jsonResponse({ error: "Forbidden. Only admins can reset passwords." }, 403);
    }

    if (!callerProfile.is_active) {
      return jsonResponse({ error: "Caller account is deactivated." }, 403);
    }

    // ---- 3. Parse and validate request body ----
    const body = await req.json();
    const targetEmail = body?.email?.trim()?.toLowerCase();
    const newPassword = body?.password;

    if (!targetEmail || !newPassword) {
      return jsonResponse({ error: "email and password required" }, 400);
    }

    if (newPassword.length < 8) {
      return jsonResponse({ error: "password must be at least 8 characters" }, 400);
    }

    // ---- 4. Find the target user by email ----
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { users }, error: listError } = await adminClient.auth.admin.listUsers({
      perPage: 1000,
    });

    if (listError) {
      return jsonResponse({ error: `Failed to look up users: ${listError.message}` }, 500);
    }

    const targetUser = users?.find((u) => u.email === targetEmail);

    if (!targetUser) {
      return jsonResponse({ error: "user not found" }, 404);
    }

    // ---- 5. Update the password ----
    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      targetUser.id,
      { password: newPassword }
    );

    if (updateError) {
      console.error("updateUserById error:", updateError);
      return jsonResponse({ error: `Failed to reset password: ${updateError.message}` }, 500);
    }

    // ---- 6. Audit log ----
    console.log(
      `[AUDIT] Admin ${callerProfile.id} (${callerAuth.email}) reset password for ${targetEmail}`
    );

    return jsonResponse({ success: true, email: targetEmail });
  } catch (err) {
    console.error("admin-reset-password error:", err);
    return jsonResponse(
      { error: `Internal error: ${err.message || "Unknown error"}` },
      500
    );
  }
});
```

- [ ] **Step 2: Deploy the Edge Function**

```bash
cd "c:\Users\oibrahim\Desktop\Ejada Projects\EAS_AI_ADOPTION\E-AI-S"
supabase functions deploy admin-reset-password
```

Expected output: `Deployed admin-reset-password successfully.`

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-reset-password/index.ts
git commit -m "feat: add admin-reset-password Edge Function"
```

---

## Task 2: Update admin.html — Remove Magic Link

**Files:**
- Modify: `src/pages/admin.html`

- [ ] **Step 1: Remove the magic link modal HTML**

Find and delete the entire block from line ~1489 to ~1519 (inclusive):

```html
<!-- Magic Link Result Modal -->
<div class="modal-overlay" id="modal-magic-link">
  <div class="modal" style="max-width:560px">
    ...
  </div>
</div>
```

The block starts with `<!-- Magic Link Result Modal -->` and ends with the closing `</div>` after `</div>` for `id="modal-magic-link"`.

- [ ] **Step 2: Remove the magic link JS block**

Find and delete from line ~3765 to ~3818 (inclusive):

```js
// ============ ADMIN MAGIC LINK ============
const MAGIC_LINK_URL = SUPABASE_URL + '/functions/v1/admin-magic-link';

async function generateMagicLink(email) { ... }

async function _doGenerateMagicLink(email) { ... }

function copyMagicLink() { ... }
```

Delete the entire section: `// ============ ADMIN MAGIC LINK ============` through the closing `}` of `copyMagicLink`.

- [ ] **Step 3: Replace the magic link button in the user row**

Find:
```js
        <button class="btn-icon" onclick="generateMagicLink('${escapeHtml(u.email)}')" title="Generate login link" style="color:var(--accent)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
```

Replace with:
```js
        <button class="btn-icon" onclick="resetUserPassword('${escapeHtml(u.email)}')" title="Reset password" style="color:var(--warning)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
        </button>
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin.html
git commit -m "refactor: remove magic link button and JS from admin panel"
```

---

## Task 3: Update admin.html — Add Reset Password Modal + JS

**Files:**
- Modify: `src/pages/admin.html`

- [ ] **Step 1: Add the reset password modal HTML**

Find the `<!-- Confirm Dialog -->` comment (around line 1521 after removals). Insert the following block **immediately before** it:

```html
<!-- Reset Password Modal -->
<div class="modal-overlay" id="modal-reset-password">
  <div class="modal" style="max-width:480px">
    <h3 style="display:flex;align-items:center;gap:8px">
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--warning)" stroke-width="2" width="22" height="22"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
      Reset Password
    </h3>
    <div style="margin:16px 0 8px">
      <label style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">User</label>
      <div id="rp-email" style="padding:8px 12px;background:var(--bg-primary);border:1px solid var(--border);border-radius:8px;font-size:14px;margin-top:4px"></div>
    </div>
    <div style="margin:12px 0">
      <label style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px">New Password</label>
      <input type="password" id="rp-password" placeholder="Min 8 characters" minlength="8"
        style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-primary);color:var(--text-primary);font-size:14px;margin-top:4px;outline:none"
        onkeydown="if(event.key==='Enter') _doResetPassword()">
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal('modal-reset-password')">Cancel</button>
      <button class="btn btn-primary" onclick="_doResetPassword()">Set Password</button>
    </div>
  </div>
</div>

```

- [ ] **Step 2: Add the reset password JS**

Find the `function escapeHtml(text)` block (near the bottom of the script). Insert the following block **immediately after** the closing `}` of `escapeHtml`:

```js
// ============ ADMIN RESET PASSWORD ============
const RESET_PASSWORD_URL = SUPABASE_URL + '/functions/v1/admin-reset-password';

function resetUserPassword(email) {
  if (!email) return;
  document.getElementById('rp-email').textContent = email;
  document.getElementById('rp-password').value = '';
  openModal('modal-reset-password');
  setTimeout(() => document.getElementById('rp-password').focus(), 100);
}

async function _doResetPassword() {
  const email = document.getElementById('rp-email').textContent.trim();
  const password = document.getElementById('rp-password').value;
  if (!password || password.length < 8) {
    showToast('Password must be at least 8 characters', 'error');
    return;
  }
  try {
    showToast('Resetting password…', 'info');
    const session = await EAS_Auth.getSession();
    if (!session) {
      showToast('You must be logged in', 'error');
      return;
    }
    const res = await fetch(RESET_PASSWORD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to reset password', 'error');
      return;
    }
    closeModal('modal-reset-password');
    showToast(`Password reset for ${email}`, 'success');
  } catch (err) {
    console.error('_doResetPassword error:', err);
    showToast('Network error: ' + err.message, 'error');
  }
}
```

- [ ] **Step 3: Verify no remaining magic link references**

Search for any remaining references to magic link in admin.html and confirm zero results:
- `generateMagicLink` — should not exist
- `modal-magic-link` — should not exist
- `copyMagicLink` — should not exist
- `MAGIC_LINK_URL` — should not exist

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin.html
git commit -m "feat: add reset password modal and JS to admin panel"
```

---

## Task 4: Update Docs and Push

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/IMPLEMENTATION_NOTES.md`

- [ ] **Step 1: Update CHANGELOG.md**

Add under `## [Unreleased]`:

```
- 2026-04-20 (claude) — Replace magic link button with admin-set password action; new Edge Function admin-reset-password (admin panel)
```

- [ ] **Step 2: Update IMPLEMENTATION_NOTES.md**

Append:

```
## 2026-04-20 — Admin Reset Password

Replaced the Magic Link action in the admin user table with a "Reset Password" action. Motivation: magic links are one-time login URLs, not passwords — admins needed to set a known temporary password (e.g., `12345678`) for users who are locked out.

A new Edge Function (`admin-reset-password`) mirrors the `admin-magic-link` auth pattern: verifies caller JWT, confirms admin role in `public.users`, then calls `supabase.auth.admin.updateUserById` with the new password via the service role key. The service role key stays server-side.

`listUsers({ perPage: 1000 })` is used to look up the target user by email since the Supabase JS SDK v2 Admin API has no `getUserByEmail`. This is acceptable for ~120 users; a future migration could add a direct lookup if the user count grows significantly.
```

- [ ] **Step 3: Commit and push**

```bash
git add CHANGELOG.md docs/IMPLEMENTATION_NOTES.md
git commit -m "docs: changelog and implementation notes for admin reset password"
git push origin master
```

---

## Verification Checklist

After all tasks are complete:

- [ ] Open admin panel → Users tab → confirm the magic link chain icon is gone and a key icon (amber) is present for each user row
- [ ] Click the key icon for any user → modal opens showing the user's email and a password field
- [ ] Enter a password < 8 chars → "Password must be at least 8 characters" toast, modal stays open
- [ ] Enter a valid password (≥ 8 chars) → "Resetting password…" info toast → "Password reset for user@email.com" success toast, modal closes
- [ ] Log in as that user with the new password to confirm it works
- [ ] Confirm Edge Function logs show the audit line in Supabase dashboard → Functions → admin-reset-password → Logs
