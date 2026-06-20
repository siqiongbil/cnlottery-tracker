/**
 * 历史赔率服务。
 *
 * 用 getFixedBonusV1 的 oddsHistory 给出某场比赛的赔率变动轨迹（按时间戳）。
 * 支持：
 *   - 按 asOf 日期取「当天收盘价」（≤asOf 的最后一条快照）
 *   - all=true 返回某天全部变动快照（轨迹）
 *
 * oddsHistory 里每个玩法是一个按时间排列的 List：
 *   hadList / hhadList / crsList / ttgList / hafuList
 *   每条带 updateDate/updateTime + 该玩法字段，复用 oddsNormalizer 解析。
 */
const bonusClient = require('./bonusClient');
const {
  normalizeHad, normalizeHhad, normalizeCrs, normalizeTtg, normalizeHafu
} = require('../utils/oddsNormalizer');

function ts(entry) {
  return `${entry.updateDate || ''} ${entry.updateTime || ''}`.trim();
}

// 把一条 List 条目按玩法标准化为赔率对象
function normEntry(playType, entry) {
  switch (playType) {
    case 'had': return normalizeHad(entry);
    case 'hhad': return normalizeHhad(entry);
    case 'crs': return normalizeCrs(entry);
    case 'ttg': return normalizeTtg(entry);
    case 'hafu': return normalizeHafu(entry);
    default: return null;
  }
}

const LIST_KEYS = { had: 'hadList', hhad: 'hhadList', crs: 'crsList', ttg: 'ttgList', hafu: 'hafuList' };

// 把条目时间戳和 asOf 都规整成可比较字符串。
//   asOf 可为 'YYYY-MM-DD'（视为当天 23:59:59）或 'YYYY-MM-DD HH:mm:ss'
function entryStamp(e) {
  return `${e.updateDate || ''} ${e.updateTime || '00:00:00'}`.trim();
}
function asOfCeiling(asOf) {
  if (!asOf) return null;
  return /\d{2}:\d{2}/.test(asOf) ? asOf : `${asOf} 23:59:59`;
}

// 取某玩法 List 中 时间<=asOf 的最后一条（收盘）；asOf 为空则取全程最后一条
function closingEntry(list, asOf) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const ceil = asOfCeiling(asOf);
  let chosen = null;
  for (const e of list) {
    if (ceil && entryStamp(e) > ceil) continue;
    chosen = e; // List 已按时间升序，最后一个满足条件的即收盘
  }
  return chosen;
}

// 取某玩法 List 中 updateDate===asOf(日期部分) 的全部条目（当天轨迹）；asOf 为空则全部
function dayEntries(list, asOf) {
  if (!Array.isArray(list)) return [];
  if (!asOf) return list.slice();
  const day = String(asOf).slice(0, 10);
  return list.filter((e) => (e.updateDate || '') === day);
}

/**
 * @param {object} opts { matchId, asOf?: 'YYYY-MM-DD', all?: boolean }
 */
async function getOddsHistory(opts = {}) {
  const { matchId, asOf, all } = opts;
  if (matchId == null || matchId === '') {
    const e = new Error('matchId is required');
    e.statusCode = 400;
    throw e;
  }

  const raw = await bonusClient.fetchBonusRaw(matchId);
  const oh = (raw.value && raw.value.oddsHistory) || {};

  const meta = {
    matchId: oh.matchId != null ? oh.matchId : matchId,
    home: oh.homeTeamAllName || '',
    away: oh.awayTeamAllName || '',
    league: oh.leagueAllName || ''
  };

  if (all) {
    // 当天全部变动轨迹：每个玩法给一个按时间排列的快照数组
    const trace = {};
    for (const [pt, key] of Object.entries(LIST_KEYS)) {
      const entries = dayEntries(oh[key], asOf);
      trace[pt] = entries.map((e) => ({ at: ts(e), odds: normEntry(pt, e) })).filter((x) => x.odds);
    }
    return { ...meta, asOf: asOf || null, mode: 'trace', trace };
  }

  // 收盘价：每个玩法取 ≤asOf 的最后一条
  const odds = {};
  const at = {};
  for (const [pt, key] of Object.entries(LIST_KEYS)) {
    const e = closingEntry(oh[key], asOf);
    if (!e) continue;
    const norm = normEntry(pt, e);
    if (norm) { odds[pt] = norm; at[pt] = ts(e); }
  }
  return { ...meta, asOf: asOf || null, mode: 'closing', odds, updatedAt: at };
}

/**
 * 给落票补价用：取某 matchId 在 asOf 时点的收盘赔率表 + 让球。
 * 返回 { odds:{had,hhad,crs,ttg,hafu}, handicap, at:{...} }，拉不到返回 null。
 */
async function closingOddsTable(matchId, asOf) {
  const raw = await bonusClient.fetchBonusRaw(matchId);
  const oh = (raw.value && raw.value.oddsHistory) || {};
  const odds = {};
  const at = {};
  let handicap = null;
  for (const [pt, key] of Object.entries(LIST_KEYS)) {
    const e = closingEntry(oh[key], asOf);
    if (!e) continue;
    const norm = normEntry(pt, e);
    if (norm) {
      odds[pt] = norm;
      at[pt] = ts(e);
      if (pt === 'hhad' && norm.handicap != null) handicap = norm.handicap;
    }
  }
  if (Object.keys(odds).length === 0) return null;
  return { odds, handicap, at };
}

module.exports = { getOddsHistory, closingOddsTable };
