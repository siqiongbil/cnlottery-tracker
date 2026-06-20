/**
 * 体彩赛程列表接口客户端。
 *
 *   getMatchListV1.qry?clientCode=3001
 *
 * 按「业务日期号」返回当前在售 + 临近的全部比赛（实测一次覆盖约 5 个销售日）。
 * 结构 value.matchInfoList[].subMatchList[]，字段与赔率接口同名：
 *   matchId / matchDate / matchNumStr / homeTeamAllName / awayTeamAllName / matchStatus
 *
 * 用途：赔率接口(getMatchCalculatorV1)是滚动赔率窗口，较早开售的比赛会滑出；
 * 此接口按期号覆盖更广，作落票/查询「按队名反查 matchId」的回退一层。
 * 不带日期参数（带 matchBeginDate/Endodate 会被体彩 WAF 拒，返回 567）。
 */
const axios = require('axios');
const {
  SPORTTERY_MATCHLIST_API_BASE,
  SPORTTERY_BONUS_CLIENT_CODE,
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

async function fetchMatchListRaw() {
  const cacheKey = 'matchList';
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const params = { clientCode: SPORTTERY_BONUS_CLIENT_CODE };
  const resp = await http.get(SPORTTERY_MATCHLIST_API_BASE, { params });
  const body = resp.data;
  if (!body || body.success !== true || String(body.errorCode) !== '0') {
    const err = new Error(`sporttery matchList upstream error: ${body && body.errorMessage}`);
    err.statusCode = 502;
    throw err;
  }
  setCache(cacheKey, body, ODDS_CACHE_TTL_MS);
  return body;
}

function clearCache() {
  const n = cache.size;
  cache.clear();
  return n;
}

module.exports = { fetchMatchListRaw, clearCache };
