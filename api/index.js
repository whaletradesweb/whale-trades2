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

<div id="pi-cycle-indicator" style="width: 100%; height: 600px;"></div>
<script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
<script>
async function renderPiCycle() {
  const res = await fetch("https://whale-trades2.vercel.app/api/pi-cycle");
  const data = await res.json();

  const dates = data.prices.map(p => new Date(p.date));
  const price = data.prices.map(p => p.price);

  // Main lines
  const tracePrice = { 
    x: dates, y: price, type: "scatter", mode: "lines", 
    name: "BTC Price", line: { color: "#cccccc", width: 1.5 }, 
    hovertemplate: "BTC Price: $%{y:,.2f}<extra></extra>"
  };
  const trace111 = { 
    x: dates, y: data.dma111, type: "scatter", mode: "lines", 
    name: "111DMA", line: { color: "red", width: 1.5 }, 
    hovertemplate: "111DMA: $%{y:,.2f}<extra></extra>"
  };
  const trace350x2 = { 
    x: dates, y: data.dma350x2, type: "scatter", mode: "lines", 
    name: "350DMA x 2", line: { color: "green", width: 1.5 }, 
    hovertemplate: "350DMA x2: $%{y:,.2f}<extra></extra>"
  };

  // Pi Top markers
  const traceCrossovers = {
    x: data.crossovers.map(c => new Date(c.date)),
    y: data.crossovers.map(c => c.price),
    mode: "markers+text",
    name: "Pi Cycle Tops",
    text: data.crossovers.map(() => "⬆"),
    textposition: "top center",
    marker: { color: "#ff4e00", size: 8, symbol: "circle" },
    hovertemplate: "<b>Pi Cycle Top</b><br>Date: %{x|%d %b %Y}<br>Price: $%{y:,.2f}<extra></extra>"
  };

  const layout = {
    template: "plotly_dark",
    title: { text: "Pi Cycle Top Indicator", font: { size: 22, color: "#fff", family: "Mona Sans" } },
    xaxis: {
      title: { text: "Date", font: { family: "Mona Sans" }},
      rangeselector: {
        buttons: [
          { count: 1, label: "1m", step: "month", stepmode: "backward" },
          { count: 6, label: "6m", step: "month", stepmode: "backward" },
          { count: 1, label: "1y", step: "year", stepmode: "backward" },
          { step: "all", label: "all" }
        ],
        activecolor: "#ff4e00", // selected button fill
        bgcolor: "rgba(0,0,0,0)", // make background transparent
        bordercolor: "#494949"
      },
      rangeslider: { visible: true, bgcolor: "#242424" },
      type: "date",
      gridcolor: "rgba(255,255,255,0.05)"
    },
    yaxis: { 
      title: { text: "Price (USD)", font: { family: "Mona Sans" }},
      type: "log",
      gridcolor: "rgba(255,255,255,0.05)"
    },
    hovermode: "x unified",
    font: { color: "white", family: "Mona Sans" },
    plot_bgcolor: "rgba(24,24,24,1)",
    paper_bgcolor: "rgba(24,24,24,1)",
    legend: { orientation: "h", y: -0.25, font: { color: "#ccc", family: "Mona Sans" } }
  };

  // Custom button styling
  Plotly.newPlot("pi-cycle-indicator", [tracePrice, trace111, trace350x2, traceCrossovers], layout, { responsive: true });

  // Post-render: Style range selector buttons manually
  const buttons = document.querySelectorAll('.button');
  buttons.forEach(btn => {
    btn.style.border = "1px solid #494949";
    btn.style.borderRadius = "12px";
    btn.style.backgroundColor = "transparent";
    btn.style.fontFamily = "Mona Sans";
    btn.style.color = "#ccc";
  });
}
renderPiCycle();
</script>



module.exports = app;
