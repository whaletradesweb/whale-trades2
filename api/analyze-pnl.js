// Fixed analyze-pnl.js for Vercel serverless function
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
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

  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: 'OpenAI API key not configured',
        message: 'OPENAI_API_KEY environment variable is missing'
      });
    }

    const { images } = req.body;
    if (!images?.length) {
      return res.status(400).json({ error: "No images provided" });
    }

    // Dynamic import for OpenAI (required for Vercel serverless)
    const { OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    const batches = [];
    for (let i = 0; i < images.length; i += 10) {
      batches.push(images.slice(i, i + 10));
    }

    const results = [];
    for (const batch of batches) {
      try {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              ...batch.map(img => ({ 
                type: "image_url", 
                image_url: { 
                  url: typeof img === 'string' ? img : (img.url || img.imageUrl)
                } 
              }))
            ]
          }],
          max_tokens: 1500
        });

        const content = response.choices[0].message.content;
        let parsed = [];
        try { parsed = JSON.parse(content); } catch {}
        if (!Array.isArray(parsed)) parsed = [parsed];

        parsed.forEach((t, i) => {
          // Include ALL trades for debugging, not just profitable ones
          if (t && (t.profit_percent !== undefined || t.image_type)) {
            const imgData = batch[i];
            results.push({
              profit_percent: t.profit_percent || 0,
              symbol: t.symbol || "UNKNOWN",
              direction: t.direction || "UNKNOWN",
              leverage: t.leverage || null,
              author: t.author || (typeof imgData === 'object' ? imgData.author : "unknown"),
              url: typeof imgData === 'string' ? imgData : (imgData.url || imgData.imageUrl),
              image_type: t.image_type || "unknown",
              description: t.description || "no description"
            });
          }
        });
      } catch (e) {
        console.error("GPT batch failed:", e);
      }
    }

    const best = results.length > 0
      ? results.reduce((a, b) => a.profit_percent > b.profit_percent ? a : b)
      : null;

    res.json({
      success: true,
      best_trade: best,
      total_processed: images.length,
      valid_trades: results.length,
      sample_results: results.slice(0, 5), // Show first 5 results for debugging
      profitable_trades: results.filter(t => t.profit_percent > 0).length,
      image_types: results.reduce((acc, t) => {
        acc[t.image_type] = (acc[t.image_type] || 0) + 1;
        return acc;
      }, {})
    });

  } catch (error) {
    console.error("Analysis failed:", error);
    res.status(500).json({ 
      error: "Analysis failed", 
      message: error.message 
    });
  }
}
