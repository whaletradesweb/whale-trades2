import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PROMPT = `You are a trading analyst. Extract the MOST PROFITABLE closed trade from each image.

Return a JSON array of objects with:
{
  "profit_percent": float,
  "symbol": string,
  "direction": "LONG" or "SHORT",
  "leverage": string or null,
  "author": string (if visible)
}

Only include trades with positive profit %.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { images } = req.body;
  if (!images?.length) return res.status(400).json({ error: "No images" });

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
            ...batch.map(img => ({ type: "image_url", image_url: { url: img.url } }))
          ]
        }],
        max_tokens: 1500
      });

      const content = response.choices[0].message.content;
      let parsed = [];
      try { parsed = JSON.parse(content); } catch {}
      if (!Array.isArray(parsed)) parsed = [parsed];

      parsed.forEach((t, i) => {
        if (t?.profit_percent > 0) {
          results.push({
            profit_percent: t.profit_percent,
            symbol: t.symbol || "UNKNOWN",
            direction: t.direction || "UNKNOWN",
            leverage: t.leverage || null,
            author: batch[i].author || "unknown",
            url: batch[i].url
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
    best_trade: best,
    total_processed: images.length,
    valid_trades: results.length
  });
}
