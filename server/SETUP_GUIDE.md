# AI Adoption Agent — Chat Widget Setup Guide

## Overview

This guide walks you through deploying the embedded **AI Adoption Agent chat widget** in your admin portal. The widget lets admins and SPOCs ask for reports, status updates, escalations, and recommendations directly from the dashboard.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Admin Portal (admin.html)                       │
│  ┌─────────────────────────────────────────┐    │
│  │  Chat Widget                             │    │
│  │  (HTML + CSS + JS in admin.html)         │    │
│  │  💬 Fixed button in bottom-right corner  │    │
│  └─────────────────┬───────────────────────┘    │
│                    │ HTTP POST /api/adoption-agent
┌─────────────────────────────────────────────────┐
│  Backend Endpoint (Node.js/Express)             │
│  ┌─────────────────────────────────────────┐    │
│  │ adoption-agent-endpoint.js              │    │
│  │ • Receives query & conversation history │    │
│  │ • Fetches live data from Supabase       │    │
│  │ • Calls Claude API with context         │    │
│  │ • Returns AI-powered insights           │    │
│  └─────────────────┬───────────────────────┘    │
│                    │                             │
│         ┌──────────┴──────────┐                  │
│         ▼                     ▼                   │
│    Supabase DB          Anthropic API            │
│    (live metrics)       (Claude 3.5)             │
└─────────────────────────────────────────────────┘
```

---

## Setup Steps

### Step 1: Frontend is Ready ✅

The chat widget is **already added** to `admin.html`. It includes:
- 💬 Fixed button in bottom-right corner
- Responsive chat interface
- Message history
- Loading states & error handling
- Auto-greeting on first open

**No frontend changes needed!**

---

### Step 2: Backend Deployment (Choose One)

#### **Option A: Local Development (Fastest for Testing)**

```bash
cd server/

# 1. Install dependencies
npm install

# 2. Copy environment file
cp .env.example .env

# 3. Edit .env with your keys (see below)
# Get ANTHROPIC_API_KEY from: https://console.anthropic.com/
# SUPABASE_URL and SUPABASE_ANON_KEY are in your Supabase dashboard

# 4. Start the server
npm start

# Server runs on http://localhost:3001
```

Test it:
```bash
curl -X POST http://localhost:3001/api/adoption-agent \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is our current adoption rate?",
    "conversation": [],
    "userRole": "admin",
    "userPractice": ""
  }'
```

---

#### **Option B: Deploy to Vercel (Recommended for Production)**

1. **Create Vercel project:**
   ```bash
   # Install Vercel CLI
   npm install -g vercel
   
   # Deploy
   cd server/
   vercel
   ```

2. **Add environment variables in Vercel dashboard:**
   - Project Settings → Environment Variables
   - Add: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`

3. **Update admin.html to call your Vercel endpoint:**
   ```javascript
   // In the sendAdoptionAgentQuery() function, change:
   const response = await fetch('/api/adoption-agent', {
   
   // To:
   const response = await fetch('https://your-vercel-project.vercel.app/api/adoption-agent', {
   ```

---

#### **Option C: Deploy to Heroku (Alternative)**

```bash
heroku create your-adoption-agent
heroku config:set ANTHROPIC_API_KEY=sk-ant-...
heroku config:set SUPABASE_URL=https://...
heroku config:set SUPABASE_ANON_KEY=...
git push heroku main
```

---

### Step 3: Configure Environment Variables

Create `server/.env`:

```env
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
SUPABASE_URL=https://apcfnzbiylhgiutcjigg.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
PORT=3001
```

**Get your API keys:**

1. **Anthropic API Key:**
   - Go to https://console.anthropic.com/
   - Create API key
   - Copy and paste into `.env`
   - Cost: ~$0.001 per message (very cheap)

2. **Supabase Keys:**
   - Already have them in `js/config.js`
   - Copy SUPABASE_URL and SUPABASE_ANON_KEY

---

### Step 4: Update admin.html to Call Your Endpoint

The widget calls `/api/adoption-agent` by default. Depending on your setup:

**If running locally (localhost:3001):**
```javascript
const response = await fetch('/api/adoption-agent', {
  // This uses relative URL, so make sure your local server is running
});
```

**If deployed (e.g., Vercel):**
```javascript
const response = await fetch('https://your-deployment-url.vercel.app/api/adoption-agent', {
  // Update the URL to your deployed endpoint
});
```

