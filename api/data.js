const axios = require("axios");
const { kv } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;


module.exports = async (req, res) => {
  // Enhanced CORS headers for better compatibility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type, symbol = "BTC", exchange = "Binance", action, interval = "1h", limit = "100" } = req.query;

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

case "etf-eth-flows": {
  const url = "https://open-api-v4.coinglass.com/api/etf/ethereum/flow-history";
  const response = await axios.get(url, { headers });
  const rawData = response.data?.data || [];
  // Format daily data - using same field names as BTC
  const daily = rawData.map(d => ({
    date: new Date(d.timestamp).toISOString().split("T")[0],
    totalFlow: d.flow_usd,        // Same as BTC
    price: d.price_usd,           // Same as BTC
    etfs: d.etf_flows.map(etf => ({
      ticker: etf.etf_ticker,     // Same as BTC
      flow: etf.flow_usd          // Same as BTC
    }))
  }));
  // Weekly aggregate
  const weekly = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    if (chunk.length === 7) {
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


// ... inside your switch (type) statement ...

case "liquidations-table": {
  console.log("DEBUG: Using exchange-list endpoint for liquidations...");

  // --> Caching: Define a unique key for this data in Vercel KV.
  const cacheKey = "cache:liquidations-table";
  
  try {
    // --> Caching: Try to get the data from the cache first.
    const cachedData = await kv.get(cacheKey);
    if (cachedData) {
      console.log("DEBUG: Returning cached liquidations data.");
      // Add a header to easily see that the response was cached.
      res.setHeader('X-Vercel-Cache', 'HIT');
      return res.json(cachedData);
    }
    console.log("DEBUG: No cache found. Fetching fresh liquidations data.");
    res.setHeader('X-Vercel-Cache', 'MISS');

    const timeframes = ['1h', '4h', '12h', '24h'];
    const results = {};

    const fmtUSD = (v) => {
      const n = Math.abs(v);
      if (n >= 1e12) return `$${(v/1e12).toFixed(2)}T`;
      if (n >= 1e9)  return `$${(v/1e9 ).toFixed(2)}B`;
      if (n >= 1e6)  return `$${(v/1e6 ).toFixed(2)}M`;
      if (n >= 1e3)  return `$${(v/1e3 ).toFixed(2)}K`;
      return `$${v.toFixed(2)}`;
    };

    const requests = timeframes.map(range =>
      axios.get("https://open-api-v4.coinglass.com/api/futures/liquidation/exchange-list", {
        headers,
        timeout: 10000,
        params: { range },
        validateStatus: s => s < 500
      } )
    );

    const responses = await Promise.all(requests);

    timeframes.forEach((timeframe, index) => {
      const response = responses[index];
      
      if (response.status !== 200 || response.data?.code !== "0") {
        console.warn(`Failed to fetch ${timeframe} liquidations:`, response.status, response.data?.msg);
        results[timeframe] = {
          total: "$0", long: "$0", short: "$0",
          error: response.data?.msg || `HTTP ${response.status}`
        };
        return;
      }

      const data = response.data.data || [];
      const allExchanges = data.find(item => item.exchange === "All");
      
      if (allExchanges) {
        results[timeframe] = {
          total: fmtUSD(allExchanges.liquidation_usd || 0),
          long: fmtUSD(allExchanges.longLiquidation_usd || 0),
          short: fmtUSD(allExchanges.shortLiquidation_usd || 0),
          raw: {
            total: allExchanges.liquidation_usd || 0,
            long: allExchanges.longLiquidation_usd || 0,
            short: allExchanges.shortLiquidation_usd || 0
          }
        };
      } else {
        const totalLiq = data.reduce((sum, item) => sum + (item.liquidation_usd || 0), 0);
        const totalLong = data.reduce((sum, item) => sum + (item.longLiquidation_usd || 0), 0);
        const totalShort = data.reduce((sum, item) => sum + (item.shortLiquidation_usd || 0), 0);
        
        results[timeframe] = {
          total: fmtUSD(totalLiq), long: fmtUSD(totalLong), short: fmtUSD(totalShort),
          raw: { total: totalLiq, long: totalLong, short: totalShort }
        };
      }
    });

    const webflowFormatted = {};
    timeframes.forEach(tf => {
      const tfUpper = tf.toUpperCase();
      if (results[tf] && !results[tf].error) {
        webflowFormatted[`${tfUpper}-Total`] = results[tf].total;
        webflowFormatted[`${tfUpper}-Total-Long`] = results[tf].long;
        webflowFormatted[`${tfUpper}-Total-Short`] = results[tf].short;
      } else {
        webflowFormatted[`${tfUpper}-Total`] = "$0";
        webflowFormatted[`${tfUpper}-Total-Long`] = "$0";
        webflowFormatted[`${tfUpper}-Total-Short`] = "$0";
      }
    });
    
    const finalResponse = {
      success: true,
      ...webflowFormatted,
      nested_data: results,
      lastUpdated: new Date().toISOString(),
      method: "exchange-list-aggregated",
      api_calls_used: timeframes.length
    };

    // --> Caching: Save the fresh data to the cache before returning it.
    // `ex: 300` sets the cache to expire in 300 seconds (5 minutes).
    await kv.set(cacheKey, finalResponse, { ex: 300 });
    
    console.log("DEBUG: Liquidations data fetched and cached successfully.");
    return res.json(finalResponse);

  } catch (err) {
    console.error("[liquidations-table] Error:", err.message);
    
    const fallbackResults = {};
    ['1h', '4h', '12h', '24h'].forEach(tf => {
      const tfUpper = tf.toUpperCase();
      fallbackResults[`${tfUpper}-Total`] = "$0";
      fallbackResults[`${tfUpper}-Total-Long`] = "$0";
      fallbackResults[`${tfUpper}-Total-Short`] = "$0";
    });
    
    return res.status(500).json({
      success: false,
      ...fallbackResults,
      error: "Liquidations API failed",
      message: err.message,
      lastUpdated: new Date().toISOString()
    });
  }
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
  
  // Calculate the differential (skew)
  const differential = Math.abs(avgLongPct - avgShortPct);
  
  return res.json({
    long_pct: avgLongPct.toFixed(2),
    short_pct: avgShortPct.toFixed(2),
    differential: differential.toFixed(2), // New field
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
        
        console.log("DEBUG: Max Pain raw response:", response.data);
        
        // CoinGlass returns data directly, not nested
        const maxPainData = response.data?.data || response.data;
        
        if (!maxPainData) {
          throw new Error("Max Pain data unavailable");
        }
        
        // If it's an array, take the first item, otherwise use as is
        const finalData = Array.isArray(maxPainData) ? maxPainData[0] : maxPainData;
        
        console.log("DEBUG: Final Max Pain data:", finalData);
        
        return res.json({ data: finalData });
      }

     case "open-interest": {
  const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
  const response = await axios.get(url, { headers });
  const coins = Array.isArray(response.data?.data) ? response.data.data : [];
  if (!coins.length) throw new Error("Coinglass returned empty or malformed data");

  // 1) Total global OI (all coins, all exchanges)
  const totalOpenInterest = coins.reduce((sum, c) => sum + (c.open_interest_usd || 0), 0);

  // 2) Simple average of 24h OI change % across coins
  const pctList = coins
    .map(c => c.open_interest_change_percent_24h)
    .filter(v => typeof v === "number" && Number.isFinite(v));
  const avgChangePct = pctList.length ? (pctList.reduce((a, b) => a + b, 0) / pctList.length) : 0;

  // (Optional) Weighted average by each coin's OI (often more meaningful)
  let wNum = 0, wDen = 0;
  for (const c of coins) {
    const oi = c.open_interest_usd || 0;
    const pct = c.open_interest_change_percent_24h;
    if (oi > 0 && typeof pct === "number" && Number.isFinite(pct)) {
      wNum += oi * pct;
      wDen += oi;
    }
  }
  const weightedAvgChangePct = wDen ? (wNum / wDen) : 0;

  // Keep your KV baseline logic if you still want a rolling 24h delta from your last fetch
  let previousOI = await kv.get("open_interest:previous_total");
  let previousTimestamp = await kv.get("open_interest:timestamp");
  const now = Date.now();
  let baselineChangePct = 0;
  if (previousOI && previousTimestamp && (now - previousTimestamp) < 24 * 60 * 60 * 1000) {
    baselineChangePct = ((totalOpenInterest - previousOI) / previousOI) * 100;
  } else {
    await kv.set("open_interest:previous_total", totalOpenInterest);
    await kv.set("open_interest:timestamp", now);
    previousOI = totalOpenInterest;
    previousTimestamp = now;
  }

  return res.json({
    total_open_interest_usd: totalOpenInterest,
    avg_open_interest_change_percent_24h: avgChangePct,         // simple mean
    weighted_open_interest_change_percent_24h: weightedAvgChangePct, // OI-weighted
    baseline_change_percent_since_last_fetch: baselineChangePct, // from KV baseline
    coin_count: coins.length,
    baseline_timestamp: new Date(previousTimestamp).toUTCString()
  });
}


case "rsi-heatmap": {
  const { interval = "1h" } = req.query;
  
  // Validate interval parameter
  const validIntervals = ["15m", "1h", "4h", "8h", "12h", "1d", "1w"];
  if (!validIntervals.includes(interval)) {
    return res.status(400).json({ 
      error: "Invalid interval", 
      message: "Interval must be one of: " + validIntervals.join(", ")
    });
  }
  
  console.log(`DEBUG: Requesting RSI data for interval: ${interval}`);
  
  const url = "https://open-api-v4.coinglass.com/api/futures/rsi/list";
  const response = await axios.get(url, { 
    headers,
    timeout: 10000,
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  console.log("DEBUG: RSI Response Status:", response.status);
  
  if (response.status === 401) {
    return res.status(401).json({
      error: 'API Authentication Failed',
      message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
    });
  }
  
  if (response.status === 403) {
    return res.status(403).json({
      error: 'API Access Forbidden',
      message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
    });
  }
  
  if (response.status !== 200) {
    return res.status(response.status).json({
      error: 'API Request Failed',
      message: `CoinGlass API returned status ${response.status}`,
      details: response.data
    });
  }
  
  if (!response.data || response.data.code !== "0") {
    return res.status(400).json({
      error: 'API Error',
      message: response.data?.message || 'CoinGlass API returned error code',
      code: response.data?.code
    });
  }
  
  const rawData = response.data.data || [];
  
  if (!Array.isArray(rawData) || rawData.length === 0) {
    return res.status(404).json({
      error: 'No Data',
      message: 'No RSI data available for the requested interval'
    });
  }
  
  // Process and format the RSI data based on actual API response structure
  const processedData = rawData.map(coin => {
    const rsiData = {
      "15m": coin.rsi_15m || null,
      "1h": coin.rsi_1h || null,
      "4h": coin.rsi_4h || null,
      "12h": coin.rsi_12h || null,
      "24h": coin.rsi_24h || null,
      "1w": coin.rsi_1w || null
    };
    
    const priceChangeData = {
      "15m": coin.price_change_percent_15m || 0,
      "1h": coin.price_change_percent_1h || 0,
      "4h": coin.price_change_percent_4h || 0,
      "12h": coin.price_change_percent_12h || 0,
      "24h": coin.price_change_percent_24h || 0,
      "1w": coin.price_change_percent_1w || 0
    };
    
    // Map interval parameter to API keys
    const intervalMap = {
      "15m": "15m",
      "1h": "1h", 
      "4h": "4h",
      "8h": "4h", // Use 4h as fallback for 8h
      "12h": "12h",
      "1d": "24h", // Map 1d to 24h
      "1w": "1w"
    };
    
    const mappedInterval = intervalMap[interval] || "1h";
    
    return {
      symbol: coin.symbol || 'UNKNOWN',
      current_price: coin.current_price || 0,
      rsi: rsiData,
      price_change_percent: priceChangeData,
      current_rsi: rsiData[mappedInterval], // RSI for the requested interval
      current_price_change: priceChangeData[mappedInterval] // Price change for the requested interval
    };
  })
  .filter(coin => coin.current_rsi !== null && coin.current_rsi !== undefined)
  .sort((a, b) => {
    // Sort by current price descending (as proxy for market cap), then by RSI
    if (b.current_price !== a.current_price) {
      return b.current_price - a.current_price;
    }
    return b.current_rsi - a.current_rsi;
  })
  .slice(0, 150); // Limit to top 150 coins for performance
  
  // Calculate distribution statistics
  const rsiValues = processedData.map(coin => coin.current_rsi);
  const overbought = rsiValues.filter(rsi => rsi >= 70).length;
  const oversold = rsiValues.filter(rsi => rsi <= 30).length;
  const neutral = rsiValues.filter(rsi => rsi > 30 && rsi < 70).length;
  const strong = rsiValues.filter(rsi => rsi >= 60 && rsi < 70).length;
  const weak = rsiValues.filter(rsi => rsi > 30 && rsi <= 40).length;
  
  const stats = {
    total_coins: processedData.length,
    overbought_count: overbought,
    oversold_count: oversold,
    neutral_count: neutral,
    strong_count: strong,
    weak_count: weak,
    overbought_percent: ((overbought / processedData.length) * 100).toFixed(1),
    oversold_percent: ((oversold / processedData.length) * 100).toFixed(1),
    average_rsi: (rsiValues.reduce((sum, rsi) => sum + rsi, 0) / rsiValues.length).toFixed(2)
  };
  
  console.log(`DEBUG: Processed ${processedData.length} coins for ${interval} interval`);
  console.log("DEBUG: RSI Distribution:", stats);
  
  return res.json({ 
    success: true,
    data: processedData,
    interval: interval,
    statistics: stats,
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date(Date.now() + 15 * 60 * 1000).toISOString() // Next update in 15 minutes
  });
}

  case "bitcoin-dominance": {
  console.log("DEBUG: Requesting Bitcoin Dominance from Coinglass...");
  
  const btcDominanceUrl = "https://open-api-v4.coinglass.com/api/index/bitcoin-dominance";
  const btcResponse = await axios.get(btcDominanceUrl, { 
    headers,
    timeout: 10000,
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  console.log("DEBUG: Coinglass Response Status:", btcResponse.status);
  
  if (btcResponse.status === 401) {
    return res.status(401).json({
      error: 'API Authentication Failed',
      message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
    });
  }
  
  if (btcResponse.status === 403) {
    return res.status(403).json({
      error: 'API Access Forbidden',
      message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
    });
  }
  
  if (btcResponse.status === 404) {
    return res.status(404).json({
      error: 'API Endpoint Not Found',
      message: 'The bitcoin dominance endpoint may have changed. Check CoinGlass API documentation.'
    });
  }
  
  if (btcResponse.status !== 200) {
    return res.status(btcResponse.status).json({
      error: 'API Request Failed',
      message: `CoinGlass API returned status ${btcResponse.status}`,
      details: btcResponse.data
    });
  }
  
  if (!btcResponse.data || btcResponse.data.code !== "0") {
    return res.status(400).json({
      error: 'API Error',
      message: btcResponse.data?.message || 'CoinGlass API returned error code',
      code: btcResponse.data?.code
    });
  }
  
  const btcRaw = btcResponse.data.data;
  const btcDominanceData = btcRaw.map(d => ({
    timestamp: d.timestamp,
    price: d.price,
    bitcoin_dominance: d.bitcoin_dominance,
    market_cap: d.market_cap
  }));
  
  // Sort by timestamp to ensure chronological order
  btcDominanceData.sort((a, b) => a.timestamp - b.timestamp);
  
  return res.json({ 
    success: true,
    data: btcDominanceData,
    lastUpdated: new Date().toISOString(),
    dataPoints: btcDominanceData.length
  });
}


case "crypto-ticker": {
  console.log("DEBUG: Requesting crypto ticker data from Coinglass...");
  
  const url = "https://open-api-v4.coinglass.com/api/futures/coins-price-change";
  const response = await axios.get(url, { 
    headers,
    timeout: 10000,
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  console.log("DEBUG: Coinglass Response Status:", response.status);
  
  if (response.status === 401) {
    return res.status(401).json({
      error: 'API Authentication Failed',
      message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
    });
  }
  
  if (response.status === 403) {
    return res.status(403).json({
      error: 'API Access Forbidden',
      message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
    });
  }
  
  if (response.status !== 200) {
    return res.status(response.status).json({
      error: 'API Request Failed',
      message: `CoinGlass API returned status ${response.status}`,
      details: response.data
    });
  }
  
  if (!response.data || response.data.code !== "0") {
    return res.status(400).json({
      error: 'API Error',
      message: response.data?.message || 'CoinGlass API returned error code',
      code: response.data?.code
    });
  }
  
  const rawData = response.data.data || [];
  
  // Define the coins you want to show, ordered by market cap
  const targetCoins = [
    'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TRX', 'TON', 'AVAX',
    'LINK', 'DOT', 'LTC', 'BCH', 'UNI', 'XLM', 'HBAR', 'SUI', 'PEPE', 'SHIB',
    'INJ', 'ONDO'
  ];
  
  // Filter and sort the data based on your target coins
  const filteredData = rawData
    .filter(coin => targetCoins.includes(coin.symbol))
    .map(coin => ({
      symbol: coin.symbol,
      current_price: coin.current_price,
      price_change_percent_24h: coin.price_change_percent_24h || 0,
      // Add logo URL pointing to your GitHub logos
      logo_url: `https://raw.githubusercontent.com/whaletradesweb/whale-trades2/main/api/public/logos/${coin.symbol.toLowerCase()}.svg`
    }))
    .sort((a, b) => {
      // Sort by the order in targetCoins array (market cap order)
      return targetCoins.indexOf(a.symbol) - targetCoins.indexOf(b.symbol);
    });
  
  console.log(`DEBUG: Filtered ${filteredData.length} coins for ticker`);
  
  return res.json({ 
    success: true,
    data: filteredData,
    lastUpdated: new Date().toISOString(),
    totalCoins: filteredData.length
  });
}


// Risk Calculator

case "supported-coins": {
  console.log("DEBUG: Requesting supported coins from Coinglass...");
  
  const url = "https://open-api-v4.coinglass.com/api/futures/supported-coins";
  const response = await axios.get(url, { 
    headers,
    timeout: 10000,
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  console.log("DEBUG: Supported Coins Response Status:", response.status);
  
  if (response.status === 401) {
    return res.status(401).json({
      error: 'API Authentication Failed',
      message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
    });
  }
  
  if (response.status === 403) {
    return res.status(403).json({
      error: 'API Access Forbidden',
      message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
    });
  }
  
  if (response.status !== 200) {
    return res.status(response.status).json({
      error: 'API Request Failed',
      message: `CoinGlass API returned status ${response.status}`,
      details: response.data
    });
  }
  
  if (!response.data || response.data.code !== "0") {
    return res.status(400).json({
      error: 'API Error',
      message: response.data?.message || 'CoinGlass API returned error code',
      code: response.data?.code
    });
  }
  
  return res.json(response.data);
}

case "coins-markets": {
  console.log("DEBUG: Requesting coins markets from Coinglass...");
  
  const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
  const response = await axios.get(url, { 
    headers,
    timeout: 10000,
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  console.log("DEBUG: Coins Markets Response Status:", response.status);
  
  if (response.status === 401) {
    return res.status(401).json({
      error: 'API Authentication Failed',
      message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
    });
  }
  
  if (response.status === 403) {
    return res.status(403).json({
      error: 'API Access Forbidden',
      message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
    });
  }
  
  if (response.status !== 200) {
    return res.status(response.status).json({
      error: 'API Request Failed',
      message: `CoinGlass API returned status ${response.status}`,
      details: response.data
    });
  }
  
  if (!response.data || response.data.code !== "0") {
    return res.status(400).json({
      error: 'API Error',
      message: response.data?.message || 'CoinGlass API returned error code',
      code: response.data?.code
    });
  }
  
  return res.json(response.data);
}


        

case "hyperliquid-long-short": {
  console.log("DEBUG: Requesting Hyperliquid whale positions...");
  
  const url = "https://open-api-v4.coinglass.com/api/hyperliquid/whale-position";
  const response = await axios.get(url, { 
    headers,
    timeout: 10000,
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  console.log("DEBUG: Hyperliquid Response Status:", response.status);
  
  if (response.status === 401) {
    return res.status(401).json({
      error: 'API Authentication Failed',
      message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
    });
  }
  
  if (response.status === 403) {
    return res.status(403).json({
      error: 'API Access Forbidden',
      message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
    });
  }
  
  if (response.status !== 200) {
    return res.status(response.status).json({
      error: 'API Request Failed',
      message: `CoinGlass API returned status ${response.status}`,
      details: response.data
    });
  }
  
  if (!response.data || response.data.code !== "0") {
    return res.status(400).json({
      error: 'API Error',
      message: response.data?.message || 'CoinGlass API returned error code',
      code: response.data?.code
    });
  }
  
  const rawData = response.data.data || [];
  
  if (!Array.isArray(rawData) || rawData.length === 0) {
    return res.status(404).json({
      error: 'No Data',
      message: 'No Hyperliquid whale position data available'
    });
  }
  
  // Group positions by symbol and calculate long/short ratios
  const symbolData = {};
  
  rawData.forEach(position => {
    const symbol = position.symbol;
    const positionSize = position.position_size || 0;
    const positionValueUsd = Math.abs(position.position_value_usd || 0);
    
    if (!symbolData[symbol]) {
      symbolData[symbol] = {
        symbol: symbol,
        longValue: 0,
        shortValue: 0,
        totalValue: 0,
        positionCount: 0
      };
    }
    
    if (positionSize > 0) {
      // Long position
      symbolData[symbol].longValue += positionValueUsd;
    } else if (positionSize < 0) {
      // Short position
      symbolData[symbol].shortValue += positionValueUsd;
    }
    
    symbolData[symbol].totalValue += positionValueUsd;
    symbolData[symbol].positionCount += 1;
  });
  
  // Calculate percentages and format data
  const processedData = Object.values(symbolData)
    .filter(data => data.totalValue > 0) // Only include symbols with positions
    .map(data => {
      const longPct = data.totalValue > 0 ? (data.longValue / data.totalValue) * 100 : 0;
      const shortPct = data.totalValue > 0 ? (data.shortValue / data.totalValue) * 100 : 0;
      const differential = Math.abs(longPct - shortPct);
      
      return {
        symbol: data.symbol,
        longValue: data.longValue,
        shortValue: data.shortValue,
        totalValue: data.totalValue,
        longPct: parseFloat(longPct.toFixed(2)),
        shortPct: parseFloat(shortPct.toFixed(2)),
        differential: parseFloat(differential.toFixed(2)),
        positionCount: data.positionCount,
        // Determine market sentiment
        sentiment: longPct > shortPct ? 'bullish' : 'bearish',
        dominance: Math.max(longPct, shortPct)
      };
    })
    .sort((a, b) => b.totalValue - a.totalValue) // Sort by total position value
    .slice(0, 20); // Top 20 coins
  
  // Calculate overall market metrics
  const totalLongValue = processedData.reduce((sum, coin) => sum + coin.longValue, 0);
  const totalShortValue = processedData.reduce((sum, coin) => sum + coin.shortValue, 0);
  const totalValue = totalLongValue + totalShortValue;
  
  const overallLongPct = totalValue > 0 ? (totalLongValue / totalValue) * 100 : 0;
  const overallShortPct = totalValue > 0 ? (totalShortValue / totalValue) * 100 : 0;
  const overallDifferential = Math.abs(overallLongPct - overallShortPct);
  
  const marketMetrics = {
    totalLongValue,
    totalShortValue,
    totalValue,
    overallLongPct: parseFloat(overallLongPct.toFixed(2)),
    overallShortPct: parseFloat(overallShortPct.toFixed(2)),
    overallDifferential: parseFloat(overallDifferential.toFixed(2)),
    marketSentiment: overallLongPct > overallShortPct ? 'bullish' : 'bearish',
    totalCoins: processedData.length,
    bullishCoins: processedData.filter(coin => coin.sentiment === 'bullish').length,
    bearishCoins: processedData.filter(coin => coin.sentiment === 'bearish').length
  };
  
  console.log(`DEBUG: Processed ${processedData.length} coins with total value $${(totalValue / 1e6).toFixed(2)}M`);
  console.log(`DEBUG: Overall ratio - Long: ${overallLongPct.toFixed(2)}%, Short: ${overallShortPct.toFixed(2)}%`);
  
  return res.json({ 
    success: true,
    data: processedData,
    marketMetrics: marketMetrics,
    lastUpdated: new Date().toISOString(),
    dataSource: 'hyperliquid_whale_positions'
  });
}

case "hyperliquid-whale-position": {
  console.log("DEBUG: Requesting raw Hyperliquid whale positions...");
  
  const url = "https://open-api-v4.coinglass.com/api/hyperliquid/whale-position";
  const response = await axios.get(url, { 
    headers,
    timeout: 10000,
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  console.log("DEBUG: Hyperliquid Whale Position Response Status:", response.status);
  
  if (response.status === 401) {
    return res.status(401).json({
      error: 'API Authentication Failed',
      message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
    });
  }
  
  if (response.status === 403) {
    return res.status(403).json({
      error: 'API Access Forbidden',
      message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
    });
  }
  
  if (response.status !== 200) {
    return res.status(response.status).json({
      error: 'API Request Failed',
      message: `CoinGlass API returned status ${response.status}`,
      details: response.data
    });
  }
  
  if (!response.data || response.data.code !== "0") {
    return res.status(400).json({
      error: 'API Error',
      message: response.data?.message || 'CoinGlass API returned error code',
      code: response.data?.code
    });
  }
  
  const rawData = response.data.data || [];
  
  if (!Array.isArray(rawData) || rawData.length === 0) {
    return res.status(404).json({
      error: 'No Data',
      message: 'No Hyperliquid whale position data available'
    });
  }
  
  console.log(`DEBUG: Processed ${rawData.length} raw whale positions`);
  
  return res.json({ 
    success: true,
    data: rawData,
    lastUpdated: new Date().toISOString(),
    dataSource: 'hyperliquid_raw_whale_positions'
  });
}


// Add this case to your existing switch statement in data.js

case "hyperliquid-whale-alert": {
  console.log("DEBUG: Requesting Hyperliquid whale alerts...");
  
  const url = "https://open-api-v4.coinglass.com/api/hyperliquid/whale-alert";
  const response = await axios.get(url, { 
    headers,
    timeout: 10000,
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  console.log("DEBUG: Hyperliquid Whale Alert Response Status:", response.status);
  
  if (response.status === 401) {
    return res.status(401).json({
      error: 'API Authentication Failed',
      message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
    });
  }
  
  if (response.status === 403) {
    return res.status(403).json({
      error: 'API Access Forbidden',
      message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
    });
  }
  
  if (response.status !== 200) {
    return res.status(response.status).json({
      error: 'API Request Failed',
      message: `CoinGlass API returned status ${response.status}`,
      details: response.data
    });
  }
  
  if (!response.data || response.data.code !== "0") {
    return res.status(400).json({
      error: 'API Error',
      message: response.data?.message || 'CoinGlass API returned error code',
      code: response.data?.code
    });
  }
  
  const rawData = response.data.data || [];
  
  if (!Array.isArray(rawData)) {
    return res.status(404).json({
      error: 'No Data',
      message: 'No Hyperliquid whale alert data available'
    });
  }
  
  console.log(`DEBUG: Processed ${rawData.length} whale alerts`);
  
  return res.json({ 
    success: true,
    data: rawData,
    lastUpdated: new Date().toISOString(),
    dataSource: 'hyperliquid_whale_alerts'
  });
}

// 

case "bull-market-peak-indicators": {
  console.log("DEBUG: Requesting Bull Market Peak Indicators from Coinglass...");
  
  const bullMarketUrl = "https://open-api-v4.coinglass.com/api/bull-market-peak-indicator";
  const bullResponse = await axios.get(bullMarketUrl, { 
    headers,
    timeout: 10000,
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  console.log("DEBUG: Bull Market Peak Indicators Response Status:", bullResponse.status);
  
  if (bullResponse.status === 401) {
    return res.status(401).json({
      error: 'API Authentication Failed',
      message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
    });
  }
  
  if (bullResponse.status === 403) {
    return res.status(403).json({
      error: 'API Access Forbidden',
      message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
    });
  }
  
  if (bullResponse.status === 404) {
    return res.status(404).json({
      error: 'API Endpoint Not Found',
      message: 'The bull market peak indicators endpoint may have changed. Check CoinGlass API documentation.'
    });
  }
  
  if (bullResponse.status !== 200) {
    return res.status(bullResponse.status).json({
      error: 'API Request Failed',
      message: `CoinGlass API returned status ${bullResponse.status}`,
      details: bullResponse.data
    });
  }
  
  if (!bullResponse.data || bullResponse.data.code !== "0") {
    return res.status(400).json({
      error: 'API Error',
      message: bullResponse.data?.message || 'CoinGlass API returned error code',
      code: bullResponse.data?.code
    });
  }
  
  const indicators = bullResponse.data.data || [];
  
  // Target indicators we want to display (using exact API names)
  const targetIndicators = [
    "Pi Cycle Top Indicator",
    "Puell Multiple", 
    "Bitcoin Rainbow Chart",
    "MVRV Z-Score", // Fixed name
    "Altcoin Season Index",
    "Bitcoin Dominance", 
    "Bitcoin Net Unrealized P&L (NUPL)", // Fixed name
    "Bitcoin 4-Year Moving Average"
  ];
  
  // Process and format the indicators data
  const processedIndicators = {};
  
  indicators.forEach(indicator => {
    if (targetIndicators.includes(indicator.indicator_name)) {
      // Parse current and target values (handle percentage strings)
      let current = parseFloat(indicator.current_value.toString().replace('%', '')) || 0;
      let target = parseFloat(indicator.target_value.toString().replace('%', '')) || 0;
      const previous = parseFloat(indicator.previous_value.toString().replace('%', '')) || 0;
      const change = parseFloat(indicator.change_value) || 0;
      
      // Calculate progress percentage
      let progressPercentage = 0;
      if (indicator.comparison_type === ">=") {
        // For >= comparisons, calculate how close we are to the target
        progressPercentage = target > 0 ? Math.min((current / target) * 100, 100) : 0;
      } else if (indicator.comparison_type === "<=") {
        // For <= comparisons, calculate how close we are (inverted)
        progressPercentage = target > 0 ? Math.max(100 - ((current / target) * 100), 0) : 0;
      }
      
      // Calculate distance to target
      const distance = Math.abs(target - current);
      
      // Calculate percentage change from previous
      const percentageChange = previous !== 0 ? ((current - previous) / previous) * 100 : 0;
      
      processedIndicators[indicator.indicator_name] = {
        current_value: current,
        target_value: target,
        previous_value: previous,
        change_value: change,
        comparison_type: indicator.comparison_type,
        hit_status: indicator.hit_status,
        progress_percentage: Math.round(progressPercentage * 100) / 100,
        distance_to_target: distance,
        percentage_change: Math.round(percentageChange * 100) / 100,
        progress_bar_width: Math.min(progressPercentage, 100), // This is the green progress bar
        remaining_bar_width: Math.max(100 - progressPercentage, 0), // This is the remaining gray bar
        original_current_value: indicator.current_value, // Keep original format for display
        original_target_value: indicator.target_value // Keep original format for display
      };
    }
  });
  
  console.log(`DEBUG: Processed ${Object.keys(processedIndicators).length} indicators`);
  
  return res.json({ 
    success: true,
    data: processedIndicators,
    lastUpdated: new Date().toISOString(),
    totalIndicators: Object.keys(processedIndicators).length
  });
}



case "volume-total": {
  console.log("DEBUG: Using optimized volume-total endpoint...");
  
  const fmtUSD = (v) => {
    const n = Math.abs(v);
    if (n >= 1e12) return `$${(v/1e12).toFixed(2)}T`;
    if (n >= 1e9)  return `$${(v/1e9 ).toFixed(2)}B`;
    if (n >= 1e6)  return `$${(v/1e6 ).toFixed(2)}M`;
    return `$${Math.round(v).toLocaleString()}`;
  };

  try {
    // Use coins-markets to get volume data for all coins in fewer calls
    let allCoins = [];
    let page = 1;
    const PER_PAGE = 200;
    
    // Fetch all coins with pagination (much fewer calls than per-symbol requests)
    for (;;) {
      const response = await axios.get(
        "https://open-api-v4.coinglass.com/api/futures/coins-markets",
        {
          headers,
          timeout: 15000,
          params: { per_page: PER_PAGE, page },
          validateStatus: s => s < 500
        }
      );
      
      if (response.status !== 200 || response.data?.code !== "0") {
        throw new Error(`API request failed: ${response.status} - ${response.data?.message || 'Unknown error'}`);
      }
      
      const rows = response.data?.data || [];
      if (!rows.length) break;
      
      allCoins = allCoins.concat(rows);
      
      if (rows.length < PER_PAGE) break; // Last page
      page++;
    }
    
    console.log(`DEBUG: Fetched ${allCoins.length} coins in ${page} API calls`);
    
    // Calculate total volume by summing long + short for each coin
    let totalVolume24h = 0;
    let totalWeightedChange = 0;
    let coinsWithVolume = 0;
    
    const coinData = allCoins.map(coin => {
      const longVolume = coin.long_volume_usd_24h || 0;
      const shortVolume = coin.short_volume_usd_24h || 0;
      const coinTotalVolume = longVolume + shortVolume;
      const changePercent = coin.volume_change_percent_24h || 0;
      
      if (coinTotalVolume > 0) {
        totalVolume24h += coinTotalVolume;
        coinsWithVolume++;
        
        // Calculate volume-weighted change contribution
        if (changePercent !== 0) {
          totalWeightedChange += (coinTotalVolume * changePercent);
        }
      }
      
      return {
        symbol: coin.symbol,
        volume_usd_24h: coinTotalVolume,
        volume_formatted: fmtUSD(coinTotalVolume),
        long_volume: longVolume,
        short_volume: shortVolume,
        change_percent: changePercent
      };
    });
    
    // Calculate overall percentage change (volume-weighted average)
    const overallChangePercent = totalVolume24h > 0 ? (totalWeightedChange / totalVolume24h) : 0;
    
    // Sort by volume and get top coins
    const topCoins = coinData
      .filter(coin => coin.volume_usd_24h > 0)
      .sort((a, b) => b.volume_usd_24h - a.volume_usd_24h)
      .slice(0, 50);
    
    console.log(`DEBUG: Total volume: ${fmtUSD(totalVolume24h)} from ${coinsWithVolume} coins`);
    
    return res.json({
      total_volume_24h: totalVolume24h,
      total_formatted: fmtUSD(totalVolume24h),
      percent_change_24h: overallChangePercent,
      coins_count: allCoins.length,
      coins_with_volume: coinsWithVolume,
      api_calls_used: page,
      top_coins: topCoins,
      last_updated: new Date().toISOString(),
      method: "long-short-volume-sum"
    });

  } catch (err) {
    console.error("[volume-total] Error:", err.message);
    return res.status(500).json({
      error: "Volume API failed",
      message: err.message,
      total_volume_24h: 0,
      total_formatted: "$0",
      last_updated: new Date().toISOString()
    });
  }
}

        


case "api-usage-debug": {
  // Make a simple test call to see if you're rate limited
  try {
    const testResponse = await axios.get(
      "https://open-api-v4.coinglass.com/api/futures/supported-coins",
      { 
        headers,
        timeout: 5000,
        validateStatus: () => true // Don't throw on any status
      }
    );
    
    return res.json({
      status: testResponse.status,
      message: testResponse.status === 429 ? "Rate Limited" : 
               testResponse.status === 200 ? "API Working" : 
               `HTTP ${testResponse.status}`,
      headers: {
        remaining: testResponse.headers['x-ratelimit-remaining'],
        limit: testResponse.headers['x-ratelimit-limit'],
        reset: testResponse.headers['x-ratelimit-reset']
      },
      response_body: testResponse.data
    });
  } catch (err) {
    return res.json({
      error: err.message,
      api_status: "Connection Failed"
    });
  }
}





case "market-sentiment-flow": {
  // Query: &basis=market_cap|volume  &interval=1h|4h|1d|1w  &limit=10
  const {
    basis = "market_cap",     // "market_cap" or "volume"
    interval = "1h",          // "1h" | "4h" | "1d" | "1w"
    limit = "10"
  } = req.query;

  const validIntervals = ["1h", "4h", "1d", "1w"];
  if (!validIntervals.includes(interval)) {
    return res.status(400).json({ error: "Invalid interval. Use 1h, 4h, 1d, 1w" });
  }

  // Map 1d → 24h fields on the API
  const fieldKey = interval === "1d" ? "24h" : interval;

  const buyField   = `buy_volume_usd_${fieldKey}`;
  const sellField  = `sell_volume_usd_${fieldKey}`;
  const flowField  = `volume_flow_usd_${fieldKey}`;
  const mcapField  = "market_cap";       // USD
  const vol24Field = "volume_usd_24h";   // USD

  // --- Helpers: label, snapped score, and color (keep UI+pointer consistent)
  function labelFromRatio(r){
    if (r <= -0.25) return "Strong sell";
    if (r <  -0.05) return "Sell";
    if (r <=  0.05) return "Neutral";
    if (r <   0.25) return "Buy";
    return "Strong buy";
  }
  function scoreFromLabel(lbl){
    switch (lbl) {
      case "Strong sell": return 0.10;
      case "Sell":        return 0.30;
      case "Neutral":     return 0.50;
      case "Buy":         return 0.70;
      case "Strong buy":  return 0.90;
      default:            return 0.50;
    }
  }
  function colorFromLabel(lbl){
    // Your minimal palette
    if (lbl === "Strong sell") return "#ff3333";
    if (lbl === "Sell")        return "#ff6666";
    if (lbl === "Neutral")     return "#ffffff";
    if (lbl === "Buy")         return "#00cc66";
    return "#00ff99"; // Strong buy
  }

  try {
    const url = "https://open-api-v4.coinglass.com/api/spot/coins-markets";
    const cg = await axios.get(url, { headers, timeout: 15000, validateStatus: s => s < 500 });

    if (cg.status !== 200 || cg.data?.code !== "0") {
      return res.status(cg.status).json({
        error: "CoinGlass spot coins-markets failed",
        message: cg.data?.msg || cg.data?.message || `HTTP ${cg.status}`
      });
    }

    let rows = Array.isArray(cg.data?.data) ? cg.data.data : [];
    if (!rows.length) {
      return res.json({ success: true, data: [], lastUpdated: new Date().toISOString() });
    }

    // Rank by basis
    rows = rows
      .filter(r => typeof r[buyField] === "number" || typeof r[sellField] === "number")
      .sort((a, b) => {
        if (basis === "volume") return (b[vol24Field] || 0) - (a[vol24Field] || 0);
        return (b[mcapField] || 0) - (a[mcapField] || 0);
      })
      .slice(0, Math.max(1, Math.min(+limit || 10, 50)));

    // Compute ratios and shape output
    const data = rows.map((r) => {
      const buy  = Math.max(0, r[buyField]  || 0);
      const sell = Math.max(0, r[sellField] || 0);
      const flow = Number.isFinite(r[flowField]) ? r[flowField] : (buy - sell);
      const denom = buy + sell;
      const ratio = denom > 0 ? (buy - sell) / denom : 0; // -1..1

      const sentiment = labelFromRatio(ratio);
      const score     = scoreFromLabel(sentiment); // snapped to band center
      const band_color = colorFromLabel(sentiment);

      return {
        symbol: r.symbol,
        current_price: r.current_price,
        market_cap: r[mcapField] || 0,
        volume_usd_24h: r[vol24Field] || 0,
        interval,
        buy_usd: buy,
        sell_usd: sell,
        flow_usd: flow,
        ratio,              // (-1..1) buy-vs-sell dominance
        score,              // (0..1) snapped pointer value
        sentiment,          // label matching thresholds
        band_color          // convenience color for UI
      };
    });

    // Overall market score for the selected cohort (also snapped)
    const totBuy  = data.reduce((s, d) => s + d.buy_usd, 0);
    const totSell = data.reduce((s, d) => s + d.sell_usd, 0);
    const groupRatio   = (totBuy + totSell) > 0 ? (totBuy - totSell) / (totBuy + totSell) : 0;
    const groupLabel   = labelFromRatio(groupRatio);
    const groupScore   = scoreFromLabel(groupLabel);
    const groupColor   = colorFromLabel(groupLabel);

    return res.json({
      success: true,
      meta: {
        basis,
        interval,
        limit: data.length,
        overall: {
          ratio: groupRatio,
          score: groupScore,
          sentiment: groupLabel,
          band_color: groupColor,
          buy_usd: totBuy,
          sell_usd: totSell,
          flow_usd: totBuy - totSell
        }
      },
      data,
      lastUpdated: new Date().toISOString(),
      source: "coinglass_spot_coins_markets"
    });

  } catch (err) {
    return res.status(500).json({
      error: "market-sentiment-flow failed",
      message: err.message
    });
  }
}


case "coins-flow-sankey": {
  // --- local helpers (like your other cases) ---
  const tfMap = { "1h":"1h","4h":"4h","24h":"24h","1w":"1w" };
  const tf = (req.query.tf || "24h").toLowerCase();
  const top = Math.max(5, Math.min(parseInt(req.query.top || "20", 10), 200));
  const perPage = Math.max(top, Math.min(parseInt(req.query.per_page || "200", 10), 200));

  if (!tfMap[tf]) {
    return res.status(400).json({ error: "Invalid tf. Use 1h|4h|24h|1w" });
  }

  const volField  = `volume_usd_${tfMap[tf]}`;
  const buyField  = `buy_volume_usd_${tfMap[tf]}`;
  const sellField = `sell_volume_usd_${tfMap[tf]}`;
  const flowField = `volume_flow_usd_${tfMap[tf]}`;

  try {
    const url = `https://open-api-v4.coinglass.com/api/spot/coins-markets?per_page=${perPage}&page=1`;
    const cg = await axios.get(url, { headers, timeout: 15000, validateStatus: s => s < 500 });

    if (cg.status !== 200 || cg.data?.code !== "0") {
      return res.status(cg.status).json({
        error: "CoinGlass spot coins-markets failed",
        message: cg.data?.msg || cg.data?.message || `HTTP ${cg.status}`
      });
    }

    let rows = Array.isArray(cg.data?.data) ? cg.data.data : [];
    rows = rows
      .filter(r => typeof r[volField] === "number")
      .sort((a,b) => (b[volField]||0) - (a[volField]||0))
      .slice(0, top);

    const items = rows.map(r => ({
      symbol: r.symbol,
      volume: r[volField] || 0,
      buy:    r[buyField] || 0,
      sell:   r[sellField] || 0,
      flow:   r[flowField] ?? ((r[buyField]||0) - (r[sellField]||0))
    }));

    return res.json({
      success: true,
      timeframe: tf,
      top,
      items,
      lastUpdated: new Date().toISOString(),
      source: "coinglass_spot_coins_markets"
    });

  } catch (err) {
    return res.status(500).json({
      error: "coins-flow-sankey failed",
      message: err.message
    });
  }
}


// Add this case to your existing switch statement in data.js

case "discord-feed": {
  console.log("DEBUG: Requesting Discord messages from external service...");
  
  // The Discord service URL - replace with your actual deployed URL
  const DISCORD_SERVICE_URL = process.env.DISCORD_SERVICE_URL || "https://discord-monitor.azurewebsites.net";
  const limit = Math.min(parseInt(req.query.limit || "50"), 100);
  
  try {
    const discordUrl = `${DISCORD_SERVICE_URL}/messages`;
    const response = await axios.get(discordUrl, {
      timeout: 15000,
      validateStatus: function (status) {
        return status < 500;
      },
      params: {
        limit: limit
      }
    });

    if (response.status === 404) {
      return res.status(404).json({
        error: 'Discord service not found',
        message: 'Discord monitoring service is not available at the configured URL.'
      });
    }

    if (response.status === 503) {
      return res.status(503).json({
        error: 'Discord service unavailable',
        message: 'Discord monitoring service is temporarily unavailable.'
      });
    }

    if (response.status !== 200) {
      return res.status(response.status).json({
        error: 'Discord service error',
        message: `Discord service returned status ${response.status}`
      });
    }

    const messages = response.data || [];
    
    // Validate and format the messages
    const processedMessages = Array.isArray(messages) ? messages.map(msg => ({
      author: msg.author || 'Unknown',
      content: msg.content || '',
      images: Array.isArray(msg.images) ? msg.images : [],
      timestamp: msg.timestamp,
      // Add any additional processing if needed
      formatted_time: msg.timestamp ? new Date(msg.timestamp).toLocaleString() : null
    })) : [];

    console.log(`DEBUG: Processed ${processedMessages.length} Discord messages`);

    return res.json({
      success: true,
      data: processedMessages,
      lastUpdated: new Date().toISOString(),
      totalMessages: processedMessages.length,
      source: 'discord_monitor_service'
    });

  } catch (err) {
    console.error("[discord-feed] Error:", err.message);
    
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: "Discord service connection failed",
        message: "Unable to connect to Discord monitoring service. Please try again later."
      });
    }
    
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      return res.status(504).json({
        error: "Request timeout",
        message: "Discord service request timed out. Please try again."
      });
    }
    
    return res.status(500).json({
      error: "Discord feed failed",
      message: err.message,
      data: [],
      lastUpdated: new Date().toISOString()
    });
  }
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
