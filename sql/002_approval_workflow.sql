-- ============================================================
-- EAS AI Adoption Dashboard — Phase 8 Approval Workflow
-- Database Migration for Approval System
-- ============================================================

-- ===================== PRACTICE SPOC MAPPING TABLE =====================
-- Maps practices to their SPOC (Single Point of Contact)
CREATE TABLE IF NOT EXISTS practice_spoc (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice TEXT NOT NULL REFERENCES practices(name),
  spoc_id UUID REFERENCES users(id),
  spoc_email TEXT,
  spoc_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(practice)
);

-- ===================== SUBMISSION APPROVALS TABLE =====================
-- Tracks approval workflow for tasks and accomplishments
CREATE TABLE IF NOT EXISTS submission_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_type TEXT NOT NULL CHECK (submission_type IN ('task', 'accomplishment')),
  submission_id UUID NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'ai_review', 'spoc_review', 'admin_review', 'approved', 'rejected')),
  approval_layer TEXT DEFAULT 'ai' CHECK (approval_layer IN ('ai', 'spoc', 'admin')),
  saved_hours NUMERIC(8,2) DEFAULT 0,
  
  -- AI Validation
  ai_validation_result JSONB DEFAULT NULL,
  ai_validation_failed BOOLEAN DEFAULT false,
  ai_failure_reason TEXT,
  ai_reviewed_at TIMESTAMPTZ,
  ai_reviewed_by TEXT,
  
  -- SPOC Approval
  spoc_id UUID REFERENCES users(id),
  spoc_approved BOOLEAN DEFAULT false,
  spoc_approval_notes TEXT,
  spoc_reviewed_at TIMESTAMPTZ,
  
  -- Admin Approval
  admin_id UUID REFERENCES users(id),
  admin_approved BOOLEAN DEFAULT false,
  admin_approval_notes TEXT,
  admin_reviewed_at TIMESTAMPTZ,
  
  -- Final approval
  approved_by UUID REFERENCES users(id),
  approved_by_name TEXT,
  approved_by_email TEXT,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  
  -- Metadata
  practice TEXT REFERENCES practices(name),
  submitted_by UUID REFERENCES users(id),
  submitted_by_email TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ===================== MODIFY TASKS TABLE =====================
-- Add approval-related columns to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_id UUID REFERENCES submission_approvals(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approved_by_name TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'ai_review', 'spoc_review', 'admin_review', 'approved', 'rejected'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_notes TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submitted_for_approval BOOLEAN DEFAULT false;

-- ===================== MODIFY ACCOMPLISHMENTS TABLE =====================
-- Add approval-related columns to accomplishments table
ALTER TABLE accomplishments ADD COLUMN IF NOT EXISTS approval_id UUID REFERENCES submission_approvals(id);
ALTER TABLE accomplishments ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE accomplishments ADD COLUMN IF NOT EXISTS approved_by_name TEXT;
ALTER TABLE accomplishments ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'ai_review', 'spoc_review', 'admin_review', 'approved', 'rejected'));
ALTER TABLE accomplishments ADD COLUMN IF NOT EXISTS approval_notes TEXT;
ALTER TABLE accomplishments ADD COLUMN IF NOT EXISTS submitted_for_approval BOOLEAN DEFAULT false;

-- ===================== INDEXES =====================
CREATE INDEX IF NOT EXISTS idx_submission_approvals_submission ON submission_approvals(submission_type, submission_id);
CREATE INDEX IF NOT EXISTS idx_submission_approvals_status ON submission_approvals(approval_status);
CREATE INDEX IF NOT EXISTS idx_submission_approvals_practice ON submission_approvals(practice);
CREATE INDEX IF NOT EXISTS idx_submission_approvals_spoc ON submission_approvals(spoc_id);
CREATE INDEX IF NOT EXISTS idx_submission_approvals_admin ON submission_approvals(admin_id);
CREATE INDEX IF NOT EXISTS idx_submission_approvals_submitted_by ON submission_approvals(submitted_by);
CREATE INDEX IF NOT EXISTS idx_submission_approvals_created ON submission_approvals(created_at);

CREATE INDEX IF NOT EXISTS idx_practice_spoc_practice ON practice_spoc(practice);
CREATE INDEX IF NOT EXISTS idx_practice_spoc_spoc ON practice_spoc(spoc_id);

CREATE INDEX IF NOT EXISTS idx_tasks_approval_status ON tasks(approval_status);
CREATE INDEX IF NOT EXISTS idx_tasks_submitted_for_approval ON tasks(submitted_for_approval);
CREATE INDEX IF NOT EXISTS idx_accomplishments_approval_status ON accomplishments(approval_status);

-- ===================== UPDATED_AT TRIGGERS =====================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_submission_approvals_updated_at BEFORE UPDATE ON submission_approvals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_practice_spoc_updated_at BEFORE UPDATE ON practice_spoc FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ===================== ROW-LEVEL SECURITY =====================
ALTER TABLE submission_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_spoc ENABLE ROW LEVEL SECURITY;

-- ---- SUBMISSION APPROVALS POLICIES ----
-- Admin: full access
CREATE POLICY IF NOT EXISTS "submission_approvals_admin_all" ON submission_approvals FOR ALL USING (get_user_role() = 'admin');

-- All authenticated users can read all approvals
CREATE POLICY IF NOT EXISTS "submission_approvals_read_all_authenticated" ON submission_approvals FOR SELECT USING (auth.uid() IS NOT NULL);

