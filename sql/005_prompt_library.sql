-- ============================================================
-- 005_prompt_library.sql
-- Prompt Library table for the Guide Me section
-- Stores role-based AI prompts, editable by admins
-- ============================================================

-- Table
CREATE TABLE IF NOT EXISTS prompt_library (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role        TEXT NOT NULL,           -- pm, sa, ba, dev, dba, admin, dm
  role_label  TEXT NOT NULL,           -- Human-readable: "Project Manager", etc.
  category    TEXT NOT NULL,           -- "Sprint & Planning", "Code Quality", etc.
  prompt_text TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 1,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  copy_count  INT  NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_prompt_library_role       ON prompt_library(role);
CREATE INDEX IF NOT EXISTS idx_prompt_library_active     ON prompt_library(is_active);
CREATE INDEX IF NOT EXISTS idx_prompt_library_role_order ON prompt_library(role, sort_order);

-- Auto-update updated_at trigger
CREATE TRIGGER trg_prompt_library_updated
  BEFORE UPDATE ON prompt_library
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE prompt_library ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read active prompts
CREATE POLICY prompt_library_select ON prompt_library
  FOR SELECT TO authenticated
  USING (is_active = true);

-- Admins have full access
CREATE POLICY prompt_library_admin_all ON prompt_library
  FOR ALL TO authenticated
  USING  (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- RPC to increment copy count (fire-and-forget from client)
CREATE OR REPLACE FUNCTION increment_prompt_copy(p_prompt_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE prompt_library SET copy_count = copy_count + 1 WHERE id = p_prompt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
