const axios = require("axios");
const { kv } = require("@vercel/kv");
const COINGLASS_API_KEY = process.env.COINGLASS_API_KEY;
const { cacheGetSet, allow, axiosWithBackoff } = require("./lib/cacheAndLimit");

module.exports = async (req, res) => {
  // --- CORS (open to all origins) ---
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  const reqHeaders = req.headers["access-control-request-headers"];
  res.setHeader(
    "Access-Control-Allow-Headers",
    reqHeaders ? String(reqHeaders) : "Content-Type, Authorization, X-Requested-With, Accept, Origin"
  );
  res.setHeader("Access-Control-Allow-Credentials", "false");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");


  // preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
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
  const TTL = 600;
  const cacheKey   = "cg:altcoin-season";
  const lastGoodKey= "last:altcoin-season";

  // 1) Fast lane
  const cached = await kv.get(cacheKey);
  if (cached) return res.json(cached);

  // 2) Traffic cop
  if (!(await allow("cg:GLOBAL", 250))) {
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // fully-shaped guarded fallback
    return res.json({
      success: true,
      data: [],
      lastUpdated: new Date().toISOString(),
      method: "guarded-fallback",
      message: "Guarded: Rate limit active"
    });
  }

  // 3) Live fetch
  try {
    const url = "https://open-api-v4.coinglass.com/api/index/altcoin-season";
    const resp = await axiosWithBackoff(() =>
      axios.get(url, { headers, timeout: 10000, validateStatus: s => s < 500 })
    );

    if (resp.status !== 200 || resp.data?.code !== "0" || !Array.isArray(resp.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${resp.status} code=${resp.data?.code} msg=${resp.data?.msg || resp.data?.message || "unknown"}`);
    }

    const raw = resp.data.data;
    const altcoinData = raw
      .map(d => ({
        timestamp: Number(d.timestamp) || 0,
        altcoin_index: Number(d.altcoin_index) || 0,
        altcoin_marketcap: Number(d.altcoin_marketcap || 0)
      }))
      .filter(r => r.timestamp > 0)
      .sort((a, b) => a.timestamp - b.timestamp);

    const payload = {
      success: true,
      data: altcoinData,
      lastUpdated: new Date().toISOString(),
      method: "live-fetch"
    };

    // 4) Cache both
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({
      success: false,
      data: [],
      error: "API fetch failed",
      message: error.message,
      lastUpdated: new Date().toISOString(),
      method: "live-error"
    });
  }
}



case "etf-flows": {
  const asset = String(req.query.symbol || "BTC").toLowerCase();
  const assetName = asset.includes("eth") ? "ethereum" : "bitcoin";

  const TTL = 600;
  const cacheKey    = `cg:etf-flows:${assetName}`;
  const lastGoodKey = `last:etf-flows:${assetName}`;

  // 1) Fast lane
  const cached = await kv.get(cacheKey);
  if (cached) return res.json(cached);

  // 2) Traffic cop
  if (!(await allow("cg:GLOBAL", 250))) {
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.json({
      daily: [],
      weekly: [],
      lastUpdated: new Date().toISOString(),
      method: "guarded-fallback",
      message: "Guarded: Rate limit active"
    });
  }

  // 3) Live fetch
  try {
    const url = `https://open-api-v4.coinglass.com/api/etf/${assetName}/flow-history`;
    const resp = await axiosWithBackoff(() =>
      axios.get(url, { headers, timeout: 12000, validateStatus: s => s < 500 })
    );

    if (resp.status !== 200 || resp.data?.code !== "0" || !Array.isArray(resp.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${resp.status} code=${resp.data?.code} msg=${resp.data?.msg || resp.data?.message || "unknown"}`);
    }

    const rows = resp.data.data;

    // Sort by timestamp ascending; normalize seconds↔ms just in case
    const normTs = (ts) => {
      const n = Number(ts || 0);
      return n < 1e12 ? n * 1000 : n; // if seconds, convert to ms
    };
    rows.sort((a,b) => normTs(a.timestamp) - normTs(b.timestamp));

    // Build daily series (YYYY-MM-DD)
    const daily = rows.map(d => {
      const tsMs = normTs(d.timestamp);
      const dateStr = new Date(tsMs).toISOString().split("T")[0];
      const totalFlow = Number(d.flow_usd || 0);
      const price = Number(d.price_usd || 0);
      const etfs = Array.isArray(d.etf_flows)
        ? d.etf_flows.map(etf => ({
            ticker: etf?.etf_ticker || "UNKNOWN",
            flow: Number(etf?.flow_usd || 0)
          }))
        : [];
      return { date: dateStr, totalFlow, price, etfs };
    });

    // Aggregate into rolling weekly chunks of 7 consecutive daily entries
    const weekly = [];
    for (let i = 0; i < daily.length; i += 7) {
      const chunk = daily.slice(i, i + 7);
      if (!chunk.length) continue;

      const totalFlow = chunk.reduce((s, d) => s + Number(d.totalFlow || 0), 0);
      const avgPrice = chunk.reduce((s, d) => s + Number(d.price || 0), 0) / chunk.length;

      // Sum flows per ticker
      const etfMap = new Map();
      for (const day of chunk) {
        for (const e of day.etfs) {
          etfMap.set(e.ticker, (etfMap.get(e.ticker) || 0) + Number(e.flow || 0));
        }
      }
      const etfs = Array.from(etfMap.entries()).map(([ticker, flow]) => ({ ticker, flow }));

      weekly.push({
        weekStart: chunk[0].date,
        weekEnd: chunk[chunk.length - 1].date,
        totalFlow,
        avgPrice: Number.isFinite(avgPrice) ? Number(avgPrice.toFixed(2)) : 0,
        etfs
      });
    }

    const payload = {
      daily,
      weekly,
      lastUpdated: new Date().toISOString(),
      method: "live-fetch",
      asset: assetName
    };

    // 4) Cache to both stores
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({
      daily: [],
      weekly: [],
      error: "API fetch failed",
      message: error.message,
      lastUpdated: new Date().toISOString(),
      method: "live-error",
      asset: assetName
    });
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
    const response = await axiosWithBackoff(() => axios.get(url, { headers }));

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
  const TTL = 180;
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
  const TTL = 600;
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
    const response = await axiosWithBackoff(() => axios.get(url, { headers, timeout: 15000 }));

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

  const TTL = 600; // 10 min
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
  const TTL = 600; // Main cache TTL: 10 mins
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
        total_open_interest_usd: 0, 
        avg_open_interest_change_percent_24h: 0,
        weighted_open_interest_change_percent_24h: 0, 
        baseline_change_percent_since_last_fetch: 0,
        coin_count: 0, 
        baseline_timestamp: new Date().toUTCString(), 
        method: "guarded-fallback"
    });
  }
  
  // 3. If allowed, fetch fresh data
  try {
    console.log(`DEBUG [${type}]: Fetching fresh data.`);
    const url = "https://open-api-v4.coinglass.com/api/futures/coins-markets";
    const response = await axiosWithBackoff(() => axios.get(url, { headers, timeout: 15000 }));
    
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
      if (oi > 0 && Number.isFinite(pct)) { 
        wNum += oi * pct; 
        wDen += oi; 
      }
    }
    const weightedAvgChangePct = wDen ? (wNum / wDen) : 0;
    
    const now = Date.now();
    let previousOI = await kv.get("open_interest:previous_total");
    let previousTs = await kv.get("open_interest:timestamp");
    let baselineChangePct = 0;
    
    if (previousOI && previousTs && (now - previousTs) < 24 * 60 * 60 * 1000) {
      baselineChangePct = ((totalOpenInterest - previousOI) / previousOI) * 100;
    }
    
    // Always update the baseline for the next calculation
    await kv.set("open_interest:previous_total", totalOpenInterest);
    await kv.set("open_interest:timestamp", now);
    // --- END OF YOUR LOGIC ---
    
    const payload = {
      total_open_interest_usd: totalOpenInterest,
      avg_open_interest_change_percent_24h: avgChangePct,
      weighted_open_interest_change_percent_24h: weightedAvgChangePct,
      baseline_change_percent_since_last_fetch: baselineChangePct,
      coin_count: coins.length,
      baseline_timestamp: new Date(now).toUTCString(),
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
  const TTL = 600;
  const cacheKey   = `cg:rsi-heatmap:${interval}`;
  const lastGoodKey= `last:rsi-heatmap:${interval}`;

  // 1) Fast lane
  const cached = await kv.get(cacheKey);
  if (cached) return res.json(cached);

  // 2) Traffic cop
  if (!(await allow("cg:GLOBAL", 250))) {
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.json({
      success: false,
      data: [],
      interval,
      statistics: {
        total_coins: 0,
        overbought_count: 0,
        oversold_count: 0,
        neutral_count: 0,
        overbought_percent: "0.0",
        oversold_percent: "0.0",
        average_rsi: "0.00"
      },
      lastUpdated: new Date().toISOString(),
      method: "guarded-fallback",
      message: "Guarded: Rate limit active"
    });
  }

  // 3) Live fetch
  try {
    // Map UI interval → API field set
    // Note: CoinGlass doesn't expose 8h; we map 8h → 4h for continuity.
    const intervalMap = { "15m":"15m","1h":"1h","4h":"4h","8h":"4h","12h":"12h","1d":"24h","1w":"1w" };
    const validIntervals = Object.keys(intervalMap);
    if (!validIntervals.includes(interval)) {
      return res.status(400).json({ error: `Invalid interval. Use ${validIntervals.join(", ")}` });
    }
    const mappedInterval = intervalMap[interval];

    const url = "https://open-api-v4.coinglass.com/api/futures/rsi/list";
    const response = await axiosWithBackoff(() =>
      axios.get(url, { headers, timeout: 10000, validateStatus: s => s < 500 })
    );
    if (response.status !== 200 || response.data?.code !== "0" || !Array.isArray(response.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${response.status} code=${response.data?.code} msg=${response.data?.msg || response.data?.message || "unknown"}`);
    }

    const rawData = response.data.data;

    if (!rawData.length) {
      const payload = {
        success: true,
        data: [],
        interval,
        statistics: {
          total_coins: 0,
          overbought_count: 0,
          oversold_count: 0,
          neutral_count: 0,
          overbought_percent: "0.0",
          oversold_percent: "0.0",
          average_rsi: "0.00"
        },
        lastUpdated: new Date().toISOString(),
        method: "live-empty"
      };
      await kv.set(cacheKey, payload, { ex: TTL });
      await kv.set(lastGoodKey, payload, { ex: 3600 });
      return res.json(payload);
    }

    const processedData = rawData.map((coin) => {
      const rsi = {
        "15m": coin.rsi_15m,
        "1h":  coin.rsi_1h,
        "4h":  coin.rsi_4h,
        "12h": coin.rsi_12h,
        "24h": coin.rsi_24h,
        "1w":  coin.rsi_1w
      };
      const priceChange = {
        "15m": coin.price_change_percent_15m || 0,
        "1h":  coin.price_change_percent_1h || 0,
        "4h":  coin.price_change_percent_4h || 0,
        "12h": coin.price_change_percent_12h || 0,
        "24h": coin.price_change_percent_24h || 0,
        "1w":  coin.price_change_percent_1w || 0
      };

      return {
        symbol: coin.symbol || "UNKNOWN",
        current_price: Number(coin.current_price || 0),
        rsi,
        price_change_percent: priceChange,
        current_rsi: rsi[mappedInterval],
        current_price_change: priceChange[mappedInterval]
      };
    })
    .filter(c => c.current_rsi != null && Number.isFinite(c.current_rsi))
    .sort((a, b) => (b.current_price || 0) - (a.current_price || 0))
    .slice(0, 150);

    const rsiValues = processedData.map(c => Number(c.current_rsi)).filter(Number.isFinite);
    const total = rsiValues.length || 0;
    const overbought = rsiValues.filter(r => r >= 70).length;
    const oversold   = rsiValues.filter(r => r <= 30).length;
    const neutral    = Math.max(0, total - overbought - oversold);
    const avgRsi     = total ? (rsiValues.reduce((s, r) => s + r, 0) / total) : 0;

    const stats = {
      total_coins: total,
      overbought_count: overbought,
      oversold_count: oversold,
      neutral_count: neutral,
      overbought_percent: total ? ((overbought / total) * 100).toFixed(1) : "0.0",
      oversold_percent:   total ? ((oversold   / total) * 100).toFixed(1) : "0.0",
      average_rsi: avgRsi.toFixed(2)
    };

    const payload = {
      success: true,
      data: processedData,
      interval,
      statistics: stats,
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
    return res.status(500).json({
      success: false,
      data: [],
      interval,
      statistics: {
        total_coins: 0,
        overbought_count: 0,
        oversold_count: 0,
        neutral_count: 0,
        overbought_percent: "0.0",
        oversold_percent: "0.0",
        average_rsi: "0.00"
      },
      error: "API fetch failed",
      message: error.message,
      lastUpdated: new Date().toISOString(),
      method: "live-error"
    });
  }
}



case "crypto-ticker": {
  const TTL = 600;
  const cacheKey   = "cg:crypto-ticker";
  const lastGoodKey= "last:crypto-ticker";

  // 1) Fast lane
  const cached = await kv.get(cacheKey);
  if (cached) return res.json(cached);

  // 2) Traffic cop
  if (!(await allow("cg:GLOBAL", 250))) {
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // fully-shaped guarded fallback so UI won’t break if it expects fields
    return res.json({
      success: true,
      data: [],
      lastUpdated: new Date().toISOString(),
      method: "guarded-fallback"
    });
  }

  // 3) Live fetch
  try {
    const url = "https://open-api-v4.coinglass.com/api/futures/coins-price-change";
    const resp = await axiosWithBackoff(() =>
      axios.get(url, { headers, timeout: 10000, validateStatus: s => s < 500 })
    );
    if (resp.status !== 200 || resp.data?.code !== "0" || !Array.isArray(resp.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${resp.status} code=${resp.data?.code} msg=${resp.data?.msg || resp.data?.message || "unknown"}`);
    }

    const raw = resp.data.data;

    const targetCoins = [
      "BTC","ETH","BNB","SOL","XRP","ADA","DOGE","TRX","TON","AVAX","LINK","DOT",
      "LTC","BCH","UNI","XLM","HBAR","SUI","PEPE","SHIB","INJ","ONDO"
    ];

    // normalize + stable order (as in targetCoins list)
    const filtered = raw
      .filter(c => targetCoins.includes(String(c.symbol).toUpperCase()))
      .map(c => {
        const sym = String(c.symbol).toUpperCase();
        return {
          symbol: sym,
          current_price: Number(c.current_price || 0),
          price_change_percent_24h: Number(c.price_change_percent_24h || 0),
          logo_url: `https://raw.githubusercontent.com/whaletradesweb/whale-trades2/main/api/public/logos/${sym.toLowerCase()}.svg`
        };
      })
      .sort((a, b) => targetCoins.indexOf(a.symbol) - targetCoins.indexOf(b.symbol));

    const payload = {
      success: true,
      data: filtered,
      lastUpdated: new Date().toISOString(),
      method: "live-fetch"
    };

    // 4) Cache to both stores
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({
      success: false,
      data: [],
      error: "API fetch failed",
      message: error.message,
      lastUpdated: new Date().toISOString(),
      method: "live-error"
    });
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
  // Optional: &top=20
  const top = Math.max(1, Math.min(parseInt(req.query.top || "20", 10) || 20, 100));

  const TTL = 600; // short-term cache
  const cacheKey    = `cg:hyperliquid-long-short:top=${top}`;
  const lastGoodKey = `last:hyperliquid-long-short:top=${top}`;

  // 1) Fast lane: short-term cache
  const cached = await kv.get(cacheKey);
  if (cached) {
    console.log(`DEBUG [${type}]: hyperliquid-long-short → cache-hit (top=${top})`);
    return res.json(cached);
  }

  // 2) Traffic cop: global rate limiter
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: hyperliquid-long-short → rate-limited, serving last-good`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // fully shaped guarded fallback
    return res.json({
      success: true,
      data: [],
      marketMetrics: {
        totalLongValue: 0,
        totalShortValue: 0,
        totalValue: 0,
        overallLongPct: 0,
        overallShortPct: 0,
        overallDifferential: 0,
        marketSentiment: "bearish",
        totalCoins: 0,
        bullishCoins: 0,
        bearishCoins: 0
      },
      lastUpdated: new Date().toISOString(),
      dataSource: "hyperliquid_whale_positions",
      method: "guarded-fallback"
    });
  }

  // 3) Live fetch
  try {
    console.log("DEBUG: Requesting Hyperliquid whale positions...");
    const url = "https://open-api-v4.coinglass.com/api/hyperliquid/whale-position";
    const response = await axiosWithBackoff(() => axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: s => s < 500
    }));

    // Upstream guards
    if (response.status === 401) {
      return res.status(401).json({
        error: "API Authentication Failed",
        message: "Invalid API key or insufficient permissions. Check your CoinGlass API plan."
      });
    }
    if (response.status === 403) {
      return res.status(403).json({
        error: "API Access Forbidden",
        message: "Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher."
      });
    }
    if (response.status !== 200 || response.data?.code !== "0" || !Array.isArray(response.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${response.status} code=${response.data?.code} msg=${response.data?.message || response.data?.msg || "unknown"}`);
    }

    const rawData = response.data.data || [];
    if (!rawData.length) {
      const payload = {
        success: true,
        data: [],
        marketMetrics: {
          totalLongValue: 0,
          totalShortValue: 0,
          totalValue: 0,
          overallLongPct: 0,
          overallShortPct: 0,
          overallDifferential: 0,
          marketSentiment: "bearish",
          totalCoins: 0,
          bullishCoins: 0,
          bearishCoins: 0
        },
        lastUpdated: new Date().toISOString(),
        dataSource: "hyperliquid_whale_positions",
        method: "live-empty"
      };
      await kv.set(cacheKey, payload, { ex: TTL });
      await kv.set(lastGoodKey, payload, { ex: 3600 });
      return res.json(payload);
    }

    // Group positions by symbol and calculate long/short values
    const symbolData = {};
    for (const position of rawData) {
      const symbol = position.symbol;
      const positionSize = Number(position.position_size || 0);
      const positionValueUsd = Math.abs(Number(position.position_value_usd || 0));

      if (!symbolData[symbol]) {
        symbolData[symbol] = {
          symbol,
          longValue: 0,
          shortValue: 0,
          totalValue: 0,
          positionCount: 0
        };
      }
      if (positionSize > 0) symbolData[symbol].longValue += positionValueUsd;
      else if (positionSize < 0) symbolData[symbol].shortValue += positionValueUsd;

      symbolData[symbol].totalValue += positionValueUsd;
      symbolData[symbol].positionCount += 1;
    }

    // Calculate percentages per symbol and sort
    const processedData = Object.values(symbolData)
      .filter(d => d.totalValue > 0)
      .map(d => {
        const longPct = d.totalValue > 0 ? (d.longValue / d.totalValue) * 100 : 0;
        const shortPct = d.totalValue > 0 ? (d.shortValue / d.totalValue) * 100 : 0;
        const differential = Math.abs(longPct - shortPct);
        return {
          symbol: d.symbol,
          longValue: d.longValue,
          shortValue: d.shortValue,
          totalValue: d.totalValue,
          longPct: parseFloat(longPct.toFixed(2)),
          shortPct: parseFloat(shortPct.toFixed(2)),
          differential: parseFloat(differential.toFixed(2)),
          positionCount: d.positionCount,
          sentiment: longPct > shortPct ? "bullish" : "bearish",
          dominance: Math.max(longPct, shortPct)
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, top);

    // Overall market metrics
    const totalLongValue = processedData.reduce((s, c) => s + c.longValue, 0);
    const totalShortValue = processedData.reduce((s, c) => s + c.shortValue, 0);
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
      marketSentiment: overallLongPct > overallShortPct ? "bullish" : "bearish",
      totalCoins: processedData.length,
      bullishCoins: processedData.filter(c => c.sentiment === "bullish").length,
      bearishCoins: processedData.filter(c => c.sentiment === "bearish").length
    };

    const payload = {
      success: true,
      data: processedData,
      marketMetrics,
      lastUpdated: new Date().toISOString(),
      dataSource: "hyperliquid_whale_positions",
      method: "live-fetch"
    };

    // 4) Cache to both stores
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (err) {
    console.error(`[${type}] hyperliquid-long-short fetch error:`, err.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);

    return res.status(500).json({
      success: false,
      data: [],
      marketMetrics: {
        totalLongValue: 0,
        totalShortValue: 0,
        totalValue: 0,
        overallLongPct: 0,
        overallShortPct: 0,
        overallDifferential: 0,
        marketSentiment: "bearish",
        totalCoins: 0,
        bullishCoins: 0,
        bearishCoins: 0
      },
      error: "API fetch failed and no cached data available.",
      lastUpdated: new Date().toISOString()
    });
  }
}




case "hyperliquid-whale-position": {
  // Optional cap for UI/testing: &top=100
  const top = Math.max(1, Math.min(parseInt(req.query.top || "0", 10) || 0, 500)); // 0 = no cap

  // --- Cache keys (fast-lane + safety-net) ---
  const TTL = 600; // 10 min fast cache
  const cacheKey    = `cg:hyperliquid-whale-position:top=${top}`;
  const lastGoodKey = `last:hyperliquid-whale-position:top=${top}`;

  // 1) Fast lane: short-term cache
  const cached = await kv.get(cacheKey);
  if (cached) {
    console.log(`DEBUG [${type}]: hyperliquid-whale-position → cache-hit (top=${top || "all"})`);
    return res.json(cached);
  }

  // 2) Traffic cop: global rate limiter
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: hyperliquid-whale-position → rate-limited, serving last-good`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // fully shaped guarded fallback
    return res.json({
      success: true,
      data: [],
      lastUpdated: new Date().toISOString(),
      dataSource: "hyperliquid_raw_whale_positions",
      method: "guarded-fallback"
    });
  }

  // 3) Live fetch
  try {
    console.log("DEBUG: Requesting raw Hyperliquid whale positions...");
    const url = "https://open-api-v4.coinglass.com/api/hyperliquid/whale-position";

    const response = await axiosWithBackoff(() => axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: s => s < 500
    }));

    console.log("DEBUG: Hyperliquid Whale Position Response Status:", response.status);

    if (response.status === 401) {
      return res.status(401).json({
        error: "API Authentication Failed",
        message: "Invalid API key or insufficient permissions. Check your CoinGlass API plan."
      });
    }
    if (response.status === 403) {
      return res.status(403).json({
        error: "API Access Forbidden",
        message: "Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher."
      });
    }
    if (response.status !== 200 || response.data?.code !== "0" || !Array.isArray(response.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${response.status} code=${response.data?.code} msg=${response.data?.message || response.data?.msg || "unknown"}`);
    }

    let rawData = response.data.data || [];
    if (top > 0 && rawData.length > top) {
      rawData = rawData.slice(0, top);
    }

    console.log(`DEBUG: Processed ${rawData.length} raw whale positions`);

    const payload = {
      success: true,
      data: rawData,
      lastUpdated: new Date().toISOString(),
      dataSource: "hyperliquid_raw_whale_positions",
      method: "live-fetch"
    };

    // 4) Cache to both stores
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (err) {
    console.error(`[${type}] hyperliquid-whale-position fetch error:`, err.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);

    return res.status(500).json({
      success: false,
      data: [],
      error: "API fetch failed and no cached data available.",
      lastUpdated: new Date().toISOString()
    });
  }
}

        
case "hyperliquid-whale-alert": {
  // Optional cap for UI/testing: &top=200 (0 = no cap)
  const top = Math.max(0, Math.min(parseInt(req.query.top || "0", 10) || 0, 500));

  // --- Cache keys (fast-lane + safety-net) ---
  const TTL = 600; // 10 min fast cache
  const cacheKey    = `cg:hyperliquid-whale-alert:top=${top}`;
  const lastGoodKey = `last:hyperliquid-whale-alert:top=${top}`;

  // 1) Fast lane: short-term cache
  const cached = await kv.get(cacheKey);
  if (cached) {
    console.log(`DEBUG [${type}]: hyperliquid-whale-alert → cache-hit (top=${top || "all"})`);
    return res.json(cached);
  }

  // 2) Traffic cop: global rate limiter
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: hyperliquid-whale-alert → rate-limited, serving last-good`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // fully shaped guarded fallback
    return res.json({
      success: true,
      data: [],
      lastUpdated: new Date().toISOString(),
      dataSource: "hyperliquid_whale_alerts",
      method: "guarded-fallback"
    });
  }

  // 3) Live fetch
  try {
    console.log("DEBUG: Requesting Hyperliquid whale alerts...");
    const url = "https://open-api-v4.coinglass.com/api/hyperliquid/whale-alert";

    const response = await axiosWithBackoff(() => axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: s => s < 500
    }));

    console.log("DEBUG: Hyperliquid Whale Alert Response Status:", response.status);

    if (response.status === 401) {
      return res.status(401).json({
        error: "API Authentication Failed",
        message: "Invalid API key or insufficient permissions. Check your CoinGlass API plan."
      });
    }
    if (response.status === 403) {
      return res.status(403).json({
        error: "API Access Forbidden",
        message: "Your API plan does not include access to this endpoint. Upgrade to Startup plan or higher."
      });
    }
    if (response.status !== 200 || response.data?.code !== "0" || !Array.isArray(response.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${response.status} code=${response.data?.code} msg=${response.data?.message || response.data?.msg || "unknown"}`);
    }

    // Normalize + optional cap
    let rawData = response.data.data || [];

    // (Optional) sort newest → oldest if timestamp exists
    rawData.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (top > 0 && rawData.length > top) {
      rawData = rawData.slice(0, top);
    }

    console.log(`DEBUG: Processed ${rawData.length} whale alerts`);

    const payload = {
      success: true,
      data: rawData,
      lastUpdated: new Date().toISOString(),
      dataSource: "hyperliquid_whale_alerts",
      method: "live-fetch"
    };

    // 4) Cache to both stores
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (err) {
    console.error(`[${type}] hyperliquid-whale-alert fetch error:`, err.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);

    return res.status(500).json({
      success: false,
      data: [],
      error: "API fetch failed and no cached data available.",
      lastUpdated: new Date().toISOString()
    });
  }
}




