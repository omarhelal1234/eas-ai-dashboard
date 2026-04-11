# Phase 8: Task/Accomplishment Submission with AI-Assisted Validation & Multi-Layer Approval

## Overview

Phase 8 introduces a comprehensive submission workflow with AI-assisted writing, smart validation, and tiered approval routing based on saved hours and user roles.

### Key Features Implemented

#### 1. **Backend Infrastructure (Node.js Express Server)**
✅ **Location:** `server/adoption-agent-endpoint.js`

**New Endpoints:**
- `POST /api/ai/generate-suggestions` — Generates 3 AI-powered suggestions for task/accomplishment "why" or "what" fields
- `POST /api/ai/validate-submission` — Validates submissions against: 
  - Min 2 hours saved
  - Mentions specific AI tool (ChatGPT, Copilot, Claude, etc.)
  - Mentions quantifiable metrics/outcomes
  - Quality assessment (overall coherence and professional tone)

**OpenAI Integration:**
- Uses GPT-4-Turbo for suggestion generation and validation
- Securely stores API key in backend (not exposed to frontend)
- Fallback handling if API is unresponsive

#### 2. **Database Schema (Supabase PostgreSQL)**
✅ **Location:** `submission_approvals` table + RLS policies

**New Table:**
```sql
submission_approvals (
  id UUID PRIMARY KEY
  submission_type TEXT ('task' | 'accomplishment')
  submission_id UUID (references task/accomplishment)
  approval_status TEXT ('pending' | 'ai_review' | 'spoc_review' | 'approved' | 'rejected')
  approval_layer TEXT ('ai' | 'spoc' | 'admin')
  saved_hours NUMERIC
  ai_validation_result JSONB (stores AI response)
  ai_suggestions JSONB (stores suggestion options)
  approver_id UUID (references auth.users)
  approver_name TEXT
  approval_notes TEXT
  rejected_reason TEXT
  created_at, updated_at TIMESTAMPTZ
)
```

**RLS Policies:**
- Users can view their own submissions
- Admins/SPOCs can view and approve submissions
- Only authorized approvers can update status

**Enhanced Tables:**
- `tasks` — Added: `approval_status`, `approval_id`, `requires_approval`
- `accomplishments` — Added: `approval_status`, `approval_id`, `requires_approval`

#### 3. **Database Layer (js/db.js)**
✅ **Location:** `js/db.js`

**New Functions:**
- `fetchCopilotUsersByPractice(practice)` — Returns Copilot users for autocomplete
- `createSubmissionApproval(submissionType, submissionId, savedHours)` — Creates approval workflow
- `fetchSubmissionApproval(submissionId, submissionType)` — Retrieves approval status
- `updateSubmissionApproval(approvalId, updates)` — Updates approval outcome
- `submitTaskWithApproval(taskData)` — Inserts task + creates approval workflow
- `submitAccomplishmentWithApproval(accData)` — Inserts accomplishment + creates approval workflow

#### 4. **Frontend Client Library (js/phase8-submission.js)**
✅ **Location:** `js/phase8-submission.js` (NEW FILE)

**Features:**

**A. Employee Autocomplete**
- Real-time searchable dropdown filtering Copilot users table
- Only shows users with 'access granted' status
- On blur, prompts user to register if employee not found
- Sets `data-selectedUserId` and `data-selectedEmail` attributes

**B. Saved Hours Real-Time Calculation**
- Listens to "time without AI" and "time with AI" inputs
- Calculates `saved = without - with` in decimal hours
- Updates display element in real-time on change/input events

**C. AI Suggestions Generator**
- User clicks "Get AI Suggestions" button
- Passes current field text + context to backend API
- Receives 3 professional alternatives
- Modal displays suggestions; user selects one to apply
- Supports both "why" (context field) and "what" (accomplishment field)

**D. AI Validation**
- Triggered before submission if saved_hours < 15
- Validates against rules: min 2h, mentions AI tool, quantifiable outcome
- Displays validation modal with:
  - ✅/⚠️ status  
  - Passed/failed rules breakdown
  - Overall score (0-100)
  - Actionable suggestions
- User can proceed despite warnings

**E. Multi-Layer Approval Routing**
```
Saved Hours < 15:
  1. AI Validator (if API responsive)
     → Approved: Mark as "approved"
     → Rejected: Send to SPOC
  2. SPOC Review (if AI rejects or AI unavailable)
     → Approved: Mark as "approved"
     → Rejected: Mark as "rejected" with reason

Saved Hours ≥ 15:
  1. Direct to Admin/Omar Ibrahim
     → Approved: Mark as "approved"
     → Rejected: Mark as "rejected" with reason

Admin Can Bypass:
  - Checkbox "Skip Approval Workflow"
  - Directly submits task without approval flow
```

