const axios = require("axios");
const { createClient } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

// ✅ Explicitly connect KV using the prefixed variables you have
const kv = createClient({
  url: process.env.KV_REST_API_KV_URL, 
  token: process.env.KV_REST_API_KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets?exchange_list=Binance";

    const response = await axios.get(url, { headers });
    const coins = response.data?.data || [];

    if (!Array.isArray(coins) || coins.length === 0) {
      throw new Error("Coinglass returned empty or malformed data");
    }

    const totalOpenInterest = coins.reduce((sum, coin) => sum + (coin.open_interest_usd || 0), 0);

    // ✅ KV Baseline
    let previousOI = await kv.get("open_interest:previous_total");
    let previousTimestamp = await kv.get("open_interest:timestamp");
    const now = Date.now();
    let percentChange = 0;

    if (previousOI && previousTimestamp && (now - previousTimestamp) < 24 * 60 * 60 * 1000) {
      percentChange = ((totalOpenInterest - previousOI) / previousOI) * 100;
    } else {
      await kv.set("open_interest:previous_total", totalOpenInterest);
      await kv.set("open_interest:timestamp", now);
      previousOI = totalOpenInterest;
      previousTimestamp = now;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      total_open_interest_usd: totalOpenInterest,
      open_interest_change_24h: percentChange,
      baseline_timestamp: new Date(previousTimestamp).toUTCString()
    });

  } catch (err) {
    console.error("Error fetching Open Interest:", err.message);
    res.status(500).json({ error: "Failed to load Open Interest data", message: err.message });
  }
};
