require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const analysesPath = path.join(dataDir, 'analyses.json');
if (!fs.existsSync(analysesPath)) {
  fs.writeFileSync(analysesPath, '[]');
}

// Routes
app.use('/api/partners', require('./routes/partners'));
app.use('/api/analyze', require('./routes/analyze'));
app.use('/api/compare', require('./routes/compare'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/export', require('./routes/export'));
// Serve static assets in production if built
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  console.log(`  Serving static assets from: ${clientDistPath}`);
  app.use(express.static(clientDistPath));
  
  // Wildcard handler to support client-side routing (React Router)
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Health check
app.get('/api/health', (req, res) => {
  const { activeProviderName, isValidKey, isValidGeminiKey } = require('./services/ai');
  const hasValidKey = isValidKey(process.env.OPENROUTER_API_KEY) ||
                      isValidKey(process.env.GROQ_API_KEY) ||
                      isValidGeminiKey(process.env.GEMINI_API_KEY);
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    apiKeyConfigured: hasValidKey,
    activeProvider: typeof activeProviderName === 'function' ? activeProviderName() : activeProviderName,
    openrouterConfigured: isValidKey(process.env.OPENROUTER_API_KEY),
    groqConfigured: isValidKey(process.env.GROQ_API_KEY),
    geminiConfigured: isValidGeminiKey(process.env.GEMINI_API_KEY),
    groqKeys: [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3].filter(isValidKey).length,
  });
});

// AI Credits endpoint — fetches live usage from OpenRouter or returns provider status
app.get('/api/credits', async (req, res) => {
  try {
    const { isValidKey } = require('./services/ai');

    if (isValidKey(process.env.OPENROUTER_API_KEY)) {
      try {
        const resp = await fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` }
        });
        if (resp.ok) {
          const json = await resp.json();
          const data = json.data || json;
          const isFree = data.is_free_tier ?? true;
          const usage  = data.usage  ?? 0;
          const limit  = data.limit  ?? null;

          return res.json({
            provider: 'OpenRouter (Llama 3.3 70B)',
            isFree,
            creditsUsed:      isFree ? null : usage,
            creditsRemaining: isFree ? null : (limit ? limit - usage : null),
            creditLimit:      isFree ? null : limit,
            usagePct:         (!isFree && limit) ? Math.round((usage / limit) * 100) : 0,
            rateLimit:        data.rate_limit || null,
            status:           isFree ? 'free_unlimited' : (limit && usage >= limit * 0.9 ? 'near_limit' : 'ok'),
            label:            isFree ? '∞ Free Tier — No Daily Limit' : `$${(limit - usage).toFixed(4)} remaining of $${limit?.toFixed(2)}`,
          });
        }
      } catch (e) {
        console.warn('[Credits] OpenRouter fetch failed, falling through:', e.message);
      }
    }

    if (isValidKey(process.env.GROQ_API_KEY)) {
      const groqKeys = [
        process.env.GROQ_API_KEY,
        process.env.GROQ_API_KEY_2,
        process.env.GROQ_API_KEY_3,
      ].filter(isValidKey).length;
      return res.json({
        provider: 'Groq (Llama 3.3 70B)',
        isFree: true,
        creditsUsed: null,
        creditsRemaining: null,
        status: 'ok',
        groqKeys,
        label: `Free tier · ${groqKeys} key${groqKeys > 1 ? 's' : ''} · 100K tokens/day each`,
      });
    }

    const { isValidGeminiKey } = require('./services/ai');
    if (isValidGeminiKey(process.env.GEMINI_API_KEY)) {
      return res.json({
        provider: 'Google Gemini (3.8 Flash)',
        isFree: true,
        creditsUsed: null,
        creditsRemaining: null,
        status: 'ok',
        label: 'Gemini Free Tier · 1,500 req/day',
      });
    }

    res.json({
      provider: 'None',
      isFree: true,
      creditsUsed: null,
      creditsRemaining: null,
      status: 'no_key',
      label: '⚠️ No API key set in server/.env',
    });
  } catch (err) {
    console.error('[Credits]', err.message);
    res.json({
      provider: 'None',
      isFree: true,
      creditsUsed: null,
      creditsRemaining: null,
      status: 'error',
      label: 'API key not configured',
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

app.listen(PORT, async () => {
  const { activeProviderName, isValidKey, isValidGeminiKey } = require('./services/ai');
  const { useMongo, getPartners } = require('./services/db');
  const active = typeof activeProviderName === 'function' ? activeProviderName() : activeProviderName;
  console.log(`\n  Partnership Fitment Agent API Server`);
  console.log(`  ────────────────────────────────────`);
  console.log(`  Running on: http://localhost:${PORT}`);
  console.log(`  OpenRouter (Free):     ${isValidKey(process.env.OPENROUTER_API_KEY) ? 'Configured ✓ PRIMARY' : 'NOT SET'}`);
  console.log(`  Groq (Llama 3.3 70B):  ${isValidKey(process.env.GROQ_API_KEY) ? 'Configured ✓' : 'NOT SET'}`);
  console.log(`  Gemini (3.8 Flash):    ${isValidGeminiKey(process.env.GEMINI_API_KEY) ? 'Configured ✓' : 'NOT SET'}`);
  console.log(`  Active Provider:       ${active.toUpperCase()} ⚡`);
  console.log(`  Database Mode:      ${useMongo ? 'MongoDB 🗄️' : 'Local JSON Files 📁'}`);
  
  if (useMongo) {
    try {
      await getPartners();
    } catch (e) {
      console.error('  MongoDB connection test failed:', e.message);
    }
  }
  console.log(`  Data dir:           ${dataDir}`);
  console.log('');
});
