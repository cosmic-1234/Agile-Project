/**
 * OpenRouter AI Service
 * ─────────────────────────────────────────────────────────────────────────────
 * OpenRouter routes to free open-source models with NO daily token limits.
 * Automatically tries multiple active free models with robust JSON extraction
 * and generous token limits to accommodate comprehensive partner evaluations.
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';

// Resilient list of active free models on OpenRouter (verified responsive)
const FREE_MODELS = [
  'openrouter/free',
  'dots-studio/dots-3-note-preview:free',
  'liquid/lfm-2.5-2.6b:free',
  'apodex/apodex-1.1-mini:free',
  'nvidia/nemotron-3.5-lightning:free',
];

// ── Compact partner summary (reduces tokens by ~70% vs full JSON) ──────────
function compactPartner(p) {
  return {
    id:   p.id,
    name: p.name,
    tier: p.tier,
    hq:   p.headquarters || '',
    solutions:    (p.solutions    || []).slice(0, 5),
    capabilities: (p.capabilities || []).slice(0, 5),
    useCases:     (p.useCases     || []).slice(0, 2),
    certs:        (p.certifications || []).slice(0, 3),
  };
}

// ── Robust JSON parser that handles reasoning tokens, code fences, etc. ───
function extractJSON(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Empty response from model');
  }

  // 1. Remove reasoning / think blocks (from deepseek, qwen, nemotron, dots, etc.)
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Remove markdown code fences
  cleaned = cleaned.replace(/```(?:json)?([\s\S]*?)```/gi, '$1').trim();

  // 3. Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  // 4. Extract outermost { ... }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // Relax trailing commas or control characters
      try {
        const relaxed = candidate
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
        return JSON.parse(relaxed);
      } catch (_) {}
    }
  }

  // 5. Extract outermost [ ... ]
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = cleaned.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch (_) {}
  }

  throw new Error('Response did not contain parseable JSON: ' + cleaned.slice(0, 150));
}

// ── Low-level chat wrapper with automatic model rotation ──────────────────
async function chat(systemPrompt, userMessage) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  let lastError = null;

  for (const model of FREE_MODELS) {
    try {
      const response = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  'https://ahan-s-repo.onrender.com',
          'X-Title':       'Partnership Fitment Agent',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens:  8192,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userMessage  },
          ],
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[OpenRouter] Model ${model} returned HTTP ${response.status}: ${errText.slice(0, 120)}`);
        lastError = new Error(`OpenRouter ${response.status}: ${errText}`);
        continue;
      }

      const json = await response.json();
      if (json.error) {
        console.warn(`[OpenRouter] Model ${model} error: ${JSON.stringify(json.error).slice(0, 120)}`);
        lastError = new Error(`OpenRouter error: ${JSON.stringify(json.error)}`);
        continue;
      }

      const rawText = json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning || '';
      const parsed = extractJSON(rawText);
      return parsed;
    } catch (err) {
      console.warn(`[OpenRouter] Model ${model} failed (${err.message}). Trying next free model...`);
      lastError = err;
    }
  }

  throw lastError || new Error('All OpenRouter free models failed');
}

// ── System prompts ────────────────────────────────────────────────────────
const SYSTEM = {
  analyze: `You are a Partnership Fitment Analyst for a smart manufacturing IT company. Analyze client problems and match them to the best technology partners. Respond in valid JSON only.`,
  extract: `You are a document analysis expert. Extract structured information from documents. Respond in valid JSON only.`,
  compare: `You are a Partnership Fitment Analyst. Compare technology partners against a client problem. Respond in valid JSON only.`,
  profile: `You are a corporate partner profiling assistant for manufacturing technology. Extract partner information from documents. Respond in valid JSON only.`,
};

// ── analyzeProblem ───────────────────────────────────────────────────────
async function analyzeProblem(problemText, partners, options = {}) {
  const { industry, urgency, budgetRange } = options;
  const partnerList = partners.map(compactPartner);

  const userMessage = `CLIENT PROBLEM: ${problemText}
${industry ? `INDUSTRY: ${industry}` : ''}${urgency ? ` | URGENCY: ${urgency}` : ''}${budgetRange ? ` | BUDGET: ${budgetRange}` : ''}

PARTNERS:
${JSON.stringify(partnerList)}

Return JSON matching this schema exactly:
{
  "problemSummary": "string",
  "keyRequirements": ["string"],
  "industryContext": "string",
  "rankedPartners": [
    {
      "partnerId": "string",
      "partnerName": "string",
      "fitmentScore": 0-100,
      "overallAssessment": "string",
      "strengthsMatched": ["string"],
      "capabilitiesMatched": ["string"],
      "relevantUseCases": ["string"],
      "gaps": ["string"],
      "recommendedApproach": "string"
    }
  ],
  "analysisNotes": "string"
}
Only include partners with fitmentScore > 20. Sort by fitmentScore descending.`;

  return chat(SYSTEM.analyze, userMessage);
}

// ── extractDocument ──────────────────────────────────────────────────────
async function extractDocument(documentText) {
  const userMessage = `DOCUMENT (first 20000 chars):
${documentText.substring(0, 20000)}

Return JSON:
{
  "clientName": "string",
  "problemStatement": "string",
  "businessChallenges": ["string"],
  "technicalRequirements": ["string"],
  "industry": "string",
  "domain": "string",
  "budgetInfo": "string",
  "timelineInfo": "string",
  "technologyPreferences": ["string"],
  "successCriteria": ["string"],
  "summary": "string"
}`;

  return chat(SYSTEM.extract, userMessage);
}

// ── comparePartners ──────────────────────────────────────────────────────
async function comparePartners(problemText, selectedPartners) {
  const userMessage = `CLIENT PROBLEM: ${problemText}

PARTNERS TO COMPARE:
${JSON.stringify(selectedPartners.map(compactPartner))}

Return JSON:
{
  "problemContext": "string",
  "comparisonDimensions": ["string"],
  "partnerAnalyses": [
    {
      "partnerId": "string",
      "partnerName": "string",
      "fitmentScore": 0-100,
      "strengths": ["string"],
      "weaknesses": ["string"],
      "differentiators": ["string"],
      "riskFactors": ["string"],
      "engagementApproach": "string",
      "estimatedTimeline": "string",
      "dimensionScores": { "dimension": 85 }
    }
  ],
  "overallRecommendation": {
    "topChoice": "partnerId",
    "rationale": "string",
    "alternativeScenarios": "string"
  }
}`;

  return chat(SYSTEM.compare, userMessage);
}

// ── addPartnerFromText ───────────────────────────────────────────────────
async function addPartnerFromText(documentText) {
  const userMessage = `DOCUMENT:
${documentText.substring(0, 20000)}

Extract partner profile. Return JSON:
{
  "name": "string",
  "description": "string (2-3 sentences)",
  "solutions": ["string"],
  "capabilities": ["string"],
  "industries": ["Manufacturing"],
  "useCases": ["string"],
  "certifications": ["string"],
  "tier": "Platinum|Gold|Silver",
  "website": "string",
  "contactEmail": "string",
  "headquarters": "string",
  "employeeCount": number,
  "yearFounded": number
}
Use your knowledge to fill missing public fields. Never return empty arrays or 0 values.`;

  return chat(SYSTEM.profile, userMessage);
}

module.exports = { analyzeProblem, extractDocument, comparePartners, addPartnerFromText };
