const { createHash, timingSafeEqual } = require('node:crypto');

function authorized(req, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const header = req.headers?.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 1024) return false;
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(header.slice(7)), hash(secret));
}

// Preserve the formats used by the existing Zapier workflow.
function normalizeImages(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) value = parsed;
      else if (parsed && Array.isArray(parsed.images)) value = parsed.images;
    } catch (_) { /* A single URL or comma-separated URLs are also supported. */ }
    if (typeof value === 'string') value = value.split(',').map(url => url.trim());
  }
  return Array.isArray(value) ? value : value ? [value] : [];
}

function imageUrl(image) {
  return typeof image === 'string' ? image : image?.url || image?.imageUrl || image?.href;
}

function validateImages(images, maxImages = 100) {
  if (!images.length) return 'Images array is empty';
  if (images.length > maxImages) return `A maximum of ${maxImages} images is allowed`;
  for (const image of images) {
    const url = imageUrl(image);
    if (typeof url !== 'string' || url.length > 8192) return 'Invalid image URL';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return 'Images must use HTTPS URLs without credentials';
    } catch (_) { return 'Invalid image URL'; }
  }
  return null;
}

// Atomic across all Vercel function instances. Reserve the image budget before
// any paid request; unavailable storage fails closed instead of bypassing limits.
async function reserveBudget(kv, count, now = Date.now()) {
  const hour = Math.floor(now / 3600000);
  const key = `security:analyze-pnl:images:${hour}`;
  const used = await kv.eval(`
    local current = tonumber(redis.call('GET', KEYS[1]) or '0')
    local count = tonumber(ARGV[1])
    if current + count > tonumber(ARGV[2]) then return 0 end
    redis.call('INCRBY', KEYS[1], count)
    redis.call('EXPIRE', KEYS[1], 7200)
    return 1
  `, [key], [count, 200]);
  return Number(used) === 1;
}

module.exports = { authorized, normalizeImages, imageUrl, validateImages, reserveBudget };
