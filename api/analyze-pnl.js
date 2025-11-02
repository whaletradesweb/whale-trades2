// Robust analyze-pnl.js with better error handling
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

    // Get and validate images array and authors
    let { images, authors } = req.body;
    
    console.log('DEBUG: Raw req.body:', JSON.stringify(req.body, null, 2));
    console.log('DEBUG: Images received:', JSON.stringify(images, null, 2));
    console.log('DEBUG: Authors received:', JSON.stringify(authors, null, 2));
    console.log('DEBUG: Images type:', typeof images);
    console.log('DEBUG: Authors type:', typeof authors);
    console.log('DEBUG: Images is array:', Array.isArray(images));
    
    // Handle different input formats for images
    if (!images) {
      return res.status(400).json({ error: "No images field in request body" });
    }
    
    // Handle double-encoded JSON from Zapier for images
    if (typeof images === 'string') {
      try {
        const parsed = JSON.parse(images);
        if (parsed.images && Array.isArray(parsed.images)) {
          images = parsed.images;
          console.log('DEBUG: Parsed double-encoded JSON for images, found', images.length, 'images');
        } else {
          // Check if it's a comma-separated string from Zapier
          if (images.includes(',')) {
            images = images.split(',').map(url => url.trim());
            console.log('DEBUG: Split comma-separated images string, found', images.length, 'images');
          } else {
            images = [images];
          }
        }
      } catch (parseError) {
        if (images.includes(',')) {
          images = images.split(',').map(url => url.trim());
          console.log('DEBUG: Split comma-separated images string, found', images.length, 'images');
        } else {
          images = [images];
        }
      }
    }
    
    // Handle authors field - should be comma-separated string matching images
    let authorsArray = [];
    if (authors) {
      if (typeof authors === 'string') {
        if (authors.includes(',')) {
          authorsArray = authors.split(',').map(author => author.trim());
          console.log('DEBUG: Split comma-separated authors string, found', authorsArray.length, 'authors');
        } else {
          authorsArray = [authors.trim()];
        }
      } else if (Array.isArray(authors)) {
        authorsArray = authors;
      }
    }
    
    // Ensure we have the same number of authors as images
    while (authorsArray.length < images.length) {
      authorsArray.push('unknown');
    }
    
    console.log('DEBUG: Final images array length:', images.length);
    console.log('DEBUG: Final authors array length:', authorsArray.length);
    console.log('DEBUG: Authors mapping:', authorsArray);
    
    // Convert to array if it's not already
    if (!Array.isArray(images)) {
      images = [images];
    }
    
    if (images.length === 0) {
      return res.status(400).json({ error: "Images array is empty" });
    }

    console.log(`DEBUG: Processing ${images.length} images`);

    // Dynamic import for OpenAI (required for Vercel serverless)
    const { OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

    // Process in smaller batches to avoid errors
    const batchSize = 5; // Reduced from 10
    const results = [];
    let imageIndex = 0; // Track overall image index for author mapping
    
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const batchAuthors = authorsArray.slice(i, i + batchSize); // Get corresponding authors
      
      console.log(`DEBUG: Processing batch ${Math.floor(i/batchSize) + 1}, ${batch.length} images`);
      console.log(`DEBUG: Batch content:`, JSON.stringify(batch, null, 2));
      console.log(`DEBUG: Batch authors:`, JSON.stringify(batchAuthors, null, 2));
      
      // Ensure batch is an array and has valid items
      if (!Array.isArray(batch)) {
        console.error('ERROR: Batch is not an array:', batch);
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
            console.warn('Skipping invalid image:', img);
            continue;
          }
          
          if (imageUrl && typeof imageUrl === 'string') {
            content.push({
              type: "image_url",
              image_url: { url: imageUrl }
            });
          }
        }
        
        console.log(`DEBUG: Sending ${content.length - 1} images to OpenAI`);
        
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: content
          }],
          max_tokens: 1500
        });

        const responseContent = response.choices[0].message.content;
        console.log(`DEBUG: GPT response:`, responseContent);
        
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
          console.log(`DEBUG: Successfully parsed GPT response, found ${parsed.length} items`);
        } catch (parseError) {
          console.log("DEBUG: Failed to parse GPT response as JSON:", parseError);
          console.log("DEBUG: Raw response:", responseContent);
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
            
            console.log(`DEBUG: Mapping image ${batchIndex} to author: ${authorName}`);
            
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
        console.error("DEBUG: GPT batch failed:", batchError);
      }
    }

    // Find best trade (most profitable)
    const profitableTrades = results.filter(t => t.profit_percent > 0);
    const best = profitableTrades.length > 0
      ? profitableTrades.reduce((a, b) => a.profit_percent > b.profit_percent ? a : b)
      : null;

    console.log(`DEBUG: Analysis complete. Found ${results.length} total results, ${profitableTrades.length} profitable`);

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
    console.error("Analysis failed:", error);
    res.status(500).json({ 
      error: "Analysis failed", 
      message: error.message,
      stack: error.stack
    });
  }
}
