// ============================================================
// EAS AI Adoption Dashboard — Phase 10: IDE Task Logger API
// Supabase Edge Function: ide-task-log
//
// Endpoints (path-routed within a single function):
//   POST   /                → Submit a task from IDE
//   GET    /context         → Active quarter, LOVs, user's projects
//   GET    /my-tasks        → Authenticated user's recent tasks
//   GET    /health          → Auth-free health check
//
// Auth: JWT Bearer token required (except /health)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// ---- Helpers ----

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Authenticate the request using the JWT Bearer token.
 * Returns a Supabase client scoped to the authenticated user, plus their profile.
 */
async function authenticateRequest(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: "Missing or invalid Authorization header. Use: Bearer <jwt>" };
  }

  const token = authHeader.replace("Bearer ", "");

  // Create a client with the user's JWT so RLS applies
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Verify the token and get the user
  const { data: { user }, error: authError } = await userClient.auth.getUser(token);
  if (authError || !user) {
    return { error: "Invalid or expired token. Please re-authenticate." };
  }

  // Fetch user profile from public.users
  const { data: profile, error: profileError } = await userClient
    .from("users")
    .select("id, email, name, role, practice, is_active")
    .eq("auth_id", user.id)
    .single();

  if (profileError || !profile) {
    return { error: "User profile not found. Please contact an administrator." };
  }

  if (!profile.is_active) {
    return { error: "User account is deactivated." };
  }

  return { userClient, user, profile, token };
}

/**
 * Extract the sub-path from the request URL.
 * Edge Functions are mounted at /functions/v1/ide-task-log
 * so we strip that prefix to get the route.
 */
function getRoute(req: Request): string {
  const url = new URL(req.url);
  const path = url.pathname;
  // Remove the Edge Function base path prefix
  const match = path.match(/\/ide-task-log(\/.*)?$/);
  return match?.[1] || "/";
}

