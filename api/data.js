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

    console.log(`DEBUG: Processing ${coins.length} coins for volume calculation`);

    // Calculate total 24h volume by summing long and short volumes
    let total24hVolume = 0;
    let totalWeightedChange = 0;
    let validCoins = 0;

    coins.forEach(coin => {
      // Sum long and short volume for 24h to get total volume for this coin
      const longVolume24h = coin.long_volume_usd_24h || 0;
      const shortVolume24h = coin.short_volume_usd_24h || 0;
      const coinTotal24hVolume = longVolume24h + shortVolume24h;
      
      if (coinTotal24hVolume > 0) {
        total24hVolume += coinTotal24hVolume;
        
        // For weighted percentage change, use the volume change if available
        if (typeof coin.volume_change_percent_24h === "number") {
          totalWeightedChange += coinTotal24hVolume * coin.volume_change_percent_24h;
          validCoins++;
        }
      }
    });

    // Calculate volume-weighted percentage change
    const cumulativePercentageChange = total24hVolume > 0 
      ? totalWeightedChange / total24hVolume 
      : 0;

    console.log(`DEBUG: Total 24h Volume: $${(total24hVolume / 1e9).toFixed(2)}B`);
    console.log(`DEBUG: Weighted Change: ${cumulativePercentageChange.toFixed(2)}%`);
    console.log(`DEBUG: Valid coins for calculation: ${validCoins}`);

    return res.json({
      total_volume_24h: total24hVolume,
      percent_change_24h: cumulativePercentageChange,
      total_coins_processed: coins.length,
      coins_with_volume_data: validCoins,
      last_updated: new Date().toUTCString(),
      calculation_method: "sum_of_long_and_short_volumes"
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