case "bull-market-peak-indicators": {
  const TTL = 600; // 10 min
  const cacheKey = "cg:bull-market-peak-indicators";
  const lastGoodKey = "last:bull-market-peak-indicators";

  // 1) Fast lane
  const cached = await kv.get(cacheKey);
  if (cached) {
    console.log(`DEBUG [${type}]: Returning main cached data.`);
    return res.json(cached);
  }

  // 2) Traffic cop
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: Rate limit active. Serving last known good.`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // Fully-shaped guarded fallback
    return res.json({
      success: false,
      data: {},
      totalIndicators: 0,
      lastUpdated: new Date().toISOString(),
      method: "guarded-fallback",
      message: "Guarded: Rate limit active"
    });
  }

  // 3) Live fetch
  try {
    console.log(`DEBUG [${type}]: Fetching fresh data.`);
    const url = "https://open-api-v4.coinglass.com/api/bull-market-peak-indicator";
    const response = await axiosWithBackoff(() =>
      axios.get(url, { headers, timeout: 10000, validateStatus: s => s < 500 })
    );

    if (response.status !== 200 || response.data?.code !== "0" || !Array.isArray(response.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${response.status} code=${response.data?.code} msg=${response.data?.message || response.data?.msg || "unknown"}`);
    }

    // --- Processing logic (hardened) ---
    const indicators = response.data.data;

    const targetIndicators = [
      "Pi Cycle Top Indicator", "Puell Multiple", "Bitcoin Rainbow Chart",
      "MVRV Z-Score", "Altcoin Season Index", "Bitcoin Dominance",
      "Bitcoin Net Unrealized P&L (NUPL)", "Bitcoin 4-Year Moving Average"
    ];

    const num = (v) => {
      if (v == null) return 0;
      if (typeof v === "number") return Number.isFinite(v) ? v : 0;
      const s = String(v).replace(/\s+/g, "").replace("%", "");
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    };

    const processed = {};
    for (const indicator of indicators) {
      const name = indicator?.indicator_name;
      if (!targetIndicators.includes(name)) continue;

      const current  = num(indicator?.current_value);
      const target   = num(indicator?.target_value);
      const previous = num(indicator?.previous_value);
      const change   = num(indicator?.change_value);
      const cmp      = indicator?.comparison_type || ">="; // default safe
      const hit      = indicator?.hit_status ?? false;

      let progressPct = 0;
      if (cmp === ">=") {
        progressPct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
      } else if (cmp === "<=") {
        progressPct = target > 0 ? Math.max(100 - ((current / target) * 100), 0) : 0;
      }

      const distance = Math.abs(target - current);
      const pctChange = previous !== 0 ? ((current - previous) / previous) * 100 : 0;

      processed[name] = {
        current_value: current,
        target_value: target,
        previous_value: previous,
        change_value: change,
        comparison_type: cmp,
        hit_status: hit,
        progress_percentage: Math.round(progressPct * 100) / 100,
        distance_to_target: distance,
        percentage_change: Math.round(pctChange * 100) / 100,
        progress_bar_width: Math.min(progressPct, 100),
        remaining_bar_width: Math.max(100 - progressPct, 0),
        original_current_value: indicator?.current_value ?? null,
        original_target_value: indicator?.target_value ?? null
      };
    }
    // --- end processing ---

    const payload = {
      success: true,
      data: processed,
      totalIndicators: Object.keys(processed).length,
      lastUpdated: new Date().toISOString(),
      method: "live-fetch"
    };

    // 4) Cache both
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Fetch Error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.status(500).json({
      success: false,
      data: {},
      totalIndicators: 0,
      error: "API fetch failed",
      message: error.message,
      lastUpdated: new Date().toISOString(),
      method: "live-error"
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
  const TTL = 600; // 10 minutes fast-lane cache
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
  // --- Input guards & param shaping ---
  const tfMap = { "1h":"1h","4h":"4h","24h":"24h","1w":"1w" };
  const tf = (req.query.tf || "24h").toLowerCase();
  if (!tfMap[tf]) {
    return res.status(400).json({ error: "Invalid tf. Use 1h|4h|24h|1w" });
  }
  const safeTop = Math.max(5, Math.min(parseInt(req.query.top || "20", 10) || 20, 200));
  const safePerPage = Math.max(safeTop, Math.min(parseInt(req.query.per_page || "200", 10) || 200, 200));

  const volField  = `volume_usd_${tfMap[tf]}`;
  const buyField  = `buy_volume_usd_${tfMap[tf]}`;
  const sellField = `sell_volume_usd_${tfMap[tf]}`;
  const flowField = `volume_flow_usd_${tfMap[tf]}`;

  // --- Cache keys (fast-lane + safety-net) ---
  const TTL = 600; // 10 min fast cache
  const cacheKey    = `cg:coins-flow-sankey:tf=${tf}:top=${safeTop}:per=${safePerPage}`;
  const lastGoodKey = `last:coins-flow-sankey:tf=${tf}:top=${safeTop}:per=${safePerPage}`;

  // 1) Fast lane: short-term cache
  const cached = await kv.get(cacheKey);
  if (cached) {
    console.log(`DEBUG [${type}]: coins-flow-sankey → cache-hit (tf=${tf}, top=${safeTop})`);
    return res.json(cached);
  }

  // 2) Traffic cop: global rate limiter
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: coins-flow-sankey → rate-limited, serving last-good`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    // Fully-shaped guarded fallback so UI never breaks
    return res.json({
      success: true,
      timeframe: tf,
      top: 0,
      items: [],
      lastUpdated: new Date().toISOString(),
      method: "guarded-fallback",
      source: "coinglass_spot_coins_markets"
    });
  }

  // 3) Live fetch
  try {
    const url = `https://open-api-v4.coinglass.com/api/spot/coins-markets`;
    const cg = await axiosWithBackoff(() =>
      axios.get(url, {
        headers,
        timeout: 15000,
        validateStatus: s => s < 500,
        params: { per_page: safePerPage, page: 1 }
      })
    );

    if (cg.status !== 200 || cg.data?.code !== "0" || !Array.isArray(cg.data?.data)) {
      throw new Error(`Upstream failed: HTTP ${cg.status} code=${cg.data?.code} msg=${cg.data?.msg || cg.data?.message || "unknown"}`);
    }

    let rows = cg.data.data;

    // Rank by timeframe volume, then slice
    rows = rows
      .filter(r => typeof r[volField] === "number")
      .sort((a,b) => (b[volField] || 0) - (a[volField] || 0))
      .slice(0, safeTop);

    // Shape output; if empty, still return shaped payload
    const items = rows.map(r => {
      const buy  = Number(r[buyField]  || 0);
      const sell = Number(r[sellField] || 0);
      return {
        symbol: r.symbol,
        volume: Number(r[volField] || 0),
        buy,
        sell,
        flow: Number.isFinite(r[flowField]) ? Number(r[flowField]) : (buy - sell)
      };
    });

    const payload = {
      success: true,
      timeframe: tf,
      top: items.length,
      items,
      lastUpdated: new Date().toISOString(),
      method: "live-fetch",
      source: "coinglass_spot_coins_markets"
    };

    // 4) Populate both caches
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 3600 });

    return res.json(payload);

  } catch (err) {
    console.error(`[${type}] coins-flow-sankey fetch error:`, err.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);

    return res.status(500).json({
      success: false,
      timeframe: tf,
      top: 0,
      items: [],
      error: "coins-flow-sankey failed",
      message: err.message,
      lastUpdated: new Date().toISOString()
    });
  }
}




