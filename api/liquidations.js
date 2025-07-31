const coinglassAPI = require("./lib/coinglass");

module.exports = async (req, res) => {
  try {
    // 1️⃣ Fetch liquidation coin list
    const response = await coinglassAPI.get("/futures/liquidation/coin-list");
    const coins = response.data?.data || [];

    if (!Array.isArray(coins) || coins.length === 0) {
      throw new Error("No liquidation data received from Coinglass");
    }

    // 2️⃣ Calculate total liquidation for past 24H
    const total24h = coins.reduce((sum, coin) => sum + (coin.liquidation_usd_24h || 0), 0);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      total_liquidations_24h: total24h,
      formatted: formatUSD(total24h)
    });

  } catch (err) {
    console.error("Error fetching Liquidations:", err.message);
    res.status(500).json({
      error: "Failed to load liquidation data",
      message: err.message
    });
  }
};

// Helper: Format USD (e.g., $1.23B)
function formatUSD(value) {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}
