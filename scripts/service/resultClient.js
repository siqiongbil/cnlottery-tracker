/**
 * 体彩赛果接口客户端。
 *
 *   getUniformMatchResultV1.qry?matchBeginDate=YYYY-MM-DD&matchEndDate=YYYY-MM-DD&...
 *
 * 返回 value.matchResult[]，每场含：
 *   sectionsNo1   半场比分 "0:0"
 *   sectionsNo999 全场比分 "1:0"
 *   winFlag       H/D/A
 *   goalLine      让球 "-1"
 *   matchNum / matchNumStr / matchId / matchDate / allHomeTeam / allAwayTeam
 *
 * 比 Bing HTML 解析权威得多，且带半场比分（hafu 可结算）。
 */
const axios = require('axios');
const {
  SPORTTERY_RESULT_API_BASE,
  SPORTTERY_LEAGUE_ID,
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

/**
 * 拉某个日期区间的赛果原始数据。
 * @param {string} beginDate YYYY-MM-DD
 * @param {string} endDate   YYYY-MM-DD（默认同 beginDate）
 */
async function fetchResultRaw(beginDate, endDate) {
  const begin = beginDate;
  const end = endDate || beginDate;
  const cacheKey = `result:${begin}:${end}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const params = {
    matchBeginDate: begin,
    matchEndDate: end,
    leagueId: SPORTTERY_LEAGUE_ID || '',
    pageSize: 100,
    pageNo: 1,
    isFix: 0,
    matchPage: 1,
    pcOrWap: 1
  };
  const resp = await http.get(SPORTTERY_RESULT_API_BASE, { params });
  const body = resp.data;
  if (!body || body.success !== true || String(body.errorCode) !== '0') {
    const err = new Error(`sporttery result upstream error: ${body && body.errorMessage}`);
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

module.exports = { fetchResultRaw, clearCache };
