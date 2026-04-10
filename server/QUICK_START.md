# 🚀 5-Minute Quick Start: Deploy Chat Widget

Follow these steps to get the AI Adoption Agent chat widget working in your admin portal.

---

## Prerequisites
- [ ] Node.js 18+ installed on your machine
- [ ] Anthropic API key (get free at https://console.anthropic.com/)
- [ ] Admin portal open to verify widget works

---

## ⚡ Deploy Now

### Step 1: Install Backend (2 minutes)
```bash
cd server/
npm install
```

### Step 2: Configure API Keys (1 minute)
```bash
# Copy the template
cp .env.example .env

# Edit .env file and add your ANTHROPIC_API_KEY:
# (On Windows: notepad .env)
# (On Mac/Linux: nano .env)

# Copy this line and paste your key from https://console.anthropic.com/:
# ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
```

File should look like:
```env
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
SUPABASE_URL=https://apcfnzbiylhgiutcjigg.supabase.co
SUPABASE_ANON_KEY=sb_publishable_fO29UdOY1Wa8_LOgjDj2Pg_iZ7bhKJ3
PORT=3001
```

### Step 3: Start Backend Server (30 seconds)
```bash
npm start
```

Expected output:
```
✅ AI Adoption Agent endpoint running on http://localhost:3001
```

### Step 4: Test Widget (1 minute)
```bash
# Open your browser and go to:
http://localhost/admin.html

# OR if using local file system:
file:///C:/Users/oibrahim/Desktop/Ejada%20Projects/EAS_AI_ADOPTION/E-AI-S/admin.html
```

Then:
1. Click **💬 button** (bottom-right corner)
2. Type a question: `What is our adoption rate?`
3. Hit Enter
4. You should see a response from Claude with live metrics!

---

## ✅ Verify It Works

- [ ] Chat widget opens when clicking 💬 button
- [ ] Message box accepts text input
- [ ] Pressing Enter sends the message
- [ ] Claude responds with real adoption data
- [ ] No "Network error" messages
- [ ] Conversation history persists

---

## 🎯 Example Queries to Try

```
1. What's our current adoption rate?
2. Analyze the ERP practice performance
3. Generate a Q2 progress report
4. What are the top blockers to adoption?
5. Recommend actions to increase adoption
6. Which practices need the most support?
7. What's the forecast for Q3?
```

---

## 🔧 If Something Breaks

| Problem | Solution |
|---------|----------|
| `npm ERR! Cannot find module` | Run `npm install` again |
| `ANTHROPIC_API_KEY is not defined` | Check `.env` file exists and has correct key |
| Widget says "Network error" | Make sure backend is running (`npm start`) |
| Server won't start | Check Node version: `node --version` (need 18+) |
| Widget doesn't open | Check browser console (F12) for JavaScript errors |

---

## 📋 Next Steps

After verifying it works locally:

1. **For Permanent Deployment** (beyond local testing):
   - Option A: Keep running `npm start` on your local machine
   - Option B: Deploy to Vercel, Heroku, or AWS (see [SETUP_GUIDE.md](./SETUP_GUIDE.md))

2. **Update Admin Dashboard:**
   - If deploying to cloud, update the endpoint URL in `admin.html`
   - Currently uses `/api/adoption-agent` (local)
   - Cloud would be: `https://your-backend-url/api/adoption-agent`

3. **Monitor & Improve:**
   - Track what questions users ask
   - Update agent context if metrics change
   - Scale backend if heavily used

---

## 📞 Support

- **Backend logs:** Watch terminal output where you ran `npm start`
- **Check health:** `curl http://localhost:3001/api/adoption-agent/health`
- **Full docs:** See [README.md](./README.md) and [SETUP_GUIDE.md](./SETUP_GUIDE.md)

---

## 🎬 Demo Flow

```
User opens admin.html
        ↓
Sees blue 💬 button (bottom-right)
        ↓
Clicks button → Widget slides up
        ↓
Sees greeting: "Hi! What would you like to know?"
        ↓
Types: "How many users adopted Copilot?"
        ↓
Frontend sends to http://localhost:3001/api/adoption-agent
        ↓
Backend fetches live metrics from Supabase
        ↓
Backend calls Claude with live data
        ↓
Claude responds with insights
        ↓
Response appears in widget
        ↓
User reads: "10 out of 147 users have used Copilot (6.8%)" + trends + recommendations
```

---

**You're all set! 🎉 The AI Adoption Agent is now embedded in your admin portal.**

Last updated: April 10, 2026
