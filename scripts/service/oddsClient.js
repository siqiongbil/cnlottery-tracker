const axios = require('axios');
const {
  SPORTTERY_API_BASE,
  SPORTTERY_CHANNEL,
  SPORTTERY_DEFAULT_POOLS,
  REQUEST_TIMEOUT_MS,
  ODDS_CACHE_TTL_MS,
  USER_AGENT,
  SPORTTERY_REFERER,
  SPORTTERY_ORIGIN
} = require('../config');

const http = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: SPORTTERY_REFERER,
    Origin: SPORTTERY_ORIGIN
  }
});

// 内存 TTL 缓存。赔率稳定期短，故默认 30s。
const cache = new Map();

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function withCache(key, ttlMs, loader) {
  const cached = getCache(key);
  if (cached) return cached;
  const value = await loader();
  setCache(key, value, ttlMs);
  return value;
}

/**
 * 拉一次原始数据。可指定 poolCode，多个用英文逗号。
 * 不指定时使用环境变量 SPORTTERY_DEFAULT_POOLS。
 */
async function fetchRaw(poolCodes) {
  const pools = poolCodes || SPORTTERY_DEFAULT_POOLS;
  const url = SPORTTERY_API_BASE;
  const params = { channel: SPORTTERY_CHANNEL, poolCode: pools };

  const cacheKey = `raw:${SPORTTERY_CHANNEL}:${pools}`;
  return withCache(cacheKey, ODDS_CACHE_TTL_MS, async () => {
    const resp = await http.get(url, { params });
    const body = resp.data;
    if (!body || body.success !== true || String(body.errorCode) !== '0') {
      const err = new Error(`sporttery upstream error: ${body && body.errorMessage}`);
      err.statusCode = 502;
      throw err;
    }
    return body;
  });
}

function clearCache() {
  const n = cache.size;
  cache.clear();
  return n;
}

module.exports = { fetchRaw, clearCache };