// ============================================================
// Route: GET /health — No auth required
// ============================================================
function handleHealth(): Response {
  return jsonResponse({
    status: "ok",
    service: "ide-task-log",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
}

// ============================================================
// Route: GET /context — Returns form context for the IDE
// ============================================================
async function handleGetContext(
  userClient: ReturnType<typeof createClient>,
  profile: Record<string, unknown>
): Promise<Response> {
  // Fetch active quarter
  const { data: quarters } = await userClient
    .from("quarters")
    .select("id, label, is_active, is_locked")
    .order("start_date", { ascending: true });

  const activeQuarter = quarters?.find((q: Record<string, unknown>) => q.is_active) || quarters?.[quarters.length - 1] || null;

  // Fetch LOV values (categories & AI tools)
  const { data: lovs } = await userClient
    .from("lovs")
    .select("category, value, is_licensed")
    .order("sort_order", { ascending: true });

  const categories = lovs?.filter((l: Record<string, unknown>) => l.category === "taskCategory").map((l: Record<string, unknown>) => l.value) || [];
  const aiTools = lovs?.filter((l: Record<string, unknown>) => l.category === "aiTool").map((l: Record<string, unknown>) => ({
    value: l.value,
    isLicensed: l.is_licensed || false,
  })) || [];

  // Fetch user's practice projects
  const { data: projects } = await userClient
    .from("projects")
    .select("project_name, project_code, customer")
    .eq("practice", profile.practice as string)
    .order("project_name");

  // Fetch role-based view permissions for this user's role
  const { data: permRows } = await userClient
    .from("role_view_permissions")
    .select("view_key, is_visible")
    .eq("role", profile.role as string);

  const permissions: Record<string, boolean> = {};
  if (permRows) {
    for (const row of permRows as Array<{ view_key: string; is_visible: boolean }>) {
      permissions[row.view_key] = row.is_visible;
    }
  }

  return jsonResponse({
    user: {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      practice: profile.practice,
    },
    activeQuarter: activeQuarter
      ? { id: activeQuarter.id, label: activeQuarter.label, isLocked: activeQuarter.is_locked }
      : null,
    quarters: quarters?.map((q: Record<string, unknown>) => ({
      id: q.id,
      label: q.label,
      isActive: q.is_active,
      isLocked: q.is_locked,
    })) || [],
    categories,
    aiTools,
    projects: projects?.map((p: Record<string, unknown>) => ({
      name: p.project_name,
      code: p.project_code,
      customer: p.customer,
    })) || [],
    permissions,
  });
}

// ============================================================
// Route: GET /my-tasks — Returns user's recent tasks
// ============================================================
async function handleGetMyTasks(
  userClient: ReturnType<typeof createClient>,
  profile: Record<string, unknown>,
  req: Request
): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);
  const quarterId = url.searchParams.get("quarter") || null;

  let query = userClient
    .from("tasks")
    .select("id, task_description, category, ai_tool, time_without_ai, time_with_ai, time_saved, efficiency, quality_rating, approval_status, source, quarter_id, project, created_at")
    .eq("logged_by", profile.id as string)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (quarterId && quarterId !== "all") {
    query = query.eq("quarter_id", quarterId);
  }

  const { data: tasks, error } = await query;

  if (error) {
    console.error("handleGetMyTasks error:", error.message);
    return errorResponse("Failed to fetch tasks", 500);
  }

  // Also fetch approval details for the returned tasks
  const taskIds = tasks?.map((t: Record<string, unknown>) => t.id) || [];
  let approvals: Record<string, unknown>[] = [];
  if (taskIds.length > 0) {
    const { data: approvalData } = await userClient
      .from("submission_approvals")
      .select("submission_id, approval_status, approval_layer, ai_validation_result, spoc_approval_notes, admin_approval_notes, submitted_at")
      .in("submission_id", taskIds)
      .eq("submission_type", "task");
    approvals = approvalData || [];
  }

  const approvalMap = new Map(approvals.map((a: Record<string, unknown>) => [a.submission_id, a]));

  const enrichedTasks = tasks?.map((t: Record<string, unknown>) => ({
    id: t.id,
    description: t.task_description,
    category: t.category,
    aiTool: t.ai_tool,
    timeWithoutAi: t.time_without_ai,
    timeWithAi: t.time_with_ai,
    timeSaved: t.time_saved,
    efficiency: t.efficiency,
    qualityRating: t.quality_rating,
    approvalStatus: t.approval_status,
    source: t.source,
    quarterId: t.quarter_id,
    project: t.project,
    createdAt: t.created_at,
    approval: approvalMap.get(t.id) || null,
  })) || [];

  return jsonResponse({
    tasks: enrichedTasks,
    total: enrichedTasks.length,
    limit,
  });
}

// ============================================================
// Route: POST / — Submit a task from IDE
// ============================================================

/** Validate required fields for task submission */
function validateTaskPayload(body: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (!body.taskDescription || typeof body.taskDescription !== "string" || (body.taskDescription as string).trim().length < 10) {
    errors.push("taskDescription is required (min 10 characters)");
  }
  if (!body.category || typeof body.category !== "string") {
    errors.push("category is required");
  }
  if (!body.aiTool || typeof body.aiTool !== "string") {
    errors.push("aiTool is required");
  }
  if (body.timeWithoutAi === undefined || body.timeWithoutAi === null || typeof body.timeWithoutAi !== "number" || body.timeWithoutAi < 0) {
    errors.push("timeWithoutAi is required (non-negative number, in hours)");
  }
  if (body.timeWithAi === undefined || body.timeWithAi === null || typeof body.timeWithAi !== "number" || body.timeWithAi < 0) {
    errors.push("timeWithAi is required (non-negative number, in hours)");
  }
  if (body.timeWithoutAi !== undefined && body.timeWithAi !== undefined &&
      typeof body.timeWithoutAi === "number" && typeof body.timeWithAi === "number" &&
      body.timeWithAi > body.timeWithoutAi) {
    errors.push("timeWithAi cannot exceed timeWithoutAi");
  }

  return errors;
}

/**
 * Determine approval routing based on business rules.
 * Mirrors the logic in js/db.js → determineApprovalRouting()
 */
