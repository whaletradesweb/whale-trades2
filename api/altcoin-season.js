const axios = require("axios");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const headers = { 
      accept: "application/json", 
      "CG-API-KEY": COINGLASS_API_KEY 
    };
    
    // ✅ CORRECTED: Use hyphen, not camelCase
    const url = "https://open-api-v4.coinglass.com/api/index/altcoin-season";
    
    const response = await axios.get(url, { headers });
    
    // Check if the API returned an error code
    if (response.data.code !== "0") {
      throw new Error(`API Error: ${response.data.message || 'Unknown error'}`);
    }
    
    const rawData = response.data?.data || [];
    
    const formattedData = rawData.map(d => ({
      date: new Date(d.timestamp).toISOString().split("T")[0],
      altcoin_index: d.altcoin_index || null,
      timestamp: d.timestamp // Keep original timestamp for chart
    }));
    
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    
    res.status(200).json({ altcoinSeason: formattedData });
    
  } catch (err) {
    console.error("Error fetching Altcoin Season Index:", err.message);
    
    // More detailed error handling
    if (err.response) {
      const status = err.response.status;
      const statusMessages = {
        401: "Invalid API key",
        403: "API key doesn't have access to this endpoint (requires Startup plan or higher)",
        404: "Endpoint not found - check URL",
        429: "Rate limit exceeded"
      };
      
      res.status(status).json({ 
        error: "Failed to load Altcoin Season data", 
        message: statusMessages[status] || err.message,
        status: status
      });
    } else {
      res.status(500).json({ 
        error: "Failed to load Altcoin Season data", 
        message: err.message 
      });
    }
  }
};
