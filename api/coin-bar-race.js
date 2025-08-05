const axios = require("axios");
const { kv } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const cacheKey = "coin-bar-race:frames";
    const cacheTimestampKey = "coin-bar-race:timestamp";

    // 1️⃣ Check cache for historical frames
    const cachedFrames = await kv.get(cacheKey);
    const cachedTimestamp = await kv.get(cacheTimestampKey);
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    let frames;
    if (cachedFrames && cachedTimestamp && (now - cachedTimestamp) < oneDay) {
      console.log("[Cache Hit] Using cached historical frames");
      frames = cachedFrames;
    } else {
      console.log("[Cache Miss] Fetching fresh historical data...");

      // Fetch current top 20 coins by market cap
      const marketRes = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
      const coins = marketRes.data?.data || [];
      const top20 = coins.sort((a, b) => b.market_cap_usd - a.market_cap_usd).slice(0, 20).map(c => c.symbol);

      // Fetch 4 years of weekly price history for each coin
      const endTime = now;
      const startTime = endTime - (4 * 365 * 24 * 60 * 60 * 1000); // 4 years
      const interval = "1w";

      const historyData = {};
      for (const symbol of top20) {
        const priceUrl = `https://open-api-v4.coinglass.com/api/futures/price/history?symbol=${symbol}USDT&interval=${interval}&start_time=${startTime}&end_time=${endTime}`;
        const priceRes = await axios.get(priceUrl, { headers });
        const prices = priceRes.data?.data || [];
        if (prices.length) {
          const base = prices[0].close;
          historyData[symbol] = prices.map(p => ({
            date: new Date(p.time).toISOString().split("T")[0],
            value: ((p.close / base) - 1) * 100 // normalize % change
          }));
        }
      }

      // Build frames (weekly)
      const allDates = [...new Set(Object.values(historyData).flat().map(d => d.date))].sort();
      frames = allDates.map(date => {
        const ranked = Object.entries(historyData)
          .map(([coin, data]) => ({ name: coin, value: data.find(d => d.date === date)?.value || 0 }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 20);
        return { date, ranked };
      });

      // Cache historical frames for 24h
      await kv.set(cacheKey, frames);
      await kv.set(cacheTimestampKey, now);
    }

    // 2️⃣ Fetch live top 20 prices for final frame
    const liveRes = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
    const liveCoins = liveRes.data?.data || [];
    const liveTop20 = liveCoins.sort((a, b) => b.market_cap_usd - a.market_cap_usd).slice(0, 20);

    // Build live frame using cached base prices for normalization
    const liveFrame = liveTop20.map(c => {
      const history = frames[0]?.ranked.find(h => h.name === c.symbol);
      const baseValue = history ? history.value : c.current_price;
      return {
        name: c.symbol,
        value: baseValue ? ((c.current_price / (baseValue / 100 + 1)) - 1) * 100 : 0
      };
    }).sort((a, b) => b.value - a.value);

    res.json({ frames, liveFrame, lastUpdated: new Date().toISOString() });

  } catch (err) {
    console.error("Error fetching bar race data:", err.message);
    res.status(500).json({ error: "Failed to fetch bar race data", message: err.message });
  }
};
