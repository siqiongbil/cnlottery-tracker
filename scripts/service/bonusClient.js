/**
 * 体彩派彩赔率接口客户端。
 *
 *   getFixedBonusV1.qry?clientCode=3001&matchId=<id>
 *
 * 返回 value：
 *   matchResultList[]  官方中奖组合 + 最终派彩赔率（每玩法一条）
 *                      { code, combination, combinationDesc, goalLine, odds, refundStatus }
 *   oddsHistory        各玩法历史赔率快照列表（hadList/crsList/ttgList/hafuList/hhadList）
 *   isCancel           是否取消
 *   sectionsNo999      全场比分
 *
 * 一次只查一个 matchId。结算校验时按需调用（默认关闭）。
 */
const axios = require('axios');
const {
  SPORTTERY_BONUS_API_BASE,
  SPORTTERY_BONUS_CLIENT_CODE,
  REQUEST_TIMEOUT_MS,
  RESULT_CACHE_TTL_MS,
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

async function fetchBonusRaw(matchId) {
  if (matchId == null || matchId === '') {
    const e = new Error('matchId is required');
    e.statusCode = 400;
    throw e;
  }
  const cacheKey = `bonus:${matchId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const params = { clientCode: SPORTTERY_BONUS_CLIENT_CODE, matchId };
  const resp = await http.get(SPORTTERY_BONUS_API_BASE, { params });
  const body = resp.data;
  if (!body || body.success !== true || String(body.errorCode) !== '0') {
    const err = new Error(`sporttery bonus upstream error: ${body && body.errorMessage}`);
    err.statusCode = 502;
    throw err;
  }
  setCache(cacheKey, body, RESULT_CACHE_TTL_MS);
  return body;
}

function clearCache() {
  const n = cache.size;
  cache.clear();
  return n;
}

module.exports = { fetchBonusRaw, clearCache };
