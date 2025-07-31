const axios = require("axios");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const { symbol = "BTC", exchange = "Binance" } = req.query;
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = `https://open-api-v4.coinglass.com/api/option/max-pain?symbol=${symbol}&exchange=${exchange}`;

    const response = await axios.get(url, { headers });
    const data = response.data?.data?.[0];
    if (!data) throw new Error("Max Pain data unavailable");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);
  } catch (err) {
    console.error("Error fetching Max Pain:", err.message);
    res.status(500).json({ error: "Failed to load Max Pain data", message: err.message });
  }
};
