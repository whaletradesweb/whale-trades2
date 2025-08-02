const axios = require("axios");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/etf/bitcoin/flow-history";
    const response = await axios.get(url, { headers });

    const rawData = response.data?.data || [];

    // Format daily data
    const daily = rawData.map(d => ({
      date: new Date(d.timestamp).toISOString().split("T")[0],  // YYYY-MM-DD
      totalFlow: d.flow_usd,                                    // Total inflow/outflow
      price: d.price_usd,                                       // BTC price
      etfs: d.etf_flows.map(etf => ({
        ticker: etf.etf_ticker,
        flow: etf.flow_usd
      }))
    }));

    // Calculate weekly aggregates
    const weekly = [];
    for (let i = 0; i < daily.length; i += 7) {
      const chunk = daily.slice(i, i + 7);
      const totalFlow = chunk.reduce((sum, d) => sum + d.totalFlow, 0);
      const avgPrice = chunk.reduce((sum, d) => sum + d.price, 0) / chunk.length;
      const etfMap = {};

      // Sum ETF flows per ticker across the week
      chunk.forEach(day => {
        day.etfs.forEach(e => {
          etfMap[e.ticker] = (etfMap[e.ticker] || 0) + e.flow;
        });
      });

      weekly.push({
        weekStart: chunk[0].date,
        weekEnd: chunk[chunk.length - 1].date,
        totalFlow,
        avgPrice: parseFloat(avgPrice.toFixed(2)),
        etfs: Object.entries(etfMap).map(([ticker, flow]) => ({ ticker, flow }))
      });
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ daily, weekly });

  } catch (err) {
    console.error("Error fetching ETF Flows:", err.message);
    res.status(500).json({ error: "Failed to load ETF Flows data", message: err.message });
  }
};

