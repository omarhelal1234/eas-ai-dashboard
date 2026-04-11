# Phase 8 Setup & Development Guide

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ installed
- Git access to repository
- OpenAI API account with credits
- Existing Supabase project

### 1. Configure Backend

```bash
# Navigate to server directory
cd server

# Install dependencies
npm install

# Create .env file
cp ../.env.example .env
```

Update `.env` with:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-key
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
PORT=3001
CORS_ORIGIN=http://localhost:3000
```

### 2. Run Backend Server

```bash
npm start
# or for development with auto-reload:
npm run dev
```

You should see:
```
✅ AI Adoption Agent endpoint running on http://localhost:3001
   POST /api/adoption-agent — Submit query
   POST /api/ai/generate-suggestions — Generate AI suggestions
   POST /api/ai/validate-submission — Validate task/accomplishment
   GET /api/adoption-agent/health — Health check
```

### 3. Test Backend Endpoints

```bash
# Test health check
curl http://localhost:3001/api/adoption-agent/health

# Test AI suggestions
curl -X POST http://localhost:3001/api/ai/generate-suggestions \
  -H "Content-Type: application/json" \
  -d '{
    "fieldType": "what",
    "currentText": "Used ChatGPT to automate API testing",
    "context": "Development phase"
  }'

# Test validation
curl -X POST http://localhost:3001/api/ai/validate-submission \
  -H "Content-Type: application/json" \
  -d '{
    "submissionType": "task",
    "savedHours": 8.5,
    "whyText": "Reduced manual testing overhead",
    "whatText": "Automated regression test suite using ChatGPT prompts for test case generation",
    "aiTool": "ChatGPT",
    "category": "QA"
  }'
```

### 4. Deploy to Supabase

```bash
# Apply database migrations
supabase db push

# Verify migrations
supabase migration list --remote
```

### 5. Frontend Integration

Phase 8 functionality is already integrated into `index.html`. It automatically:
- Loads `js/phase8-submission.js`
- Initializes employee autocomplete
- Enables AI suggestions on forms
- Routes approvals based on saved hours

## 📋 Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anonymous key (safe to expose) |
| `OPENAI_API_KEY` | ✅ | OpenAI API key (keep in backend only) |
| `ANTHROPIC_API_KEY` | ✅ | Anthropic API key (keep in backend only) |
| `PORT` | ⚠️ | Backend port (default: 3001) |
| `CORS_ORIGIN` | ⚠️ | Allowed CORS origins (comma-separated) |

### Supabase Setup

Ensure these tables exist:
- `copilot_users` — List of licensed users
- `submission_approvals` — Approval workflow tracking (auto-created)
- `tasks` — Task log (extended with approval columns)
- `accomplishments` — Accomplishment log (extended with approval columns)

## 🧪 Testing

### Unit Tests

Create `server/__tests__/api.test.js`:

```javascript
const assert = require('assert');
const fetch = require('node-fetch');

const BASE = 'http://localhost:3001';

describe('Phase 8 API', () => {
  it('generates AI suggestions', async () => {
    const res = await fetch(`${BASE}/api/ai/generate-suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fieldType: 'why',
        currentText: 'Test text'
      })
    });
    assert(res.status === 200);
    const data = await res.json();
    assert(data.suggestions.length === 3);
  });

  it('validates submissions', async () => {
    const res = await fetch(`${BASE}/api/ai/validate-submission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionType: 'task',
        savedHours: 10,
        whyText: 'To reduce manual effort',
        whatText: 'Automated workflow using ChatGPT',
        aiTool: 'ChatGPT',
        category: 'automation'
      })
    });
    assert(res.status === 200);
    const data = await res.json();
    assert('validation' in data);
  });
});
```

Run tests:
```bash
npm test
```

### Integration Testing

1. **Test Employee Autocomplete:**
   - Open dashboard Task form
   - Start typing employee name
   - Verify dropdown appears with Copilot users
   - Select one — verify name and email populate practice

2. **Test AI Suggestions:**
   - Click "Get AI Suggestions" on task description
   - Verify 3 suggestions appear
   - Select one — verify text updates

3. **Test Saved Hours Calculation:**
   - Enter time without AI: 10
   - Enter time with AI: 4
   - Verify saved hours displays: 6.0h

4. **Test Small Task (< 15h) Approval:**
   - Log task with 8h saved
   - Submit
   - Monitor approval_status in Supabase
   - If AI validates: should auto-approve
   - If AI rejects: should route to SPOC

5. **Test Large Task (≥ 15h) Approval:**
   - Log task with 20h saved
   - Submit
   - Verify routed directly to Omar/Admin
   - Admin approves from dashboard

6. **Test Admin Bypass:**
   - Admin checks "Skip Approval Workflow"
   - Submit task
   - Verify approval_status = 'approved' immediately

## 🐛 Debugging

### Check Backend Logs

```bash
# Terminal 1: Backend
npm start

