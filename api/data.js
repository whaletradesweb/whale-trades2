const axios = require("axios");
const { kv } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;
const { cacheGetSet, allow, axiosWithBackoff } = require("./lib/cacheAndLimit");


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
  const TTL = 300;
  const cacheKey = "cg:altcoin-season";
  const lastGoodKey = "last:altcoin-season";

  const cachedData = await kv.get(cacheKey);
  if (cachedData) return res.json(cachedData);

  if (!(await allow("cg:GLOBAL", 250))) {
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.json({ success: false, data: [], message: "Guarded: Rate limit active" });
  }

  try {
    const url = "https://open-api-v4.coinglass.com/api/index/altcoin-season";
    const response = await axiosWithBackoff(( ) => axios.get(url, { headers, timeout: 10000 }));
    if (response.status !== 200 || response.data?.code !== "0") throw new Error(`Upstream failed: ${response.status}`);
    
    const raw = response.data.data || [];
    const altcoinData = raw.map(d => ({ timestamp: d.timestamp, altcoin_index: d.altcoin_index, altcoin_marketcap: d.altcoin_marketcap || 0 })).sort((a, b) => a.timestamp - b.timestamp);
    const payload = { success: true, data: altcoinData, lastUpdated: new Date().toISOString() };

    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });
    return res.json(payload);
  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({ error: "API fetch failed", message: error.message });
  }
}


case "etf-flows": {
  const asset = (req.query.symbol || "BTC").toLowerCase();
  const assetName = asset.startsWith('btc') ? 'bitcoin' : 'ethereum';
  const TTL = 300;
  const cacheKey = `cg:etf-flows:${assetName}`;
  const lastGoodKey = `last:etf-flows:${assetName}`;

  const cachedData = await kv.get(cacheKey);
  if (cachedData) return res.json(cachedData);

  if (!(await allow("cg:GLOBAL", 250))) {
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.json({ daily: [], weekly: [], message: "Guarded: Rate limit active" });
  }

  try {
    const url = `https://open-api-v4.coinglass.com/api/etf/${assetName}/flow-history`;
    const response = await axiosWithBackoff(( ) => axios.get(url, { headers }));
    if (response.status !== 200 || response.data?.code !== "0") throw new Error(`Upstream failed: ${response.status}`);

    const rawData = response.data?.data || [];
    const daily = rawData.map(d => ({ date: new Date(d.timestamp).toISOString().split("T")[0], totalFlow: d.flow_usd, price: d.price_usd, etfs: d.etf_flows.map(etf => ({ ticker: etf.etf_ticker, flow: etf.flow_usd })) }));
    const weekly = [];
    for (let i = 0; i < daily.length; i += 7) {
      const chunk = daily.slice(i, i + 7);
      if (chunk.length > 0) {
        const totalFlow = chunk.reduce((sum, d) => sum + d.totalFlow, 0);
        const avgPrice = chunk.reduce((sum, d) => sum + d.price, 0) / chunk.length;
        const etfMap = {};
        chunk.forEach(day => day.etfs.forEach(e => { etfMap[e.ticker] = (etfMap[e.ticker] || 0) + e.flow; }));
        weekly.push({ weekStart: chunk[0].date, weekEnd: chunk[chunk.length - 1].date, totalFlow, avgPrice: parseFloat(avgPrice.toFixed(2)), etfs: Object.entries(etfMap).map(([ticker, flow]) => ({ ticker, flow })) });
      }
    }
    const payload = { daily, weekly, lastUpdated: new Date().toISOString() };

    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });
    return res.json(payload);
  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({ error: "API fetch failed", message: error.message });
  }
}



