// 加载 .env，但只有真正存在的 key 才覆盖 process.env
require('dotenv').config();

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

module.exports = {
  PORT: envInt('PORT', 3000),
  HOST: envStr('HOST', '0.0.0.0'),
  API_TOKEN: envStr('API_TOKEN', ''),

  SPORTTERY_API_BASE: envStr(
    'SPORTTERY_API_BASE',
    'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry'
  ),
  // 赛果接口（含半全场 sectionsNo1/sectionsNo999、winFlag、goalLine）
  SPORTTERY_RESULT_API_BASE: envStr(
    'SPORTTERY_RESULT_API_BASE',
    'https://webapi.sporttery.cn/gateway/uniform/football/getUniformMatchResultV1.qry'
  ),
  // 派彩赔率接口（按 matchId 拉官方中奖组合 + 历史赔率）
  SPORTTERY_BONUS_API_BASE: envStr(
    'SPORTTERY_BONUS_API_BASE',
    'https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry'
  ),
  // 赛程列表接口（按业务日期号返回在售/临近比赛，覆盖赔率窗口已滑出但仍在售的场次）
  SPORTTERY_MATCHLIST_API_BASE: envStr(
    'SPORTTERY_MATCHLIST_API_BASE',
    'https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry'
  ),
  // 实时比分接口（method=live，进行中比赛的实时比分；赛果/历史接口在终场前拿不到）
  SPORTTERY_LIVE_API_BASE: envStr(
    'SPORTTERY_LIVE_API_BASE',
    'https://webapi.sporttery.cn/gateway/uniform/fb/getMatchDataPageListV1.qry'
  ),
  SPORTTERY_BONUS_CLIENT_CODE: envStr('SPORTTERY_BONUS_CLIENT_CODE', '3001'),
  // 世界杯 leagueId（服务端按联赛筛赛果）。留空表示不筛。
  SPORTTERY_LEAGUE_ID: envStr('SPORTTERY_LEAGUE_ID', '72'),
  // 结算时是否用 getFixedBonusV1 做官方校验（每场一次额外请求，默认关）
  RESULT_VERIFY: envStr('RESULT_VERIFY', '0'),
  // 单注/单选项最高奖金封顶（体彩竞彩 100 万/注）。0 或负数表示不封顶。
  MAX_PAYOUT_PER_BET: envInt('MAX_PAYOUT_PER_BET', 1_000_000),
  SPORTTERY_CHANNEL: envStr('SPORTTERY_CHANNEL', 'c'),
  SPORTTERY_DEFAULT_POOLS: envStr('SPORTTERY_DEFAULT_POOLS', 'hhad,had,hafu,crs,ttg'),
  REQUEST_TIMEOUT_MS: envInt('REQUEST_TIMEOUT_MS', 15000),

  TIME_ZONE: envStr('TIME_ZONE', 'Asia/Shanghai'),
  ODDS_CACHE_TTL_MS: envInt('ODDS_CACHE_TTL_MS', 30_000),
  // 赛果缓存：结果出了就不会变，可以缓存久一点
  RESULT_CACHE_TTL_MS: envInt('RESULT_CACHE_TTL_MS', 5 * 60 * 1000),
  // 实时比分缓存：进行中比分秒级变，缓存要短
  LIVE_CACHE_TTL_MS: envInt('LIVE_CACHE_TTL_MS', 10_000),

  DATA_DIR: envStr('DATA_DIR', 'data'),

  USER_AGENT: envStr(
    'USER_AGENT',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
  ),

  // 体彩接口需要的来源头，绕过 WAF
  SPORTTERY_REFERER: envStr('SPORTTERY_REFERER', 'https://www.sporttery.cn/jc/jsq/'),
  SPORTTERY_ORIGIN: envStr('SPORTTERY_ORIGIN', 'https://www.sporttery.cn')
};
