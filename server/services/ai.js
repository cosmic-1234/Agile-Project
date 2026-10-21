/**
 * AI Dispatcher — Multi-Provider with Automatic Fallback
 * ─────────────────────────────────────────────────────────────────────────────
 * Provider priority:
 *   1. OpenRouter  — FREE, no daily token limits, multi-model fallback
 *   2. Groq        — FREE, 100K tokens/day limit
 *   3. Gemini      — Google Gemini 3.8 Flash (starts with AIzaSy)
 */

const openrouter = require('./openrouter');
const groq = require('./groq');
const gemini = require('./gemini');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isValidKey(key) {
  return typeof key === 'string' && key.trim().length > 10 && !key.includes('your-') && !key.includes('placeholder');
}

function isValidGeminiKey(key) {
  return typeof key === 'string' && key.trim().startsWith('AIzaSy');
}

// ── Groq multi-key rotation ──────────────────────────────────────────────
function getGroqKeys() {
  return [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
  ].filter(isValidKey);
}

function isRateLimitError(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
}

function isDailyQuotaError(err) {
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('tokens per day') ||
    msg.includes('tpd') ||
    (msg.includes('429') && (msg.includes('hour') || msg.includes('min') || msg.includes('day')))
  );
}

// ── Try Groq with key rotation ───────────────────────────────────────────
async function tryGroq(serviceMethod, ...args) {
  const keys = getGroqKeys();
  if (!keys.length) throw new Error('No GROQ_API_KEY configured');

  let lastError;
  for (const key of keys) {
    const originalKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = key;

    try {
      const groqModule = require('./groq');
      const result = await groqModule[serviceMethod](...args);
      return result;
    } catch (err) {
      lastError = err;
      process.env.GROQ_API_KEY = originalKey;

      if (isDailyQuotaError(err)) {
        console.warn(`[AI] Groq key ...${key.slice(-6)} hit daily quota. Trying next key...`);
        continue;
      } else if (isRateLimitError(err)) {
        console.warn(`[AI] Groq transient rate limit. Waiting 8s...`);
        await sleep(8000);
        continue;
      } else {
        break;
      }
    }
  }
  throw lastError;
}

// ── Main dispatcher ──────────────────────────────────────────────────────
async function invoke(serviceMethod, ...args) {
  let lastError = null;

  // 1. Try OpenRouter first if valid key is set
  if (isValidKey(process.env.OPENROUTER_API_KEY)) {
    try {
      console.log(`[AI] OpenRouter '${serviceMethod}'...`);
      const result = await openrouter[serviceMethod](...args);
      console.log(`[AI] OpenRouter '${serviceMethod}' ✓`);
      return result;
    } catch (err) {
      console.error(`[AI] OpenRouter '${serviceMethod}' failed: ${err.message}`);
      lastError = err;
    }
  }

  // 2. Try Groq if valid key is set
  if (getGroqKeys().length > 0) {
    try {
      console.log(`[AI] Groq '${serviceMethod}'...`);
      const result = await tryGroq(serviceMethod, ...args);
      console.log(`[AI] Groq '${serviceMethod}' ✓`);
      return result;
    } catch (err) {
      console.error(`[AI] Groq '${serviceMethod}' all keys exhausted: ${err.message}`);
      lastError = err;
    }
  }

  // 3. Try Gemini ONLY if a valid AIzaSy key is set
  if (isValidGeminiKey(process.env.GEMINI_API_KEY)) {
    try {
      console.log(`[AI] Gemini '${serviceMethod}'...`);
      const result = await gemini[serviceMethod](...args);
      console.log(`[AI] Gemini '${serviceMethod}' ✓`);
      return result;
    } catch (err) {
      console.error(`[AI] Gemini '${serviceMethod}' failed: ${err.message}`);
      lastError = err;
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error('No valid AI API key configured. Please set OPENROUTER_API_KEY in server/.env.');
}

// ── Active provider label for health endpoint ───────────────────────────
function getActiveProviderName() {
  if (isValidKey(process.env.OPENROUTER_API_KEY)) return 'openrouter-free';
  if (getGroqKeys().length > 0) return 'groq-llama-3.3-70b';
  if (isValidGeminiKey(process.env.GEMINI_API_KEY)) return 'gemini-3.8-flash';
  return 'none';
}

module.exports = {
  isValidKey,
  isValidGeminiKey,
  analyzeProblem:     (...args) => invoke('analyzeProblem',     ...args),
  extractDocument:    (...args) => invoke('extractDocument',    ...args),
  comparePartners:    (...args) => invoke('comparePartners',    ...args),
  addPartnerFromText: (...args) => invoke('addPartnerFromText', ...args),
  activeProviderName: getActiveProviderName,
};
