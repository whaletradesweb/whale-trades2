const axios = require("axios");
const { createClient } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

// ✅ Explicit KV binding using your prefixed environment variables
const kv = createClient({
  url: process.env.KV_REST_API_KV_URL,
  token: process.env.KV_REST_API_KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };
    const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets?exchange_list=Binance";

    const response = await axios.get(url, { headers });
    const coins = response.data?.data || [];

    // ✅ Sum cumulative Open Interest USD
    const totalOpenInterest = coins.reduce((sum, coin) => sum + (coin.open_interest_usd ||
