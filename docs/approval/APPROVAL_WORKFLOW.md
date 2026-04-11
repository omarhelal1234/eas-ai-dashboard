# EAS AI Adoption Dashboard - Approval Workflow Guide

## Overview

The approval workflow ensures all task submissions are properly validated and approved before being recorded. This document outlines how the workflow works for employees, SPOCs (Single Point of Contact), and admins.

## Workflow Process

### 1. Employee Submission
- Employees submit their AI-powered tasks through the dashboard
- They provide:
  - Task description
  - Time without AI
  - Time with AI (system calculates saved hours)
  - AI tool used
  - Category and other metadata

### 2. Approval Routing Rules

The task is routed through the approval workflow based on these rules (in order of priority):

#### **Rule 1: High Savings (≥15 hours)**
- **Route To:** Admin (Omar Ibrahim for BFSI)
- **Reason:** High impact tasks require top-level approval
- **Status:** Pending Admin Review

#### **Rule 2: AI Validation Failure**
- **Route To:** Direct SPOC (manager for the employee's practice)
- **Reason:** AI couldn't validate the submission, human review needed
- **Status:** Pending SPOC Review
- **Note:** If SPOC not found, escalates to Admin

#### **Rule 3: Low Savings (<15 hours) & AI Passes**
- **Route To:** AI Review → SPOC Review
- **Reason:** Standard workflow for routine submissions
- **Statuses:** 
  1. AI Review (automatic)
  2. SPOC Review (if AI passes)

### 3. Approval Status Stages

| Status | Description | Assigned To |
|--------|-------------|-------------|
| 🔄 AI Review | Automated validation in progress | AI System |
| 👤 SPOC Review | Waiting for manager/SPOC approval | Direct SPOC |
| ⏳ Admin Review | Waiting for final admin approval | Admin |
| ✅ Approved | Task approved and recorded | - |
| ❌ Rejected | Task rejected with reason | - |

### 4. Approval Tracking

#### For Employees
- View all submitted tasks at **My Work → Task Status**
- See current approval status and who it's pending with
- Track approval timeline with dates
- View rejection reasons if applicable

#### For SPOCs & Admins
- Access **Approvals** tab in admin panel
- See all pending approvals in their workload
- Filter by:
  - Status (Pending, AI Review, SPOC Review, Admin Review, Approved, Rejected)
  - Practice
  - Date range
- Approve/Reject with optional notes

### 5. SPOC (Single Point of Contact) Configuration

Each practice has one SPOC who handles approvals for that practice:

| Practice | SPOC |
|----------|------|
| BFSI | Omar Ibrahim |
| CES | Norah Al Wabel |
| ERP Solutions | Reham Ibrahim |
| EPS | Yousef Milhem |
| GRC | Mohamed Essam |
| EPCS | Ahmed Shaheen |

**Note:** Omar Ibrahim is both SPOC for BFSI and also the Admin, so he gets notifications for both his practice submissions AND high-value submissions (≥15 hours) from all practices.

## Database Schema

### Tables

#### `submission_approvals`
Tracks the approval workflow for each task/accomplishment

```sql
- id (UUID): Unique identifier
- submission_type: 'task' or 'accomplishment'
- submission_id: Links to the actual task/accomplishment
- approval_status: Current status
- approval_layer: 'ai', 'spoc', or 'admin'
- saved_hours: Time saved by AI
- ai_validation_result: AI validation data
- ai_validation_failed: Boolean flag
- spoc_id: SPOC user ID if routed to SPOC
- admin_id: Admin user ID if routed to admin
- approved_by: User who approved
- approval_notes: Comments during approval
- created_at/updated_at: Timestamps
```

#### `tasks` (Updated)
Added approval-related fields:

```sql
- approval_id: Links to submission_approvals record
- approved_by: User who approved
- approved_by_name: Name of approver
- approval_status: Current status
- approval_notes: Any notes
- submitted_for_approval: Boolean flag
```

#### `practice_spoc`
Maps practices to their SPOCs

```sql
- id (UUID): Unique identifier
- practice: Practice name
- spoc_id: User ID of SPOC
- spoc_name: SPOC's name
- spoc_email: SPOC's email
- is_active: Boolean flag
```

## API Functions

### Database Functions (in `db.js`)

```javascript
// Get SPOC for a practice
EAS_DB.getSpocForPractice(practice)

// Determine routing based on business rules
EAS_DB.determineApprovalRouting(practice, savedHours, aiValidationFailed)

// Create approval workflow entry
EAS_DB.createSubmissionApproval(submissionType, submissionId, savedHours, aiValidationResult, practice, aiValidationFailed)

// Fetch pending approvals
EAS_DB.fetchPendingApprovals(userRole, userPractice, userId)

// Fetch approval history
EAS_DB.fetchApprovalHistory(userRole, userPractice, limit)

// Approve a submission
EAS_DB.approveSubmission(approvalId, approvalNotes)

// Reject a submission
EAS_DB.rejectSubmission(approvalId, rejectionReason)

// Fetch employee's task approvals
EAS_DB.fetchEmployeeTaskApprovals(employeeEmail)
```

## User Interface

### Admin Panel - Approvals Tab

Located at: Admin Panel → Approvals

**Features:**
- Unified approval dashboard
- Filters by status, practice, and search
- Two sections:
  1. **Pending Approvals** - Tasks awaiting action
  2. **Approval History** - Completed (approved/rejected) approvals
- Action buttons to review, approve, or reject

### Employee Task Status Page

Located at: My Work → Task Status (or separate page)

**Features:**
- Personal statistics (Total, Approved, Pending, Rejected)
- Table of all submitted tasks
- Status badges with visual indicators
- Approval timeline with submission and approval dates
- Filter by status and search capability

## Error Handling

### AI Validation Failure
If AI validation fails:
1. Task is marked as `ai_validation_failed = true`
2. Automatically routed to SPOC for the practice
3. SPOC sees failure reason in approval details
4. SPOC can approve based on manual review

### Practice Without SPOC
If practice doesn't have a valid SPOC:
1. Task escalates to Admin
2. Admin is notified
3. Task status shows "Admin Review"

## Best Practices

1. **For Employees:**
   - Check Task Status regularly to see approval progress
   - Resubmit if rejected with corrections
   - Note rejection reasons to improve future submissions

2. **For SPOCs:**
   - Review submissions timely (target: within 24 hours)
   - Provide feedback for rejected tasks
   - Use approval notes to communicate decision rationale

3. **For Admins:**
   - Monitor high-value submissions (≥15 hours)
   - Ensure SPOCs are actively reviewing
   - Periodically audit approval times and trends

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Task stuck in "AI Review" | Check AI service status; may need manual SPOC approval |
| SPOC not receiving approvals | Verify SPOC is configured in practice_spoc table |
| Employee can't see status | Ensure they have contributor role and used correct email |
| Approval takes too long | Check with SPOC or escalate to admin |

## Future Enhancements

- Automated reminders for pending approvals
- Mobile notifications for new approvals
- Bulk approval actions
- Approval SLA tracking
- Integration with calendar for approval deadlines
- Email notifications on approval status changes
