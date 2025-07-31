const axios = require("axios");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const headers = { "CG-API-KEY": COINGLASS_API_KEY };
    const response = await axios.get("https://open-api-v4.coinglass.com/api/futures/liquidation/coin-list", { headers });

    const coinData = response.data?.data || [];
    const total24h = coinData.reduce((sum, coin) => sum + (coin.liquidation_usd_24h || 0), 0);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ total24h: Math.round(total24h), change24h: 0 });
  } catch (err) {
    console.error("Error fetching Liquidations:", err.message);
    res.status(500).json({ error: "Failed to load liquidation data", message: err.message });
  }
};