case "discord-feed": {
  console.log("DEBUG: Requesting Discord messages from external service...");
  
  const DISCORD_SERVICE_URL = process.env.DISCORD_SERVICE_URL || "https://discord-monitor.azurewebsites.net";
  const limit = Math.min(parseInt(req.query.limit || "50"), 100);
  
  // Get optional timestamp filters from query params
  const startTimestamp = req.query.start_timestamp ? parseInt(req.query.start_timestamp) : null;
  const endTimestamp = req.query.end_timestamp ? parseInt(req.query.end_timestamp) : null;
  const hours = req.query.hours ? parseInt(req.query.hours) : null; // ← ONLY FOR ZAP

  // Debug logs
  if (startTimestamp && endTimestamp) {
    console.log(`DEBUG: Filtering by start/end timestamp`);
  }
  if (hours) {
    console.log(`DEBUG: ZAP requesting last ${hours} hours only`);
  }
  
  try {
    const discordUrl = `${DISCORD_SERVICE_URL}/messages`;
    console.log("DEBUG: Fetching from:", discordUrl, "with limit:", limit);
    
    const response = await axios.get(discordUrl, {
      timeout: 15000,
      validateStatus: (status) => status < 500,
      params: { limit: limit }
    });
    if (response.status !== 200) {
      return res.status(response.status).json({
        error: 'Discord service error',
        message: `Discord service returned status ${response.status}`
      });
    }
    const messages = response.data || [];
    console.log(`DEBUG: Raw response contains ${Array.isArray(messages) ? messages.length : 'non-array'} messages`);
    
    // Log first message structure for debugging
    if (Array.isArray(messages) && messages.length > 0) {
      console.log("DEBUG: First message structure:", JSON.stringify(messages[0], null, 2));
    }
    
    // **SIMPLIFIED PROCESSING: Use the images array directly**
    const processedMessages = Array.isArray(messages) ? messages.map((msg, index) => {
      const images = Array.isArray(msg.images) ? msg.images.filter(img => 
        typeof img === 'string' && img.trim() && img.startsWith('http')
      ) : [];
      
      return {
        id: msg.id,
        author: msg.author || 'Unknown',
        content: msg.content || '',
        images: images,
        timestamp: msg.timestamp,
        formatted_time: msg.timestamp ? new Date(msg.timestamp).toLocaleString() : null,
        author_avatar: msg.author_avatar || null
      };
    }) : [];
    
    // === APPLY FILTERING ===
    let filteredMessages = processedMessages;

    // ONLY apply hours filter IF ?hours= is in URL (i.e. from Zap)
    if (hours) {
      const cutoff = Date.now() - hours * 60 * 60 * 1000;
      filteredMessages = filteredMessages.filter(msg => {
        if (!msg.timestamp) return false;
        const msgTime = new Date(msg.timestamp).getTime();
        return msgTime >= cutoff;
      });
      console.log(`DEBUG: Applied ?hours=${hours} → ${filteredMessages.length} messages`);
    }

    // Apply start/end timestamp filtering (if used elsewhere)
    if (startTimestamp && endTimestamp) {
      filteredMessages = filteredMessages.filter(msg => {
        if (!msg.timestamp) return false;
        const msgTime = new Date(msg.timestamp).getTime();
        return msgTime >= startTimestamp && msgTime <= endTimestamp;
      });
      console.log(`DEBUG: Applied start/end timestamp filter → ${filteredMessages.length} messages`);
    }
    
    const totalImages = filteredMessages.reduce((sum, msg) => sum + msg.images.length, 0);
    const messagesWithImages = filteredMessages.filter(msg => msg.images.length > 0).length;
    
    console.log(`DEBUG: Final results:`, {
      totalMessages: filteredMessages.length,
      totalImages,
      messagesWithImages,
      hoursFilterApplied: !!hours
    });

    return res.json({
      success: true,
      data: filteredMessages,
      lastUpdated: new Date().toISOString(),
      totalMessages: filteredMessages.length,
      totalImages,
      messagesWithImages,
      source: 'discord_monitor_service',
      hoursFilter: !!hours ? hours : null  // optional debug
    });
    
  } catch (err) {
    console.error("[discord-feed] Error:", err.message);
    return res.status(500).json({
      error: "Discord feed failed",
      message: err.message,
      data: [],
      lastUpdated: new Date().toISOString()
    });
  }
}