case "liquidations-total": {
  const TTL = 60; // Cache for 60 seconds
  const cacheKey = "cg:liquidations-total";
  const lastGoodKey = "last:liquidations-total";

  // 1. Check for fresh data in the main cache
  const cachedData = await kv.get(cacheKey);
  if (cachedData) {
    console.log(`DEBUG [${type}]: Returning main cached data.`);
    return res.json(cachedData);
  }

  // 2. If no cache, check rate limit
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: Rate limit active. Serving last known good.`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // Fallback with a neutral structure
    return res.json({
      total_liquidations_24h: 0,
      percent_change_24h: 0,
      baseline_timestamp: new Date().toUTCString(),
      method: "guarded-fallback"
    });
  }

  // 3. If allowed, fetch fresh data
  try {
    console.log(`DEBUG [${type}]: Fetching fresh data.`);
    
    // --- YOUR ORIGINAL, WORKING LOGIC STARTS HERE ---
    const url = "https://open-api-v4.coinglass.com/api/futures/liquidation/coin-list";
    const response = await axiosWithBackoff(( ) => axios.get(url, { headers }));

    if (response.status !== 200 || !Array.isArray(response.data?.data)) {
      throw new Error(`Upstream failed: ${response.status}`);
    }
    
    const coins = response.data.data || [];
    const total24h = coins.reduce((sum, c) => sum + (c.liquidation_usd_24h || 0), 0);
    
    const now = Date.now();
    let percentChange = 0;
    
    const previousTotal = await kv.get("liquidations:previous_total");
    const previousTimestamp = await kv.get("liquidations:timestamp");
    
    if (previousTotal !== null && previousTimestamp && (now - previousTimestamp) < 24 * 60 * 60 * 1000) {
      percentChange = ((total24h - previousTotal) / previousTotal) * 100;
    } else {
      await kv.set("liquidations:previous_total", total24h);
      await kv.set("liquidations:timestamp", now);
    }
    // --- YOUR ORIGINAL, WORKING LOGIC ENDS HERE ---

    const payload = {
      total_liquidations_24h: total24h,
      percent_change_24h: percentChange,
      baseline_timestamp: previousTimestamp ? new Date(previousTimestamp).toUTCString() : new Date(now).toUTCString(),
      lastUpdated: new Date().toISOString(),
      method: "live-fetch"
    };

    // 4. Cache the successful payload
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({
      error: "API fetch failed",
      message: error.message,
      total_liquidations_24h: 0,
      percent_change_24h: 0
    });
  }
}

        
 

case "liquidations-table": {
  const TTL = 60;
  const cacheKey = "cg:liquidations-table";
  const lastGoodKey = "last:liquidations-table";

  // 1. Check for fresh data in the main cache
  const cachedData = await kv.get(cacheKey);
  if (cachedData) {
    console.log(`DEBUG [${type}]: Returning main cached data.`);
    return res.json(cachedData);
  }

  // 2. If no cache, check rate limit
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: Rate limit active. Serving last known good.`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    
    const fallbackResults = {};
    ['1h', '4h', '12h', '24h'].forEach(tf => {
      const tfUpper = tf.toUpperCase();
      fallbackResults[`${tfUpper}-Total`] = "$0";
      fallbackResults[`${tfUpper}-Total-Long`] = "$0";
      fallbackResults[`${tfUpper}-Total-Short`] = "$0";
    });
    return res.json({ success: false, ...fallbackResults, method: "guarded-fallback" });
  }

  // 3. If allowed, fetch fresh data
  try {
    console.log(`DEBUG [${type}]: Fetching fresh data.`);
    
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

    // --- THIS BLOCK IS CORRECTED ---
    const requests = timeframes.map(range => 
      axiosWithBackoff(() => 
        axios.get("https://open-api-v4.coinglass.com/api/futures/liquidation/exchange-list", {
          headers,
          timeout: 10000,
          params: { range },
          validateStatus: s => s < 500
        } )
      )
    );
    const responses = await Promise.all(requests);

    timeframes.forEach((timeframe, index) => {
      const response = responses[index];
      if (response.status !== 200 || response.data?.code !== "0") {
        results[timeframe] = { total: "$0", long: "$0", short: "$0", error: response.data?.msg || `HTTP ${response.status}` };
        return;
      }
      const data = response.data.data || [];
      const allExchanges = data.find(item => item.exchange === "All");
      if (allExchanges) {
        results[timeframe] = {
          total: fmtUSD(allExchanges.liquidation_usd || 0),
          long: fmtUSD(allExchanges.longLiquidation_usd || 0),
          short: fmtUSD(allExchanges.shortLiquidation_usd || 0)
        };
      } else {
        const totalLiq = data.reduce((sum, item) => sum + (item.liquidation_usd || 0), 0);
        const totalLong = data.reduce((sum, item) => sum + (item.longLiquidation_usd || 0), 0);
        const totalShort = data.reduce((sum, item) => sum + (item.shortLiquidation_usd || 0), 0);
        results[timeframe] = { total: fmtUSD(totalLiq), long: fmtUSD(totalLong), short: fmtUSD(totalShort) };
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

    const payload = {
      success: true,
      ...webflowFormatted,
      nested_data: results,
      lastUpdated: new Date().toISOString(),
      method: "live-fetch"
    };

    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    
    const fallbackResults = {};
    ['1h', '4h', '12h', '24h'].forEach(tf => {
      const tfUpper = tf.toUpperCase();
      fallbackResults[`${tfUpper}-Total`] = "$0";
      fallbackResults[`${tfUpper}-Total-Long`] = "$0";
      fallbackResults[`${tfUpper}-Total-Short`] = "$0";
    });
    return res.status(500).json({ success: false, ...fallbackResults, error: "API fetch failed", message: error.message });
  }
}







case "long-short": {
  const TTL = 60;
  const cacheKey = "cg:long-short";
  const lastGoodKey = "last:long-short";

  const cachedData = await kv.get(cacheKey);
  if (cachedData) {
    console.log(`DEBUG [${type}]: Returning main cached data.`);
    return res.json(cachedData);
  }

  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: Rate limit active. Serving last known good.`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.json({ long_pct: "0.00", short_pct: "0.00", differential: "0.00", method: "guarded-fallback" });
  }

  try {
    console.log(`DEBUG [${type}]: Fetching fresh data.`);
    const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
    const response = await axiosWithBackoff(( ) => axios.get(url, { headers, timeout: 15000 }));

    if (response.status !== 200 || !Array.isArray(response.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${response.status}`);
    }

    const coins = response.data.data;
    const top10 = coins.filter(c => c.long_short_ratio_24h != null).sort((a, b) => b.market_cap_usd - a.market_cap_usd).slice(0, 10);

    if (!top10.length) {
      return res.json({ long_pct: "0.00", short_pct: "0.00", differential: "0.00", method: "no-valid-ratios" });
    }

    const avgRatio = top10.reduce((s, c) => s + c.long_short_ratio_24h, 0) / top10.length;
    const avgLongPct = (avgRatio / (1 + avgRatio)) * 100;
    const avgShortPct = 100 - avgLongPct;
    const differential = Math.abs(avgLongPct - avgShortPct);

    const payload = {
      long_pct: avgLongPct.toFixed(2),
      short_pct: avgShortPct.toFixed(2),
      differential: differential.toFixed(2),
      average_ratio: avgRatio.toFixed(4),
      sampled_coins: top10.map(c => ({ symbol: c.symbol, market_cap_usd: c.market_cap_usd, long_short_ratio_24h: c.long_short_ratio_24h })),
      lastUpdated: new Date().toISOString(),
      method: "live-fetch"
    };

    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({ error: "API fetch failed", message: error.message });
  }
}




