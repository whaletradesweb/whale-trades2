const axios = require("axios");
const { kv } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, symbol = "BTC", exchange = "Binance", action } = req.query;

  try {
    console.log(`DEBUG: Processing request for type: ${type}`);

    if (!COINGLASS_API_KEY) {
      return res.status(500).json({
        error: 'API key not configured',
        message: 'COINGLASS_API_KEY environment variable is missing'
      });
    }

    const headers = {
      'accept': 'application/json',
      'CG-API-KEY': COINGLASS_API_KEY,
      'User-Agent': 'Mozilla/5.0 (compatible; API-Client/1.0)'
    };

    switch (type) {
      // --------------------------
      // DEBUG ROUTE
      // --------------------------
      case "debug-env": {
        return res.json({
          exists: !!COINGLASS_API_KEY,
          length: COINGLASS_API_KEY?.length || 0,
          masked: COINGLASS_API_KEY?.slice(0, 4) + "****" || null,
          environment: process.env.VERCEL_ENV || "unknown"
        });
      }

      // --------------------------
      // VOLUME TOTAL (NEW ENDPOINT)
      // --------------------------
      case "volume-total": {
        try {
          console.log("[Volume API] Starting request...");

          const response = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
          console.log("[Volume API] Status:", response.status);

          const coins = response.data?.data || [];
          console.log("[Volume API] Coins length:", coins.length);

          if (!Array.isArray(coins) || coins.length === 0) {
            throw new Error("No market data received from Coinglass");
          }

          // ✅ Calculate cumulative 24h volume
          const totalVolume24h = coins.reduce((sum, coin) =>
            sum + (typeof coin.volume_change_usd_24h === "number" ? Math.abs(coin.volume_change_usd_24h) : 0),
          0);

          console.log("[Volume API] Total Volume:", totalVolume24h);

          // ✅ Percent Change Logic (Safe KV Handling)
          const now = Date.now();
          let percentChange = 0;
          let previousVolume = null;
          let previousTimestamp = null;

          try {
            previousVolume = await kv.get("volume:previous_total");
            previousTimestamp = await kv.get("volume:timestamp");
          } catch (kvErr) {
            console.warn("[Volume API] KV not available or first run:", kvErr.message);
          }

          if (previousVolume && previousTimestamp && (now - previousTimestamp) < 24 * 60 * 60 * 1000) {
            percentChange = ((totalVolume24h - previousVolume) / previousVolume) * 100;
          } else {
            await kv.set("volume:previous_total", totalVolume24h);
            await kv.set("volume:timestamp", now);
          }

          return res.json({
            total_volume_24h: totalVolume24h,
            percent_change_24h: percentChange,
            baseline_timestamp: previousTimestamp ? new Date(previousTimestamp).toUTCString() : new Date(now).toUTCString()
          });

        } catch (err) {
          console.error("[Volume API Error]", err);
          return res.status(500).json({ error: "Volume API failed", message: err.message });
        }
      }

      // --------------------------
      // OTHER EXISTING CASES
      // --------------------------
      // Keep your existing cases here (altcoin-season, etf-btc-flows, open-interest, etc.)
      // Ensure each case ends with a proper `return res.json(...)` or break

      default:
        return res.status(400).json({ error: "Invalid type parameter" });
    }

  } catch (err) {
    console.error(`API Error (${type}):`, err.message);

    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: "Network connection failed", message: "Unable to connect to CoinGlass API." });
    }

    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      return res.status(504).json({ error: "Request timeout", message: "CoinGlass API request timed out." });
    }

    if (err.response) {
      return res.status(err.response.status || 500).json({
        error: "API request failed",
        message: err.response.data?.message || err.message,
        status: err.response.status
      });
    }

    if (err.request) {
      return res.status(503).json({ error: "No response from API", message: "CoinGlass API did not respond." });
    }

    return res.status(500).json({ error: "Request setup failed", message: err.message });
  }
};
