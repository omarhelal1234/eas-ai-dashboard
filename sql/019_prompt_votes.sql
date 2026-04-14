-- ============================================================
-- 019_prompt_votes.sql
-- Community prompt submissions + like/dislike voting system
-- Allows any authenticated user to submit prompts and vote.
-- Prompts with ≥10 dislikes are hard-deleted.
-- Prompts with ≥10 likes are highlighted in the UI.
-- ============================================================

-- ============================================================
-- 1. prompt_votes table
-- ============================================================
CREATE TABLE IF NOT EXISTS prompt_votes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id  UUID NOT NULL REFERENCES prompt_library(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  vote_type  TEXT NOT NULL CHECK (vote_type IN ('like', 'dislike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, user_id)
);

-- Indexes for fast aggregation and lookups
CREATE INDEX IF NOT EXISTS idx_prompt_votes_prompt  ON prompt_votes(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_votes_user    ON prompt_votes(user_id);

-- ============================================================
-- 2. RLS on prompt_votes
-- ============================================================
ALTER TABLE prompt_votes ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read all votes (needed for counts)
CREATE POLICY prompt_votes_select ON prompt_votes
  FOR SELECT TO authenticated
  USING (true);

-- Users can insert their own votes
CREATE POLICY prompt_votes_insert ON prompt_votes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own votes (change like ↔ dislike)
CREATE POLICY prompt_votes_update ON prompt_votes
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own votes (toggle off)
CREATE POLICY prompt_votes_delete ON prompt_votes
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Admins have full access
CREATE POLICY prompt_votes_admin_all ON prompt_votes
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- ============================================================
-- 3. New RLS policy: allow all authenticated users to INSERT prompts
-- ============================================================
CREATE POLICY prompt_library_insert_authenticated ON prompt_library
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Allow users to delete their own community-submitted prompts
CREATE POLICY prompt_library_delete_own ON prompt_library
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by);

-- ============================================================
-- 4. RPC: vote_prompt — upsert a vote, or remove it (toggle)
--    If p_vote_type IS NULL, removes the vote.
--    After vote change, checks if dislike_count >= 10 → hard-delete prompt.
--    Returns JSON: { like_count, dislike_count, user_vote }
-- ============================================================
CREATE OR REPLACE FUNCTION vote_prompt(
  p_prompt_id UUID,
  p_vote_type TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
  v_like_count  INT;
  v_dislike_count INT;
  v_user_vote TEXT;
BEGIN
  -- Validate vote type
  IF p_vote_type IS NOT NULL AND p_vote_type NOT IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'Invalid vote_type: must be like, dislike, or null';
  END IF;

  -- Remove vote if NULL
  IF p_vote_type IS NULL THEN
    DELETE FROM prompt_votes
    WHERE prompt_id = p_prompt_id AND user_id = auth.uid();
  ELSE
    -- Upsert: insert or update on conflict
    INSERT INTO prompt_votes (prompt_id, user_id, vote_type)
    VALUES (p_prompt_id, auth.uid(), p_vote_type)
    ON CONFLICT (prompt_id, user_id)
    DO UPDATE SET vote_type = EXCLUDED.vote_type;
  END IF;

  -- Compute counts
  SELECT
    COALESCE(SUM(CASE WHEN vote_type = 'like' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN vote_type = 'dislike' THEN 1 ELSE 0 END), 0)
  INTO v_like_count, v_dislike_count
  FROM prompt_votes
  WHERE prompt_id = p_prompt_id;

  -- Get user's current vote
  SELECT vote_type INTO v_user_vote
  FROM prompt_votes
  WHERE prompt_id = p_prompt_id AND user_id = auth.uid();

  -- Hard-delete prompt if dislikes >= 10
  IF v_dislike_count >= 10 THEN
    DELETE FROM prompt_library WHERE id = p_prompt_id;
    RETURN json_build_object(
      'deleted', true,
      'like_count', v_like_count,
      'dislike_count', v_dislike_count,
      'user_vote', null
    );
  END IF;

  RETURN json_build_object(
    'deleted', false,
    'like_count', v_like_count,
    'dislike_count', v_dislike_count,
    'user_vote', v_user_vote
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- ============================================================
-- 5. RPC: get_prompt_vote_counts — aggregate likes/dislikes per prompt
--    Returns a table of prompt_id, like_count, dislike_count
-- ============================================================
CREATE OR REPLACE FUNCTION get_prompt_vote_counts()
RETURNS TABLE (
  prompt_id     UUID,
  like_count    INT,
  dislike_count INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pv.prompt_id,
    COALESCE(SUM(CASE WHEN pv.vote_type = 'like' THEN 1 ELSE 0 END)::INT, 0) AS like_count,
    COALESCE(SUM(CASE WHEN pv.vote_type = 'dislike' THEN 1 ELSE 0 END)::INT, 0) AS dislike_count
  FROM prompt_votes pv
  GROUP BY pv.prompt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE
   SET search_path = public;

-- ============================================================
-- 6. RPC: add_community_prompt — any user can submit a prompt
--    Returns the newly inserted prompt row as JSON
-- ============================================================
CREATE OR REPLACE FUNCTION add_community_prompt(
  p_role       TEXT,
  p_role_label TEXT,
  p_category   TEXT,
  p_prompt_text TEXT
)
RETURNS JSON AS $$
DECLARE
  v_row prompt_library%ROWTYPE;
BEGIN
  INSERT INTO prompt_library (role, role_label, category, prompt_text, sort_order, is_active, created_by)
  VALUES (p_role, p_role_label, p_category, p_prompt_text, 999, true, auth.uid())
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'id',         v_row.id,
    'role',       v_row.role,
    'role_label', v_row.role_label,
    'category',   v_row.category,
    'prompt_text', v_row.prompt_text,
    'sort_order', v_row.sort_order,
    'copy_count', v_row.copy_count,
    'created_by', v_row.created_by,
    'created_at', v_row.created_at
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;
