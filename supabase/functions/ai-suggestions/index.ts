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
    const { fieldType, currentText, context } = await req.json();

    if (!fieldType || !["why", "what"].includes(fieldType)) {
      return new Response(
        JSON.stringify({ error: 'fieldType must be "why" or "what"' }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!currentText || typeof currentText !== "string" || currentText.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "currentText is required and must be non-empty" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const contextStr = context ? `\nContext: ${context}` : "";

    const prompt =
      fieldType === "why"
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
      model: "gpt-4-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = completion.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [currentText] };

    return new Response(
      JSON.stringify({
        fieldType,
        suggestions: result.suggestions || [currentText],
        timestamp: new Date().toISOString(),
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error("AI suggestions error:", err);
    return new Response(
      JSON.stringify({
        error: `Failed to generate suggestions: ${err.message || "Internal error"}`,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