case "max-pain": {
  const { symbol = "BTC", exchange = "Binance" } = req.query;

  const TTL = 180; // 3 min
  const cacheKey = `cg:max-pain:${symbol}:${exchange}`;
  const lastGoodKey = `last:max-pain:${symbol}:${exchange}`;

  // 1) Fast lane
  const cachedData = await kv.get(cacheKey);
  if (cachedData) {
    console.log(`DEBUG [${type}]: Returning main cached data for ${symbol}/${exchange}.`);
    return res.json(cachedData);
  }

  // 2) Traffic cop
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: Rate limit active. Serving last known good for ${symbol}/${exchange}.`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // fully shaped fallback so UI never breaks
    return res.json({
      data: {
        max_pain_price: 0,
        call_open_interest_market_value: 0,
        put_open_interest_market_value: 0,
        call_open_interest: 0,
        put_open_interest: 0,
        call_open_interest_notional: 0,
        put_open_interest_notional: 0,
        date: null
      },
      lastUpdated: new Date().toISOString(),
      method: "guarded-fallback"
    });
  }

  // 3) Live fetch
  try {
    console.log(`DEBUG [${type}]: Fetching fresh data for ${symbol}/${exchange}.`);
    const url = `https://open-api-v4.coinglass.com/api/option/max-pain?symbol=${symbol}&exchange=${exchange}`;
    const response = await axiosWithBackoff(() => axios.get(url, { headers, timeout: 10000 }));

    if (response.status !== 200 || response.data?.code !== "0") {
      throw new Error(`Upstream failed: HTTP ${response.status} code=${response.data?.code} msg=${response.data?.message || response.data?.msg || "unknown"}`);
    }

    // CoinGlass may return { data: {...} } or { data: [ ... expiries ... ] }
    const raw = response.data?.data;
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);

    // Pick nearest future expiry; else latest by date/timestamp
    const now = Date.now();
    const parseExpiry = (item) => {
      // accept 'date' (YYMMDD / YYYYMMDD), 'expire_date', or 'timestamp'
      if (item.timestamp) return +item.timestamp;
      const d = (item.date || item.expire_date || "").toString();
      // try YYYYMMDD then YYMMDD
      if (/^\d{8}$/.test(d)) {
        const y = +d.slice(0,4), m = +d.slice(4,6)-1, dd = +d.slice(6,8);
        return Date.UTC(y, m, dd);
      }
      if (/^\d{6}$/.test(d)) {
        const y = 2000 + +d.slice(0,2), m = +d.slice(2,4)-1, dd = +d.slice(4,6);
        return Date.UTC(y, m, dd);
      }
      return 0;
    };

    list.sort((a,b) => parseExpiry(a) - parseExpiry(b));
    let chosen = list.find(it => parseExpiry(it) >= now) || list[list.length - 1] || {};

    // Normalize field names → what your Webflow expects
    const norm = (k) => k == null ? 0 : Number(k) || 0;
    const toYYMMDD = (tmsOrStr) => {
      if (!tmsOrStr) return null;
      if (typeof tmsOrStr === "number") {
        const d = new Date(tmsOrStr);
        const yy = String(d.getUTCFullYear()).slice(-2);
        const mm = String(d.getUTCMonth()+1).padStart(2,"0");
        const dd = String(d.getUTCDate()).padStart(2,"0");
        return `${yy}${mm}${dd}`;
      }
      const s = String(tmsOrStr);
      // accept YYYYMMDD or YYMMDD
      if (/^\d{8}$/.test(s)) return s.slice(2);
      if (/^\d{6}$/.test(s)) return s;
      return null;
    };

    // Many APIs use camelCase; we defensively alias common variants
    const finalData = {
      max_pain_price:              norm(chosen.max_pain_price ?? chosen.maxPainPrice ?? chosen.max_pain ?? chosen.maxpain),
      call_open_interest_market_value: norm(chosen.call_open_interest_market_value ?? chosen.callOiMarketValueUsd ?? chosen.call_oi_market_value_usd ?? chosen.call_oi_mv_usd),
      put_open_interest_market_value:  norm(chosen.put_open_interest_market_value  ?? chosen.putOiMarketValueUsd  ?? chosen.put_oi_market_value_usd  ?? chosen.put_oi_mv_usd),
      call_open_interest:          norm(chosen.call_open_interest ?? chosen.callOi ?? chosen.call_oi),
      put_open_interest:           norm(chosen.put_open_interest  ?? chosen.putOi  ?? chosen.put_oi),
      call_open_interest_notional: norm(chosen.call_open_interest_notional ?? chosen.callOiNotionalUsd ?? chosen.call_oi_notional_usd),
      put_open_interest_notional:  norm(chosen.put_open_interest_notional  ?? chosen.putOiNotionalUsd  ?? chosen.put_oi_notional_usd),
      date:                        toYYMMDD(chosen.date ?? chosen.expire_date ?? chosen.timestamp)
    };

    const payload = { data: finalData, lastUpdated: new Date().toISOString(), method: "live-fetch" };

    await kv.set(cacheKey, payload, { ex: TTL });
    if (Object.values(finalData).some(v => v)) {
      await kv.set(lastGoodKey, payload, { ex: 3600 });
    }

    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error for ${symbol}/${exchange}:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({
      data: {
        max_pain_price: 0,
        call_open_interest_market_value: 0,
        put_open_interest_market_value: 0,
        call_open_interest: 0,
        put_open_interest: 0,
        call_open_interest_notional: 0,
        put_open_interest_notional: 0,
        date: null
      },
      error: "API fetch failed and no cached data available."
    });
  }
}

 




