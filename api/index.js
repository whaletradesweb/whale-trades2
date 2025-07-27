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
    const headers = { 
      accept: "application/json", 
      "CG-API-KEY": COINGLASS_API_KEY 
    };

    const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
    const response = await axios.get(url, { headers });
    const coinData = response.data?.data || [];

    let totalOpenInterest = 0;
    let weightedChange = 0;
    let weight = 0;

    coinData.forEach((coin) => {
      const oi = coin.open_interest_usd || 0;
      const change = coin.open_interest_change_percent_24h;

      totalOpenInterest += oi;

      if (change !== undefined && oi > 0) {
        weightedChange += oi * change;
        weight += oi;
      }
    });

    const openInterestChange24h = weight > 0 ? weightedChange / weight : 0;

    res.json({
      totalOpenInterest: Math.round(totalOpenInterest),
      openInterestChange24h: openInterestChange24h.toFixed(2)
    });
  } catch (err) {
    console.error("Error fetching Open Interest data:", err.message);
    res.status(500).json({
      error: "Failed to load Open Interest data",
      message: err.message
    });
  }
});

// ====== 4. Aggregated Liquidations Table (/api/liquidations-table) ======
app.get("/api/liquidations-table", async (req, res) => {
  try {
    const headers = {
      accept: "application/json",
      "CG-API-KEY": COINGLASS_API_KEY
    };

    const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
    const response = await axios.get(url, { headers });
    const coins = response.data?.data || [];

    const timeframes = ['1h', '4h', '12h', '24h'];
    const aggregates = {
      '1h': { total: 0, long: 0, short: 0 },
      '4h': { total: 0, long: 0, short: 0 },
      '12h': { total: 0, long: 0, short: 0 },
      '24h': { total: 0, long: 0, short: 0 }
    };

    // Aggregate data across all coins
    coins.forEach(coin => {
      timeframes.forEach(tf => {
        aggregates[tf].total += coin[`liquidation_usd_${tf}`] || 0;
        aggregates[tf].long += coin[`long_liquidation_usd_${tf}`] || 0;
        aggregates[tf].short += coin[`short_liquidation_usd_${tf}`] || 0;
      });
    });

    // Format values: round to 2 decimals, add $, and abbreviate
    function formatUSD(value) {
      if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
      if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
      if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
      return `$${value.toFixed(2)}`;
    }

    const formatted = {};
    timeframes.forEach(tf => {
      formatted[tf] = {
        total: formatUSD(aggregates[tf].total),
        long: formatUSD(aggregates[tf].long),
        short: formatUSD(aggregates[tf].short)
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching liquidation table data:", err.message);
    res.status(500).json({
      error: "Failed to load liquidation table data",
      message: err.message
    });
  }
});

// ====== 5. Max Pain Options Data (/api/max-pain?symbol=BTC|ETH) ======
app.get("/api/max-pain", async (req, res) => {
  try {
    const symbol = req.query.symbol || "BTC"; // BTC or ETH
    const headers = {
      accept: "application/json",
      "CG-API-KEY": COINGLASS_API_KEY
    };

    const url = `https://open-api-v4.coinglass.com/api/option/max-pain?symbol=${symbol}&exchange=Binance`;
    const response = await axios.get(url, { headers });
    const data = response.data?.data?.[0];

    if (!data) {
      return res.status(404).json({ error: "No max pain data found" });
    }

    // Format number to USD abbreviated
    const formatUSD = (val) => {
      if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
      if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
      if (val >= 1e3) return `$${(val / 1e3).toFixed(2)}K`;
      return `$${val.toFixed(2)}`;
    };

    const formatDate = (YYMMDD) => {
      const d = new Date(`20${YYMMDD.slice(0, 2)}-${YYMMDD.slice(2, 4)}-${YYMMDD.slice(4, 6)}`);
      return d.toISOString().split("T")[0]; // YYYY-MM-DD
    };

    res.json({
      max_pain_price: `$${Number(data.max_pain_price).toLocaleString()}`,
      call_open_interest_market_value: formatUSD(data.call_open_interest_market_value),
      put_open_interest_market_value: formatUSD(data.put_open_interest_market_value),
      call_open_interest: data.call_open_interest.toFixed(2),
      put_open_interest: data.put_open_interest.toFixed(2),
      call_open_interest_notional: formatUSD(data.call_open_interest_notional),
      put_open_interest_notional: formatUSD(data.put_open_interest_notional),
      options_expiry_date: formatDate(data.date)
    });
  } catch (err) {
    console.error("Error fetching max pain:", err.message);
    res.status(500).json({ error: "Failed to load max pain data" });
  }
});



module.exports = app;
