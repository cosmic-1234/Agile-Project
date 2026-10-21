const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { analyzeProblem, extractDocument } = require('../services/ai');
const { parseDocument } = require('../services/documentParser');
const { getPartners, getAnalyses, saveAnalyses } = require('../services/db');

const tempDir = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}_${file.originalname}`);
  }
});

const upload = multer({ 
  storage, 
  limits: { fileSize: 250 * 1024 * 1024 } // Support up to 250MB uploads
});

// POST /api/analyze/text - Analyze client problem from text
router.post('/text', async (req, res) => {
  try {
    const { problemText } = req.body;

    if (!problemText || problemText.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a detailed problem description (at least 10 characters)' });
    }

    const partners = await getPartners();
    const result = await analyzeProblem(problemText, partners, { industry: 'Manufacturing' });

    // Save analysis
    const analysis = {
      id: uuidv4(),
      type: 'text',
      timestamp: new Date().toISOString(),
      input: { problemText, industry: 'Manufacturing' },
      result,
      partnerCount: result.rankedPartners?.length || 0
    };

    const analyses = await getAnalyses();
    analyses.unshift(analysis);
    // Keep last 100 analyses
    if (analyses.length > 100) analyses.length = 100;
    await saveAnalyses(analyses);

    res.json(analysis);
  } catch (error) {
    console.error('Analysis error:', error);
    const isRateLimit = error.message && (
      error.message.includes('429') ||
      error.message.includes('rate limit') ||
      error.message.includes('quota') ||
      error.message.includes('tokens per day')
    );
    if (isRateLimit) {
      return res.status(503).json({
        error: 'AI provider is temporarily busy',
        details: error.message || 'Upstream provider is temporarily busy. Please wait a moment and retry.',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
    res.status(500).json({ error: error.message || 'Analysis failed', details: error.message });
  }
});

// POST /api/analyze/document - Analyze from uploaded document
router.post('/document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No document uploaded' });
    }

    // Step 1: Extract text from document
    let documentText;
    try {
      documentText = await parseDocument(req.file.path, req.file.mimetype, req.file.originalname);
    } finally {
      // Ensure file is deleted from temp directory immediately
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }

    if (!documentText || documentText.trim().length < 20) {
      return res.status(400).json({ error: 'Could not extract sufficient text from the document' });
    }

    // Step 2: Use Google Gemini to extract structured information
    const extraction = await extractDocument(documentText);

    if (!extraction) {
      return res.status(400).json({ error: 'AI document extraction failed. Please ensure the document is not empty or corrupted.' });
    }

    const safeJoin = (val) => {
      if (Array.isArray(val)) return val.join('; ');
      if (typeof val === 'string') return val;
      return 'Not specified';
    };

    // Step 3: Build problem text from extraction
    const problemText = `
Client: ${extraction.clientName || 'Not specified'}
Problem: ${extraction.problemStatement || extraction.summary || 'Not specified'}
Business Challenges: ${safeJoin(extraction.businessChallenges)}
Technical Requirements: ${safeJoin(extraction.technicalRequirements)}
Industry: ${extraction.industry || 'Not specified'}
Domain: ${extraction.domain || 'Not specified'}
Budget: ${extraction.budgetInfo || 'Not specified'}
Timeline: ${extraction.timelineInfo || 'Not specified'}
Technology Preferences: ${safeJoin(extraction.technologyPreferences)}
Success Criteria: ${safeJoin(extraction.successCriteria)}
    `.trim();

    // Step 4: Analyze against partners
    const partners = await getPartners();
    const result = await analyzeProblem(problemText, partners, {
      industry: 'Manufacturing'
    });

    // Save analysis
    const analysis = {
      id: uuidv4(),
      type: 'document',
      timestamp: new Date().toISOString(),
      input: {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        extraction,
        problemText
      },
      result,
      partnerCount: result.rankedPartners?.length || 0
    };

    const analyses = await getAnalyses();
    analyses.unshift(analysis);
    if (analyses.length > 100) analyses.length = 100;
    await saveAnalyses(analyses);

    res.json(analysis);
  } catch (error) {
    console.error('Document analysis error:', error);
    const isRateLimit = error.message && (
      error.message.includes('429') ||
      error.message.includes('rate limit') ||
      error.message.includes('quota') ||
      error.message.includes('tokens per day')
    );
    if (isRateLimit) {
      return res.status(503).json({
        error: 'AI provider is temporarily busy',
        details: error.message || 'Upstream provider is temporarily busy. Please wait a moment and retry.',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
    res.status(500).json({ error: error.message || 'Document analysis failed', details: error.message });
  }
});

// GET /api/analyze/history - Get analysis history
router.get('/history', async (req, res) => {
  try {
    const analyses = await getAnalyses();
    const limit = parseInt(req.query.limit) || 20;
    res.json({
      analyses: analyses.slice(0, limit),
      total: analyses.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history', details: error.message });
  }
});

// GET /api/analyze/:id - Get single analysis
router.get('/:id', async (req, res) => {
  try {
    const analyses = await getAnalyses();
    const analysis = analyses.find(a => a.id === req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analysis', details: error.message });
  }
});

module.exports = router;
