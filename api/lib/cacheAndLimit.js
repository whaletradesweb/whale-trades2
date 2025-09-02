// api/_lib/cacheAndLimit.js
const { kv } = require("@vercel/kv");

const k = (name, params) => `cg:${name}:${Buffer.from(JSON.stringify(params||{})).toString("base64")}`;

// get-or-set cache (TTL in seconds)
async function cacheGetSet(name, params, ttlSec, fetcher) {
  const key = k(name, params);
  const cached = await kv.get(key);
  if (cached) return cached;
  const data = await fetcher();
  await kv.set(key, data, { ex: ttlSec });
  return data;
}

// simple per-minute token bucket
async function allow(name, maxPerMinute) {
  const key = `ratelimit:${name}`;
  const now = Date.now();
  const state = (await kv.get(key)) || { tokens: maxPerMinute, ts: now };
  const refill = ((now - state.ts) / 60000) * maxPerMinute;
  const tokens = Math.min(maxPerMinute, state.tokens + refill);
  if (tokens < 1) {
    await kv.set(key, { tokens, ts: now }, { ex: 120 });
    return false;
  }
  await kv.set(key, { tokens: tokens - 1, ts: now }, { ex: 120 });
  return true;
}

// backoff helper for 429s
async function axiosWithBackoff(getFn, tries = 3) {
  try {
    return await getFn();
  } catch (e) {
    const status = e?.response?.status;
    if (status === 429 && tries > 0) {
      const resetMs = Number(e?.response?.headers?.["x-ratelimit-reset"]) || 1000;
      const jitter = 250 + Math.random()*500;
      await new Promise(r => setTimeout(r, resetMs + jitter));
      return axiosWithBackoff(getFn, tries - 1);
    }
    throw e;
  }
}

module.exports = { cacheGetSet, allow, axiosWithBackoff };
