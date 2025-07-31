const axios = require("axios");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
    const response = await axios.get(url, { headers });
    const coinData = response.data?.data || [];

    let totalOpenInterest = 0, weightedChange = 0, weight = 0;
    coinData.forEach((coin) => {
      const oi = coin.open_interest_usd || 0;
      totalOpenInterest += oi;
      if (coin.open_interest_change_percent_24h !== undefined && oi > 0) {
        weightedChange += oi * coin.open_interest_change_percent_24h;
        weight += oi;
      }
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      totalOpenInterest: Math.round(totalOpenInterest),
      openInterestChange24h: (weight > 0 ? weightedChange / weight : 0).toFixed(2)
    });
  } catch (err) {
    console.error("Error fetching Open Interest:", err.message);
    res.status(500).json({ error: "Failed to load Open Interest data", message: err.message });
  }
};
