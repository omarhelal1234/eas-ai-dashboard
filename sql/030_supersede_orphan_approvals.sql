-- Migration 030: Auto-supersede orphan submission_approvals rows
--
-- Problem: when a contributor edits a task/accomplishment, the client tries to
-- delete prior non-terminal approval rows before creating a new one. If that
-- delete is blocked (RLS) or bypassed (bulk sync, alternate path), stale rows
-- linger in the SPOC queue even though the task itself is already approved or
-- pointing to a different approval_id.
--
-- Fix, in three parts:
--   1) One-shot cleanup of existing orphans.
--   2) BEFORE-INSERT trigger on submission_approvals: supersede any prior
--      non-terminal row for the same (submission_type, submission_id) so only
--      one active approval exists at a time, regardless of who deleted what.
--   3) AFTER-UPDATE trigger on tasks/accomplishments: when the parent row's
--      approval_id changes or it transitions to 'approved' (auto-approve path),
--      supersede any lingering non-terminal approval rows that no longer match.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. One-shot cleanup of existing orphans
-- ---------------------------------------------------------------------------

UPDATE submission_approvals sa
SET approval_status   = 'superseded',
    rejection_reason  = COALESCE(sa.rejection_reason,
                                 'Auto-superseded: task no longer references this approval')
FROM tasks t
WHERE sa.submission_type = 'task'
  AND sa.submission_id   = t.id
  AND sa.approval_status IN ('pending','spoc_review','admin_review')
  AND (t.approval_status = 'approved' OR t.approval_id IS DISTINCT FROM sa.id);

UPDATE submission_approvals sa
SET approval_status   = 'superseded',
    rejection_reason  = COALESCE(sa.rejection_reason,
                                 'Auto-superseded: accomplishment no longer references this approval')
FROM accomplishments a
WHERE sa.submission_type = 'accomplishment'
  AND sa.submission_id   = a.id
  AND sa.approval_status IN ('pending','spoc_review','admin_review')
  AND (a.approval_status = 'approved' OR a.approval_id IS DISTINCT FROM sa.id);

-- ---------------------------------------------------------------------------
-- 2. BEFORE-INSERT on submission_approvals: retire prior non-terminal rows
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION supersede_prior_submission_approvals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE submission_approvals
  SET approval_status  = 'superseded',
      rejection_reason = COALESCE(rejection_reason,
                                  'Auto-superseded by a newer approval submission')
  WHERE submission_type = NEW.submission_type
    AND submission_id   = NEW.submission_id
    AND approval_status IN ('pending','spoc_review','admin_review')
    AND id <> NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sa_supersede_prior ON submission_approvals;
CREATE TRIGGER trg_sa_supersede_prior
AFTER INSERT ON submission_approvals
FOR EACH ROW
EXECUTE FUNCTION supersede_prior_submission_approvals();

-- ---------------------------------------------------------------------------
-- 3. AFTER-UPDATE on tasks / accomplishments: supersede stale approval rows
--    when the parent row's approval_id or approval_status moves on.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION supersede_orphan_approvals_for_submission()
RETURNS TRIGGER AS $$
DECLARE
  v_type TEXT := TG_ARGV[0];
BEGIN
  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     OR NEW.approval_id  IS DISTINCT FROM OLD.approval_id THEN
    UPDATE submission_approvals sa
    SET approval_status  = 'superseded',
        rejection_reason = COALESCE(sa.rejection_reason,
                                    'Auto-superseded: parent row no longer references this approval')
    WHERE sa.submission_type = v_type
      AND sa.submission_id   = NEW.id
      AND sa.approval_status IN ('pending','spoc_review','admin_review')
      AND (NEW.approval_id IS NULL OR sa.id <> NEW.approval_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_tasks_supersede_orphan_approvals ON tasks;
CREATE TRIGGER trg_tasks_supersede_orphan_approvals
AFTER UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION supersede_orphan_approvals_for_submission('task');

DROP TRIGGER IF EXISTS trg_accomplishments_supersede_orphan_approvals ON accomplishments;
CREATE TRIGGER trg_accomplishments_supersede_orphan_approvals
AFTER UPDATE ON accomplishments
FOR EACH ROW
EXECUTE FUNCTION supersede_orphan_approvals_for_submission('accomplishment');

COMMIT;