case "open-interest": {
  const TTL = 60; // Main cache TTL: 60 seconds
  const cacheKey = "cg:open-interest";
  const lastGoodKey = "last:open-interest";

  // 1. Check for fresh data in the main cache
  const cachedData = await kv.get(cacheKey);
  if (cachedData) {
    console.log(`DEBUG [${type}]: Returning main cached data.`);
    return res.json(cachedData);
  }

  // 2. If no cache, check rate limit
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: Rate limit active. Serving last known good.`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // Fallback if there's no "last good" data
    return res.json({
        total_open_interest_usd: 0, avg_open_interest_change_percent_24h: 0,
        weighted_open_interest_change_percent_24h: 0, baseline_change_percent_since_last_fetch: 0,
        coin_count: 0, baseline_timestamp: new Date().toUTCString(), method: "guarded-fallback"
    });
  }

  // 3. If allowed, fetch fresh data
  try {
    console.log(`DEBUG [${type}]: Fetching fresh data.`);
    const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
    const response = await axiosWithBackoff(( ) => axios.get(url, { headers, timeout: 15000 }));

    if (response.status !== 200 || !Array.isArray(response.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${response.status}`);
    }

    // --- YOUR CRITICAL PROCESSING LOGIC ---
    const coins = response.data.data;
    const totalOpenInterest = coins.reduce((sum, c) => sum + (c.open_interest_usd || 0), 0);
    const pctList = coins.map(c => c.open_interest_change_percent_24h).filter(v => typeof v === "number" && Number.isFinite(v));
    const avgChangePct = pctList.length ? (pctList.reduce((a, b) => a + b, 0) / pctList.length) : 0;
    let wNum = 0, wDen = 0;
    for (const c of coins) {
      const oi = c.open_interest_usd || 0;
      const pct = c.open_interest_change_percent_24h;
      if (oi > 0 && Number.isFinite(pct)) { wNum += oi * pct; wDen += oi; }
    }
    const weightedAvgChangePct = wDen ? (wNum / wDen) : 0;
    const now = Date.now();
    let previousOI = await kv.get("open_interest:previous_total");
    let previousTs = await kv.get("open_interest:timestamp");
    let baselineChangePct = 0;
    if (previousOI && previousTs && (now - previousTs) < 24 * 60 * 60 * 1000) {
      baselineChangePct = ((totalOpenInterest - previousOI) / previousOI) * 100;
    } else {
      await kv.set("open_interest:previous_total", totalOpenInterest);
      await kv.set("open_interest:timestamp", now);
      previousTs = now;
    }
    // --- END OF YOUR LOGIC ---

    const payload = {
      total_open_interest_usd: totalOpenInterest,
      avg_open_interest_change_percent_24h: avgChangePct,
      weighted_open_interest_change_percent_24h: weightedAvgChangePct,
      baseline_change_percent_since_last_fetch: baselineChangePct,
      coin_count: coins.length,
      baseline_timestamp: new Date(previousTs).toUTCString(),
      lastUpdated: new Date().toISOString(),
      method: "live-fetch"
    };

    // 4. Cache the successful payload
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 }); // last good has a longer TTL

    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({ error: "API fetch failed and no cached data available." });
  }
}




