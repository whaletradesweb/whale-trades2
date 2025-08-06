const axios = require("axios");
const { kv } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { type } = req.query;

  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    console.log("Using headers:", headers); // 🔍 Log headers to runtime

    switch (type) {
      case "altcoin-season": {
        const url = "https://open-api-v4.coinglass.com/api/index/altcoin-season";
        const { data } = await axios.get(url, { headers });
        return res.json({ data: data?.data || [], raw: data });
      }

      case "debug-env": {
        return res.json({
          exists: !!COINGLASS_API_KEY,
          masked: COINGLASS_API_KEY ? COINGLASS_API_KEY.slice(0, 4) + "****" : null,
          headers
        });
      }

      default:
        return res.status(400).json({ error: "Invalid type parameter" });
    }
  } catch (err) {
    console.error("API Error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Failed request", details: err.response?.data || err.message });
  }
};
