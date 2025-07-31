const axios = require('axios');

const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log("DEBUG: COINGLASS_API_KEY loaded?", !!COINGLASS_API_KEY);
    const headers = { 
      accept: "application/json", 
      "CG-API-KEY": COINGLASS_API_KEY 
    };
    console.log("DEBUG: Requesting Altcoin Season from Coinglass...");
    const altUrl = "https://open-api-v4.coinglass.com/api/index/altcoin-season";
    const altResponse = await axios.get(altUrl, { headers });
    console.log("DEBUG: Coinglass Alt Response Status:", altResponse.status);
    if (!altResponse.data?.data) {
      console.log("DEBUG: Coinglass Raw Response:", altResponse.data);
      throw new Error("No data returned from Coinglass");
    }
    const altRaw = altResponse.data.data;
    const altcoinData = altRaw.map(d => ({
      date: new Date(d.timestamp),
      altcoin_index: d.altcoin_index
    }));
    console.log("DEBUG: Parsed Altcoin Data Length:", altcoinData.length);
    // Fetch BTC Price
    const btcUrl = "https://open-api-v4.coinglass.com/api/index/bitcoin-price";
    const btcResponse = await axios.get(btcUrl, { headers });
    console.log("DEBUG: BTC Price Response Status:", btcResponse.status);
    const btcRaw = btcResponse.data?.data || [];
    const btcData = btcRaw.map(d => ({
      date: new Date(d.timestamp),
      btc_price: d.price
    }));
    const merged = altcoinData.map(alt => {
      const btc = btcData.find(b => b.date.getTime() === alt.date.getTime());
      return { date: alt.date, altcoin_index: alt.altcoin_index, btc_price: btc?.btc_price || null };
    });
    console.log("DEBUG: Merged Data Points:", merged.length);
    res.json({ data: merged });
  } catch (err) {
    console.error("FULL ERROR STACK:", err.stack || err.message);
    res.status(500).json({
      error: "Failed to load Altcoin Season data",
      message: err.message
    });
  }
};