case "rsi-heatmap": {
  const { interval = "1h" } = req.query;
  const TTL = 120;
  const cacheKey = `cg:rsi-heatmap:${interval}`;
  const lastGoodKey = `last:rsi-heatmap:${interval}`;

  const cachedData = await kv.get(cacheKey);
  if (cachedData) return res.json(cachedData);

  if (!(await allow("cg:GLOBAL", 250))) {
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.json({ success: false, data: [], statistics: {}, message: "Guarded: Rate limit active" });
  }

  try {
    const url = "https://open-api-v4.coinglass.com/api/futures/rsi/list";
    const response = await axiosWithBackoff(( ) => axios.get(url, { headers, timeout: 10000 }));
    if (response.status !== 200 || response.data?.code !== "0") throw new Error(`Upstream failed: ${response.status}`);
    
    const rawData = response.data.data || [];
    if (!Array.isArray(rawData) || rawData.length === 0) return { success: true, data: [], statistics: {}, message: "No data available" };

    // Your full processing logic
    const intervalMap = {"15m":"15m","1h":"1h","4h":"4h","8h":"4h","12h":"12h","1d":"24h","1w":"1w"};
    const mappedInterval = intervalMap[interval] || "1h";
    const processedData = rawData.map(coin => {
      const rsiData = {"15m":coin.rsi_15m,"1h":coin.rsi_1h,"4h":coin.rsi_4h,"12h":coin.rsi_12h,"24h":coin.rsi_24h,"1w":coin.rsi_1w};
      const priceChangeData = {"15m":coin.price_change_percent_15m||0,"1h":coin.price_change_percent_1h||0,"4h":coin.price_change_percent_4h||0,"12h":coin.price_change_percent_12h||0,"24h":coin.price_change_percent_24h||0,"1w":coin.price_change_percent_1w||0};
      return { symbol: coin.symbol || 'UNKNOWN', current_price: coin.current_price || 0, rsi: rsiData, price_change_percent: priceChangeData, current_rsi: rsiData[mappedInterval], current_price_change: priceChangeData[mappedInterval] };
    }).filter(c => c.current_rsi != null).sort((a, b) => b.current_price - a.current_price).slice(0, 150);
    const rsiValues = processedData.map(c => c.current_rsi);
    const overbought = rsiValues.filter(r => r >= 70).length;
    const oversold = rsiValues.filter(r => r <= 30).length;
    const stats = { total_coins: processedData.length, overbought_count: overbought, oversold_count: oversold, neutral_count: rsiValues.length - overbought - oversold, overbought_percent: ((overbought / rsiValues.length) * 100).toFixed(1), oversold_percent: ((oversold / rsiValues.length) * 100).toFixed(1), average_rsi: (rsiValues.reduce((s, r) => s + r, 0) / rsiValues.length).toFixed(2) };
    const payload = { success: true, data: processedData, interval: interval, statistics: stats, lastUpdated: new Date().toISOString() };

    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });
    return res.json(payload);
  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({ error: "API fetch failed", message: error.message });
  }
}





