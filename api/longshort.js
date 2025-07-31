const coinglassAPI = require("./lib/coinglass");

module.exports = async (req, res) => {
  try {
    // 1️⃣ Fetch market data
    const response = await coinglassAPI.get("/futures/coins-markets");
    const coins = response.data?.data || [];

    if (!Array.isArray(coins) || coins.length === 0) {
      throw new Error("No market data received from Coinglass");
    }

    // 2️⃣ Sort by market cap, take top 10 with valid long/short ratio
    const top10 = coins
      .filter(c => c.long_short_ratio_24h != null)
      .sort((a, b) => b.market_cap_usd - a.market_cap_usd)
      .slice(0, 10);

    if (top10.length === 0) throw new Error("No valid long/short ratios found for top coins");

    // 3️⃣ Calculate average long/short ratio
    const avgRatio = top10.reduce((sum, coin) => sum + coin.long_short_ratio_24h, 0) / top10.length;

    // 4️⃣ Convert to percentages
    const avgLongPct = (avgRatio / (1 + avgRatio)) * 100;
    const avgShortPct = 100 - avgLongPct;

    // 5️⃣ Send response
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      long_pct: avgLongPct.toFixed(2),
      short_pct: avgShortPct.toFixed(2),
      average_ratio: avgRatio.toFixed(4),
      sampled_coins: top10.map(c => ({
        symbol: c.symbol,
        market_cap_usd: c.market_cap_usd,
        long_short_ratio_24h: c.long_short_ratio_24h
      }))
    });
  } catch (err) {
    console.error("Error fetching Long/Short ratio:", err.message);
    res.status(500).json({
      error: "Failed to load long/short ratio",
      message: err.message
    });
  }
};
