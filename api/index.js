
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

// Export the app for Vercel's serverless function deployment
module.exports = app;


