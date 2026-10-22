const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const security = require('../lib/analysis-security.cjs');
const { isPatched } = require('../lib/runtime-security.cjs');
const root = path.resolve(__dirname, '..');
const secret = 'a-test-secret-that-is-long-enough-for-authentication';
const image = 'https://cdn.discordapp.com/attachments/test/image.png?ex=123&hm=456';

function response() {
  return { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() {} };
}

function analysis({ budget = 1, storageFails = false, apiFails = false, configured = true } = {}) {
  const calls = { storage: 0, paid: 0, logs: [] };
  const kv = { async eval() { calls.storage++; if (storageFails) throw Error('private-storage-error'); return budget; } };
  class FakeOpenAI {
    chat = { completions: { create: async () => {
      calls.paid++;
      if (apiFails) throw Error('private-api-error');
      return { choices: [{ message: { content: JSON.stringify([
        { profit_percent: 42, symbol: 'BTCUSDT', direction: 'LONG', leverage: '2x', image_type: 'pnl_screenshot', description: 'Trade' }
      ]) } }] };
    } } };
  }
  let source = fs.readFileSync(path.join(root, 'api/analyze-pnl.js'), 'utf8')
    .replace('export default async function handler', 'module.exports = async function handler')
    .replace("await import('openai')", 'await Promise.resolve({ OpenAI: FakeOpenAI })');
  const context = {
    module: { exports: {} }, FakeOpenAI, URL, Date, Array, JSON,
    console: { info: (...args) => calls.logs.push(args), log: (...args) => calls.logs.push(args), warn: (...args) => calls.logs.push(args), error: (...args) => calls.logs.push(args) },
    process: { env: { OPENAI_API_KEY: 'not-a-real-key', ANALYZE_PNL_SECRET: configured ? secret : undefined } },
    require(name) {
      if (name === '@vercel/kv') return { kv };
      if (name === '../lib/analysis-security.cjs') return security;
      if (name === '../lib/runtime-security.cjs') return { reportRuntime() {} };
      throw Error(name);
    }
  };
  vm.runInNewContext(source, context);
  return { handler: context.module.exports, calls };
}

async function post(options, body, authorization = `Bearer ${secret}`) {
  const { handler, calls } = analysis(options); const res = response();
  await handler({ method: 'POST', headers: { authorization }, body }, res);
  return { res, calls };
}

test('Node.js security minima reject vulnerable, unsupported and malformed versions', () => {
  for (const v of ['v22.23.3', 'v24.22.0', 'v26.12.0', 'v20.99.0', 'v23.0.0', 'v22.23.4-rc.1', 'oops']) assert.equal(isPatched(v), false, v);
  for (const v of ['v22.23.4', 'v22.24.0', 'v24.22.1', 'v26.12.1']) assert.equal(isPatched(v), true, v);
});

test('missing, incorrect, duplicate and absent-server credentials cannot incur charges', async () => {
  for (const header of ['', 'Bearer wrong', ['Bearer '+secret], 'Basic '+secret]) {
    const { res, calls } = await post({}, { images: [image] }, header);
    assert.equal(res.code, 401); assert.equal(calls.paid, 0); assert.equal(calls.storage, 0);
  }
  assert.equal((await post({ configured: false }, { images: [image] })).res.code, 401);
});

test('invalid bodies, oversized batches and non-HTTPS URLs are rejected before storage or payment', async () => {
  for (const body of [null, [], {}, { images: [] }, { images: ['file:///etc/passwd'] }, { images: ['https://user:pass@example.com/image'] }]) {
    const { res, calls } = await post({}, body); assert.equal(res.code, 400); assert.equal(calls.paid, 0); assert.equal(calls.storage, 0);
  }
  const { res, calls } = await post({}, { images: Array(101).fill(image) });
  assert.equal(res.code, 413); assert.equal(calls.paid, 0);
});

test('existing Zapier image formats preserve successful output and author mapping', async () => {
  for (const images of [image, [image], JSON.stringify({ images: [image] }), JSON.stringify([image]), [{ url: image }]]) {
    const { res, calls } = await post({}, { images, authors: 'trader' });
    assert.equal(res.code, 200); assert.equal(calls.paid, 1); assert.equal(res.body.success, true);
    assert.equal(res.body.total_processed, 1); assert.equal(res.body.best_trade.author, 'trader');
    assert.equal(res.body.best_trade.profit_percent, 42);
    assert.equal(JSON.stringify(calls.logs).includes(image), false);
    assert.equal(JSON.stringify(calls.logs).includes('trader'), false);
  }
});

test('banned authors remain excluded from trade of day', async () => {
  const { res } = await post({}, { images: [image], authors: 'slavic8105' });
  assert.equal(res.body.best_trade, null); assert.equal(res.body.profitable_trades, 0);
});

test('rate limit and storage outages fail closed without paid requests', async () => {
  const limited = await post({ budget: 0 }, { images: [image] });
  assert.equal(limited.res.code, 429); assert.ok(limited.res.headers['Retry-After']); assert.equal(limited.calls.paid, 0);
  const outage = await post({ storageFails: true }, { images: [image] });
  assert.equal(outage.res.code, 503); assert.equal(outage.calls.paid, 0);
  assert.equal(JSON.stringify(outage.res.body).includes('private-storage-error'), false);
});

test('upstream errors do not disclose stack traces, image URLs or credentials', async () => {
  const { res, calls } = await post({ apiFails: true }, { images: [image] });
  const output = JSON.stringify([res.body, calls.logs]);
  assert.equal(output.includes('private-api-error'), false); assert.equal(output.includes(image), false);
  assert.equal(output.includes(secret), false); assert.equal(output.includes('stack'), false);
});

test('image budget reservation is atomic and shared across requests', async () => {
  const calls = [];
  const kv = { async eval(script, keys, args) { calls.push({ script, keys, args }); return 1; } };
  assert.equal(await security.reserveBudget(kv, 10, 3600000), true);
  assert.equal(await security.reserveBudget(kv, 5, 3600100), true);
  assert.equal(calls[0].keys[0], calls[1].keys[0]);
  assert.deepEqual(calls[0].args, [10, 200]);
  assert.match(calls[0].script, /INCRBY/); assert.match(calls[0].script, /EXPIRE/);
});

test('removed diagnostics return no credential data while normal cached data keeps its schema', async () => {
  let upstream = 0;
  const source = fs.readFileSync(path.join(root, 'api/data.js'), 'utf8');
  const cached = { total_liquidations_24h: 123, percent_change_24h: 4 };
  const context = { module: { exports: {} }, process: { env: { COINGLASS_API_KEY: 'not-a-real-key' } },
    console: { info() {}, log() {}, error() {} }, Buffer, Date, setTimeout,
    require(name) {
      if (name === 'axios') return { get() { upstream++; throw Error('unexpected upstream'); } };
      if (name === '@vercel/kv') return { kv: { async get() { return cached; } } };
      if (name === './lib/cacheAndLimit') return {};
      if (name === '../lib/runtime-security.cjs') return { reportRuntime() {} };
      throw Error(name);
    } };
  vm.runInNewContext(source, context);
  for (const type of ['debug-env', 'api-usage-debug']) {
    const res = response(); await context.module.exports({ method: 'GET', headers: {}, query: { type } }, res);
    assert.equal(res.code, 404); assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(JSON.stringify(res.body).includes('not-a-real-key'), false);
  }
  const res = response(); await context.module.exports({ method: 'GET', headers: {}, query: { type: 'liquidations-total' } }, res);
  assert.equal(res.code, 200); assert.equal(res.body, cached); assert.equal(upstream, 0);
});