**F. Approval Status Display**
- Badge shows current approval state: ⏳ Pending, 🤖 AI Reviewing, 👤 SPOC Reviewing, ✅ Approved, ❌ Rejected
- Color-coded: Orange (pending), Blue (AI), Purple (SPOC), Green (approved), Red (rejected)

#### 5. **Frontend UI Integration** 
⏳ **IN PROGRESS**

**Task Modal Enhancements:**
1. Add "Why" field (optional, 50+ word suggestion)
   - Button: "Get AI Suggestions" → calls `Phase8.getAISuggestions('why', text, context)`
   - Real-time validation

2. Add "Get AI Suggestions" buttons to:
   - Task description field ("what")
   - Accomplishment title field ("what")
   - Accomplishment details field ("why")

3. Add real-time saved hours display:
   - Format: "X.Xh saved"
   - Color: Green if > 0, gray if 0
   - Updates as user types

4. Add validation before submission:
   - If saved_hours < 15 → Call `Phase8.validateSubmission(...)`
   - Show results modal
   - Allow user to proceed even if warnings

5. Update modal title to reflect approval tier:
   - "Log Task (Will Auto-Route to SPOC)" if < 15h
   - "Log Task (Direct to Admin)" if ≥ 15h
   - "Log Task (Skip Approval)" if admin + checkbox

6. Add employee picker initialization:
   - On modal open: `Phase8.initEmployeeAutocomplete('f-employee', 'f-practice')`
   - On modal open: `Phase8.initSavedHoursCalculation('f-time-without', 'f-time-with', 'f-saved-hours-display')`

7. Add "Approve" / "Reject" buttons for SPOC/Admin in task table view:
   - Only visible for pending approvals
   - Click opens approval modal with notes
   - Calls `EAS_DB.updateSubmissionApproval(...)`

## Implementation Checklist

### Phase 8A: Backend API (✅ DONE)
- [x] Add OpenAI client initialization  
- [x] Create `/api/ai/generate-suggestions` endpoint
- [x] Create `/api/ai/validate-submission` endpoint
- [x] Add error handling and fallback behavior
- [x] Test endpoints locally

### Phase 8B: Database (✅ DONE)
- [x] Create `submission_approvals` table
- [x] Add RLS policies
- [x] Add foreign key columns to tasks/accomplishments
- [x] Create indexes for performance
- [x] Run Supabase advisors (security check)

### Phase 8C: Database Layer (✅ DONE)
- [x] Add `fetchCopilotUsersByPractice()` function
- [x] Add approval workflow functions
- [x] Add submission functions with approval integration
- [x] Update public API export

### Phase 8D: Frontend Client (✅ DONE)
- [x] Create `js/phase8-submission.js` module
- [x] Implement employee autocomplete
- [x] Implement saved hours calculation
- [x] Implement AI suggestions generator
- [x] Implement AI validation modal
- [x] Implement approval routing logic
- [x] Add to index.html via `<script>` tag

### Phase 8E: UI Integration (⏳ IN PROGRESS)
- [ ] Update `openModal('task')` to initialize Phase8 features
- [ ] Add "Get AI Suggestions" buttons to task/accomplishment forms
- [ ] Add real-time saved hours display
- [ ] Add validation before submission
- [ ] Add approval tier indicator in modal title
- [ ] Add employee picker
- [ ] Add approval action buttons to tables
- [ ] Test full workflow end-to-end

### Phase 8F: Notification System (⏳ PENDING)
- [ ] Create email template for approval notifications
- [ ] Integrate Supabase email (SendGrid)
- [ ] Send email on approval status change
- [ ] Add toast notifications in UI

### Phase 8G: Documentation & Testing
- [ ] Update BRD.md with Phase 8 requirements
- [ ] Update CODE_ARCHITECTURE.md with new schema/APIs
- [ ] Update IMPLEMENTATION_PLAN.md (Phase 8 status)
- [ ] Create test scenarios for approval routing
- [ ] Test AI fallback (API timeout/error)
- [ ] Test admin bypass
- [ ] Performance test approval queries

### Phase 8H: Deployment
- [ ] Deploy backend changes (npm install, update .env)
- [ ] Deploy database migrations to Supabase
- [ ] Commit all changes to Git
- [ ] Push to GitHub master
- [ ] Verify in production

