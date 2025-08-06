const axios = require("axios");
const { kv } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { type, symbol = "BTC", exchange = "Binance" } = req.query;

  try {
    const headers = { accept: "application/json", "CG-API-KEY": COINGLASS_API_KEY };

    switch (type) {
      case "debug-env": {
        return res.json({
          exists: !!COINGLASS_API_KEY,
          length: COINGLASS_API_KEY?.length || 0,
          masked: COINGLASS_API_KEY?.slice(0, 4) + "****" || null,
          environment: process.env.VERCEL_ENV || "unknown"
        });
      }

      case "altcoin-season": {
        const url = "https://open-api-v4.coinglass.com/api/index/altcoin-season";
        const { data } = await axios.get(url, { headers });
        return res.json({ data: data?.data || [] });
      }

      case "etf-btc-flows": {
        const url = "https://open-api-v4.coinglass.com/api/etf/bitcoin/flow-history";
        const { data } = await axios.get(url, { headers });
        return res.json({ data: data?.data || [] });
      }

      case "liquidations-total": {
        const url = "https://open-api-v4.coinglass.com/api/futures/liquidation/coin-list";
        const { data } = await axios.get(url, { headers });
        const total = (data?.data || []).reduce((sum, c) => sum + (c.liquidation_usd_24h || 0), 0);
        return res.json({ total_liquidations_24h: total });
      }

      case "liquidations-table": {
        const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
        const { data } = await axios.get(url, { headers });
        const coins = data?.data || [];
        const timeframes = ["1h", "4h", "12h", "24h"];
        const aggregates = Object.fromEntries(timeframes.map(tf => [tf, { total: 0, long: 0, short: 0 }]));
        coins.forEach(c => timeframes.forEach(tf => {
          aggregates[tf].total += c[`liquidation_usd_${tf}`] || 0;
          aggregates[tf].long += c[`long_liquidation_usd_${tf}`] || 0;
          aggregates[tf].short += c[`short_liquidation_usd_${tf}`] || 0;
        }));
        return res.json({ aggregates });
      }

      case "long-short": {
        const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
        const { data } = await axios.get(url, { headers });
        const coins = data?.data || [];
        const top10 = coins.filter(c => c.long_short_ratio_24h != null)
          .sort((a, b) => b.market_cap_usd - a.market_cap_usd)
          .slice(0, 10);
        const avgRatio = top10.reduce((sum, c) => sum + c.long_short_ratio_24h, 0) / top10.length;
        const avgLongPct = (avgRatio / (1 + avgRatio)) * 100;
        return res.json({ long_pct: avgLongPct.toFixed(2), short_pct: (100 - avgLongPct).toFixed(2) });
      }

      case "max-pain": {
        const url = `https://open-api-v4.coinglass.com/api/option/max-pain?symbol=${symbol}&exchange=${exchange}`;
        const { data } = await axios.get(url, { headers });
        return res.json({ data: data?.data?.[0] || {} });
      }

      case "open-interest": {
        const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets?exchange_list=Binance";
        const { data } = await axios.get(url, { headers });
        const coins = data?.data || [];
        const totalOI = coins.reduce((sum, c) => sum + (c.open_interest_usd || 0), 0);
        return res.json({ total_open_interest_usd: totalOI });
      }

      case "pi-cycle": {
        const url = "https://open-api-v4.coinglass.com/api/index/pi-cycle-indicator";
        const { data } = await axios.get(url, { headers });
        return res.json({ data: data?.data || [] });
      }

      case "puell-multiple": {
        const url = "https://open-api-v4.coinglass.com/api/index/puell-multiple";
        const { data } = await axios.get(url, { headers });
        return res.json({ data: data?.data || [] });
      }

      case "coin-bar-race": {
        const cacheKey = "coin-bar-race:frames";
        const cacheTimestampKey = "coin-bar-race:timestamp";
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;

        let frames = await kv.get(cacheKey);
        const cachedTimestamp = await kv.get(cacheTimestampKey);

        if (!frames || !cachedTimestamp || (now - cachedTimestamp) >= oneDay) {
          const marketRes = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
          const coins = marketRes.data?.data || [];
          const top20 = coins.sort((a, b) => b.market_cap_usd - a.market_cap_usd).slice(0, 20).map(c => c.symbol);

          const endTime = now;
          const startTime = endTime - (4 * 365 * 24 * 60 * 60 * 1000); // 4 years
          const interval = "1w";
          const historyData = {};

          for (const sym of top20) {
            const priceUrl = `https://open-api-v4.coinglass.com/api/futures/price/history?symbol=${sym}USDT&interval=${interval}&start_time=${startTime}&end_time=${endTime}`;
            const priceRes = await axios.get(priceUrl, { headers });
            const prices = priceRes.data?.data || [];
            if (prices.length) {
              const base = prices[0].close;
              historyData[sym] = prices.map(p => ({
                date: new Date(p.time).toISOString().split("T")[0],
                value: ((p.close / base) - 1) * 100,
              }));
            }
          }

          const allDates = [...new Set(Object.values(historyData).flat().map(d => d.date))].sort();
          frames = allDates.map(date => {
            const ranked = Object.entries(historyData)
              .map(([coin, data]) => ({ name: coin, value: data.find(d => d.date === date)?.value || 0 }))
              .sort((a, b) => b.value - a.value)
              .slice(0, 20);
            return { date, ranked };
          });

          await kv.set(cacheKey, frames);
          await kv.set(cacheTimestampKey, now);
        }

        const liveRes = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
        const liveCoins = liveRes.data?.data || [];
        const liveTop20 = liveCoins.sort((a, b) => b.market_cap_usd - a.market_cap_usd).slice(0, 20);

        const liveFrame = liveTop20.map(c => {
          const base = frames[0]?.ranked.find(h => h.name === c.symbol)?.value;
          const basePrice = base !== undefined ? (base / 100) + 1 : 1;
          return {
            name: c.symbol,
            value: basePrice ? ((c.current_price / (c.current_price / basePrice)) - 1) * 100 : 0
          };
        }).sort((a, b) => b.value - a.value);

        return res.json({ frames, liveFrame, lastUpdated: new Date().toISOString() });
      }

      default:
        return res.status(400).json({ error: "Invalid type parameter" });
    }
  } catch (err) {
    console.error(`API Error (${type}):`, err.message);
    return res.status(500).json({ error: "Failed to fetch data", message: err.message });
  }
};
