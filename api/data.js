const axios = require("axios");
const { kv } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { type, symbol = "BTC", exchange = "Binance", action } = req.query;

  try {
    console.log(`DEBUG: Processing request for type: ${type}`);
    if (!COINGLASS_API_KEY) {
      return res.status(500).json({ error: 'API key not configured', message: 'COINGLASS_API_KEY environment variable is missing' });
    }

    const headers = {
      'accept': 'application/json',
      'CG-API-KEY': COINGLASS_API_KEY,
      'User-Agent': 'Mozilla/5.0 (compatible; API-Client/1.0)'
    };

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
        console.log("DEBUG: Requesting Altcoin Season from Coinglass...");
        const altUrl = "https://open-api-v4.coinglass.com/api/index/altcoin-season";
        const altResponse = await axios.get(altUrl, { headers });
        if (altResponse.status !== 200) {
          return res.status(altResponse.status).json({ error: 'API Request Failed', details: altResponse.data });
        }
        const altRaw = altResponse.data.data;
        const altcoinData = altRaw.map(d => ({
          timestamp: d.timestamp,
          altcoin_index: d.altcoin_index,
          altcoin_marketcap: d.altcoin_marketcap || 0
        })).sort((a, b) => a.timestamp - b.timestamp);
        return res.json({ success: true, data: altcoinData, lastUpdated: new Date().toISOString(), dataPoints: altcoinData.length });
      }

      case "etf-btc-flows": {
        const url = "https://open-api-v4.coinglass.com/api/etf/bitcoin/flow-history";
        const response = await axios.get(url, { headers });
        const rawData = response.data?.data || [];
        const daily = rawData.map(d => ({
          date: new Date(d.timestamp).toISOString().split("T")[0],
          totalFlow: d.flow_usd,
          price: d.price_usd,
          etfs: d.etf_flows.map(etf => ({ ticker: etf.etf_ticker, flow: etf.flow_usd }))
        }));
        return res.json({ daily });
      }

      case "liquidations-total": {
        const response = await axios.get("https://open-api-v4.coinglass.com/api/futures/liquidation/coin-list", { headers });
        const coins = response.data?.data || [];
        const total24h = coins.reduce((sum, c) => sum + (c.liquidation_usd_24h || 0), 0);
        const now = Date.now();
        let percentChange = 0;
        const previousTotal = await kv.get("liquidations:previous_total");
        const previousTimestamp = await kv.get("liquidations:timestamp");
        if (previousTotal && previousTimestamp && (now - previousTimestamp) < 86400000) {
          percentChange = ((total24h - previousTotal) / previousTotal) * 100;
        } else {
          await kv.set("liquidations:previous_total", total24h);
          await kv.set("liquidations:timestamp", now);
        }
        return res.json({ total_liquidations_24h: total24h, percent_change_24h: percentChange });
      }

      case "liquidations-debug": {
        if (action === "reset") {
          await kv.del("liquidations:previous_total");
          await kv.del("liquidations:timestamp");
          return res.json({ message: "✅ Baseline reset successfully" });
        }
        const previousTotal = await kv.get("liquidations:previous_total");
        const previousTimestamp = await kv.get("liquidations:timestamp");
        return res.json({ previous_total: previousTotal || "Not set", previous_timestamp: previousTimestamp || "Not set" });
      }

      case "liquidations-table": {
        const response = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
        const coins = response.data?.data || [];
        const timeframes = ['1h', '4h', '12h', '24h'];
        const aggregates = Object.fromEntries(timeframes.map(tf => [tf, { total: 0, long: 0, short: 0 }]));
        coins.forEach(coin => timeframes.forEach(tf => {
          aggregates[tf].total += coin[`liquidation_usd_${tf}`] || 0;
          aggregates[tf].long += coin[`long_liquidation_usd_${tf}`] || 0;
          aggregates[tf].short += coin[`short_liquidation_usd_${tf}`] || 0;
        }));
        return res.json(aggregates);
      }

      case "long-short": {
        const response = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
        const coins = response.data?.data || [];
        const top10 = coins.filter(c => c.long_short_ratio_24h != null)
                           .sort((a, b) => b.market_cap_usd - a.market_cap_usd)
                           .slice(0, 10);
        const avgRatio = top10.reduce((sum, c) => sum + c.long_short_ratio_24h, 0) / top10.length;
        const avgLongPct = (avgRatio / (1 + avgRatio)) * 100;
        return res.json({ long_pct: avgLongPct.toFixed(2), short_pct: (100 - avgLongPct).toFixed(2) });
      }

      case "max-pain": {
        const url = `https://open-api-v4.coinglass.com/api/option/max-pain?symbol=${symbol}&exchange=${exchange}`;
        const response = await axios.get(url, { headers });
        return res.json({ data: response.data?.data || response.data });
      }

      case "open-interest": {
        const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets?exchange_list=Binance";
        const response = await axios.get(url, { headers });
        const coins = response.data?.data || [];
        const totalOpenInterest = coins.reduce((sum, coin) => sum + (coin.open_interest_usd || 0), 0);
        let previousOI = await kv.get("open_interest:previous_total");
        let previousTimestamp = await kv.get("open_interest:timestamp");
        const now = Date.now();
        let percentChange = 0;
        if (previousOI && previousTimestamp && (now - previousTimestamp) < 86400000) {
          percentChange = ((totalOpenInterest - previousOI) / previousOI) * 100;
        } else {
          await kv.set("open_interest:previous_total", totalOpenInterest);
          await kv.set("open_interest:timestamp", now);
        }
        return res.json({ total_open_interest_usd: totalOpenInterest, open_interest_change_24h: percentChange });
      }

      case "pi-cycle": {
        const url = "https://open-api-v4.coinglass.com/api/index/pi-cycle-indicator";
        const response = await axios.get(url, { headers });
        const rawData = response.data?.data || [];
        const prices = rawData.map(d => ({ date: new Date(d.timestamp), price: d.price }));
        const dma111 = rawData.map(d => d.ma_110 || null);
        const dma350x2 = rawData.map(d => d.ma_350_mu_2 || null);
        return res.json({ prices, dma111, dma350x2 });
      }

      case "puell-multiple": {
        const url = "https://open-api-v4.coinglass.com/api/index/puell-multiple";
        const response = await axios.get(url, { headers });
        const rawData = response.data?.data || [];
        const prices = rawData.map(d => ({ date: new Date(d.timestamp), price: d.price }));
        const puellValues = rawData.map(d => d.puell_multiple || null);
        return res.json({ prices, puellValues });
      }

      case "coin-bar-race": {
        const marketRes = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
        const coins = marketRes.data?.data || [];
        const top15 = coins.sort((a, b) => b.market_cap_usd - a.market_cap_usd).slice(0, 15).map(c => c.symbol);
        const liveFrame = coins.filter(c => top15.includes(c.symbol))
                               .map(c => ({ name: c.symbol, value: c.price_change_percent_24h || 0 }))
                               .sort((a, b) => b.value - a.value);
        return res.json({ liveFrame, lastUpdated: new Date().toISOString() });
      }

      // ✅ NEW CASE
      case "volume-total": {
        const response = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
        const coins = response.data?.data || [];
        if (!Array.isArray(coins) || coins.length === 0) throw new Error("No market data from Coinglass");
        const totalVolume24h = coins.reduce((sum, coin) =>
          sum + (typeof coin.volume_change_usd_24h === "number" ? Math.abs(coin.volume_change_usd_24h) : 0), 0);
        const now = Date.now();
        let percentChange = 0;
        const previousVolume = await kv.get("volume:previous_total");
        const previousTimestamp = await kv.get("volume:timestamp");
        if (previousVolume && previousTimestamp && (now - previousTimestamp) < 86400000) {
          percentChange = ((totalVolume24h - previousVolume) / previousVolume) * 100;
        } else {
          await kv.set("volume:previous_total", totalVolume24h);
          await kv.set("volume:timestamp", now);
        }
        return res.json({ total_volume_24h: totalVolume24h, percent_change_24h: percentChange });
      }

      default:
        return res.status(400).json({ error: "Invalid type parameter" });
    }

  } catch (err) {
    console.error(`API Error (${type}):`, err.message);
    return res.status(500).json({ error: "Internal Server Error", message: err.message });
  }
};
