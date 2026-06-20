/**
 * 体彩实时比分接口客户端。
 *
 *   getMatchDataPageListV1.qry?method=live
 *
 * 返回 value.matchInfoList[].subMatchList[]，结构与赛程列表接口同构，进行中比赛额外带：
 *   h / a          主 / 客 实时比分（未开赛为空串）
 *   sectionsNo1    半场比分 "0:0"（半场结束后才有）
 *   sectionsNo999  全场比分 "1:0"（终场后才有）
 *   matchStatus / matchStatusName  比赛状态码 / 中文名
 *   matchId / matchNumStr / homeTeamAllName / awayTeamAllName
 *
 * 用途：赛果接口(getUniformMatchResultV1)和历史接口在终场前都拿不到进行中比分，
 * 此接口是进行中比分的唯一来源，供 settleService 给串关「提前判死活」。
 * 只读不写派彩：仅用来判定「数学上已不可能再中」的关。
 */
const axios = require('axios');
const {
  SPORTTERY_LIVE_API_BASE,
  REQUEST_TIMEOUT_MS,
  LIVE_CACHE_TTL_MS,
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

/**
 * 拉一次实时比分原始数据。一次返回当前在售/临近全部比赛（无需日期参数）。
 */
async function fetchLiveRaw() {
  const cacheKey = 'live';
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const params = { method: 'live' };
  const resp = await http.get(SPORTTERY_LIVE_API_BASE, { params });
  const body = resp.data;
  if (!body || body.success !== true || String(body.errorCode) !== '0') {
    const err = new Error(`sporttery live upstream error: ${body && body.errorMessage}`);
    err.statusCode = 502;
    throw err;
  }
  setCache(cacheKey, body, LIVE_CACHE_TTL_MS);
  return body;
}

function clearCache() {
  const n = cache.size;
  cache.clear();
  return n;
}

module.exports = { fetchLiveRaw, clearCache };
