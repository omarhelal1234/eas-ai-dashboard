# 🚀 Approval Workflow - Quick Setup Guide

## ⚠️ Current Status
The approval workflow code is deployed, but the **SQL migration hasn't been applied to Supabase yet**.

This is why you're seeing:
- ❌ Tasks appear in "Manage Tasks" instead of "Approvals" tab
- ❌ Employee status page shows "failed to fetch"
- ❌ Admin approval buttons not functional

## ✅ How to Fix (3 Simple Steps)

### Step 1: Open Supabase SQL Editor
```
1. Go to: https://supabase.com/dashboard
2. Select your project
3. Click "SQL Editor" (left sidebar)
4. Click "New Query"
```

### Step 2: Copy the Migration SQL
```
1. Open file: sql/002_approval_workflow.sql
2. Copy ALL the content
3. Paste it into the Supabase SQL Editor
```

### Step 3: Run the Migration
```
1. Click the "Run" button (or press Ctrl+Enter)
2. Wait for it to complete (should show green checkmark)
3. Check that no errors appear
```

---

## 📋 Verification Checklist

After running the migration, verify it worked:

### ✓ Check Supabase Tables
1. Go to Supabase Dashboard > Database > Tables
2. Search for these tables:
   - ✓ `submission_approvals` (new)
   - ✓ `practice_spoc` (new)
   - ✓ `tasks` (modified - should have new columns)
   - ✓ `accomplishments` (modified - should have new columns)

### ✓ Check Views
1. Go to Supabase Dashboard > Database > Views
2. Look for these new views:
   - ✓ `pending_approvals`
   - ✓ `employee_task_approvals`
   - ✓ `spoc_approval_workload`
   - ✓ `admin_approval_dashboard`

---

## 🧪 Testing the Approval Workflow

### Test 1: Employee Submits Task (≥15 hours saved)
```
1. Employee logs in → Dashboard
2. Click "Log AI Task"
3. Fill form:
   - Practice: BFSI
   - Employee: [any employee]
   - Task: "Test task with high savings"
   - Time without AI: 20 hours
   - Time with AI: 2 hours
   - Saved: 18 hours ✓
4. Click "Save Task"
5. Should see: "Task submitted for admin review (18.0 hrs saved)"
```

**Expected Result:**
- Task appears in Admin Panel → Approvals tab
- Status shows "⏳ Admin Review"
- Omar Ibrahim (admin) should see it in pending approvals

### Test 2: Admin Reviews Task
```
1. Admin logs in → Admin Panel
2. Click "Approvals" tab
3. Should see the task from Test 1
4. Click "Review" button
5. Click "✓ Approve" button
6. Enter optional notes (or leave blank)
7. Click "Approve"
```

**Expected Result:**
- Task status changes to "✅ Approved"
- Moves to "Approval History" section
- Employee can see approval on Task Status page

### Test 3: Employee Tracks Status
```
1. Employee logs in
2. Click sidebar → "My Work" → "Task Status"
3. Should see the task they submitted
4. Click "View Timeline"
5. Should see approval milestones
```

**Expected Result:**
- Task appears in list
- Status shows "✅ Approved"
- Approved date shown in timeline

---

## 🐛 Troubleshooting

### Problem 1: "relation submission_approvals does not exist"
**Solution:** SQL migration wasn't run. Go to Supabase → SQL Editor → Copy & Run sql/002_approval_workflow.sql

### Problem 2: Tasks still appearing only in "Manage Tasks"
**Solution:** Clear browser cache and refresh. Ensure migration completed without errors.

### Problem 3: Admin Approvals tab empty
**Solution:** 
1. Verify migration ran successfully
2. Check that a task was submitted after migration
3. Refresh the admin panel

### Problem 4: Employee Status page showing warning message
**Solution:** This is expected if migration hasn't run. After migration, refresh the page.

### Problem 5: Buttons not clickable/functional
**Solution:**
1. Check browser console (F12 > Console)
2. Look for JavaScript errors
3. Verify all db.js functions are available

---

## 📑 Documentation

For more details, see:
- [APPROVAL_WORKFLOW.md](../docs/APPROVAL_WORKFLOW.md) - Complete workflow guide
- [IMPLEMENTATION_NOTES.md](../docs/IMPLEMENTATION_NOTES.md) - Technical deep dive
- [002_approval_workflow.sql](sql/002_approval_workflow.sql) - Database schema

---

## ⚡ Quick Command Reference

**If you have Supabase CLI installed:**
```bash
# Run migration directly from file
supabase db push

# Or manually through dashboard:
# 1. SQL Editor → New Query
# 2. Copy sql/002_approval_workflow.sql
# 3. Paste and Run
```

---

## 🎯 Next Steps

After migration is complete:

1. ✅ Test all workflows above
2. ✅ Train SPOC users on approval process
3. ✅ Set up email notifications (optional)
4. ✅ Monitor approval times and metrics
5. ✅ Adjust SLAs as needed

---

## 💬 Questions?

If something doesn't work:
1. Check console for errors (F12)
2. Verify all tables exist in Supabase
3. Ensure browser is refreshed (Ctrl+Shift+R for hard refresh)
4. Check that you're logged in with correct role

**The approval workflow is now ready to go! 🚀**
