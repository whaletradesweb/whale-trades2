const axios = require("axios");
const { kv } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;

module.exports = async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, symbol = "BTC", exchange = "Binance", action } = req.query;

  try {
    console.log(`DEBUG: Processing request for type: ${type}`);
    
    if (!COINGLASS_API_KEY) {
      return res.status(500).json({ 
        error: 'API key not configured',
        message: 'COINGLASS_API_KEY environment variable is missing'
      });
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
        const altResponse = await axios.get(altUrl, { 
          headers,
          timeout: 10000,
          validateStatus: function (status) {
            return status < 500;
          }
        });
        
        console.log("DEBUG: Coinglass Response Status:", altResponse.status);
        
        if (altResponse.status === 401) {
          return res.status(401).json({
            error: 'API Authentication Failed',
            message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
          });
        }
        
        if (altResponse.status === 403) {
          return res.status(403).json({
            error: 'API Access Forbidden',
            message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
          });
        }
        
        if (altResponse.status === 404) {
          return res.status(404).json({
            error: 'API Endpoint Not Found',
            message: 'The altcoin season endpoint may have changed. Check CoinGlass API documentation.'
          });
        }
        
        if (altResponse.status !== 200) {
          return res.status(altResponse.status).json({
            error: 'API Request Failed',
            message: `CoinGlass API returned status ${altResponse.status}`,
            details: altResponse.data
          });
        }
        
        if (!altResponse.data || altResponse.data.code !== "0") {
          return res.status(400).json({
            error: 'API Error',
            message: altResponse.data?.message || 'CoinGlass API returned error code',
            code: altResponse.data?.code
          });
        }
        
        const altRaw = altResponse.data.data;
        const altcoinData = altRaw.map(d => ({
          timestamp: d.timestamp,
          altcoin_index: d.altcoin_index,
          altcoin_marketcap: d.altcoin_marketcap || 0
        }));
        
        altcoinData.sort((a, b) => a.timestamp - b.timestamp);
        
        return res.json({ 
          success: true,
          data: altcoinData,
          lastUpdated: new Date().toISOString(),
          dataPoints: altcoinData.length
        });
      }

      case "etf-btc-flows": {
        const url = "https://open-api-v4.coinglass.com/api/etf/bitcoin/flow-history";
        const response = await axios.get(url, { headers });
        const rawData = response.data?.data || [];

        // Format daily data
        const daily = rawData.map(d => ({
          date: new Date(d.timestamp).toISOString().split("T")[0],
          totalFlow: d.flow_usd,
          price: d.price_usd,
          etfs: d.etf_flows.map(etf => ({
            ticker: etf.etf_ticker,
            flow: etf.flow_usd
          }))
        }));

        // Weekly aggregate
        const weekly = [];
        for (let i = 0; i < daily.length; i += 7) {
          const chunk = daily.slice(i, i + 7);
          const totalFlow = chunk.reduce((sum, d) => sum + d.totalFlow, 0);
          const avgPrice = chunk.reduce((sum, d) => sum + d.price, 0) / chunk.length;
          const etfMap = {};
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

        return res.json({ daily, weekly });
      }

      case "liquidations-total": {
        const response = await axios.get("https://open-api-v4.coinglass.com/api/futures/liquidation/coin-list", { headers });
        const coins = response.data?.data || [];
        
        const total24h = coins.reduce((sum, c) => sum + (c.liquidation_usd_24h || 0), 0);
        
        const now = Date.now();
        let percentChange = 0;
        
        // Get previous value from KV store for percent change calculation
        const previousTotal = await kv.get("liquidations:previous_total");
        const previousTimestamp = await kv.get("liquidations:timestamp");
        
        if (previousTotal !== null && previousTimestamp && (now - previousTimestamp) < 24 * 60 * 60 * 1000) {
          percentChange = ((total24h - previousTotal) / previousTotal) * 100;
          console.log(`[Liquidations API] Calculated % change: ${percentChange.toFixed(2)}%`);
        } else {
          await kv.set("liquidations:previous_total", total24h);
          await kv.set("liquidations:timestamp", now);
          console.log(`[Liquidations API] New baseline stored: ${total24h.toFixed(2)}`);
        }
        
        return res.json({
          total_liquidations_24h: total24h,
          percent_change_24h: percentChange,
          baseline_timestamp: previousTimestamp ? new Date(previousTimestamp).toUTCString() : new Date(now).toUTCString()
        });
      }

      case "liquidations-debug": {
        if (action === "reset") {
          await kv.del("liquidations:previous_total");
          await kv.del("liquidations:timestamp");
          return res.json({ message: "✅ Baseline reset successfully" });
        }

        const previousTotal = await kv.get("liquidations:previous_total");
        const previousTimestamp = await kv.get("liquidations:timestamp");

        return res.json({
          previous_total: previousTotal || "Not set",
          previous_timestamp: previousTimestamp 
            ? new Date(previousTimestamp).toUTCString() 
            : "Not set"
        });
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

        const formatUSD = (v) =>
          v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` :
          v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` :
          v >= 1e3 ? `$${(v / 1e3).toFixed(2)}K` :
          `$${v.toFixed(2)}`;

        const formatted = Object.fromEntries(
          timeframes.map(tf => [tf, {
            total: formatUSD(aggregates[tf].total),
            long: formatUSD(aggregates[tf].long),
            short: formatUSD(aggregates[tf].short)
          }])
        );

        return res.json(formatted);
      }

      case "long-short": {
        const response = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
        const coins = response.data?.data || [];

        if (!Array.isArray(coins) || coins.length === 0) {
          throw new Error("No market data received from Coinglass");
        }

        const top10 = coins
          .filter(c => c.long_short_ratio_24h != null)
          .sort((a, b) => b.market_cap_usd - a.market_cap_usd)
          .slice(0, 10);

        if (top10.length === 0) throw new Error("No valid long/short ratios found for top coins");

        const avgRatio = top10.reduce((sum, coin) => sum + coin.long_short_ratio_24h, 0) / top10.length;
        const avgLongPct = (avgRatio / (1 + avgRatio)) * 100;
        const avgShortPct = 100 - avgLongPct;

        return res.json({
          long_pct: avgLongPct.toFixed(2),
          short_pct: avgShortPct.toFixed(2),
          average_ratio: avgRatio.toFixed(4),
          sampled_coins: top10.map(c => ({
            symbol: c.symbol,
            market_cap_usd: c.market_cap_usd,
            long_short_ratio_24h: c.long_short_ratio_24h
          }))
        });
      }

      case "max-pain": {
        const url = `https://open-api-v4.coinglass.com/api/option/max-pain?symbol=${symbol}&exchange=${exchange}`;
        const response = await axios.get(url, { headers });
        const data = response.data?.data?.[0];

        if (!data) throw new Error("Max Pain data unavailable");

        return res.json(data);
      }

      case "open-interest": {
        const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets?exchange_list=Binance";
        const response = await axios.get(url, { headers });
        const coins = response.data?.data || [];

        if (!Array.isArray(coins) || coins.length === 0) {
          throw new Error("Coinglass returned empty or malformed data");
        }

        const totalOpenInterest = coins.reduce((sum, coin) => sum + (coin.open_interest_usd || 0), 0);

        // Load or update KV baseline for % change
        let previousOI = await kv.get("open_interest:previous_total");
        let previousTimestamp = await kv.get("open_interest:timestamp");
        const now = Date.now();
        let percentChange = 0;

        if (previousOI && previousTimestamp && (now - previousTimestamp) < 24 * 60 * 60 * 1000) {
          percentChange = ((totalOpenInterest - previousOI) / previousOI) * 100;
          console.log(`[Open Interest] % Change: ${percentChange.toFixed(2)}%`);
        } else {
          await kv.set("open_interest:previous_total", totalOpenInterest);
          await kv.set("open_interest:timestamp", now);
          previousOI = totalOpenInterest;
          previousTimestamp = now;
          console.log(`[Open Interest] New baseline stored: ${previousOI.toFixed(2)}`);
        }

        return res.json({
          total_open_interest_usd: totalOpenInterest,
          open_interest_change_24h: percentChange,
          baseline_timestamp: new Date(previousTimestamp).toUTCString()
        });
      }

      case "pi-cycle": {
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
            if (prevDiff < 0 && currDiff > 0) {
              crossovers.push({ date: prices[i].date, price: prices[i].price });
            }
          }
        }

        return res.json({ prices, dma111, dma350x2, crossovers });
      }

      case "puell-multiple": {
        const url = "https://open-api-v4.coinglass.com/api/index/puell-multiple";
        const response = await axios.get(url, { headers });
        const rawData = response.data?.data || [];
        
        const prices = rawData.map(d => ({ date: new Date(d.timestamp), price: d.price }));
        const puellValues = rawData.map(d => d.puell_multiple || null);

        const overbought = [], oversold = [];
        rawData.forEach((d, i) => {
          if (d.puell_multiple > 4) overbought.push({ date: prices[i].date, value: d.puell_multiple });
          if (d.puell_multiple < 0.5) oversold.push({ date: prices[i].date, value: d.puell_multiple });
        });

        return res.json({ prices, puellValues, overbought, oversold });
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
    
    // Handle different types of errors
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: "Network connection failed",
        message: "Unable to connect to CoinGlass API. Please try again later."
      });
    }
    
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      return res.status(504).json({
        error: "Request timeout",
        message: "CoinGlass API request timed out. Please try again."
      });
    }
    
    if (err.response) {
      return res.status(err.response.status || 500).json({
        error: "API request failed",
        message: err.response.data?.message || err.message,
        status: err.response.status
      });
    } else if (err.request) {
      return res.status(503).json({
        error: "No response from API",
        message: "CoinGlass API did not respond. Service may be unavailable."
      });
    } else {
      return res.status(500).json({
        error: "Request setup failed",
        message: err.message
      });
    }
  }
};
