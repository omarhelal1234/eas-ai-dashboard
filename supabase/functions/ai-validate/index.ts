import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { OpenAI } from "https://esm.sh/openai@4.28.0";

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { submissionType, savedHours, whyText, whatText, aiTool, category } = await req.json();

    if (!submissionType || !["task", "accomplishment"].includes(submissionType)) {
      return new Response(
        JSON.stringify({ error: 'submissionType must be "task" or "accomplishment"' }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (typeof savedHours !== "number" || savedHours < 0) {
      return new Response(
        JSON.stringify({ error: "savedHours must be a non-negative number" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const validationRules = `Check the following submission for quality:
    
Saved Hours: ${savedHours}
Why (Context): "${whyText || ""}"
What (Accomplishment): "${whatText || ""}"
AI Tool Used: "${aiTool || ""}"
Category: "${category || ""}"

Validate against these rules:
1. **Mentions AI tool**: Check if "${aiTool || ""}" is a real AI tool (ChatGPT, Copilot, Claude, etc.)
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
      model: "gpt-4-turbo",
      messages: [{ role: "user", content: validationRules }],
      temperature: 0.5,
      max_tokens: 400,
    });

    const content = validation.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const result = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : {
          isValid: true,
          overallScore: 70,
          reason: "Could not parse AI response",
        };

    return new Response(
      JSON.stringify({
        submissionType,
        validation: result,
        timestamp: new Date().toISOString(),
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error("AI validation error:", err);
    return new Response(
      JSON.stringify({
        error: `Validation failed: ${err.message || "Internal error"}`,
        fallback: {
          isValid: false,
          overallScore: 0,
          reason: "AI service temporarily unavailable",
        },
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
