// api/max-pain.js
const coinglassAPI = require("./lib/coinglass");

module.exports = async (req, res) => {
  try {
    const { symbol = "BTC", exchange = "Binance" } = req.query;

    // Fetch Max Pain data from Coinglass
    const response = await coinglassAPI.get(`/option/max-pain?symbol=${symbol}&exchange=${exchange}`);
    const data = response.data?.data?.[0];

    if (!data) throw new Error("Max Pain data unavailable");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json(data);

  } catch (err) {
    console.error("Error fetching Max Pain:", err.message);
    res.status(500).json({ error: "Failed to load Max Pain data", message: err.message });
  }
};
