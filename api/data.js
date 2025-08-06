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

case "orderbook-heatmap": {
  console.log(`DEBUG: Requesting orderbook heatmap for ${symbol} on ${exchange} with interval ${interval}`);
  
  // Ensure we have the right symbol format for Binance
  const symbolParam = exchange.toLowerCase() === 'binance' && !symbol.includes('USDT') 
    ? `${symbol}USDT` 
    : symbol;
  
  const url = `https://open-api-v4.coinglass.com/api/spot/orderbook/history`;
  const params = {
    exchange: exchange,
    symbol: symbolParam,
    interval: interval,
    limit: parseInt(limit) // Convert to number
  };
  
  console.log(`DEBUG: Requesting orderbook data with params:`, params);
  
  const response = await axios.get(url, { 
    headers,
    params,
    timeout: 15000,
    validateStatus: function (status) {
      return status < 500;
    }
  });
  
  console.log("DEBUG: Orderbook Response Status:", response.status);
  console.log("DEBUG: Orderbook Response Data sample:", JSON.stringify(response.data).substring(0, 200));
  
  if (response.status === 401) {
    return res.status(401).json({
      error: 'API Authentication Failed',
      message: 'Invalid API key or insufficient permissions.'
    });
  }
  
  if (response.status === 403) {
    return res.status(403).json({
      error: 'API Access Forbidden',
      message: 'Your API plan does not include access to this endpoint.'
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
      message: response.data?.msg || 'CoinGlass API returned error code',
      code: response.data?.code,
      fullResponse: response.data
    });
  }
  
  const rawData = response.data?.data || [];
  
  if (!Array.isArray(rawData) || rawData.length === 0) {
    return res.status(400).json({
      error: 'No Data Available',
      message: 'No orderbook data found for the specified parameters',
      requestedParams: params
    });
  }
  
  // Process the orderbook data for heatmap visualization
  const processedData = {
    heatmapData: [],
    priceRange: { min: Infinity, max: -Infinity },
    timeRange: [],
    bidData: [],
    askData: []
  };
  
  rawData.forEach((entry, timeIndex) => {
    const [timestamp, bids, asks] = entry;
    const date = new Date(timestamp * 1000);
    processedData.timeRange.push(date.toISOString());
    
    // Process bids (buy orders) - typically shown in green
    if (Array.isArray(bids)) {
      bids.forEach(([price, quantity], orderIndex) => {
        if (price && quantity && price > 0 && quantity > 0) {
          processedData.heatmapData.push([
            timeIndex,
            price,
            quantity,
            'bid'
          ]);
          processedData.bidData.push({
            time: timeIndex,
            price: price,
            quantity: quantity,
            value: price * quantity
          });
          processedData.priceRange.min = Math.min(processedData.priceRange.min, price);
          processedData.priceRange.max = Math.max(processedData.priceRange.max, price);
        }
      });
    }
    
    // Process asks (sell orders) - typically shown in red
    if (Array.isArray(asks)) {
      asks.forEach(([price, quantity], orderIndex) => {
        if (price && quantity && price > 0 && quantity > 0) {
          processedData.heatmapData.push([
            timeIndex,
            price,
            quantity,
            'ask'
          ]);
          processedData.askData.push({
            time: timeIndex,
            price: price,
            quantity: quantity,
            value: price * quantity
          });
          processedData.priceRange.min = Math.min(processedData.priceRange.min, price);
          processedData.priceRange.max = Math.max(processedData.priceRange.max, price);
        }
      });
    }
  });
  
  // Get current price for context (from the latest orderbook data)
  let currentPrice = null;
  let bestBid = null;
  let bestAsk = null;
  
  if (rawData.length > 0) {
    const latestEntry = rawData[rawData.length - 1];
    const [, bids, asks] = latestEntry;
    if (bids && bids[0] && bids[0][0]) {
      bestBid = bids[0][0];
    }
    if (asks && asks[0] && asks[0][0]) {
      bestAsk = asks[0][0];
    }
    if (bestBid && bestAsk) {
      currentPrice = (bestBid + bestAsk) / 2;
    } else if (bestBid) {
      currentPrice = bestBid;
    } else if (bestAsk) {
      currentPrice = bestAsk;
    }
  }
  
  return res.json({
    success: true,
    data: processedData,
    metadata: {
      symbol: symbolParam,
      exchange: exchange,
      interval: interval,
      limit: parseInt(limit),
      dataPoints: processedData.heatmapData.length,
      timePoints: processedData.timeRange.length,
      priceRange: processedData.priceRange,
      currentPrice: currentPrice,
      bestBid: bestBid,
      bestAsk: bestAsk,
      spread: bestBid && bestAsk ? ((bestAsk - bestBid) / bestBid * 100).toFixed(4) + '%' : null,
      lastUpdated: new Date().toISOString()
    },
    debug: {
      rawDataLength: rawData.length,
      sampleEntry: rawData[0] ? {
        timestamp: rawData[0][0],
        bidsCount: rawData[0][1]?.length || 0,
        asksCount: rawData[0][2]?.length || 0
      } : null
    }
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