case "crypto-ticker": {
  const TTL = 60;
  const cacheKey = "cg:crypto-ticker";
  const lastGoodKey = "last:crypto-ticker";

  const cachedData = await kv.get(cacheKey);
  if (cachedData) return res.json(cachedData);

  if (!(await allow("cg:GLOBAL", 250))) {
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.json({ success: false, data: [], message: "Guarded: Rate limit active" });
  }

  try {
    const url = "https://open-api-v4.coinglass.com/api/futures/coins-price-change";
    const response = await axiosWithBackoff(( ) => axios.get(url, { headers, timeout: 10000 }));
    if (response.status !== 200 || response.data?.code !== "0") throw new Error(`Upstream failed: ${response.status}`);

    const rawData = response.data.data || [];
    const targetCoins = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'TRX', 'TON', 'AVAX', 'LINK', 'DOT', 'LTC', 'BCH', 'UNI', 'XLM', 'HBAR', 'SUI', 'PEPE', 'SHIB', 'INJ', 'ONDO'];
    const filteredData = rawData
      .filter(coin => targetCoins.includes(coin.symbol))
      .map(coin => ({
        symbol: coin.symbol,
        current_price: coin.current_price,
        price_change_percent_24h: coin.price_change_percent_24h || 0,
        logo_url: `https://raw.githubusercontent.com/whaletradesweb/whale-trades2/main/api/public/logos/${coin.symbol.toLowerCase( )}.svg`
      }))
      .sort((a, b) => targetCoins.indexOf(a.symbol) - targetCoins.indexOf(b.symbol));

    const payload = { success: true, data: filteredData, lastUpdated: new Date().toISOString() };

    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });
    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({ error: "API fetch failed", message: error.message });
  }
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
  const TTL = 300; // Cache for 5 minutes, as this data doesn't change rapidly
  const cacheKey = "cg:bull-market-peak-indicators";
  const lastGoodKey = "last:bull-market-peak-indicators";

  // 1. Check for fresh data in the main cache
  const cachedData = await kv.get(cacheKey);
  if (cachedData) {
    console.log(`DEBUG [${type}]: Returning main cached data.`);
    return res.json(cachedData);
  }

  // 2. If no cache, check rate limit
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: Rate limit active. Serving last known good.`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // Fallback if there's no "last good" data
    return res.json({ success: false, data: {}, message: "Guarded: Rate limit active" });
  }

  // 3. If allowed, fetch fresh data
  try {
    console.log(`DEBUG [${type}]: Fetching fresh data.`);
    const url = "https://open-api-v4.coinglass.com/api/bull-market-peak-indicator";
    const response = await axiosWithBackoff(( ) => axios.get(url, { headers, timeout: 10000 }));

    if (response.status !== 200 || response.data?.code !== "0") {
      throw new Error(`Upstream failed: HTTP ${response.status} - ${response.data?.message}`);
    }

    // --- YOUR CRITICAL PROCESSING LOGIC ---
    const indicators = response.data.data || [];
    const targetIndicators = [
      "Pi Cycle Top Indicator", "Puell Multiple", "Bitcoin Rainbow Chart",
      "MVRV Z-Score", "Altcoin Season Index", "Bitcoin Dominance",
      "Bitcoin Net Unrealized P&L (NUPL)", "Bitcoin 4-Year Moving Average"
    ];
    const processedIndicators = {};
    indicators.forEach(indicator => {
      if (targetIndicators.includes(indicator.indicator_name)) {
        let current = parseFloat(indicator.current_value.toString().replace('%', '')) || 0;
        let target = parseFloat(indicator.target_value.toString().replace('%', '')) || 0;
        const previous = parseFloat(indicator.previous_value.toString().replace('%', '')) || 0;
        const change = parseFloat(indicator.change_value) || 0;
        let progressPercentage = 0;
        if (indicator.comparison_type === ">=") {
          progressPercentage = target > 0 ? Math.min((current / target) * 100, 100) : 0;
        } else if (indicator.comparison_type === "<=") {
          progressPercentage = target > 0 ? Math.max(100 - ((current / target) * 100), 0) : 0;
        }
        const distance = Math.abs(target - current);
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
          progress_bar_width: Math.min(progressPercentage, 100),
          remaining_bar_width: Math.max(100 - progressPercentage, 0),
          original_current_value: indicator.current_value,
          original_target_value: indicator.target_value
        };
      }
    });
    // --- END OF YOUR LOGIC ---

    const payload = {
      success: true,
      data: processedIndicators,
      lastUpdated: new Date().toISOString(),
      totalIndicators: Object.keys(processedIndicators).length,
      method: "live-fetch"
    };

    // 4. Cache the successful payload
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({ error: "API fetch failed", message: error.message });
  }
}



case "volume-total": {
  const TTL = 60;
  const cacheKey = "cg:volume-total";
  const lastGoodKey = "last:volume-total";

  const cachedData = await kv.get(cacheKey);
  if (cachedData) {
    console.log(`DEBUG [${type}]: Returning main cached data.`);
    return res.json(cachedData);
  }

  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: Rate limit active. Serving last known good.`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.json({ total_volume_24h: 0, total_formatted: "$0", method: "guarded-fallback" });
  }

  try {
    console.log(`DEBUG [${type}]: Fetching fresh data.`);
    const fmtUSD = (v) => {
        const n = Math.abs(v);
        if (n >= 1e12) return `$${(v/1e12).toFixed(2)}T`;
        if (n >= 1e9)  return `$${(v/1e9 ).toFixed(2)}B`;
        if (n >= 1e6)  return `$${(v/1e6 ).toFixed(2)}M`;
        return `$${Math.round(v).toLocaleString()}`;
    };

    let allCoins = [];
    let page = 1;
    const PER_PAGE = 200;
    for (;;) {
      const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
      const response = await axiosWithBackoff(( ) => axios.get(url, { headers, timeout: 15000, params: { per_page: PER_PAGE, page } }));
      if (response.status !== 200 || response.data?.code !== "0") throw new Error(`Upstream failed on page ${page}: ${response.status}`);
      
      const rows = response.data?.data || [];
      if (!rows.length) break;
      allCoins = allCoins.concat(rows);
      if (rows.length < PER_PAGE) break;
      page++;
    }

    let totalVolume24h = 0;
    let totalWeightedChange = 0;
    let coinsWithVolume = 0;
    const coinData = allCoins.map(coin => {
        const longVolume = coin.long_volume_usd_24h || 0;
        const shortVolume = coin.short_volume_usd_24h || 0;
        const coinTotal = longVolume + shortVolume;
        const changePercent = coin.volume_change_percent_24h || 0;
        if (coinTotal > 0) {
            totalVolume24h += coinTotal;
            coinsWithVolume++;
            if (changePercent !== 0) totalWeightedChange += coinTotal * changePercent;
        }
        return { symbol: coin.symbol, volume_usd_24h: coinTotal, change_percent: changePercent };
    });
    const overallChangePercent = totalVolume24h > 0 ? totalWeightedChange / totalVolume24h : 0;
    const topCoins = coinData.filter(c => c.volume_usd_24h > 0).sort((a, b) => b.volume_usd_24h - a.volume_usd_24h).slice(0, 50);

    const payload = {
      total_volume_24h: totalVolume24h,
      total_formatted: fmtUSD(totalVolume24h),
      percent_change_24h: overallChangePercent,
      coins_count: allCoins.length,
      coins_with_volume: coinsWithVolume,
      top_coins: topCoins,
      last_updated: new Date().toISOString(),
      method: "live-fetch"
    };

    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });
    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({ error: "API fetch failed", message: error.message });
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
    basis = "market_cap",     // "market_cap" | "volume"
    interval = "1h",          // "1h" | "4h" | "1d" | "1w"
    limit = "10"
  } = req.query;

  // --- Input guards ---
  const validIntervals = ["1h", "4h", "1d", "1w"];
  const validBasis = ["market_cap", "volume"];
  if (!validIntervals.includes(interval)) {
    return res.status(400).json({ error: "Invalid interval. Use 1h, 4h, 1d, 1w" });
  }
  if (!validBasis.includes(basis)) {
    return res.status(400).json({ error: "Invalid basis. Use market_cap or volume" });
  }
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 10, 50));

  // Map 1d → 24h fields on the API
  const fieldKey = interval === "1d" ? "24h" : interval;
  const buyField   = `buy_volume_usd_${fieldKey}`;
  const sellField  = `sell_volume_usd_${fieldKey}`;
  const flowField  = `volume_flow_usd_${fieldKey}`;
  const mcapField  = "market_cap";      // USD
  const vol24Field = "volume_usd_24h";  // USD

  // --- Helpers: label, snapped score, and color (UI-pointer consistency) ---
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
    if (lbl === "Strong sell") return "#ff3333";
    if (lbl === "Sell")        return "#ff6666";
    if (lbl === "Neutral")     return "#ffffff";
    if (lbl === "Buy")         return "#00cc66";
    return "#00ff99"; // Strong buy
  }

  // --- Cache + Safety-net keys ---
  const TTL = 120; // 2 minutes fast-lane cache
  const cacheKey   = `cg:market-sentiment-flow:${basis}:${interval}:limit=${safeLimit}`;
  const lastGoodKey= `last:market-sentiment-flow:${basis}:${interval}:limit=${safeLimit}`;

  // 1) Fast lane
  const cachedData = await kv.get(cacheKey);
  if (cachedData) {
    console.log(`DEBUG [${type}]: market-sentiment-flow → cache-hit (${basis}, ${interval}, ${safeLimit})`);
    return res.json(cachedData);
  }

  // 2) Global rate limiter
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: market-sentiment-flow → rate-limited, serving last-good`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);

    // Fully-shaped guarded fallback so UI never breaks
    return res.json({
      success: true,
      meta: {
        basis, interval, limit: 0,
        overall: {
          ratio: 0, score: 0.5, sentiment: "Neutral", band_color: colorFromLabel("Neutral"),
          buy_usd: 0, sell_usd: 0, flow_usd: 0
        }
      },
      data: [],
      lastUpdated: new Date().toISOString(),
      method: "guarded-fallback"
    });
  }

  // 3) Live fetch
  try {
    const url = "https://open-api-v4.coinglass.com/api/spot/coins-markets";
    const cg = await axiosWithBackoff(() =>
      axios.get(url, { headers, timeout: 15000, validateStatus: s => s < 500 })
    );

    if (cg.status !== 200 || cg.data?.code !== "0" || !Array.isArray(cg.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${cg.status} code=${cg.data?.code} msg=${cg.data?.msg || cg.data?.message || "unknown"}`);
    }

    let rows = cg.data.data;

    // Rank & slice by basis
    rows = rows
      .filter(r => typeof r[buyField] === "number" || typeof r[sellField] === "number")
      .sort((a, b) => {
        if (basis === "volume") return (b[vol24Field] || 0) - (a[vol24Field] || 0);
        return (b[mcapField] || 0) - (a[mcapField] || 0);
      })
      .slice(0, safeLimit);

    // If nothing valid, return an empty but valid payload
    if (!rows.length) {
      const payload = {
        success: true,
        meta: {
          basis, interval, limit: 0,
          overall: {
            ratio: 0, score: 0.5, sentiment: "Neutral", band_color: colorFromLabel("Neutral"),
            buy_usd: 0, sell_usd: 0, flow_usd: 0
          }
        },
        data: [],
        lastUpdated: new Date().toISOString(),
        source: "coinglass_spot_coins_markets",
        method: "live-empty"
      };
      await kv.set(cacheKey, payload, { ex: TTL });
      await kv.set(lastGoodKey, payload, { ex: 3600 });
      return res.json(payload);
    }

    // Compute ratios & shape output
    const data = rows.map((r) => {
      const buy  = Math.max(0, r[buyField]  || 0);
      const sell = Math.max(0, r[sellField] || 0);
      const flow = Number.isFinite(r[flowField]) ? r[flowField] : (buy - sell);
      const denom = buy + sell;
      const ratio = denom > 0 ? (buy - sell) / denom : 0; // -1..1

      const sentiment = labelFromRatio(ratio);
      const score     = scoreFromLabel(sentiment);
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
        ratio,       // (-1..1) buy-vs-sell dominance
        score,       // (0..1) snapped pointer value
        sentiment,   // label matching thresholds
        band_color   // convenience color for UI
      };
    });

    // Overall market score for the selected cohort (snapped)
    const totBuy  = data.reduce((s, d) => s + d.buy_usd, 0);
    const totSell = data.reduce((s, d) => s + d.sell_usd, 0);
    const groupRatio = (totBuy + totSell) > 0 ? (totBuy - totSell) / (totBuy + totSell) : 0;
    const groupLabel = labelFromRatio(groupRatio);
    const groupScore = scoreFromLabel(groupLabel);
    const groupColor = colorFromLabel(groupLabel);

    const payload = {
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
      source: "coinglass_spot_coins_markets",
      method: "live-fetch"
    };

    // 4) Cache success to both caches
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });
    return res.json(payload);

  } catch (err) {
    console.error(`[${type}] market-sentiment-flow fetch error:`, err.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);

    // final shaped failure
    return res.status(500).json({
      success: false,
      meta: {
        basis, interval, limit: 0,
        overall: {
          ratio: 0, score: 0.5, sentiment: "Neutral", band_color: colorFromLabel("Neutral"),
          buy_usd: 0, sell_usd: 0, flow_usd: 0
        }
      },
      data: [],
      error: "API fetch failed and no cached data available.",
      lastUpdated: new Date().toISOString()
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