async function determineApprovalRouting(
  serviceClient: ReturnType<typeof createClient>,
  practice: string,
  savedHours: number,
  aiValidationFailed: boolean
) {
  let approvalStatus = "pending";
  let approvalLayer = "ai";
  let spocId: string | null = null;
  let adminId: string | null = null;

  // Always go to admin if saved_hours >= 15
  if (savedHours >= 15) {
    approvalStatus = "admin_review";
    approvalLayer = "admin";
    const { data: adminData } = await serviceClient
      .from("users")
      .select("id")
      .eq("role", "admin")
      .limit(1)
      .single();
    adminId = adminData?.id || null;
  }
  // If AI validation failed, go to SPOC
  else if (aiValidationFailed) {
    approvalStatus = "spoc_review";
    approvalLayer = "spoc";
    const { data: spocData } = await serviceClient
      .from("practice_spoc")
      .select("spoc_id")
      .eq("practice", practice)
      .eq("is_active", true)
      .single();
    if (spocData?.spoc_id) {
      spocId = spocData.spoc_id;
    } else {
      // Fallback to admin if SPOC not found
      const { data: adminData } = await serviceClient
        .from("users")
        .select("id")
        .eq("role", "admin")
        .limit(1)
        .single();
      adminId = adminData?.id || null;
      approvalLayer = "admin";
      approvalStatus = "admin_review";
    }
  }
  // Default: AI review first
  else {
    approvalStatus = "ai_review";
    approvalLayer = "ai";
  }

  return { approvalStatus, approvalLayer, spocId, adminId };
}

/**
 * Call the ai-validate Edge Function for AI validation scoring.
 * This is a service-to-service call within the same Supabase project.
 */
async function callAiValidation(
  taskDescription: string,
  aiTool: string,
  category: string,
  savedHours: number
): Promise<Record<string, unknown> | null> {
  try {
    const validateUrl = `${supabaseUrl}/functions/v1/ai-validate`;
    const response = await fetch(validateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        submissionType: "task",
        savedHours,
        whyText: taskDescription,
        whatText: taskDescription,
        aiTool,
        category,
      }),
    });

    if (!response.ok) {
      console.error("AI validation HTTP error:", response.status);
      return null;
    }

    const result = await response.json();
    return result?.validation || null;
  } catch (err) {
    console.error("AI validation call failed:", err);
    return null;
  }
}

