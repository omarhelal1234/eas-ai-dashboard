// ============================================================
// Edge Function: prompt-improver
//
// Two-stage admin-only prompt enhancement pipeline:
//   1. OpenAI (gpt-4o-mini) — "Qualify": transform raw English text
//      into a well-structured prompt (role, task, context, format,
//      constraints).
//   2. Anthropic (claude-sonnet-4-5) — "Improve": refine the
//      qualified prompt for clarity, specificity, and completeness.
//
// Security:
//   - Caller must send Authorization: Bearer <user JWT>.
//   - Function looks up user_profiles.role and rejects non-admins.
//   - API keys are read from Supabase secrets (OPENAI_API_KEY,
//     ANTHROPIC_API_KEY). Never embed keys in client code.
//
// Deploy:
//   supabase functions deploy prompt-improver --no-verify-jwt
//   supabase secrets set OPENAI_API_KEY=sk-...
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Note: --no-verify-jwt is used because we perform our own auth +
// role check below using the user's JWT, which gives us the user id.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { OpenAI } from "https://esm.sh/openai@4.28.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-sonnet-4-5";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ---------- Prompts ----------

const QUALIFY_SYSTEM = `You convert raw English text into a well-structured AI prompt.

Take the user's input and rewrite it as a complete prompt that includes — where appropriate:
- ROLE: who the AI should act as
- TASK: the precise objective
- CONTEXT: relevant background or assumptions (only what's needed)
- INPUT: what data/material the AI will receive
- FORMAT: the expected output structure (length, sections, format)
- CONSTRAINTS: rules, tone, things to avoid

Rules:
- Keep the user's intent. Do not invent unrelated requirements.
- If the input is already a structured prompt, normalize it into the same six sections.
- Use clear section headings on their own lines (ROLE:, TASK:, etc.). Omit any section that genuinely doesn't apply.
- Output ONLY the qualified prompt text. No preamble, no explanations, no markdown code fences.`;

const IMPROVE_SYSTEM = `You are an expert prompt engineer. You will be given a structured prompt. Improve it.

Improve along these dimensions:
- Clarity: replace vague verbs ("handle", "deal with") with specific actions.
- Specificity: add concrete acceptance criteria where the prompt is fuzzy.
- Completeness: fill obvious gaps (e.g. missing output format, missing edge cases).
- Conciseness: cut redundancy. Shorter is better when the meaning is preserved.
- Robustness: add brief instructions to handle ambiguity (e.g. "if X is unclear, ask before proceeding").

Hard rules:
- Preserve the original intent and scope. Do not add unrelated capabilities.
- Keep the same section structure (ROLE / TASK / CONTEXT / INPUT / FORMAT / CONSTRAINTS) the input uses.
- Output ONLY the improved prompt. No preamble, no commentary, no markdown code fences.`;

// ---------- Handler ----------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    // ---- Auth: extract user from JWT and verify admin role ----
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return json({ error: "Server misconfigured: Supabase env missing" }, 500);
    }

    // Service-role client used only to (a) verify the user JWT and
    // (b) look up their role. We never expose it to the browser.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return json({ error: "Invalid or expired session" }, 401);
    }
    const userId = userData.user.id;

    // The app's profile table is `public.users` keyed by auth_id (= auth.users.id)
    const { data: profile, error: profileErr } = await admin
      .from("users")
      .select("role")
      .eq("auth_id", userId)
      .single();

    if (profileErr || !profile) {
      return json({ error: "Could not load user profile" }, 403);
    }
    if (profile.role !== "admin") {
      return json({ error: "Forbidden: admin role required" }, 403);
    }

    // ---- Parse + validate body ----
    const body = await req.json().catch(() => ({}));
    const rawText = (body?.rawText ?? "").toString().trim();
    if (!rawText) {
      return json({ error: "rawText is required" }, 400);
    }
    if (rawText.length > 4000) {
      return json({ error: "rawText must be 4000 characters or fewer" }, 400);
    }

    // ---- API keys ----
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!openaiKey || !anthropicKey) {
      return json(
        { error: "Server misconfigured: OPENAI_API_KEY and/or ANTHROPIC_API_KEY missing" },
        500
      );
    }

    // ---- Stage 1: OpenAI — Qualify ----
    const openai = new OpenAI({ apiKey: openaiKey });
    let qualified = "";
    try {
      const qResp = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.3,
        max_tokens: 1200,
        messages: [
          { role: "system", content: QUALIFY_SYSTEM },
          { role: "user", content: rawText },
        ],
      });
      qualified = (qResp.choices?.[0]?.message?.content || "").trim();
      if (!qualified) throw new Error("Empty response from OpenAI");
    } catch (err) {
      console.error("OpenAI qualify failed:", err);
      return json(
        { error: `Qualify step failed: ${(err as Error).message || "OpenAI error"}` },
        502
      );
    }

    // ---- Stage 2: Anthropic — Improve ----
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    let improved = "";
    try {
      const aResp = await anthropic.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: 1500,
        temperature: 0.4,
        system: IMPROVE_SYSTEM,
        messages: [{ role: "user", content: qualified }],
      });
      // Anthropic returns content as an array of blocks
      improved = (aResp.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      if (!improved) throw new Error("Empty response from Anthropic");
    } catch (err) {
      console.error("Anthropic improve failed:", err);
      return json(
        {
          error: `Improve step failed: ${(err as Error).message || "Anthropic error"}`,
          qualified, // still return stage-1 output so the admin doesn't lose it
        },
        502
      );
    }

    return json({
      original: rawText,
      qualified,
      improved,
      models: { qualify: OPENAI_MODEL, improve: ANTHROPIC_MODEL },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("prompt-improver fatal:", err);
    return json(
      { error: `Internal error: ${(err as Error).message || "unknown"}` },
      500
    );
  }
});
