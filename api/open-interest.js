const axios = require("axios");
const { kv } = require("@vercel/kv"); // ✅ KV storage for persistence
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets?exchange_list=Binance";

    const response = await axios.get(url, { headers });
    const coins = response.data?.data || [];

    // ✅ Sum cumulative Open Interest USD
    const totalOpenInterest = coins.reduce((sum, coin) => sum + (coin.open_interest_usd || 0), 0);

    // ✅ Load baseline from KV
    let previousOI = await kv.get("open_interest:previous_total");
    let previousTimestamp = await kv.get("open_interest:timestamp");
    const now = Date.now();
    let percentChange = 0;

    if (previousOI && previousTimestamp && (now - previousTimestamp) < 24 * 60 * 60 * 1000) {
      // Calculate rolling 24-hour % change
      percentChange = ((totalOpenInterest - previousOI) / previousOI) * 100;
      console.log(`[Open Interest] % Change: ${percentChange.toFixed(2)}% (baseline: ${new Date(previousTimestamp).toUTCString()})`);
    } else {
      // Store new baseline
      await kv.set("open_interest:previous_total", totalOpenInterest);
      await kv.set("open_interest:timestamp", now);
      previousOI = totalOpenInterest;
      previousTimestamp = now;
      console.log(`[Open Interest] New baseline stored: ${previousOI.toFixed(2)} at ${new Date(previousTimestamp).toUTCString()}`);
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
