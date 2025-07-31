const coinglassAPI = require("./lib/coinglass");

module.exports = async (req, res) => {
  try {
    // Fetch market data from Coinglass
    const response = await coinglassAPI.get("/futures/coins-markets");
    const coins = response.data?.data || [];

    const timeframes = ['1h', '4h', '12h', '24h'];
    const aggregates = Object.fromEntries(timeframes.map(tf => [tf, { total: 0, long: 0, short: 0 }]));

    // Aggregate liquidation data for each timeframe
    coins.forEach(coin => timeframes.forEach(tf => {
      aggregates[tf].total += coin[`liquidation_usd_${tf}`] || 0;
      aggregates[tf].long += coin[`long_liquidation_usd_${tf}`] || 0;
      aggregates[tf].short += coin[`short_liquidation_usd_${tf}`] || 0;
    }));

    // Format numbers into human-readable USD (e.g., $1.2M)
    const formatUSD = (v) =>
      v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` :
      v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` :
      v >= 1e3 ? `$${(v / 1e3).toFixed(2)}K` :
      `$${v.toFixed(2)}`;

    const formatted = Object.fromEntries(
      timeframes.map(tf => [tf, {
        total: formatUSD(aggregates[tf].total),
        long: formatUSD(aggregates[tf].long),
        short: formatUSD(aggregates[tf].short)
      }])
    );

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(formatted);
  } catch (err) {
    console.error("Error fetching liquidation table:", err.message);
    res.status(500).json({
      error: "Failed to load liquidation table data",
      message: err.message
    });
  }
};
