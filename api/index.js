const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

// ====== 1. Global Liquidation Summary (/api/liquidations) ======
app.get("/api/liquidations", async (req, res) => {
  try {
    const headers = { "CG-API-KEY": COINGLASS_API_KEY };
    const response = await axios.get(
      "https://open-api-v4.coinglass.com/api/futures/liquidation/coin-list",
      { headers }
    );

    const coinData = response.data?.data || [];

    let total24h = 0;
    coinData.forEach((coin) => {
      total24h += coin.liquidation_usd_24h || 0;
    });

    res.json({
      total24h: Math.round(total24h),
      change24h: 0
    });
  } catch (err) {
    console.error("Error fetching from CoinGlass:", err.message);
    res.status(500).json({
      error: "Failed to load liquidation data",
      message: err.message
    });
  }
});

// ====== 2. Long/Short Account Ratio (/api/longshort) ======
app.get("/api/longshort", async (req, res) => {
  try {
    // Use the correct header format for Coinglass API v4
    const headers = { 
      "CG-API-KEY": COINGLASS_API_KEY,
      "accept": "application/json"
    };

    // Get current time and 24 hours ago for the time range
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Convert to timestamps (in seconds)
    const startTime = Math.floor(twentyFourHoursAgo.getTime() / 1000);
    const endTime = Math.floor(now.getTime() / 1000);

    // Use the correct Coinglass API v4 endpoint for global long/short account ratio
    const apiUrl = `https://open-api-v4.coinglass.com/api/futures/global-long-short-account-ratio/history?interval=1h&start_time=${startTime}&end_time=${endTime}`;

    console.log(`Fetching long/short data from: ${apiUrl}`);

    const response = await axios.get(apiUrl, { headers });

    // Check if the response is successful
    if (response.data.code !== "0") {
      throw new Error(`Coinglass API error: ${response.data.msg}`);
    }

    // Get the most recent data point (last item in array)
    const dataArray = response.data.data;
    if (!dataArray || dataArray.length === 0) {
      throw new Error('No data available from Coinglass API');
    }

    const latestData = dataArray[dataArray.length - 1];

    // Format the data to match your existing structure
    const longPercent = latestData.global_account_long_percent.toFixed(2);
    const shortPercent = latestData.global_account_short_percent.toFixed(2);

    console.log('Long/Short data retrieved:', { long: longPercent, short: shortPercent });

    res.json({ 
      long: longPercent, 
      short: shortPercent,
      timestamp: latestData.time,
      ratio: latestData.global_account_long_short_ratio
    });

  } catch (err) {
    console.error("Error fetching long/short ratio:", err.message);
    
    // Provide more detailed error information
    let errorMessage = err.message;
    if (err.response) {
      errorMessage = `API Error ${err.response.status}: ${err.response.data?.msg || err.response.statusText}`;
    }

    res.status(500).json({
      error: "Failed to load long/short ratio",
      message: errorMessage,
      details: err.response?.data || null
    });
  }
});

module.exports = app;
