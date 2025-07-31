const axios = require("axios");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/index/pi-cycle-indicator";
    const response = await axios.get(url, { headers });

    const rawData = response.data?.data || [];
    const prices = rawData.map(d => ({ date: new Date(d.timestamp), price: d.price }));
    const dma111 = rawData.map(d => d.ma_110 || null);
    const dma350x2 = rawData.map(d => d.ma_350_mu_2 || null);

    const crossovers = [];
    for (let i = 1; i < rawData.length; i++) {
      if (dma111[i] && dma350x2[i]) {
        const prevDiff = dma111[i-1] - dma350x2[i-1];
        const currDiff = dma111[i] - dma350x2[i];
        if (prevDiff < 0 && currDiff > 0) crossovers.push({ date: prices[i].date, price: prices[i].price });
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ prices, dma111, dma350x2, crossovers });
  } catch (err) {
    console.error("Error fetching Pi Cycle:", err.message);
    res.status(500).json({ error: "Failed to load Pi Cycle data", message: err.message });
  }
};
