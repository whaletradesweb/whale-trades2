
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
<script>
(function () {
  async function fetchLiquidationData() {
    const endpoint = 'https://whale-trades2.vercel.app/api/liquidations';

    try {
      const response = await fetch(endpoint);
      const data = await response.json();

      const total = data.total24h;
      const change = data.change24h;

      const display = document.getElementById("liquidation-display");
      const percent = document.getElementById("liquidation-change");

      // Format the total
      if (display) {
        let formatted;
        if (total >= 1_000_000_000) formatted = "$" + (total / 1_000_000_000).toFixed(2) + "B";
        else if (total >= 1_000_000) formatted = "$" + (total / 1_000_000).toFixed(2) + "M";
        else if (total >= 1_000) formatted = "$" + (total / 1_000).toFixed(2) + "K";
        else formatted = "$" + total.toFixed(2);
        display.textContent = formatted;
      }

      // Format the percentage change
      if (percent) {
        const formattedChange = (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
        percent.textContent = formattedChange;
        percent.classList.remove("positive-change", "negative-change");
        percent.classList.add(change >= 0 ? "positive-change" : "negative-change");
      }
    } catch (err) {
      console.error("Liquidation data load error:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", fetchLiquidationData);
})();
</script>


// Export the app for Vercel's serverless function deployment
module.exports = app;