-- Users can insert approvals for submissions in their practice
CREATE POLICY IF NOT EXISTS "submission_approvals_contributor_insert" ON submission_approvals FOR INSERT WITH CHECK (
  get_user_role() = 'contributor' AND practice = get_user_practice()
);

-- SPOC can update approvals in their practice
CREATE POLICY IF NOT EXISTS "submission_approvals_spoc_update" ON submission_approvals FOR UPDATE USING (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);

-- ---- PRACTICE SPOC POLICIES ----
-- Admin: full access
CREATE POLICY IF NOT EXISTS "practice_spoc_admin_all" ON practice_spoc FOR ALL USING (get_user_role() = 'admin');

-- All authenticated users can read
CREATE POLICY IF NOT EXISTS "practice_spoc_read_all" ON practice_spoc FOR SELECT USING (auth.uid() IS NOT NULL);

-- ===================== SEED SPOC DATA =====================
-- Map SPOCs to practices based on the existing data
INSERT INTO practice_spoc (practice, spoc_name) VALUES
  ('BFSI', 'Omar Ibrahim'),
  ('CES', 'Norah Al Wabel'),
  ('ERP Solutions', 'Reham Ibrahim'),
  ('EPS', 'Yousef Milhem'),
  ('GRC', 'Mohamed Essam'),
  ('EPCS', 'Ahmed Shaheen')
ON CONFLICT (practice) DO NOTHING;

-- ===================== VIEWS FOR DASHBOARD =====================

-- View for pending approvals by approval layer
CREATE OR REPLACE VIEW pending_approvals AS
SELECT
  sa.id,
  sa.submission_type,
  sa.submission_id,
  sa.approval_status,
  sa.approval_layer,
  sa.saved_hours,
  sa.practice,
  sa.submitted_by_email,
  sa.spoc_id,
  sa.admin_id,
  CASE
    WHEN sa.approval_status = 'pending' AND sa.saved_hours >= 15 THEN 'admin'
    WHEN sa.approval_status = 'ai_review' THEN 'ai'
    WHEN sa.approval_status = 'spoc_review' THEN 'spoc'
    WHEN sa.approval_status = 'admin_review' THEN 'admin'
    ELSE NULL
  END AS awaiting_from,
  sa.submitted_at,
  sa.created_at
FROM submission_approvals sa
WHERE sa.approval_status NOT IN ('approved', 'rejected')
ORDER BY sa.saved_hours DESC, sa.submitted_at ASC;

-- View for employee task approval status
CREATE OR REPLACE VIEW employee_task_approvals AS
SELECT
  t.id AS task_id,
  t.employee_name,
  t.employee_email,
  t.task_description,
  t.practice,
  t.time_saved,
  t.approval_status,
  sa.approval_layer,
  sa.spoc_id,
  sa.admin_id,
  sa.approved_by_name,
  sa.submitted_at,
  sa.approved_at,
  CASE
    WHEN t.approval_status = 'approved' THEN 'Approved'
    WHEN t.approval_status = 'rejected' THEN 'Rejected'
    WHEN t.approval_status = 'pending' AND sa.saved_hours >= 15 THEN 'Pending Admin Approval'
    WHEN t.approval_status = 'ai_review' THEN 'Pending AI Review'
    WHEN t.approval_status = 'spoc_review' THEN 'Pending SPOC Review'
    WHEN t.approval_status = 'admin_review' THEN 'Pending Admin Review'
    ELSE 'Pending'
  END AS status_display,
  CASE
    WHEN t.approval_status IN ('pending', 'ai_review', 'spoc_review', 'admin_review') THEN TRUE
    ELSE FALSE
  END AS is_pending
FROM tasks t
LEFT JOIN submission_approvals sa ON sa.id = t.approval_id
ORDER BY t.created_at DESC;

-- View for SPOC approval workload
CREATE OR REPLACE VIEW spoc_approval_workload AS
SELECT
  sa.spoc_id,
  u.name AS spoc_name,
  u.practice,
  COALESCE(COUNT(CASE WHEN sa.approval_status = 'spoc_review' THEN 1 END), 0) AS pending_review,
  COALESCE(COUNT(CASE WHEN sa.approval_status != 'pending' AND sa.approval_status != 'ai_review' THEN 1 END), 0) AS total_reviewed,
  COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(sa.spoc_reviewed_at, now()) - sa.submitted_at)) / 3600), 0) AS avg_review_hours
FROM submission_approvals sa
JOIN users u ON u.id = sa.spoc_id
GROUP BY sa.spoc_id, u.name, u.practice;

-- View for admin approval dashboard
CREATE OR REPLACE VIEW admin_approval_dashboard AS
SELECT
  COUNT(CASE WHEN approval_status IN ('pending', 'admin_review') THEN 1 END) AS pending_admin_approvals,
  COUNT(CASE WHEN approval_status = 'ai_review' THEN 1 END) AS pending_ai_review,
  COUNT(CASE WHEN approval_status = 'spoc_review' THEN 1 END) AS pending_spoc_review,
  COUNT(CASE WHEN approval_status = 'approved' THEN 1 END) AS total_approved,
  COUNT(CASE WHEN approval_status = 'rejected' THEN 1 END) AS total_rejected,
  SUM(CASE WHEN approval_status = 'approved' THEN saved_hours ELSE 0 END) AS total_hours_saved
FROM submission_approvals;
