/**
 * ============================================================
 * DEPRECATED — This file is no longer used in production.
 * ============================================================
 * 
 * The AI Adoption Agent now runs as a Supabase Edge Function:
 *   https://apcfnzbiylhgiutcjigg.supabase.co/functions/v1/adoption-agent
 * 
 * Both index.html and admin.html call the Edge Function directly.
 * This Express server is kept for local development/testing only.
 * 
 * To test locally: cd server && npm install && npm start
 * ============================================================
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { Anthropic } = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
const corsOptions = process.env.CORS_ORIGIN
  ? { origin: process.env.CORS_ORIGIN.split(',').map(s => s.trim()), credentials: true }
  : {}; // Defaults to allow all origins in development
app.use(cors(corsOptions));
app.use(express.json({ limit: '100kb' }));

// Initialize clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // MUST be set in .env file
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/**
 * Fetch live adoption metrics from Supabase
 */
async function getAdoptionMetrics(quarterId = null) {
  try {
    // Adoption rate
    const { data: copilotUsers } = await supabase
      .from('copilot_users')
      .select('id, has_logged_task');

    const activeCount = copilotUsers?.filter(u => u.has_logged_task).length || 0;
    const totalCount = copilotUsers?.length || 0;
    const adoptionRate = totalCount > 0 ? (activeCount / totalCount * 100).toFixed(1) : 0;

    // Tasks and hours saved
    let tasksQuery = supabase.from('tasks').select('time_saved, quarter_id, practice');
    if (quarterId && quarterId !== 'all') {
      tasksQuery = tasksQuery.eq('quarter_id', quarterId);
    }
    const { data: tasks } = await tasksQuery;

    const totalTasks = tasks?.length || 0;
    const totalHoursSaved = tasks?.reduce((sum, t) => sum + (t.time_saved || 0), 0) || 0;

    // Per-practice breakdown
    const practiceBreakdown = {};
    tasks?.forEach(t => {
      if (!practiceBreakdown[t.practice]) {
        practiceBreakdown[t.practice] = { tasks: 0, hoursSaved: 0 };
      }
      practiceBreakdown[t.practice].tasks += 1;
      practiceBreakdown[t.practice].hoursSaved += t.time_saved || 0;
    });

    // Inactive users
    const inactiveCount = totalCount - activeCount;

    // Target info
    const { data: quarters } = await supabase
      .from('quarters')
      .select('id, label, targets, is_active')
      .order('start_date', { ascending: false })
      .limit(1);

    const currentQuarter = quarters?.[0];

    return {
      adoptionRate: parseFloat(adoptionRate),
      activeUsers: activeCount,
      totalLicensedUsers: totalCount,
      inactiveUsers: inactiveCount,
      totalTasks,
      totalHoursSaved: parseFloat(totalHoursSaved),
      practiceBreakdown,
      currentQuarter: currentQuarter?.id,
      currentQuarterLabel: currentQuarter?.label,
      targets: currentQuarter?.targets,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error('Error fetching adoption metrics:', err);
    return {
      error: true,
      message: 'Could not fetch live metrics: ' + err.message,
    };
  }
}

/**
 * Build system prompt with project context
 */
function getSystemPrompt(metrics, userRole, userPractice) {
  const practiceFilter = userRole === 'spoc' 
    ? `\n**Your role context:** You are analyzing data for the ${userPractice} practice only.` 
    : `\n**Your role context:** You are analyzing organization-wide data for all 6 practices.`;

  return `You are the AI Adoption Agent for the EAS AI Adoption Dashboard. Your role is to analyze AI adoption metrics, identify blockers, and recommend actionable improvements.

## Live Context (Last Updated: ${metrics.timestamp})
- **Adoption Rate:** ${metrics.adoptionRate}% (${metrics.activeUsers}/${metrics.totalLicensedUsers} users active)
- **Total Tasks Logged:** ${metrics.totalTasks}
- **Total Hours Saved:** ${metrics.totalHoursSaved.toFixed(1)} hours
- **Quarter:** ${metrics.currentQuarterLabel || 'Q2-2026'}
- **Q2 Targets:** 100 tasks, 500 hours saved, 30% adoption rate

### Per-Practice Breakdown:
${Object.entries(metrics.practiceBreakdown)
  .map(([practice, data]) => `- **${practice}**: ${data.tasks} tasks, ${data.hoursSaved.toFixed(1)} hours saved`)
  .join('\n')}

### Inactive Users: ${metrics.inactiveUsers} out of ${metrics.totalLicensedUsers} have never logged a task

${practiceFilter}

## Your Capabilities
You can help with:
- ✅ Current adoption metrics & trends
- ✅ Practice-level analysis & comparisons
- ✅ Blockage identification & root cause analysis
- ✅ Actionable recommendations (with effort/impact assessment)
- ✅ Q2 progress reports & forecasting
- ✅ Risk alerts & escalation flags
- ✅ Implementation action plans
- ✅ User activation strategies

## Response Style
1. **Be analytical but practical.** Interpret metrics, challenge assumptions, suggest next steps.
2. **Separate facts from recommendations.** Quote the metrics above as your evidence.
3. **Prioritize by impact.** Recommend high-impact, low-effort actions first.
4. **Be specific.** Not "improve adoption" but "send targeted onboarding email to 50 ERP users this week with 2-min video."
5. **Quote targets.** Always reference Q2 targets (100 tasks, 500 hrs, 30% adoption) in progress assessments.
6. **Act as business partner.** Think like a delivery lead, not just a data analyst.

## Important Rules
- Do NOT overstate weak metrics. If adoption is 6.8%, say it plainly: "Adoption is critically low."
- Do NOT assume high login counts = engagement. Check task completion.
- Do NOT suggest generic actions. Be tactical and measurable.
- DO call out missing accountability. "Unclear who owns ERP activation" is valid feedback.
- DO propose experiments. "Try tagging top 10 users as 'AI Champions' and give them public recognition."

## Never
- Make up metrics. If you don't have data, say so.
- Recommend actions without effort/impact rationale.
- Ignore user role context.`;
}

/**
 * Main endpoint: /api/adoption-agent
 */
app.post('/api/adoption-agent', async (req, res) => {
  try {
    const { query, conversation, userRole, userPractice } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (query.length > 2000) {
      return res.status(400).json({ error: 'Query too long (max 2000 characters)' });
    }

    // Validate conversation array
    const safeConversation = Array.isArray(conversation)
      ? conversation
          .filter(m => m && typeof m.role === 'string' && typeof m.text === 'string')
          .slice(-20)
          .map(m => ({ role: m.role, text: m.text.substring(0, 4000) }))
      : [];

    // Fetch live metrics
    const metrics = await getAdoptionMetrics();

    if (metrics.error) {
      return res.status(500).json({
        reply: `⚠️ I'm having trouble accessing the dashboard data: ${metrics.message}. Please try again in a moment.`,
      });
    }

    // Build conversation for Claude
    const systemPrompt = getSystemPrompt(metrics, userRole, userPractice);

    const messages = [
      ...safeConversation.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.text,
      })),
      {
        role: 'user',
        content: query,
      },
    ];

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages,
    });

    const reply = response.content[0].type === 'text' ? response.content[0].text : 'Unable to process response.';

    // Return response
    res.json({
      reply: reply,
      timestamp: new Date().toISOString(),
      metrics: {
        adoptionRate: metrics.adoptionRate,
        activeUsers: metrics.activeUsers,
        totalTasks: metrics.totalTasks,
        hoursSaved: metrics.totalHoursSaved,
      },
    });

  } catch (err) {
    console.error('Agent endpoint error:', err);
    res.status(500).json({
      reply: `❌ Error: ${err.message || 'Internal server error'}. Please check the server logs.`,
    });
  }
});

