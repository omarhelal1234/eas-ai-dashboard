-- Migration 013: Fix column name mismatch and approval linkage
-- Date: 2026-04-14
-- Issue: Code referenced 'submitted_for_approval' but actual column is 'submission_approved'
--        This caused all non-admin task/accomplishment updates to silently fail,
--        and approval_id linkage after insert to never be set.
-- Also: approval_status on tasks/accomplishments check constraint only allows
--        'pending', 'approved', 'rejected' — workflow states (spoc_review, admin_review)
--        must only live in submission_approvals table.

-- 1. Migrate legacy ai_review approval records to spoc_review
UPDATE submission_approvals
SET approval_status = 'spoc_review', approval_layer = 'spoc'
WHERE approval_status = 'ai_review';

-- 2. Fix any tasks where approval_id is null but a matching approval record exists
UPDATE tasks t
SET approval_id = sa.id,
    approval_status = CASE 
      WHEN sa.approval_status IN ('approved') THEN 'approved'
      WHEN sa.approval_status IN ('rejected') THEN 'rejected'
      ELSE 'pending'
    END
FROM submission_approvals sa
WHERE sa.submission_id = t.id 
  AND sa.submission_type = 'task'
  AND t.approval_id IS NULL;

-- 3. Fix any accomplishments where approval_id is null but a matching approval record exists
UPDATE accomplishments a
SET approval_id = sa.id,
    approval_status = CASE 
      WHEN sa.approval_status IN ('approved') THEN 'approved'
      WHEN sa.approval_status IN ('rejected') THEN 'rejected'
      ELSE 'pending'
    END
FROM submission_approvals sa
WHERE sa.submission_id = a.id 
  AND sa.submission_type = 'accomplishment'
  AND a.approval_id IS NULL;

-- 4. Fix tasks that show 'pending' but their approval is actually 'approved'
UPDATE tasks t
SET approval_status = 'approved'
FROM submission_approvals sa
WHERE sa.submission_id = t.id AND sa.submission_type = 'task'
  AND t.approval_id = sa.id
  AND t.approval_status = 'pending' AND sa.approval_status = 'approved';

-- 5. Fix accomplishments that show 'pending' but their approval is actually 'approved'
UPDATE accomplishments a
SET approval_status = 'approved'
FROM submission_approvals sa
WHERE sa.submission_id = a.id AND sa.submission_type = 'accomplishment'
  AND a.approval_id = sa.id
  AND a.approval_status = 'pending' AND sa.approval_status = 'approved';
