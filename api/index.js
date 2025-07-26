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
    const url = "https://open-api-v4.coinglass.com/api/futures/taker-buy-sell-volume/exchange-list?symbol=BTC&range=24h";

    const response = await axios.get(url, { headers });
    const data = response.data?.data;

    if (!data || data.buy_ratio == null || data.sell_ratio == null) {
      throw new Error("Invalid buy/sell ratio data");
    }

    const buy = +data.buy_ratio.toFixed(2);
    const sell = +data.sell_ratio.toFixed(2);

    res.json({ long: buy, short: sell });
  } catch (err) {
    console.error("Error fetching Buy/Sell ratio:", err.message);
    res.status(500).json({
      error: "Failed to load buy/sell ratio",
      message: err.message
    });
  }
});

// ====== 3. Aggregate Open Interest (/api/open-interest) ======
app.get("/api/open-interest", async (req, res) => {
  try {
    const headers = { "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/coins/markets";

    const response = await axios.get(url, { headers });
    const coinData = response.data?.data || [];

    let totalOpenInterest = 0;

    coinData.forEach((coin) => {
      totalOpenInterest += coin.open_interest_usd || 0;
    });

    res.json({
      totalOpenInterest: Math.round(totalOpenInterest)
    });
  } catch (err) {
    console.error("Error fetching Open Interest data:", err.message);
    res.status(500).json({
      error: "Failed to load Open Interest data",
      message: err.message
    });
  }
});

module.exports = app;