/**
 * AI Suggestions Generator Endpoint
 * POST /api/ai/generate-suggestions
 * Generate 3 AI-powered suggestions for task/accomplishment "why" and "what" fields
 */
app.post('/api/ai/generate-suggestions', async (req, res) => {
  try {
    const { fieldType, currentText, context } = req.body;

    if (!fieldType || !['why', 'what'].includes(fieldType)) {
      return res.status(400).json({ error: 'fieldType must be "why" or "what"' });
    }

    if (!currentText || typeof currentText !== 'string' || currentText.trim().length === 0) {
      return res.status(400).json({ error: 'currentText is required and must be non-empty' });
    }

    const contextStr = context ? `\nContext: ${context}` : '';
    
    const prompt = fieldType === 'why'
      ? `You are an expert business analyst helping employees articulate the impact and reasoning behind their AI adoption activities. 

Existing text: "${currentText}"${contextStr}

Generate exactly 3 alternative, professional suggestions for explaining WHY this task/accomplishment matters. Each should:
- Be 1-2 sentences (15-50 words)
- Focus on business impact or productivity gain
- Be specific and measurable where possible
- Avoid generic phrases like "to improve efficiency"

Format as JSON: { "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"] }`
      : `You are an expert business analyst helping employees describe their AI adoption activities clearly and measurably.

Existing text: "${currentText}"${contextStr}

Generate exactly 3 alternative, professional suggestions for describing WHAT was accomplished. Each should:
- Be 1-2 sentences (15-50 words)
- Include specific AI tools/techniques used
- Mention quantifiable outcomes (time saved, quality improvement, etc.)
- Be professional and concise

Format as JSON: { "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"] }`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = completion.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [currentText] };

    res.json({
      fieldType,
      suggestions: result.suggestions || [currentText],
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error('AI suggestions error:', err);
    res.status(500).json({
      error: `Failed to generate suggestions: ${err.message || 'Internal error'}`,
    });
  }
});

/**
 * AI Validation Endpoint
 * POST /api/ai/validate-submission
 * Validates task/accomplishment submission against quality rules
 */
app.post('/api/ai/validate-submission', async (req, res) => {
  try {
    const { submissionType, savedHours, whyText, whatText, aiTool, category } = req.body;

    if (!submissionType || !['task', 'accomplishment'].includes(submissionType)) {
      return res.status(400).json({ error: 'submissionType must be "task" or "accomplishment"' });
    }

    if (typeof savedHours !== 'number' || savedHours < 0) {
      return res.status(400).json({ error: 'savedHours must be a non-negative number' });
    }

    // Define validation rules based on project requirements
    // Mentions AI tool, mentions metrics, quality assessment
    const validationRules = `Check the following submission for quality:
    
Saved Hours: ${savedHours}
Why (Context): "${whyText || ''}"
What (Accomplishment): "${whatText || ''}"
AI Tool Used: "${aiTool || ''}"
Category: "${category || ''}"

Validate against these rules:
1. **Mentions AI tool**: Check if "${aiTool || ''}" is a real AI tool (ChatGPT, Copilot, Claude, etc.)
2. **Meaningful explanation (50+ words total)**: Check combined length of why+what texts
3. **Mentions quantifiable metrics**: Check if "why" or "what" mentions numbers, percentages, time, or specific outcomes
4. **Quality assessment**: Overall coherence and professional tone
5. **Saved hours**: Any amount saved counts (provided: ${savedHours}h)

Respond in JSON format:
{
  "isValid": true|false,
  "passedRules": ["rule 1", "rule 2"],
  "failedRules": ["rule 3"],
  "overallScore": 0-100,
  "reason": "Brief explanation",
  "suggestions": ["suggestion 1", "suggestion 2"]
}`;

    const validation = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: validationRules }],
      temperature: 0.5,
      max_tokens: 400,
    });

    const content = validation.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {
      isValid: true,
      overallScore: 70,
      reason: 'Could not parse AI response',
    };

    res.json({
      submissionType,
      validation: result,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error('AI validation error:', err);
    res.status(500).json({
      error: `Validation failed: ${err.message || 'Internal error'}`,
      fallback: { isValid: false, overallScore: 0, reason: 'AI service temporarily unavailable' },
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/api/adoption-agent/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(port, () => {
  console.log(`✅ AI Adoption Agent endpoint running on http://localhost:${port}`);
  console.log(`   POST /api/adoption-agent — Submit query`);
  console.log(`   POST /api/ai/generate-suggestions — Generate AI suggestions for task/accomplishment fields`);
  console.log(`   POST /api/ai/validate-submission — Validate task/accomplishment submission`);
  console.log(`   GET /api/adoption-agent/health — Health check`);
  console.log(`\n📋 Make sure these env vars are set:`);
  console.log(`   - ANTHROPIC_API_KEY`);
  console.log(`   - OPENAI_API_KEY`);
  console.log(`   - SUPABASE_URL`);
  console.log(`   - SUPABASE_ANON_KEY`);
});

module.exports = app;
