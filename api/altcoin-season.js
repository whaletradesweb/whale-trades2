const axios = require("axios");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/index/altcoinSeason"; // ✅ Corrected endpoint
    const response = await axios.get(url, { headers });

    const rawData = response.data?.data || [];

    const formattedData = rawData.map(d => ({
      date: new Date(d.timestamp).toISOString().split("T")[0],
      altcoin_index: d.altcoin_index || null
    }));

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ altcoinSeason: formattedData });
  } catch (err) {
    console.error("Error fetching Altcoin Season Index:", err.message);
    res.status(500).json({ error: "Failed to load Altcoin Season data", message: err.message });
  }
};