## API Reference

### `POST /api/ai/generate-suggestions`

**Request:**
```json
{
  "fieldType": "why" | "what",
  "currentText": "existing text to improve",
  "context": "optional context JSON string"
}
```

**Response:**
```json
{
  "fieldType": "why",
  "suggestions": [
    "suggestion 1",
    "suggestion 2",
    "suggestion 3"
  ],
  "timestamp": "2026-04-11T..."
}
```

### `POST /api/ai/validate-submission`

**Request:**
```json
{
  "submissionType": "task" | "accomplishment",
  "savedHours": 8.5,
  "whyText": "reason for activity",
  "whatText": "what was accomplished",
  "aiTool": "ChatGPT",
  "category": "development"
}
```

**Response:**
```json
{
  "submissionType": "task",
  "validation": {
    "isValid": true | false,
    "passedRules": ["Min 2 hrs saved", "Mentions AI tool"],
    "failedRules": ["Mentions metrics"],
    "overallScore": 75,
    "reason": "Good submission with minor improvements",
    "suggestions": ["Add specific metric", "Mention time breakdown"]
  },
  "timestamp": "2026-04-11T..."
}
```

## Approval Workflow States

```
NEW SUBMISSION
│
├─ saved_hours < 15
│  ├─ AI Validator invoked
│  │  ├─ API responsive & validates ✅  → APPROVED
│  │  ├─ API responsive & fails ❌      → SPOC_REVIEW
│  │  └─ API timeout/error              → SPOC_REVIEW (fallback)
│  │
│  └─ SPOC Review
│     ├─ SPOC approves ✅ → APPROVED
│     └─ SPOC rejects ❌  → REJECTED
│
├─ saved_hours ≥ 15
│  └─ Admin/Omar Review
│     ├─ Approves ✅ → APPROVED
│     └─ Rejects ❌  → REJECTED
│
└─ Admin bypass
   └─ Directly → APPROVED (no workflow)
```

## Security Considerations

1. **API Key Protection:**
   - OpenAI API key stored in backend `.env` only
   - Never exposed to frontend JavaScript
   - Request validated with auth token

2. **RLS Policies:**
   - Users can only see their own submissions
   - Approvers (SPOC/Admin) can view assigned submissions
   - No cross-practice data leakage

3. **Input Validation:**
   - All fields validated on backend
   - XSS protection via DOMPurify
   - SQL injection prevented via Supabase client

4. **Rate Limiting:**
   - TODO: Add rate limiting on /api/ai endpoints to prevent abuse
   - TODO: Limit suggestions per user per day

## Testing Scenarios

### T1: Task < 15 hours → AI approves
1. Log task with 8h saved
2. Verify AI validator called
3. If valid → auto-approve
4. Check approval_status = 'approved'

### T2: Task < 15 hours → AI rejects → SPOC approves
1. Log task with 5h saved
2. Submit with vague description
3. AI validator rejects
4. Route to SPOC
5. SPOC approves with notes
6. Final status = 'approved'

### T3: Task ≥ 15 hours → Admin approval
1. Log task with 20h saved
2. Verify modal shows "Direct to Admin"
3. Submit
4. Approval routed to Omar Ibrahim
5. Omar approves
6. Verify final status

### T4: Employee autocomplete
1. Start typing employee name
2. Verify Copilot users dropdown appears
3. Select user
4. Verify name and practice auto-filled

### T5: AI suggestions
1. Enter partial task description
2. Click "Get AI Suggestions"
3. Receive 3 alternatives
4. Select one
5. Verify field updated
6. Submit with improved text

### T6: Admin bypass
1. Admin enables "Skip Approval"
2. Submit task
3. Verify approval_status = 'approved' immediately
4. Check no workflow entry created

## Next Steps

1. **Complete UI Integration** — Modify saveTask() and saveAccomplishment() to use Phase8 functions
2. **Add Approval Table View** — Show pending approvals in Admin panel with approve/reject buttons
3. **Email Notifications** — Integrate Supabase email for approval status updates
4. **Performance Testing** — Load test approval queries with 1000+ submissions
5. **User Documentation** — Add help text and tooltips in forms
6. **Gradual Rollout** — Enable for 10% users first, monitor approval rates

---

**Phase 8 Status:** 80% Complete — Backend & DB done, UI integration in progress
**Est. Completion:** ~8 hours remaining for testing and deployment
