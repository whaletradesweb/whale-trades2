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

// ====== 5. Max Pain Options Data (/api/max-pain) ======
app.get("/api/max-pain", async (req, res) => {
  try {
    const { symbol = "BTC", exchange = "Binance" } = req.query;
    const headers = {
      accept: "application/json",
      "CG-API-KEY": COINGLASS_API_KEY
    };

    const url = `https://open-api-v4.coinglass.com/api/option/max-pain?symbol=${symbol}&exchange=${exchange}`;
    const response = await axios.get(url, { headers });

    const data = response.data?.data?.[0];
    if (!data) throw new Error("Max Pain data unavailable");

    res.json({
      date: data.date,
      call_open_interest_market_value: data.call_open_interest_market_value,
      put_open_interest_market_value: data.put_open_interest_market_value,
      max_pain_price: data.max_pain_price,
      call_open_interest: data.call_open_interest,
      put_open_interest: data.put_open_interest,
      call_open_interest_notional: data.call_open_interest_notional,
      put_open_interest_notional: data.put_open_interest_notional
    });
  } catch (err) {
    console.error("Error fetching Max Pain data:", err.message);
    res.status(500).json({ error: "Failed to load Max Pain data", message: err.message });
  }
});


// ====== 6. Pi Cycle Top Indicator (Coinglass Parsed) ======
app.get("/api/pi-cycle", async (req, res) => {
  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/index/pi-cycle-indicator";

    const response = await axios.get(url, { headers });
    const rawData = response.data?.data || [];

    if (!Array.isArray(rawData) || rawData.length === 0) {
      throw new Error("Pi Cycle data empty or malformed");
    }

    // Parse response
    const prices = rawData.map((d) => ({
      date: new Date(d.timestamp),
      price: d.price
    }));

    const dma111 = rawData.map((d) => d.ma_110 || null);
    const dma350x2 = rawData.map((d) => d.ma_350_mu_2 || null);

    // Detect crossovers (111DMA crossing above 350DMAx2)
    const crossovers = [];
    for (let i = 1; i < rawData.length; i++) {
      if (dma111[i] && dma350x2[i]) {
        const prevDiff = dma111[i - 1] - dma350x2[i - 1];
        const currDiff = dma111[i] - dma350x2[i];
        if (prevDiff < 0 && currDiff > 0) {
          crossovers.push({
            date: prices[i].date,
            price: prices[i].price
          });
        }
      }
    }

    res.json({
      prices,
      dma111,
      dma350x2,
      crossovers
    });
  } catch (err) {
    console.error("Error fetching Pi Cycle data:", err.message);
    res.status(500).json({
      error: "Failed to load Pi Cycle data",
      message: err.message
    });
  }
});

// ====== 7. Puell Multiple ======
import axios from "axios";

export default async function handler(req, res) {
  try {
    const headers = {
      accept: "application/json",
      "CG-API-KEY": process.env.COINGLASS_API_KEY,
    };

    const url = "https://open-api-v4.coinglass.com/api/index/puell-multiple";
    const response = await axios.get(url, { headers });

    const rawData = response.data?.data || [];
    if (!rawData.length) {
      throw new Error("No Puell Multiple data returned");
    }

    // Format data for Plotly (convert timestamp to readable date)
    const formattedData = rawData.map((d) => ({
      date: new Date(d.timestamp).toISOString().split("T")[0], // YYYY-MM-DD
      price: d.price,
      puell_multiple: d.puell_multiple,
    }));

    // Identify threshold markers (overbought >4, oversold <0.5)
    const overbought = formattedData.filter((d) => d.puell_multiple > 4);
    const oversold = formattedData.filter((d) => d.puell_multiple < 0.5);

    res.status(200).json({
      data: formattedData,
      markers: { overbought, oversold },
    });
  } catch (err) {
    console.error("Puell API error:", err.message);
    res.status(500).json({ error: "Failed to fetch Puell Multiple data" });
  }
}


module.exports = app;
