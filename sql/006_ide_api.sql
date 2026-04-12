-- ============================================================
-- EAS AI Adoption Dashboard — Phase 10: IDE Task Logger API
-- Adds 'source' column to tasks for tracking submission origin
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- ===================== SCHEMA CHANGES =====================

-- Add source column to tasks table to track where the task was submitted from
-- Values: 'web' (default, existing tasks), 'ide' (VS Code extension), 'api' (direct API)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web'
  CHECK (source IN ('web', 'ide', 'api'));

-- Add source column to accomplishments table for consistency
ALTER TABLE accomplishments
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web'
  CHECK (source IN ('web', 'ide', 'api'));

-- ===================== INDEXES =====================

-- Index for filtering tasks by source (analytics queries)
CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);

-- Composite index for common IDE query: user's recent tasks
CREATE INDEX IF NOT EXISTS idx_tasks_logged_by_created
  ON tasks(logged_by, created_at DESC);

-- ===================== COMMENTS =====================

COMMENT ON COLUMN tasks.source IS 'Submission origin: web (dashboard), ide (VS Code extension), api (direct API call)';
COMMENT ON COLUMN accomplishments.source IS 'Submission origin: web (dashboard), ide (VS Code extension), api (direct API call)';

-- ===================== RLS NOTES =====================
-- No RLS changes needed — existing policies on tasks/accomplishments
-- already handle authenticated inserts, reads, and role-based access.
-- The Edge Function uses the user's JWT (not service role) for data mutations,
-- so all existing RLS policies apply automatically.
