const axios = require("axios");

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTsBTQRNdOepzg0ICOOZWgIxljKMcd2MYH44QmodZaQA60fxYyHFdqQrAu0ck0qGNK2spYbHUq8gKKL/pub?output=csv";

module.exports = async (req, res) => {
  // --- CORS HEADERS ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS, PUT, DELETE"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Origin"
  );
  res.setHeader("Access-Control-Allow-Credentials", "false");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await axios.get(CSV_URL, {
      responseType: "text",
      timeout: 10000,
    });

    const csvText = response.data.trim();

    // --- BASIC CSV → JSON PARSE ---
    const lines = csvText.split("\n");
    const [headerLine, ...rows] = lines;
    const headers = headerLine.split(",").map((h) => h.trim());

    const data = rows
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const cols = line.split(",");
        const obj = {};

        headers.forEach((header, i) => {
          let value = cols[i] !== undefined ? cols[i].trim() : "";

          // Try to coerce to number if numeric
          const num = Number(value);
          if (!isNaN(num) && value !== "") {
            obj[header] = num;
          } else {
            obj[header] = value;
          }
        });

        return obj;
      });

    return res.json({
      success: true,
      type: "BTCUSDT-Perp Funding Rate",
      count: data.length,
      data,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[btcusdt-funding] Error:", err.message);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch or parse CSV",
      message: err.message,
    });
  }
};

