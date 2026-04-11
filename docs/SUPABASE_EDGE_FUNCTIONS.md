# Supabase Edge Functions Deployment Guide

This project uses Supabase Edge Functions for AI-powered features (AI suggestions and validation).

## Functions Deployed

1. **ai-suggestions** - Generate AI suggestions for task/accomplishment descriptions
2. **ai-validate** - Validate submissions against quality rules

## Deployment Options

### Option A: Using Supabase Dashboard (Easiest for First Deploy)

1. Go to https://app.supabase.com/projects
2. Select your project: `apcfnzbiylhgiutcjigg`
3. Navigate to **Functions** (left sidebar)
4. Click **Create Function**

**For ai-suggestions:**
- Name: `ai-suggestions`
- Copy entire contents of `supabase/functions/ai-suggestions/index.ts`
- Paste into editor
- Click **Create**

**For ai-validate:**
- Name: `ai-validate`
- Copy entire contents of `supabase/functions/ai-validate/index.ts`
- Paste into editor
- Click **Create**

5. After creating both functions, set environment variables:
   - Go to **Project Settings** → **API** → **Functions**
   - Set `OPENAI_API_KEY` to your key from https://platform.openai.com/api-keys
   - Click **Save**

6. Test in **Functions** dashboard:
   - Click on `ai-suggestions` function
   - Go to **Testing** tab
   - Paste this in Request body:
   ```json
   {
     "fieldType": "why",
     "currentText": "Used ChatGPT to analyze data",
     "context": null
   }
   ```
   - Click **Invoke**
   - Should see 3 suggestions returned

### Option B: Using Supabase CLI (Advanced)

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Deploy functions
supabase functions deploy ai-suggestions --project-id apcfnzbiylhgiutcjigg
supabase functions deploy ai-validate --project-id apcfnzbiylhgiutcjigg

# Set environment variables
supabase secrets set OPENAI_API_KEY=sk-proj-... --project-id apcfnzbiylhgiutcjigg
```

## Frontend Configuration

The frontend is already configured to use the live Edge Functions:

- API Base URL: `https://apcfnzbiylhgiutcjigg.supabase.co/functions/v1`
- Endpoint: `/ai-suggestions` for suggestions
- Endpoint: `/ai-validate` for validation

## Testing Live Deployment

1. Open the dashboard
2. Create a new task (or accomplishment)
3. Click **✨ AI Suggestions** button next to any field
4. Should see 3 AI-generated suggestions from GPT-4

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Failed to generate suggestions" | Check OPENAI_API_KEY is set in Supabase Functions secrets |
| CORS errors | Supabase Edge Functions already have CORS enabled |
| 500 error | Check Edge Function logs in Supabase dashboard |

## Logs & Monitoring

View function logs:
1. Go to https://app.supabase.com/projects/apcfnzbiylhgiutcjigg/functions
2. Click on function name
3. See **Logs** tab for recent invocations

## Cost

- **Free tier**: 500,000 requests/month included
- **Usage**: Each AI suggestion/validation = 1 request
