const coinglassAPI = require("./lib/coinglass");

// Store one baseline value in memory
let previousTotal = null;
let previousTimestamp = null;

module.exports = async (req, res) => {
  try {
    // Fetch liquidation data
    const response = await coinglassAPI.get("/futures/liquidation/coin-list");
    const coins = response.data?.data || [];

    // Calculate total 24H liquidations
    const total24h = coins.reduce((sum, c) => sum + (c.liquidation_usd_24h || 0), 0);

    const now = Date.now();
    let percentChange = 0;

    if (previousTotal !== null && previousTimestamp && (now - previousTimestamp) < 24 * 60 * 60 * 1000) {
      // ✅ Rolling 24H comparison
      percentChange = ((total24h - previousTotal) / previousTotal) * 100;
      console.log(`[Liquidations API] Calculated % change: ${percentChange.toFixed(2)}% (baseline from ${new Date(previousTimestamp).toUTCString()})`);
    } else {
      // ✅ Set or refresh baseline
      previousTotal = total24h;
      previousTimestamp = now;
      console.log(`[Liquidations API] New baseline stored: ${previousTotal.toFixed(2)} at ${new Date(previousTimestamp).toUTCString()}`);
    }

    // Respond with current total and % change
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      total_liquidations_24h: total24h,
      percent_change_24h: percentChange,
      baseline_timestamp: new Date(previousTimestamp).toUTCString() // ✅ For debugging in API response
    });

  } catch (err) {
    console.error("Error fetching Liquidations:", err.message);
    res.status(500).json({
      error: "Failed to load liquidation data",
      message: err.message
    });
  }
};
