-- ============================================================
-- EAS AI Adoption Dashboard — Reported Issues / Blockers
-- Migration 011: Issues & blockers tracking for contributors
-- ============================================================

-- ===================== REPORTED ISSUES TABLE =====================

CREATE TABLE IF NOT EXISTS reported_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  ai_tool TEXT,
  practice TEXT NOT NULL REFERENCES practices(name),
  reported_by UUID REFERENCES users(id),
  reported_by_name TEXT,
  reported_by_email TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  resolution TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Updated_at trigger
CREATE TRIGGER trg_reported_issues_updated_at
  BEFORE UPDATE ON reported_issues
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX idx_reported_issues_practice ON reported_issues(practice);
CREATE INDEX idx_reported_issues_status ON reported_issues(status);
CREATE INDEX idx_reported_issues_reported_by ON reported_issues(reported_by);
CREATE INDEX idx_reported_issues_created ON reported_issues(created_at);

-- ===================== RLS POLICIES =====================

ALTER TABLE reported_issues ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY "issues_admin_all" ON reported_issues FOR ALL USING (get_user_role() = 'admin');

-- All authenticated users can read all issues
CREATE POLICY "issues_read_all_authenticated" ON reported_issues FOR SELECT USING (auth.uid() IS NOT NULL);

-- SPOC: write access to own practice
CREATE POLICY "issues_spoc_write" ON reported_issues FOR INSERT WITH CHECK (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);
CREATE POLICY "issues_spoc_update" ON reported_issues FOR UPDATE USING (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);
CREATE POLICY "issues_spoc_delete" ON reported_issues FOR DELETE USING (
  get_user_role() = 'spoc' AND practice = get_user_practice()
);

-- Contributor: insert for own practice, update own issues
CREATE POLICY "issues_contributor_insert" ON reported_issues FOR INSERT WITH CHECK (
  get_user_role() = 'contributor' AND practice = get_user_practice()
);
CREATE POLICY "issues_contributor_update" ON reported_issues FOR UPDATE USING (
  get_user_role() = 'contributor' AND reported_by = (SELECT id FROM users WHERE auth_id = auth.uid())
);
