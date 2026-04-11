# AI Adoption Agent Backend

> **⚠️ DEPRECATED** — This local Express server has been replaced by a Supabase Edge Function
> deployed at `https://apcfnzbiylhgiutcjigg.supabase.co/functions/v1/adoption-agent`.
> Both `admin.html` and `index.html` now call the Edge Function directly.
> This folder is kept for reference only. See `SETUP_GUIDE.md` and `QUICK_START.md`
> for the original setup instructions (no longer needed).

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create .env from template and add your API keys
cp .env.example .env
# Edit .env and add ANTHROPIC_API_KEY from https://console.anthropic.com/

# 3. Start the server
npm start

# Server runs on http://localhost:3001
```

## Files

- **adoption-agent-endpoint.js** — Main Express app with Claude API integration
- **package.json** — Dependencies & scripts
- **.env.example** — Environment variable template
- **SETUP_GUIDE.md** — Detailed deployment instructions

## Architecture

### getAdoptionMetrics(quarterId)
Fetches live adoption data from Supabase:
- Adoption rate (%)
- Active users count
- Tasks logged this quarter
- Hours saved
- Breakdown by practice
- Inactive user count

Example output:
```json
{
  "adoptionRate": 6.8,
  "activeUsers": 10,
  "totalTasks": 44,
  "hoursSaved": 128,
  "practiceBreakdown": {
    "ERP": { "rate": 20, "users": 5, "tasks": 20 },
    "AI": { "rate": 10, "users": 3, "tasks": 10 }
  },
  "inactiveCount": 137
}
```

### getSystemPrompt(metrics, userRole, userPractice)
Builds dynamically-injected Claude system prompt with:
- Live adoption metrics
- User role (admin sees all, SPOC sees practice only)
- Organization context (practices, SPOCs, targets)
- Available queries & capabilities
- Tone: Analytical, data-driven, actionable

### POST /api/adoption-agent
Main chat endpoint.

**Request:**
```json
{
  "query": "What is our adoption rate?",
  "conversation": [
    { "role": "user", "text": "What's our Q2 target?" },
    { "role": "agent", "text": "The Q2 adoption target is..." }
  ],
  "userRole": "admin",
  "userPractice": "ERP"
}
```

**Response:**
```json
{
  "reply": "Your current adoption rate is 6.8% (10 out of 147 users)...",
  "timestamp": "2026-04-10T15:30:00Z",
  "metrics": { "adoptionRate": 6.8, ... }
}
```

### GET /api/adoption-agent/health
Health check endpoint. Returns 200 if API keys are configured.

```bash
curl http://localhost:3001/api/adoption-agent/health
# Response: { "status": "ok" }
```

## Environment Variables

| Variable | Required | Example |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | `sk-ant-...` |
| `SUPABASE_URL` | Yes | `https://apcfnzbiylhgiutcjigg.supabase.co` |
| `SUPABASE_ANON_KEY` | Yes | `sb_publishable_...` |
| `PORT` | No | `3001` (default) |
| `CORS_ORIGIN` | No | `https://your-domain.com` |

## Dependencies

- **@anthropic-ai/sdk** — Claude API client
- **@supabase/supabase-js** — Supabase database client
- **express** — Web framework
- **cors** — Cross-origin request handling
- **dotenv** — Environment variable loader
- **nodemon** (dev) — Auto-reload on changes

## Scripts

```bash
npm start     # Run production server
npm run dev   # Run with nodemon (auto-reload on code changes)
```

## Deployment

### Local (Development)
```bash
npm install
npm start
# Server on http://localhost:3001
```

### Vercel (Recommended)
```bash
npm install -g vercel
vercel
# Add environment variables in Vercel dashboard
```

### Heroku
```bash
heroku create your-app
heroku config:set ANTHROPIC_API_KEY=sk-ant-...
heroku config:set SUPABASE_URL=...
heroku config:set SUPABASE_ANON_KEY=...
git push heroku main
```

### Docker
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY adoption-agent-endpoint.js .
EXPOSE 3001
CMD ["node", "adoption-agent-endpoint.js"]
```

## Costs

- Claude API: ~$0.001 per message (~$0.50–$2.00/month for typical usage)
- Vercel: FREE (up to 100 invocations/day)
- Supabase: Included (already using free tier)

## Troubleshooting

### "Cannot find module '@anthropic-ai/sdk'"
```bash
npm install
```

### "Missing ANTHROPIC_API_KEY"
- Edit `.env` and add your key from https://console.anthropic.com/
- Verify file is not `.env.example` but `.env`

### "SUPABASE_URL is not defined"
- Check `.env` has both `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- Verify they match your Supabase project

### Server won't start
```bash
# Check syntax
node -c adoption-agent-endpoint.js

# Check node version (needs 18+)
node --version

# Try verbose mode
DEBUG=* npm start
```

### Widget gets "Network error"
- Verify endpoint is running: `curl http://localhost:3001/api/adoption-agent/health`
- Check admin.html has correct endpoint URL
- Verify CORS is enabled for your frontend domain

## API Model

Uses **Claude 3.5 Sonnet** with:
- Max tokens: 1024 (enough for detailed responses)
- Temperature: Uses default (0.7) for balanced creativity + accuracy
- Context window: Full conversation history (capped at 40 messages for token efficiency)

## Rate Limiting

Not implemented yet. Production deployments should add:
- Per-user rate limit (e.g., 10 queries/min)
- Global rate limit (e.g., 1000 queries/hour)
- Cache frequent queries

## Logging

Logs are printed to console:
- `✅ Adoption Agent endpoint running on http://localhost:{PORT}`
- Error messages with full stack traces
- Request timestamps (useful for debugging)

For production, consider adding:
- Winston or Pino for structured logging
- Log aggregation (e.g., LogRocket, Sentry)
- Metrics tracking (API latency, error rates)

## Security

- ✅ API keys stored server-side (.env), not exposed to client
- ✅ CORS configured to allow only admin portal domain
- ✅ Supabase RLS policies enforce row-level security
- ✅ User role & practice filters applied server-side
- ⚠️ Never commit `.env` to git
- ⚠️ Regenerate API keys if compromised

## Next Steps

1. **Get Anthropic API key** from https://console.anthropic.com/
2. **Copy .env.example → .env** and add your key
3. **npm install && npm start**
4. **Test endpoint**: `curl -X POST http://localhost:3001/api/adoption-agent ...`
5. **Update admin.html** with your endpoint URL if deploying remotely
6. **Monitor usage** and costs

---

**Questions?** See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed deployment steps.

Last updated: April 10, 2026
