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
    const headers = { "CG-API-KEY": COINGLASS_API_KEY };

    const response = await axios.get(
      "https://open-api-v4.coinglass.com/api/futures/global-long-short-account-ratio/history?exchange=Binance&symbol=BTCUSDT&interval=1d",
      { headers }
    );

    const data = response.data?.data || [];

    if (data.length === 0) {
      return res.json({ long: null, short: null });
    }

    // Use the most recent entry
    const latest = data[data.length - 1];

    const long = latest.global_account_long_percent;
    const short = latest.global_account_short_percent;

    res.json({ long, short });

  } catch (err) {
    console.error("Error fetching long/short ratio:", err.message);
    res.status(500).json({
      error: "Failed to load long/short ratio",
      message: err.message,
    });
  }
});




module.exports = app;
