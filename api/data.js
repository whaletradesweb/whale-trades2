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
        console.log("DEBUG: Starting simplified coin-bar-race...");
        
        // Get current market data for top coins
        const marketRes = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
        const coins = marketRes.data?.data || [];
        
        if (!coins.length) {
          throw new Error("No market data received");
        }
        
        // Get top 15 coins by market cap
        const top15 = coins
          .sort((a, b) => b.market_cap_usd - a.market_cap_usd)
          .slice(0, 15)
          .map(c => c.symbol);
          
        console.log("DEBUG: Top 15 coins:", top15);
        
        // Create simplified frames using recent performance data
        // We'll use 24h, 7d, 30d performance as mock historical frames
        const frames = [];
        const timeframes = ['24h', '7d', '30d'];
        
        timeframes.forEach((period, periodIndex) => {
          const frameData = coins
            .filter(c => top15.includes(c.symbol))
            .map(c => {
              let performance = 0;
              // Use available percentage changes from market data
              if (period === '24h') {
                performance = c.price_change_percent_24h || 0;
              } else if (period === '7d') {
                performance = c.price_change_percent_7d || 0;
              } else {
                performance = c.price_change_percent_30d || 0;
              }
              return {
                name: c.symbol,
                value: performance
              };
            })
            .sort((a, b) => b.value - a.value)
            .slice(0, 15);
            
          frames.push({
            date: period === '24h' ? '1 Day' : period === '7d' ? '7 Days' : '30 Days',
            ranked: frameData
          });
        });
        
        // Create live frame with current 24h performance
        const liveFrame = coins
          .filter(c => top15.includes(c.symbol))
          .map(c => ({
            name: c.symbol,
            value: c.price_change_percent_24h || 0
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 15);
        
        console.log("DEBUG: Created", frames.length, "frames and live frame with", liveFrame.length, "coins");
        console.log("DEBUG: Sample frame:", frames[0]);
        console.log("DEBUG: Sample live coin:", liveFrame[0]);
        
        return res.json({ 
          frames, 
          liveFrame, 
          lastUpdated: new Date().toISOString(),
          dataSource: "simplified"
        });
      }

case "volume-total": {
  try {
    const response = await axios.get("https://open-api-v4.coinglass.com/api/futures/coins-markets", { headers });
    const coins = response.data?.data || [];

    if (!Array.isArray(coins) || coins.length === 0) {
      throw new Error("No market data received from Coinglass");
    }

    let cumulativeVolume = 0;
    let totalWeightedChange = 0;

    // Loop through all coins to calculate 24h volume and weighted change
    coins.forEach(coin => {
      if (
        typeof coin.volume_change_usd_24h === "number" &&
        typeof coin.volume_change_percent_24h === "number" &&
        coin.volume_change_percent_24h !== 0
      ) {
        // Step 1: Calculate absolute 24h volume for this coin
        const volume_24h = Math.abs(coin.volume_change_usd_24h / (coin.volume_change_percent_24h / 100));

        // Step 2: Add to cumulative total
        cumulativeVolume += volume_24h;

        // Step 3: Calculate weighted change contribution
        const weightedChange = volume_24h * coin.volume_change_percent_24h;
        totalWeightedChange += weightedChange;
      }
    });

    // Step 4: Calculate cumulative % change (volume-weighted)
    const cumulativePercentageChange = cumulativeVolume > 0
      ? totalWeightedChange / cumulativeVolume
      : 0;

    return res.json({
      total_volume_24h: cumulativeVolume,
      percent_change_24h: cumulativePercentageChange,
      last_updated: new Date().toUTCString()
    });

  } catch (err) {
    console.error("[volume-total] API Error:", err.message);
    return res.status(500).json({ error: "Volume API failed", message: err.message });
  }
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

case "mvrv-z-score": {
  console.log("DEBUG: Requesting MVRV-Z Score data from Coinglass...");
  
  try {
    // Fetch all required data in parallel, including current MVRV-Z Score for validation
    const [sthRealizedPriceRes, lthRealizedPriceRes, sthSupplyRes, lthSupplyRes, bullMarketRes] = await Promise.all([
      axios.get("https://open-api-v4.coinglass.com/api/index/bitcoin-sth-realized-price", { headers }),
      axios.get("https://open-api-v4.coinglass.com/api/index/bitcoin-lth-realized-price", { headers }),
      axios.get("https://open-api-v4.coinglass.com/api/index/bitcoin-short-term-holder-supply", { headers }),
      axios.get("https://open-api-v4.coinglass.com/api/index/bitcoin-long-term-holder-supply", { headers }),
      axios.get("https://open-api-v4.coinglass.com/api/bull-market-peak-indicator", { headers })
    ]);

    // Validate all responses
    const responses = [sthRealizedPriceRes, lthRealizedPriceRes, sthSupplyRes, lthSupplyRes, bullMarketRes];
    const endpointNames = ['STH Realized Price', 'LTH Realized Price', 'STH Supply', 'LTH Supply', 'Bull Market Indicators'];
    
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      if (response.status !== 200 || !response.data || response.data.code !== "0") {
        return res.status(response.status || 400).json({
          error: `${endpointNames[i]} API Error`,
          message: response.data?.message || `Failed to fetch ${endpointNames[i]} data`,
          code: response.data?.code
        });
      }
    }

    // Extract current MVRV-Z Score from Bull Market Indicators for validation
    const bullMarketData = bullMarketRes.data.data || [];
    const currentMVRVIndicator = bullMarketData.find(indicator => 
      indicator.indicator_name === "MVRV Z-Score"
    );
    const expectedCurrentZScore = currentMVRVIndicator ? parseFloat(currentMVRVIndicator.current_value) : null;
    
    console.log(`DEBUG: Expected current MVRV-Z Score from Coinglass: ${expectedCurrentZScore}`);

    // Extract data arrays
    const sthRealizedPriceData = sthRealizedPriceRes.data.data || [];
    const lthRealizedPriceData = lthRealizedPriceRes.data.data || [];
    const sthSupplyData = sthSupplyRes.data.data || [];
    const lthSupplyData = lthSupplyRes.data.data || [];

    console.log(`DEBUG: Data lengths - STH Price: ${sthRealizedPriceData.length}, LTH Price: ${lthRealizedPriceData.length}, STH Supply: ${sthSupplyData.length}, LTH Supply: ${lthSupplyData.length}`);

    // Create lookup maps for efficient data matching
    const sthPriceMap = new Map();
    const lthPriceMap = new Map();
    const sthSupplyMap = new Map();
    const lthSupplyMap = new Map();

    sthRealizedPriceData.forEach(d => sthPriceMap.set(d.timestamp, d));
    lthRealizedPriceData.forEach(d => lthPriceMap.set(d.timestamp, d));
    sthSupplyData.forEach(d => sthSupplyMap.set(d.timestamp, d));
    lthSupplyData.forEach(d => lthSupplyMap.set(d.timestamp, d));

    // Get all unique timestamps and sort them
    const allTimestamps = new Set([
      ...sthRealizedPriceData.map(d => d.timestamp),
      ...lthRealizedPriceData.map(d => d.timestamp),
      ...sthSupplyData.map(d => d.timestamp),
      ...lthSupplyData.map(d => d.timestamp)
    ]);

    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    console.log(`DEBUG: Processing ${sortedTimestamps.length} unique timestamps`);

    // Calculate Market Cap and Realized Market Cap for each timestamp
    const mvrvData = [];

    sortedTimestamps.forEach(timestamp => {
      const sthPrice = sthPriceMap.get(timestamp);
      const lthPrice = lthPriceMap.get(timestamp);
      const sthSupply = sthSupplyMap.get(timestamp);
      const lthSupply = lthSupplyMap.get(timestamp);

      // Skip if any required data is missing
      if (!sthPrice || !lthPrice || !sthSupply || !lthSupply) {
        return;
      }

      // Extract values with fallbacks
      const price = sthPrice.price || lthPrice.price || 0;
      const sthRealizedPrice = sthPrice.sth_realized_price || 0;
      const lthRealizedPrice = lthPrice.lth_realized_price || 0;
      const sthSupplyValue = sthSupply.short_term_holder_supply || 0;
      const lthSupplyValue = lthSupply.long_term_holder_supply || 0;

      // Calculate Market Cap and Realized Market Cap
      const totalSupply = sthSupplyValue + lthSupplyValue;
      const marketCap = price * totalSupply;
      const realizedMarketCap = (sthRealizedPrice * sthSupplyValue) + (lthRealizedPrice * lthSupplyValue);

      mvrvData.push({
        timestamp,
        date: new Date(timestamp).toISOString().split('T')[0],
        price,
        market_cap: marketCap,
        realized_market_cap: realizedMarketCap,
        mvrv_ratio: realizedMarketCap > 0 ? marketCap / realizedMarketCap : 0,
        sth_realized_price: sthRealizedPrice,
        lth_realized_price: lthRealizedPrice,
        sth_supply: sthSupplyValue,
        lth_supply: lthSupplyValue,
        total_supply: totalSupply
      });
    });

    console.log(`DEBUG: Created ${mvrvData.length} data points for MVRV calculation`);

    // Sort by timestamp to ensure chronological order
    mvrvData.sort((a, b) => a.timestamp - b.timestamp);

    // Calculate MVRV-Z Score using the CORRECT formula:
    // MVRV Z-Score = (Market Cap - Realized Cap) / Standard Deviation of Market Cap
    const mvrvZScores = [];
    
    // Test different window sizes to find the best match with expected current value
    const windowSizes = [365, 730, 1000, 1460]; // 1, 2, ~2.7, 4 years
    let bestWindowSize = 365;
    let bestAccuracy = Infinity;
    
    for (const windowSize of windowSizes) {
      const testZScores = [];
      
      for (let i = windowSize; i < mvrvData.length; i++) {
        const current = mvrvData[i];
        
        // Get the window of Market Cap data for std dev calculation
        const windowData = mvrvData.slice(i - windowSize, i + 1);
        const marketCaps = windowData.map(d => d.market_cap);
        
        // Calculate standard deviation of Market Cap (NOT the difference!)
        const mean = marketCaps.reduce((sum, val) => sum + val, 0) / marketCaps.length;
        const variance = marketCaps.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (marketCaps.length - 1);
        const stdDev = Math.sqrt(variance);

        // Calculate MVRV-Z Score using CORRECT formula
        const mvrvZScore = stdDev > 0 ? (current.market_cap - current.realized_market_cap) / stdDev : 0;

        testZScores.push({
          timestamp: current.timestamp,
          date: current.date,
          price: current.price,
          market_cap: current.market_cap,
          realized_market_cap: current.realized_market_cap,
          mvrv_ratio: current.mvrv_ratio,
          mvrv_z_score: mvrvZScore,
          std_dev_window: windowSize,
          market_cap_std_dev: stdDev
        });
      }
      
      if (testZScores.length > 0 && expectedCurrentZScore) {
        const currentCalculated = testZScores[testZScores.length - 1].mvrv_z_score;
        const accuracy = Math.abs(currentCalculated - expectedCurrentZScore);
        
        console.log(`DEBUG: Window ${windowSize} - Current Z-Score: ${currentCalculated.toFixed(4)}, Expected: ${expectedCurrentZScore}, Accuracy: ${accuracy.toFixed(4)}`);
        
        if (accuracy < bestAccuracy) {
          bestAccuracy = accuracy;
          bestWindowSize = windowSize;
          mvrvZScores.splice(0, mvrvZScores.length, ...testZScores);
        }
      } else if (mvrvZScores.length === 0) {
        // Use as fallback
        mvrvZScores.splice(0, mvrvZScores.length, ...testZScores);
      }
    }

    console.log(`DEBUG: Selected window size: ${bestWindowSize} days, accuracy: ${bestAccuracy?.toFixed(4) || 'N/A'}`);

    // If still no good match, use 365-day window as default
    if (mvrvZScores.length === 0) {
      console.log("DEBUG: Using default 365-day window...");
      
      for (let i = 365; i < mvrvData.length; i++) {
        const current = mvrvData[i];
        
        // Get 365-day window of Market Cap data
        const windowData = mvrvData.slice(i - 365, i + 1);
        const marketCaps = windowData.map(d => d.market_cap);
        
        // Calculate standard deviation of Market Cap
        const mean = marketCaps.reduce((sum, val) => sum + val, 0) / marketCaps.length;
        const variance = marketCaps.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (marketCaps.length - 1);
        const stdDev = Math.sqrt(variance);

        const mvrvZScore = stdDev > 0 ? (current.market_cap - current.realized_market_cap) / stdDev : 0;

        mvrvZScores.push({
          timestamp: current.timestamp,
          date: current.date,
          price: current.price,
          market_cap: current.market_cap,
          realized_market_cap: current.realized_market_cap,
          mvrv_ratio: current.mvrv_ratio,
          mvrv_z_score: mvrvZScore,
          std_dev_window: 365,
          market_cap_std_dev: stdDev
        });
      }
    }

    const finalCurrentZScore = mvrvZScores[mvrvZScores.length - 1]?.mvrv_z_score || 0;
    console.log(`DEBUG: Final calculation - Current Z-Score: ${finalCurrentZScore.toFixed(4)}, Expected: ${expectedCurrentZScore}, Difference: ${expectedCurrentZScore ? Math.abs(finalCurrentZScore - expectedCurrentZScore).toFixed(4) : 'N/A'}`);

    // Calculate statistics
    const zScores = mvrvZScores.map(d => d.mvrv_z_score);
    const avgZScore = zScores.reduce((sum, val) => sum + val, 0) / zScores.length;
    const maxZScore = Math.max(...zScores);
    const minZScore = Math.min(...zScores);

    // Identify significant events (Z-Score > 7 for peaks, < -0.5 for bottoms)
    const peaks = mvrvZScores.filter(d => d.mvrv_z_score > 7);
    const bottoms = mvrvZScores.filter(d => d.mvrv_z_score < -0.5);

    return res.json({
      success: true,
      data: mvrvZScores,
      statistics: {
        total_data_points: mvrvZScores.length,
        current_z_score: finalCurrentZScore,
        expected_current_z_score: expectedCurrentZScore,
        calculation_accuracy: expectedCurrentZScore ? Math.abs(finalCurrentZScore - expectedCurrentZScore).toFixed(4) : "N/A",
        average_z_score: avgZScore.toFixed(4),
        max_z_score: maxZScore.toFixed(4),
        min_z_score: minZScore.toFixed(4),
        peaks_count: peaks.length,
        bottoms_count: bottoms.length,
        window_size_used: bestWindowSize
      },
      significant_events: {
        peaks: peaks.slice(-10), // Last 10 peaks
        bottoms: bottoms.slice(-10) // Last 10 bottoms
      },
      validation: {
        coinglass_current_mvrv_z: expectedCurrentZScore,
        our_calculated_current: finalCurrentZScore,
        difference: expectedCurrentZScore ? Math.abs(finalCurrentZScore - expectedCurrentZScore).toFixed(4) : "N/A",
        formula_used: "(Market Cap - Realized Cap) / Standard Deviation of Market Cap"
      },
      lastUpdated: new Date().toISOString(),
      calculation_method: "correct_mvrv_z_formula",
      data_range: {
        start_date: mvrvZScores[0]?.date,
        end_date: mvrvZScores[mvrvZScores.length - 1]?.date
      }
    });

  } catch (err) {
    console.error("[MVRV-Z Score] API Error:", err.message);
    
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
    
    return res.status(500).json({
      error: "MVRV-Z Score calculation failed",
      message: err.message
    });
  }
}



case "mayer-multiple": {
  console.log("DEBUG: Requesting Mayer Multiple data from Coinglass...");
  
  try {
    // First, get current Mayer Multiple from Bull Market Peak Indicators
    const indicatorsUrl = "https://open-api-v4.coinglass.com/api/bull-market-peak-indicator";
    const indicatorsResponse = await axios.get(indicatorsUrl, { 
      headers,
      timeout: 10000,
      validateStatus: function (status) {
        return status < 500;
      }
    });
    
    console.log("DEBUG: Bull Market Indicators Response Status:", indicatorsResponse.status);
    
    if (indicatorsResponse.status === 401) {
      return res.status(401).json({
        error: 'API Authentication Failed',
        message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
      });
    }
    
    if (indicatorsResponse.status === 403) {
      return res.status(403).json({
        error: 'API Access Forbidden',
        message: 'Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher.'
      });
    }
    
    if (indicatorsResponse.status === 404) {
      return res.status(404).json({
        error: 'API Endpoint Not Found',
        message: 'The bull market indicators endpoint may have changed. Check CoinGlass API documentation.'
      });
    }
    
    if (indicatorsResponse.status !== 200) {
      return res.status(indicatorsResponse.status).json({
        error: 'API Request Failed',
        message: `CoinGlass API returned status ${indicatorsResponse.status}`,
        details: indicatorsResponse.data
      });
    }
    
    if (!indicatorsResponse.data || indicatorsResponse.data.code !== "0") {
      return res.status(400).json({
        error: 'API Error',
        message: indicatorsResponse.data?.message || 'CoinGlass API returned error code',
        code: indicatorsResponse.data?.code
      });
    }
    
    // Find Mayer Multiple indicator
    const indicators = indicatorsResponse.data.data || [];
    const mayerIndicator = indicators.find(indicator => 
      indicator.indicator_name === "Mayer Multiple"
    );
    
    if (!mayerIndicator) {
      return res.status(404).json({
        error: 'Mayer Multiple Not Found',
        message: 'Mayer Multiple indicator not available in Bull Market Peak Indicators'
      });
    }
    
    console.log("DEBUG: Current Mayer Multiple from CoinGlass:", mayerIndicator.current_value);
    
    // Get historical Bitcoin price data from Pi Cycle indicator (reusing existing successful endpoint)
    const piCycleUrl = "https://open-api-v4.coinglass.com/api/index/pi-cycle-indicator";
    const piCycleResponse = await axios.get(piCycleUrl, { 
      headers,
      timeout: 10000,
      validateStatus: function (status) {
        return status < 500;
      }
    });
    
    console.log("DEBUG: Pi Cycle Response Status:", piCycleResponse.status);
    
    if (piCycleResponse.status !== 200) {
      return res.status(piCycleResponse.status).json({
        error: 'Historical Data Request Failed',
        message: `CoinGlass API returned status ${piCycleResponse.status}`,
        details: piCycleResponse.data
      });
    }
    
    if (!piCycleResponse.data || piCycleResponse.data.code !== "0") {
      return res.status(400).json({
        error: 'Historical Data API Error',
        message: piCycleResponse.data?.message || 'CoinGlass API returned error code',
        code: piCycleResponse.data?.code
      });
    }
    
    const historicalData = piCycleResponse.data.data || [];
    
    if (!Array.isArray(historicalData) || historicalData.length < 200) {
      return res.status(404).json({
        error: 'Insufficient Historical Data',
        message: `Need at least 200 days of price data for Mayer Multiple calculation. Received: ${historicalData.length} days`
      });
    }
    
    console.log(`DEBUG: Received ${historicalData.length} days of historical price data from Pi Cycle endpoint`);
    
    // Sort data by timestamp to ensure chronological order
    historicalData.sort((a, b) => a.timestamp - b.timestamp);
    
    // Calculate historical Mayer Multiple using 200-day moving average
    const mayerMultipleData = [];
    
    for (let i = 199; i < historicalData.length; i++) { // Start from index 199 (200th day)
      const currentDay = historicalData[i];
      const currentPrice = currentDay.price || 0;
      
      // Calculate 200-day moving average
      let sum = 0;
      for (let j = i - 199; j <= i; j++) {
        sum += (historicalData[j].price || 0);
      }
      const movingAverage200 = sum / 200;
      
      // Calculate Mayer Multiple
      const mayerMultiple = movingAverage200 > 0 ? currentPrice / movingAverage200 : 0;
      
      mayerMultipleData.push({
        timestamp: currentDay.timestamp,
        price: currentPrice,
        moving_average_200: movingAverage200,
        mayer_multiple: mayerMultiple
      });
    }
    
    // Use the current Mayer Multiple from CoinGlass for the latest value
    const currentMayerFromAPI = parseFloat(mayerIndicator.current_value);
    const previousMayerFromAPI = parseFloat(mayerIndicator.previous_value);
    const targetMayerFromAPI = parseFloat(mayerIndicator.target_value);
    const changeFromAPI = parseFloat(mayerIndicator.change_value);
    
    // Update the most recent data point with CoinGlass current value if available
    if (mayerMultipleData.length > 0) {
      const lastIndex = mayerMultipleData.length - 1;
      mayerMultipleData[lastIndex].mayer_multiple = currentMayerFromAPI;
      mayerMultipleData[lastIndex].coinglass_current = true; // Flag to indicate this is from CoinGlass
    }
    
    // Sort by timestamp to ensure chronological order
    mayerMultipleData.sort((a, b) => a.timestamp - b.timestamp);
    
    // Match the same response format as bitcoin-dominance
    return res.json({ 
      success: true,
      data: mayerMultipleData,
      statistics: {
        current_mayer_multiple: currentMayerFromAPI,
        previous_mayer_multiple: previousMayerFromAPI,
        target_mayer_multiple: targetMayerFromAPI,
        change_24h: changeFromAPI,
        hit_target: mayerIndicator.hit_status
      },
      coinglass_data: {
        current_value: mayerIndicator.current_value,
        target_value: mayerIndicator.target_value,
        previous_value: mayerIndicator.previous_value,
        change_value: mayerIndicator.change_value,
        comparison_type: mayerIndicator.comparison_type,
        hit_status: mayerIndicator.hit_status
      },
      lastUpdated: new Date().toISOString(),
      dataPoints: mayerMultipleData.length
    });

  } catch (err) {
    console.error("[Mayer Multiple] API Error:", err.message);
    
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
    
    return res.status(500).json({
      error: "Mayer Multiple calculation failed",
      message: err.message
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
