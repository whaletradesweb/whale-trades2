// Robust analyze-pnl.js with better error handling
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const { authorized, normalizeImages, validateImages, reserveBudget } = require('../lib/analysis-security.cjs');
const { kv } = require('@vercel/kv');
require('../lib/runtime-security.cjs').reportRuntime();

const PROMPT = `You are a trading analyst. Analyze each image and extract ANY trading information you can find.

Return a JSON array of objects with:
{
  "profit_percent": float (can be negative),
  "symbol": string,
  "direction": "LONG" or "SHORT",
  "leverage": string or null,
  "author": string (if visible),
  "image_type": "pnl_screenshot" or "chart" or "other",
  "description": "brief description of what you see"
}

Include ALL trades, even losses. If no trading data is found, return {"image_type": "other", "description": "what you see"}.`;

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Allow both GET and POST for testing
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Handle GET request for testing
  if (req.method === 'GET') {
    return res.json({ 
      message: 'P&L Analysis endpoint is working. Send POST with images array.',
      required_body: {
        images: ['url1', 'url2', '...']
      }
    });
  }

  if (!authorized(req, process.env.ANALYZE_PNL_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'A JSON request body is required' });
  }

  const normalizedImages = normalizeImages(req.body.images);
  const validationError = validateImages(normalizedImages);
  if (validationError) {
    return res.status(normalizedImages.length > 100 ? 413 : 400).json({ error: validationError });
  }

  try {
    if (!(await reserveBudget(kv, normalizedImages.length))) {
      res.setHeader('Retry-After', String(3600 - Math.floor(Date.now() / 1000) % 3600));
      return res.status(429).json({ error: 'Analysis image limit reached. Try again later.' });
    }
  } catch (_) {
    console.error('Analysis rate limiter unavailable');
    return res.status(503).json({ error: 'Analysis temporarily unavailable' });
  }

  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured',
        message: 'OPENAI_API_KEY environment variable is missing'
      });
    }

    // Get and validate images array and authors
    const images = normalizedImages;
    const { authors } = req.body;

// Handle authors field - should be comma-separated string matching images
    let authorsArray = [];
    if (authors) {
      if (typeof authors === 'string') {
        if (authors.includes(',')) {
          authorsArray = authors.split(',').map(author => author.trim());

        } else {
          authorsArray = [authors.trim()];
        }
      } else if (Array.isArray(authors)) {
        authorsArray = authors.map(author => typeof author === 'string' ? author : 'unknown');
      }
    }
    
    // Ensure we have the same number of authors as images
    while (authorsArray.length < images.length) {
      authorsArray.push('unknown');
    }

    // Dynamic import for OpenAI (required for Vercel serverless)
    const { OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 30000, maxRetries: 1 });

    // Process in smaller batches to avoid errors
    const batchSize = 5; // Reduced from 10
    const results = [];
    
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const batchAuthors = authorsArray.slice(i, i + batchSize); // Get corresponding authors

      // Ensure batch is an array and has valid items
      if (!Array.isArray(batch)) {
        console.error('Invalid analysis batch');
        continue;
      }
      
      try {
        // Build the content array safely
        const content = [{ type: "text", text: PROMPT }];
        
        // Add each image safely
        for (const img of batch) {
          let imageUrl;
          
          if (typeof img === 'string') {
            imageUrl = img;
          } else if (img && typeof img === 'object') {
            imageUrl = img.url || img.imageUrl || img.href || String(img);
          } else {
            console.warn('Skipping invalid image');
            continue;
          }
          
          if (imageUrl && typeof imageUrl === 'string') {
            content.push({
              type: "image_url",
              image_url: { url: imageUrl }
            });
          }
        }

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: content
          }],
          max_tokens: 1500
        });

        const responseContent = response.choices[0].message.content;

        let parsed = [];
        try { 
          // Remove markdown code blocks if present
          let cleanContent = responseContent.trim();
          if (cleanContent.startsWith('```json')) {
            cleanContent = cleanContent.replace(/```json\s*/, '').replace(/\s*```$/, '');
          } else if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.replace(/```\s*/, '').replace(/\s*```$/, '');
          }
          
          parsed = JSON.parse(cleanContent); 

        } catch (parseError) {

          continue;
        }
        
        if (!Array.isArray(parsed)) {
          parsed = [parsed];
        }

        // Process results and map authors correctly by batch index
        parsed.forEach((trade, batchIndex) => {
          if (trade && typeof trade === 'object') {
            const imgData = batch[batchIndex];
            
            // Get the correct author for this image using batch index
            const authorName = batchAuthors[batchIndex] || "unknown";

            results.push({
              profit_percent: trade.profit_percent || 0,
              symbol: trade.symbol || "UNKNOWN",
              direction: trade.direction || "UNKNOWN",
              leverage: trade.leverage || null,
              author: authorName, // Use the correctly mapped author
              url: typeof imgData === 'string' ? imgData : (imgData?.url || imgData?.imageUrl || "unknown"),
              image_type: trade.image_type || "unknown",
              description: trade.description || "no description"
            });
          }
        });
        
      } catch (batchError) {
        console.error('Analysis batch failed');
      }
    }

    // Find best trade (most profitable)
    // Filter out profitable trades and exclude banned users
const bannedUsers = ['slavic8105']; // Add users to exclude here
const profitableTrades = results.filter(t => {
  const hasValidProfit = t.profit_percent > 0;
  const isNotBanned = !bannedUsers.includes(t.author?.toLowerCase());
  
  
  return hasValidProfit && isNotBanned;
});
    const best = profitableTrades.length > 0
      ? profitableTrades.reduce((a, b) => a.profit_percent > b.profit_percent ? a : b)
      : null;

    // Calculate statistics
    const imageTypes = results.reduce((acc, t) => {
      acc[t.image_type] = (acc[t.image_type] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      best_trade: best,
      total_processed: images.length,
      valid_trades: results.length,
      profitable_trades: profitableTrades.length,
      sample_results: results.slice(0, 5),
      image_types: imageTypes
    });

  } catch (error) {
    console.error('Analysis failed');
    res.status(500).json({ 
      error: "Analysis failed"
    });
  }
}
