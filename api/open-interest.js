const axios = require("axios");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets?exchange_list=Binance";

    const response = await axios.get(url, { headers });
    const coins = response.data?.data || [];

    if (!Array.isArray(coins) || coins.length === 0) {
      throw new Error("Coinglass returned empty or malformed data");
    }

    // ✅ Sum cumulative Open Interest USD across all coins
    const totalOpenInterest = coins.reduce((sum, coin) => sum + (coin.open_interest_usd || 0), 0);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      total_open_interest_usd: totalOpenInterest
    });

  } catch (err) {
    console.error("Error fetching Open Interest:", err.message);
    res.status(500).json({ error: "Failed to load Open Interest data", message: err.message });
  }
};
