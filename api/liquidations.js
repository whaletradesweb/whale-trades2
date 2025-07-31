const coinglassAPI = require("./lib/coinglass");

module.exports = async (req, res) => {
  try {
    // Fetch liquidation data from Coinglass
    const response = await coinglassAPI.get("/futures/liquidation/coin-list");

    const coinData = response.data?.data || [];
    const total24h = coinData.reduce((sum, coin) => sum + (coin.liquidation_usd_24h || 0), 0);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      total24h: Math.round(total24h),
      change24h: 0
    });
  } catch (err) {
    console.error("Error fetching Liquidations:", err.message);
    res.status(500).json({
      error: "Failed to load liquidation data",
      message: err.message
    });
  }
};
