// ============================================================
// EAS Task Logger — API Client Module
// Wrapper around the ide-task-log Edge Function
// ============================================================

import * as vscode from 'vscode';
import { getAccessToken } from './auth';

// ---- Types ----

export interface EasContext {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    practice: string;
  };
  activeQuarter: {
    id: string;
    label: string;
    isLocked: boolean;
  } | null;
  quarters: Array<{
    id: string;
    label: string;
    isActive: boolean;
    isLocked: boolean;
  }>;
  categories: string[];
  aiTools: Array<{
    value: string;
    isLicensed: boolean;
  }>;
  projects: Array<{
    name: string;
    code: string;
    customer: string;
  }>;
}

export interface TaskSubmission {
  taskDescription: string;
  category: string;
  aiTool: string;
  timeWithoutAi: number;
  timeWithAi: number;
  qualityRating?: number;
  project?: string;
  projectCode?: string;
  promptUsed?: string;
  weekNumber?: number;
  notes?: string;
  quarterId?: string;
}

export interface TaskSubmitResult {
  success: boolean;
  warning?: string;
  task: {
    id: string;
    description: string;
    category: string;
    aiTool: string;
    timeWithoutAi: number;
    timeWithAi: number;
    timeSaved: number;
    qualityRating: number | null;
    source: string;
    quarterId: string;
    project: string | null;
    createdAt: string;
  };
  approval?: {
    id: string;
    status: string;
    layer: string;
    aiValidation?: {
      isValid: boolean;
      score: number;
      reason: string;
    } | null;
  };
}

export interface MyTask {
  id: string;
  description: string;
  category: string;
  aiTool: string;
  timeWithoutAi: number;
  timeWithAi: number;
  timeSaved: number;
  efficiency: number;
  qualityRating: number | null;
  approvalStatus: string;
  source: string;
  quarterId: string;
  project: string | null;
  createdAt: string;
  approval: Record<string, unknown> | null;
}

export interface MyTasksResponse {
  tasks: MyTask[];
  total: number;
  limit: number;
}

// ---- API Client ----

function getBaseUrl(): string {
  const config = vscode.workspace.getConfiguration('eas');
  const supabaseUrl = config.get<string>('supabaseUrl') || 'https://apcfnzbiylhgiutcjigg.supabase.co';
  return `${supabaseUrl}/functions/v1/ide-task-log`;
}

/**
 * Make an authenticated request to the IDE Task Log Edge Function.
 * Handles token refresh and error reporting.
 */
async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {}
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated. Please sign in first.');
  }

  const url = `${getBaseUrl()}${path}`;
  const method = options.method || 'GET';

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (options.body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);

  if (response.status === 401) {
    throw new Error('Session expired. Please sign in again.');
  }

  const data = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const errorMsg = (data.error as string) || `API error (HTTP ${response.status})`;
    const details = (data.details as string[])?.join(', ');
    throw new Error(details ? `${errorMsg}: ${details}` : errorMsg);
  }

  return data as T;
}

/**
 * Fetch form context: active quarter, LOVs, user info, projects.
 */
export async function fetchContext(): Promise<EasContext> {
  return apiRequest<EasContext>('/context');
}

/**
 * Submit a task from the IDE.
 */
export async function submitTask(task: TaskSubmission): Promise<TaskSubmitResult> {
  return apiRequest<TaskSubmitResult>('/', {
    method: 'POST',
    body: task as unknown as Record<string, unknown>,
  });
}

/**
 * Fetch the authenticated user's recent tasks.
 */
export async function fetchMyTasks(limit = 20, quarter?: string): Promise<MyTasksResponse> {
  let path = `/my-tasks?limit=${limit}`;
  if (quarter) {
    path += `&quarter=${encodeURIComponent(quarter)}`;
  }
  return apiRequest<MyTasksResponse>(path);
}

/**
 * Health check (no auth required).
 */
export async function healthCheck(): Promise<{ status: string; version: string }> {
  const url = `${getBaseUrl()}/health`;
  const response = await fetch(url);
  return response.json() as Promise<{ status: string; version: string }>;
}