case "trade-of-day": {
  // Simple rate limiting to prevent abuse
  if (!(await allow("github:trade-of-day", 100))) {
    return res.json({
      success: false,
      error: "Rate limit exceeded",
      lastUpdated: new Date().toISOString()
    });
  }
  try {
    console.log(`[trade-of-day] Fetching from GitHub`);
    
    const githubUrl = "https://raw.githubusercontent.com/whaletradesweb/whale-trades2/main/api/public/trade-of-day.json";
    const response = await axiosWithBackoff(() =>
      axios.get(githubUrl, { 
        timeout: 8000,
        validateStatus: s => s < 500,
        headers: {
          'Cache-Control': 'no-cache',
          'User-Agent': 'WhaleTradesAPI/1.0'
        }
      })
    );
    if (response.status !== 200) {
      throw new Error(`GitHub fetch failed: HTTP ${response.status}`);
    }
    const tradeData = response.data;
    
    // Validate the data structure
    if (!tradeData || typeof tradeData !== 'object') {
      throw new Error('Invalid trade data format');
    }
    // Return the data directly from GitHub
    return res.json({
      success: true,
      data: tradeData,
      lastUpdated: new Date().toISOString(),
      method: "github-direct",
      source: "github-file"
    });
  } catch (error) {
    console.error("[trade-of-day] Error:", error.message);
    
    return res.status(500).json({
      success: false,
      error: "Failed to fetch trade of the day",
      message: error.message,
      lastUpdated: new Date().toISOString()
    });
  }
}