# Terminal 2: Check health
curl http://localhost:3001/api/adoption-agent/health

# Watch for errors in Terminal 1
```

### Test Browser Console Issues

Open `index.html` in browser. Press F12:

```javascript
// Check if Phase8 is loaded
console.log(Phase8);

// Test employee autocomplete
Phase8.initEmployeeAutocomplete('f-employee', 'f-practice');

// Test saved hours calculation
Phase8.initSavedHoursCalculation('f-time-without', 'f-time-with', 'f-saved-display');

// Get current submission state
console.log(Phase8.getCurrentSubmission());
```

### Common Issues

**Issue:** 401 Unauthorized from Supabase
```
Solution: Verify SUPABASE_ANON_KEY is correct
```

**Issue:** 404 /api/ai/generate-suggestions
```
Solution: Ensure backend is running on port 3001 and CORS is configured
```

**Issue:** OpenAI rate limit error (429)
```
Solution: Add rate limiting middleware to backend, or wait before retrying
```

**Issue:** AI API timeout (no response)
```
Solution: This is handled gracefully — falls back to SPOC approval for < 15h tasks
```

## 📊 Monitoring

### Check Approval Workflow Progress

```sql
-- See pending approvals
SELECT id, submission_type, saved_hours, approval_status, created_at
FROM submission_approvals
WHERE approval_status != 'approved'
ORDER BY created_at DESC;

-- See approval distribution
SELECT approval_status, COUNT(*) as count
FROM submission_approvals
GROUP BY approval_status;

-- See AI vs SPOC routing
SELECT 
  CASE WHEN saved_hours < 15 THEN 'AI' ELSE 'Admin' END as roof,
  COUNT(*) as count
FROM submission_approvals
GROUP BY roof;
```

### Metrics Dashboard

Once Phase 8 is fully deployed, monitor:
- **AI Validation Accuracy:** % of submissions that pass AI validation on first try
- **Approval Time:** Average time from submission to approval
- **False Rejection Rate:** % of submitted tasks that AI incorrectly rejects
- **SPOC Override Rate:** % of AI rejections that SPOC overrides (approves anyway)

## 🔐 Security Checklist

- [ ] API keys stored in `.env` (not in code)
- [ ] `.env` added to `.gitignore`
- [ ] RLS policies enable on `submission_approvals` table
- [ ] Only authenticated users can create submissions
- [ ] Only approvers can update approval status
- [ ] All inputs validated on backend
- [ ] XSS protection via DOMPurify on frontend
- [ ] CORS configured for trusted origins only
- [ ] Rate limiting on `/api/ai/` endpoints (todo)
- [ ] Audit logging for all approvals (todo)

## 📝 Next Steps

1. **Test the full workflow end-to-end**
2. **Monitor AI validation accuracy** for first 100 submissions
3. **Gather feedback from SPOC users** on approval experience
4. **Implement email notifications** for approval status changes
5. **Add audit trail** for all approvals
6. **Scale to 100% of users** after validation

## 📚 References

- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Anthropic Claude API](https://docs.anthropic.com)
- [Supabase Database Guide](https://supabase.com/docs/guides/database)
- [Phase 8 Implementation Plan](./PHASE_8_IMPLEMENTATION.md)

---

**Support:** Contact Omar Ibrahim with questions
**Last Updated:** April 11, 2026
