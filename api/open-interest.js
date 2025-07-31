const coinglassAPI = require("./lib/coinglass");

module.exports = async (req, res) => {
  try {
    // 1️⃣ Fetch market data
    const response = await coinglassAPI.get("/futures/coins-markets?exchange_list=Binance");
    const coins = response.data?.data || [];

    if (!Array.isArray(coins) || coins.length === 0) {
      throw new Error("No market data received from Coinglass");
    }

    // 2️⃣ Calculate cumulative open interest
    const cumulativeOpenInterest = coins.reduce(
      (sum, coin) => sum + (coin.open_interest_usd || 0),
      0
    );

    // 3️⃣ Send response
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate"); // 1 min cache

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      cumulative_open_interest_usd: cumulativeOpenInterest,
      count: coins.length
    });
  } catch (err) {
    console.error("Error fetching Open Interest:", err.message);
    res.status(500).json({
      error: "Failed to load open interest",
      message: err.message
    });
  }
};
