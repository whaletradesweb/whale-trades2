const axios = require("axios");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const headers = { 
      accept: "application/json", 
      "CG-API-KEY": COINGLASS_API_KEY 
    };
    
    // ✅ TESTING: altcoin-season-index endpoint
    const url = "https://open-api-v4.coinglass.com/api/index/altcoin-season-index";
    
    console.log("Testing endpoint:", url);
    console.log("API Key present:", !!COINGLASS_API_KEY);
    
    const response = await axios.get(url, { headers });
    
    console.log("Response status:", response.status);
    console.log("Response data:", JSON.stringify(response.data, null, 2));
    
    // Check if the API returned an error code
    if (response.data.code !== "0") {
      throw new Error(`API Error: ${response.data.message || 'Unknown error'}`);
    }
    
    const rawData = response.data?.data || [];
    console.log("Raw data length:", rawData.length);
    
    const formattedData = rawData.map(d => ({
      date: new Date(d.timestamp).toISOString().split("T")[0],
      altcoin_index: d.altcoin_index || null,
      timestamp: d.timestamp // Keep original timestamp for chart
    }));
    
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    
    res.status(200).json({ 
      success: true,
      endpoint: url,
      altcoinSeason: formattedData,
      rawDataLength: rawData.length
    });
    
  } catch (err) {
    console.error("Error fetching Altcoin Season Index:", err.message);
    console.error("Full error:", err.response?.data || err);
    
    // More detailed error handling
    if (err.response) {
      const status = err.response.status;
      const statusMessages = {
        401: "Invalid API key - check your CG-API-KEY",
        403: "API key doesn't have access to this endpoint (requires Startup plan or higher)",
        404: "Endpoint not found - URL might be incorrect",
        429: "Rate limit exceeded - too many requests",
        500: "CoinGlass server error"
      };
      
      console.log("HTTP Status:", status);
      console.log("Response data:", err.response.data);
      
      res.status(status).json({ 
        error: "Failed to load Altcoin Season data", 
        message: statusMessages[status] || err.message,
        status: status,
        endpoint: "https://open-api-v4.coinglass.com/api/index/altcoin-season-index",
        responseData: err.response.data
      });
    } else if (err.request) {
      // Network error
      res.status(503).json({ 
        error: "Network error", 
        message: "Could not connect to CoinGlass API",
        endpoint: "https://open-api-v4.coinglass.com/api/index/altcoin-season-index"
      });
    } else {
      res.status(500).json({ 
        error: "Failed to load Altcoin Season data", 
        message: err.message,
        endpoint: "https://open-api-v4.coinglass.com/api/index/altcoin-season-index"
      });
    }
  }
};
