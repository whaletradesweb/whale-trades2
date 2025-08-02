const axios = require('axios');

const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    console.log("DEBUG: COINGLASS_API_KEY loaded?", !!COINGLASS_API_KEY);
    
    if (!COINGLASS_API_KEY) {
      return res.status(500).json({ 
        error: 'API key not configured',
        message: 'COINGLASS_API_KEY environment variable is missing'
      });
    }
    
    const headers = { 
      'accept': 'application/json',
      'CG-API-KEY': COINGLASS_API_KEY,
      'User-Agent': 'Mozilla/5.0 (compatible; API-Client/1.0)'
    };
    
    console.log("DEBUG: Requesting Altcoin Season from Coinglass...");
    
    // The correct API endpoint based on CoinGlass documentation
    const altUrl = "https://open-api-v4.coinglass.com/api/index/altcoin-season";
    
    const altResponse = await axios.get(altUrl, { 
      headers,
      timeout: 10000, // 10 second timeout
      validateStatus: function (status) {
        return status < 500; // Resolve only if the status code is less than 500
      }
    });
    
    console.log("DEBUG: Coinglass Response Status:", altResponse.status);
    console.log("DEBUG: Coinglass Response Headers:", altResponse.headers);
    
    if (altResponse.status === 401) {
      return res.status(401).json({
        error: 'API Authentication Failed',
        message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
      });
    }
    
    if (altResponse.status === 403) {
      return res.status(403).json({
        error: 'API Access Forbidden',
        message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
      });
    }
    
    if (altResponse.status === 404) {
      return res.status(404).json({
        error: 'API Endpoint Not Found',
        message: 'The altcoin season endpoint may have changed. Check CoinGlass API documentation.'
      });
    }
    
    if (altResponse.status !== 200) {
      console.log("DEBUG: Unexpected status:", altResponse.status, altResponse.data);
      return res.status(altResponse.status).json({
        error: 'API Request Failed',
        message: `CoinGlass API returned status ${altResponse.status}`,
        details: altResponse.data
      });
    }
    
    if (!altResponse.data) {
      console.log("DEBUG: No response data received");
      return res.status(500).json({
        error: 'No data received',
        message: 'CoinGlass API returned empty response'
      });
    }
    
    // Check if response has the expected structure
    if (altResponse.data.code !== "0") {
      console.log("DEBUG: API returned error code:", altResponse.data);
      return res.status(400).json({
        error: 'API Error',
        message: altResponse.data.message || 'CoinGlass API returned error code',
        code: altResponse.data.code
      });
    }
    
    if (!altResponse.data.data || !Array.isArray(altResponse.data.data)) {
      console.log("DEBUG: Invalid data structure:", altResponse.data);
      return res.status(500).json({
        error: 'Invalid data structure',
        message: 'Expected array of altcoin data not found in response'
      });
    }
    
    const altRaw = altResponse.data.data;
    console.log("DEBUG: Raw data length:", altRaw.length);
    console.log("DEBUG: Sample data point:", altRaw[0]);
    
    // Transform the data to the expected format
    const altcoinData = altRaw.map(d => ({
      timestamp: d.timestamp,
      altcoin_index: d.altcoin_index,
      altcoin_marketcap: d.altcoin_marketcap || 0
    }));
    
    console.log("DEBUG: Processed data points:", altcoinData.length);
    
    // Sort by timestamp to ensure chronological order
    altcoinData.sort((a, b) => a.timestamp - b.timestamp);
    
    res.json({ 
      success: true,
      data: altcoinData,
      lastUpdated: new Date().toISOString(),
      dataPoints: altcoinData.length
    });
    
  } catch (err) {
    console.error("FULL ERROR STACK:", err.stack || err.message);
    
    // Handle different types of errors
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: "Network connection failed",
        message: "Unable to connect to CoinGlass API. Please try again later."
      });
    }
    
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      return res.status(504).json({
        error: "Request timeout",
        message: "CoinGlass API request timed out. Please try again."
      });
    }
    
    if (err.response) {
      // The request was made and the server responded with a status code
      return res.status(err.response.status || 500).json({
        error: "API request failed",
        message: err.response.data?.message || err.message,
        status: err.response.status
      });
    } else if (err.request) {
      // The request was made but no response was received
      return res.status(503).json({
        error: "No response from API",
        message: "CoinGlass API did not respond. Service may be unavailable."
      });
    } else {
      // Something happened in setting up the request
      return res.status(500).json({
        error: "Request setup failed",
        message: err.message
      });
    }
  }
};