To update, find this in the chat widget script (near the end of admin.html):
```javascript
const response = await fetch('/api/adoption-agent', {
```

Change `/api/adoption-agent` to your actual endpoint URL.

---

## Usage

### For Admins

1. Open admin portal
2. Click 💬 button in bottom-right corner
3. Ask questions like:
   - "What's our current adoption rate by practice?"
   - "Which practices are underperforming?"
   - "Generate a Q2 progress report"
   - "What are the top 3 blockers?"
   - "Recommend actions to hit 30% adoption"

### For SPOCs

The agent automatically filters data to their assigned practice:
- SPOC sees only their practice's metrics
- Recommendations are practice-specific
- Can ask: "How is my team doing this quarter?"

---

## Example Queries

| Query | Response |
|-------|----------|
| `What's our adoption rate?` | Real-time adoption % + breakdown |
| `Analyze ERP practice` | Practice-specific insights |
| `Generate Q2 progress report` | Full report with KPIs & recommendations |
| `What are our top blockers?` | Root cause analysis + action plan |
| `Which users should we target for onboarding?` | Prioritized list + messaging suggestions |
| `Forecast Q3 adoption` | Trend analysis + projection |
| `Create an escalation alert` | Risk summary for leadership |

---

## Troubleshooting

### Widget doesn't open
- Check browser console (F12) for errors
- Make sure you didn't accidentally delete the widget JavaScript

### "Network error" / "Could not connect"
- Verify backend endpoint is running: `curl http://localhost:3001/api/adoption-agent/health`
- Check CORS settings in endpoint
- If using Vercel, verify environment variables are set

### "Could not fetch live metrics"
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`
- Check Supabase connection status
- Ensure RLS policies allow anon key reads (they should)

### "API key error" from Anthropic
- Verify `ANTHROPIC_API_KEY` is correct
- Make sure it's not expired
- Get a new key from https://console.anthropic.com/

### Response is slow (>5 seconds)
- Claude API can take 1–3 seconds normally
- If slower, check network latency
- Consider caching frequent queries

---

## Cost Estimate

| Service | Cost (Monthly) |
|---------|----------------|
| Claude API | ~$0.50–$2.00 (pay-per-token) |
| Vercel Hosting | FREE (up to 100 invocations/day) → ~$20/mo if heavily used |
| Supabase | FREE tier (already using) |
| **Total** | **~$20–$25/month** |

---

## What the Agent Can Do

✅ **Real-time Analytics**
- Current adoption rate, tasks logged, hours saved
- Per-practice breakdown & comparisons
- User activation tracking

✅ **Insights & Analysis**
- Root cause identification (why adoption is low)
- Practice performance rankings
- Trend spotting & anomalies

✅ **Actionable Recommendations**
- Tactical next steps (not generic advice)
- Prioritized by effort vs. impact
- Specific owners & timelines

✅ **Escalations & Alerts**
- Risk flags (e.g., "ERP has 60 licenses but 0 tasks")
- Data quality issues
- Off-track practices

✅ **Reports & Summaries**
- Q2 progress email-ready
- Executive summaries
- Practice-specific reports

---

## Maintenance

### Weekly
- Monitor usage (check server logs)
- Verify API quota usage

### Monthly
- Review conversation logs for common questions
- Update agent context if business goals change
- Test new use cases

### Quarterly
- Evaluate cost vs. usage
- Consider caching frequently asked questions
- Gather user feedback on insights

---

## Security Notes

- ✅ Supabase RLS policies control data access (users can only see their practice)
- ✅ Agent respects user role (admin sees all, SPOC sees practice only)
- ✅ API keys are stored server-side (.env), not exposed to client
- ⚠️ Keep `.env` file private (never commit to git)
- ⚠️ Regenerate API keys if accidentally shared

---

## Next Steps

1. **Deploy backend** (local or cloud)
2. **Update endpoint URL** in admin.html widget
3. **Test widget** in admin portal
4. **Invite team** to use it
5. **Monitor & iterate** based on usage patterns

---

## Support

**Questions?**
- Check endpoint health: `GET http://your-endpoint/api/adoption-agent/health`
- Review server logs for errors
- Check `.env` file is properly configured
- Verify network connectivity to Supabase & Anthropic APIs

---

**Happy analyzing! 🚀**

Last updated: April 10, 2026
