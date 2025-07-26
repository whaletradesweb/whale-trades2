
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors()); // Enable CORS for all routes

const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY; // Get API key from environment variable
const COINGLASS_BASE_URL = "https://open-api-v4.coinglass.com/api/futures/liquidation/history";

app.get("/api/coinglass-proxy", async (req, res) => {
  try {
    // Get query parameters from the client request
    const { exchange = "Binance", symbol = "BTCUSDT", interval = "1d", start_time, end_time } = req.query;

    // Construct the Coinglass API URL
    let coinglass_url = `${COINGLASS_BASE_URL}?exchange=${exchange}&symbol=${symbol}&interval=${interval}`;
    if (start_time) coinglass_url += `&start_time=${start_time}`;
    if (end_time) coinglass_url += `&end_time=${end_time}`;

    // Make the request to Coinglass API with the API key
    const headers = { "CG-API-KEY": COINGLASS_API_KEY };
    const response = await axios.get(coinglass_url, { headers });

    res.json(response.data);
  } catch (error) {
    console.error("Error fetching data from Coinglass API:", error.message);
    res.status(500).json({
      error: "Failed to fetch data from Coinglass API",
      details: error.message,
    });
  }
});
// New global liquidations endpoint
app.get("/api/liquidations", async (req, res) => {
  try {
    const headers = { "CG-API-KEY": COINGLASS_API_KEY };
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    const end_time = now;
    const start_time = now - ONE_DAY;
    const prev_start_time = start_time - ONE_DAY;

    // Helper function to fetch and sum liquidation data from a window
    const fetchWindow = async (from, to) => {
      const params = new URLSearchParams({
        interval: "1d",
        start_time: from.toString(),
        end_time: to.toString(),
      });
      const url = `https://open-api-v4.coinglass.com/api/futures/liquidation/history?${params.toString()}`;
      const response = await axios.get(url, { headers });
      return response.data?.data || [];
    };

    // Fetch current 24h
    const currentData = await fetchWindow(start_time, end_time);
    let total24h = 0;
    currentData.forEach(item => {
      total24h += (parseFloat(item.long_liquidation_usd) || 0) + (parseFloat(item.short_liquidation_usd) || 0);
    });

    // Fetch previous 24h
    const previousData = await fetchWindow(prev_start_time, start_time);
    let prev24h = 0;
    previousData.forEach(item => {
      prev24h += (parseFloat(item.long_liquidation_usd) || 0) + (parseFloat(item.short_liquidation_usd) || 0);
    });

    // Calculate percentage change
    const change = prev24h > 0 ? ((total24h - prev24h) / prev24h) * 100 : 0;

    // Return structured JSON
    res.json({
      total24h: Math.round(total24h),
      prev24h: Math.round(prev24h),
      change24h: +change.toFixed(2)
    });

  } catch (err) {
    console.error("Error fetching liquidation history:", err.message);
    res.status(500).json({ error: "Failed to load liquidation data", message: err.message });
  }
});


// Export the app for Vercel's serverless function deployment
module.exports = app;


