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

    // Use service-role client for token verification (works regardless of anon key format)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user: callerAuth },
      error: authError,
    } = await adminClient.auth.getUser(token);

    if (authError || !callerAuth) {
      console.error("getUser error:", authError);
      return jsonResponse({ error: "Invalid or expired token." }, 401);
    }

    // ---- 2. Verify caller is an active admin ----
    const { data: callerProfile, error: profileError } = await adminClient
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
