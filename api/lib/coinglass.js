// lib/coinglass.js
const axios = require("axios");

const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

const coinglassAPI = axios.create({
  baseURL: "https://open-api-v4.coinglass.com/api",
  headers: {
    accept: "application/json",
    "CG-API-KEY": COINGLASS_API_KEY
  }
});

module.exports = coinglassAPI;
