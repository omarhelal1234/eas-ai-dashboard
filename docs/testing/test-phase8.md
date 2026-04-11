# Phase 8 Testing Plan

## Test Scenario

### 1. AI Suggestions Dropdown Test
**Expected Flow:**
- Navigate to Dashboard → "+ Log Task"
- Enter practice, employee, and task description
- Click "✨ AI Suggestions" button below task field
- **VERIFY:** Dropdown appears below input with 3 suggestions
- Click one suggestion
- **VERIFY:** Suggestion appears in task field

### 2. Approval Flow Test
**Expected Flow:**
- Create task with saved hours ≥ 15 → Routes to ADMIN approval
- Create task with saved hours < 15 → Routes to AI validator
- Submit task and check Tasks page for approval status
- **VERIFY:** Approval status badge shows correctly

### 3. Console Debugging Messages
Expected console logs:
- "Phase8 submission context set to: task"
- "showSuggestionsDropdown called: {suggestions: 3, fieldType: 'what', ...}"
- "Input element found: f-task" or "f-task-why"
- "Suggestions dropdown appended to: Task / Activity"

### 4. Edge Function Validation
- Check that Edge Functions are responding (check browser Network tab)
- Verify CORS headers are present in responses

## Testing Status
- [ ] Suggestions dropdown displays correctly
- [ ] Selection applies suggestion to field
- [ ] Approval status shows for saved tasks
- [ ] Console logs show correct debugging info
- [ ] No JavaScript errors in console