case "bitcoin-historical": {
  const TTL = 3600; // Cache for 1 hour
  const cacheKey = "bitcoin-historical-data";
  const lastGoodKey = "last:bitcoin-historical-data";

  // 1) Fast lane - check cache first
  const cached = await kv.get(cacheKey);
  if (cached) {
    console.log(`DEBUG [${type}]: Returning cached Bitcoin historical data`);
    return res.json(cached);
  }

  // 2) Traffic cop
  if (!(await allow("sheets:bitcoin", 50))) {
    console.log(`DEBUG [${type}]: Rate limit active. Serving last known good`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.json({
      success: false,
      data: [],
      message: "Rate limit active and no cached data available",
      method: "guarded-fallback"
    });
  }

  // 3) Live fetch from Google Sheets
  try {
    console.log(`DEBUG [${type}]: Fetching Bitcoin historical data from Google Sheets`);
    
    // Use the published CSV URL from Google Sheets
    const publishedCsvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR8Dnmonp74LjnXvpyE9kPwkARq1NlaRF9XNAahuLuFkvo9bbHYPAwPKI21t_C5Xdi9tlZXHvQbDBTr/pub?gid=398063613&single=true&output=csv";
    const csvUrls = [
      publishedCsvUrl,
      // Fallback URLs in case the published URL changes
      "https://docs.google.com/spreadsheets/d/1lMeP05fHmddWZchyUhntLTQxQSTuyQGsmTX-YVZIKm8/export?format=csv&gid=0",
      "https://docs.google.com/spreadsheets/d/1lMeP05fHmddWZchyUhntLTQxQSTuyQGsmTX-YVZIKm8/export?format=csv"
    ];
    
    let response = null;
    let csvData = null;
    
    // Try each URL format until one works
    for (const csvUrl of csvUrls) {
      try {
        console.log(`DEBUG [${type}]: Trying URL: ${csvUrl}`);
        
        response = await axiosWithBackoff(() =>
          axios.get(csvUrl, { 
            timeout: 15000,
            validateStatus: s => s < 500,
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; WhaleTradesAPI/1.0)',
              'Accept': 'text/csv,application/csv,text/plain,*/*'
            },
            maxRedirects: 5,
            followRedirect: true
          })
        );

        if (response.status === 200 && response.data && typeof response.data === 'string') {
          csvData = response.data;
          console.log(`DEBUG [${type}]: Successfully fetched from: ${csvUrl}`);
          break;
        } else {
          console.log(`DEBUG [${type}]: Failed with status ${response.status} from: ${csvUrl}`);
        }
      } catch (urlError) {
        console.log(`DEBUG [${type}]: URL ${csvUrl} failed: ${urlError.message}`);
        continue;
      }
    }

    if (!csvData) {
      throw new Error(`All Google Sheets CSV URLs failed. Sheet may not be publicly accessible. Please share the sheet with "Anyone with the link can view"`);
    }

    // Parse CSV data
    const lines = csvData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length < 2) {
      throw new Error("CSV data appears to be empty or invalid");
    }
    
    console.log(`DEBUG [${type}]: Processing ${lines.length} lines from CSV`);
    
    // Process data starting from row 2 (skip header)
    const historicalData = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      
      // Handle CSV parsing more carefully
      const values = line.split(',');
      
      if (values.length >= 5) {
        const dateStr = values[0].replace(/"/g, '').trim();
        const open = parseFloat(values[1].replace(/"/g, '').trim());
        const high = parseFloat(values[2].replace(/"/g, '').trim());
        const low = parseFloat(values[3].replace(/"/g, '').trim());
        const close = parseFloat(values[4].replace(/"/g, '').trim());
        
        // Convert date string to timestamp
        const date = new Date(dateStr);
        if (isNaN(date.getTime()) || isNaN(close) || close <= 0) {
          console.log(`DEBUG [${type}]: Skipping invalid row ${i}: ${line}`);
          continue;
        }
        
        historicalData.push({
          date: dateStr,
          timestamp: date.getTime(),
          open: open,
          high: high,
          low: low,
          close: close
        });
      }
    }

    // Sort by date ascending
    historicalData.sort((a, b) => a.timestamp - b.timestamp);

    if (historicalData.length === 0) {
      throw new Error("No valid Bitcoin price data found in the sheet");
    }

    const payload = {
      success: true,
      data: historicalData,
      total_records: historicalData.length,
      date_range: {
        start: historicalData.length > 0 ? historicalData[0].date : null,
        end: historicalData.length > 0 ? historicalData[historicalData.length - 1].date : null
      },
      current_price: historicalData.length > 0 ? historicalData[historicalData.length - 1].close : null,
      data_source: "google_sheets",
      lastUpdated: new Date().toISOString(),
      method: "live-fetch",
      csv_lines_processed: lines.length,
      valid_records_found: historicalData.length
    };

    // 4) Cache both
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 7200 }); // Keep last good for 2 hours

    console.log(`DEBUG [${type}]: Successfully processed ${historicalData.length} Bitcoin records from ${lines.length} CSV lines`);
    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Bitcoin historical fetch error:`, error.message);
    
    // More specific error messages
    let errorMessage = error.message;
    if (error.message.includes("400")) {
      errorMessage = "Google Sheet access denied. Please ensure the sheet is shared with 'Anyone with the link can view' permissions.";
    } else if (error.message.includes("403")) {
      errorMessage = "Google Sheet is private. Please share the sheet publicly or with 'Anyone with the link can view' permissions.";
    } else if (error.message.includes("404")) {
      errorMessage = "Google Sheet not found. Please check the sheet ID and ensure the sheet exists.";
    }
    
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    
    return res.status(500).json({
      success: false,
      data: [],
      error: "Bitcoin historical data fetch failed",
      message: errorMessage,
      lastUpdated: new Date().toISOString(),
      method: "live-error"
    });
  }
}


case "bitcoin-latest-weekly": {
  const TTL = 3600; // Cache for 1 hour
  const cacheKey = "bitcoin-latest-weekly-data";
  const lastGoodKey = "last:bitcoin-latest-weekly-data";

  // 1) Fast lane - check cache first
  const cached = await kv.get(cacheKey);
  if (cached) {
    console.log(`DEBUG [${type}]: Returning cached Bitcoin latest weekly data`);
    return res.json(cached);
  }

  // 2) Traffic cop
  if (!(await allow("cg:GLOBAL", 250))) {
    console.log(`DEBUG [${type}]: Rate limit active. Serving last known good`);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    return res.json({
      success: false,
      data: null,
      message: "Rate limit active and no cached data available",
      method: "guarded-fallback"
    });
  }

  // 3) Live fetch from CoinGlass
  try {
    console.log(`DEBUG [${type}]: Fetching latest Bitcoin weekly data from CoinGlass`);
    
    // Calculate timestamps for the last 2 weeks to ensure we get the most recent complete week
    const now = Date.now();
    const twoWeeksAgo = now - (14 * 24 * 60 * 60 * 1000);
    
    const url = "https://open-api-v4.coinglass.com/api/spot/price/history";
    const params = {
      exchange: "Binance",
      symbol: "BTCUSDT",
      interval: "1w", // Weekly data
      start_time: twoWeeksAgo,
      end_time: now,
      limit: 10 // Just get the last few weeks
    };
    
    const response = await axiosWithBackoff(() =>
      axios.get(url, { 
        headers,
        params,
        timeout: 15000, 
        validateStatus: s => s < 500 
      })
    );

    console.log("DEBUG: CoinGlass Response Status:", response.status);

    if (response.status === 401) {
      return res.status(401).json({
        error: 'API Authentication Failed',
        message: 'Invalid API key or insufficient permissions. Check your CoinGlass API plan.'
      });
    }
    
    if (response.status === 403) {
      return res.status(403).json({
        error: 'API Access Forbidden',
        message: 'Your API plan does not include access to this endpoint. Upgrade to Pro plan or higher.'
      });
    }
    
    if (response.status !== 200 || response.data?.code !== "0") {
      throw new Error(`CoinGlass API failed: HTTP ${response.status} code=${response.data?.code} msg=${response.data?.message || response.data?.msg || "unknown"}`);
    }

    const rawData = response.data.data || [];
    
    if (!Array.isArray(rawData) || rawData.length === 0) {
      throw new Error("No weekly Bitcoin data received from CoinGlass");
    }

    console.log(`DEBUG [${type}]: Received ${rawData.length} weekly candles from CoinGlass`);

    // Process the data and get the most recent complete week
    const processedData = rawData
      .map(candle => ({
        timestamp: Number(candle.time),
        date: new Date(Number(candle.time)).toISOString().split('T')[0], // YYYY-MM-DD format
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
        volume_usd: Number(candle.volume_usd || 0)
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    // Get the most recent complete week
    const latestWeek = processedData[processedData.length - 1];
    
    // Check if this is actually a new week compared to existing data
    let isNewWeek = true;
    try {
      // Try to get existing Google Sheets data to compare
      const existingDataResponse = await fetch(`${req.headers.host || 'whale-trades.vercel.app'}/api/data?type=bitcoin-historical`);
      if (existingDataResponse.ok) {
        const existingData = await existingDataResponse.json();
        if (existingData.success && existingData.data && existingData.data.length > 0) {
          const lastExistingWeek = existingData.data[existingData.data.length - 1];
          console.log(`DEBUG: Comparing new week ${latestWeek.date} with existing ${lastExistingWeek.date}`);
          
          if (lastExistingWeek.date === latestWeek.date) {
            isNewWeek = false;
            console.log(`DEBUG: Week ${latestWeek.date} already exists in spreadsheet`);
          }
        }
      }
    } catch (compareError) {
      console.log(`DEBUG: Could not compare with existing data: ${compareError.message}`);
      // Continue anyway - let Zapier handle duplicates
    }

    const payload = {
      success: true,
      data: latestWeek,
      is_new_week: isNewWeek,
      total_weeks_fetched: processedData.length,
      data_source: "coinglass_spot_api",
      lastUpdated: new Date().toISOString(),
      method: "live-fetch",
      zapier_ready: {
        // Format specifically for Zapier to easily add to Google Sheets
        date: latestWeek.date,
        open: latestWeek.open,
        high: latestWeek.high,
        low: latestWeek.low,
        close: latestWeek.close,
        volume_usd: latestWeek.volume_usd
      }
    };

    // 4) Cache both
    await kv.set(cacheKey, payload, { ex: TTL });
    await kv.set(lastGoodKey, payload, { ex: 7200 }); // Keep last good for 2 hours

    console.log(`DEBUG [${type}]: Successfully processed latest Bitcoin week: ${latestWeek.date} (${isNewWeek ? 'NEW' : 'EXISTS'})`);
    
    return res.json(payload);

  } catch (error) {
    console.error(`[${type}] Bitcoin latest weekly fetch error:`, error.message);
    const last = await kv.get(lastGoodKey);
    if (last) return res.json(last);
    
    return res.status(500).json({
      success: false,
      data: null,
      error: "Bitcoin latest weekly data fetch failed",
      message: error.message,
      lastUpdated: new Date().toISOString(),
      method: "live-error"
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