async function handleSubmitTask(
  userClient: ReturnType<typeof createClient>,
  profile: Record<string, unknown>,
  req: Request
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  // Validate required fields
  const validationErrors = validateTaskPayload(body);
  if (validationErrors.length > 0) {
    return jsonResponse({ error: "Validation failed", details: validationErrors }, 400);
  }

  // Resolve active quarter
  const { data: activeQuarterData } = await userClient
    .from("quarters")
    .select("id, is_locked")
    .eq("is_active", true)
    .single();

  if (!activeQuarterData) {
    return errorResponse("No active quarter found. Contact an administrator.", 422);
  }
  if (activeQuarterData.is_locked) {
    return errorResponse("The active quarter is locked. No new submissions are accepted.", 422);
  }

  const quarterId = (body.quarterId as string) || activeQuarterData.id;
  const savedHours = (body.timeWithoutAi as number) - (body.timeWithAi as number);

  // Build the task payload (snake_case for DB)
  const taskPayload = {
    practice: profile.practice,
    quarter_id: quarterId,
    employee_name: profile.name,
    employee_email: profile.email,
    task_description: (body.taskDescription as string).trim(),
    category: body.category,
    ai_tool: body.aiTool,
    prompt_used: body.promptUsed || null,
    time_without_ai: body.timeWithoutAi,
    time_with_ai: body.timeWithAi,
    quality_rating: body.qualityRating || null,
    project: body.project || null,
    project_code: body.projectCode || null,
    week_number: body.weekNumber || null,
    status: "Pending",
    notes: body.notes || null,
    source: "ide",
    logged_by: profile.id,
  };

  // Insert the task (RLS applies via user's JWT)
  const { data: task, error: insertError } = await userClient
    .from("tasks")
    .insert(taskPayload)
    .select()
    .single();

  if (insertError) {
    console.error("Task insert error:", insertError.message);
    return errorResponse(`Failed to create task: ${insertError.message}`, 500);
  }

  // --- Approval Workflow ---
  // Service client for approval routing lookups (needs cross-practice access)
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  // Call AI validation (fire-and-forget pattern — don't block on failure)
  const aiValidation = await callAiValidation(
    taskPayload.task_description as string,
    taskPayload.ai_tool as string,
    taskPayload.category as string,
    savedHours
  );
  const aiValidationFailed = aiValidation ? !(aiValidation.isValid) : true;

  // Determine approval routing
  const routing = await determineApprovalRouting(
    serviceClient,
    profile.practice as string,
    savedHours,
    aiValidationFailed
  );

  // Create submission approval record (using service client for cross-table access)
  const approvalPayload = {
    submission_type: "task",
    submission_id: task.id,
    approval_status: routing.approvalStatus,
    approval_layer: routing.approvalLayer,
    saved_hours: savedHours,
    practice: profile.practice,
    submitted_by: profile.id,
    submitted_by_email: profile.email,
    ai_validation_result: aiValidation || null,
    ai_validation_failed: aiValidationFailed,
    spoc_id: routing.spocId,
    admin_id: routing.adminId,
  };

  const { data: approval, error: approvalError } = await serviceClient
    .from("submission_approvals")
    .insert(approvalPayload)
    .select()
    .single();

  if (approvalError) {
    console.error("Approval creation error:", approvalError.message);
    // Task was created but approval failed — still return success with warning
    return jsonResponse({
      success: true,
      warning: "Task created but approval workflow could not be initiated. An admin will review manually.",
      task: {
        id: task.id,
        description: task.task_description,
        timeSaved: savedHours,
        source: "ide",
        createdAt: task.created_at,
      },
    }, 201);
  }

  // Update task with approval reference (don't set approval_status — check constraint only allows pending/approved/rejected)
  await userClient.from("tasks").update({
    approval_id: approval.id,
  }).eq("id", task.id);

  // Log activity (using service client to ensure insert succeeds)
  await serviceClient.from("activity_log").insert({
    user_id: profile.id,
    action: "INSERT",
    entity_type: "tasks",
    entity_id: task.id,
    details: {
      task: task.task_description,
      source: "ide",
      ai_tool: task.ai_tool,
      saved_hours: savedHours,
    },
  });

  return jsonResponse({
    success: true,
    task: {
      id: task.id,
      description: task.task_description,
      category: task.category,
      aiTool: task.ai_tool,
      timeWithoutAi: task.time_without_ai,
      timeWithAi: task.time_with_ai,
      timeSaved: savedHours,
      qualityRating: task.quality_rating,
      source: "ide",
      quarterId: task.quarter_id,
      project: task.project,
      createdAt: task.created_at,
    },
    approval: {
      id: approval.id,
      status: approval.approval_status,
      layer: approval.approval_layer,
      aiValidation: aiValidation
        ? {
            isValid: aiValidation.isValid,
            score: aiValidation.overallScore,
            reason: aiValidation.reason,
          }
        : null,
    },
  }, 201);
}

// ============================================================
// Main Router
// ============================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const route = getRoute(req);

  // Health check — no auth
  if (req.method === "GET" && (route === "/health" || route === "/health/")) {
    return handleHealth();
  }

  // All other routes require authentication
  const auth = await authenticateRequest(req);
  if ("error" in auth) {
    return errorResponse(auth.error as string, 401);
  }

  const { userClient, profile } = auth;

  try {
    // GET /context
    if (req.method === "GET" && (route === "/context" || route === "/context/")) {
      return await handleGetContext(userClient, profile);
    }

    // GET /my-tasks
    if (req.method === "GET" && (route === "/my-tasks" || route === "/my-tasks/")) {
      return await handleGetMyTasks(userClient, profile, req);
    }

    // POST / — Submit task
    if (req.method === "POST" && (route === "/" || route === "")) {
      return await handleSubmitTask(userClient, profile, req);
    }

    return errorResponse(`Unknown route: ${req.method} ${route}`, 404);
  } catch (err) {
    console.error("Unhandled error:", err);
    return errorResponse(`Internal server error: ${(err as Error).message || "Unknown"}`, 500);
  }
});
