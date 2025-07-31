const axios = require("axios");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/index/puell-multiple";
    const response = await axios.get(url, { headers });

    const rawData = response.data?.data || [];
    const prices = rawData.map(d => ({ date: new Date(d.timestamp), price: d.price }));
    const puellValues = rawData.map(d => d.puell_multiple || null);

    const overbought = [], oversold = [];
    rawData.forEach((d, i) => {
      if (d.puell_multiple > 4) overbought.push({ date: prices[i].date, value: d.puell_multiple });
      if (d.puell_multiple < 0.5) oversold.push({ date: prices[i].date, value: d.puell_multiple });
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ prices, puellValues, overbought, oversold });
  } catch (err) {
    console.error("Error fetching Puell:", err.message);
    res.status(500).json({ error: "Failed to load Puell Multiple data", message: err.message });
  }
};
