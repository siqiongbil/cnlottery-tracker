/**
 * 按 date + 队名 在体彩赔率接口里定位一场比赛（取 matchId 等）。
 * 给历史赔率接口在只有队名时反查 matchId 用。
 *
 * 滚动窗口找不到（比赛已出窗口）时，回退赛程列表/赛果接口按 date+teams 反查 matchId。
 */
const { fetchRaw } = require('./oddsClient');
const { flattenMatches } = require('./oddsService');
const { locateOutOfWindow } = require('./matchLocator');

function norm(n) {
  return String(n || '').trim().replace(/\s+/g, '').replace(/[队]$/g, '');
}

async function findByDateAndTeams(date, teams) {
  const list = (Array.isArray(teams) ? teams : [teams]).map(norm).filter(Boolean);
  if (!date || list.length === 0) return null;

  const body = await fetchRaw();
  const matches = flattenMatches(body).filter((m) => String(m.matchDate || '') === date);

  let found = null;
  if (list.length === 1) {
    const one = list[0];
    found = matches.find((m) => norm(m.home && m.home.name) === one || norm(m.away && m.away.name) === one) || null;
  } else {
    const [a, b] = list;
    found = matches.find((m) => {
      const home = norm(m.home && m.home.name);
      const away = norm(m.away && m.away.name);
      return (home === a || away === a) && (home === b || away === b);
    }) || null;
  }

  // 滚动窗口 miss → 回退赛程列表/赛果接口（在售/刚开赛/已结束比赛）
  if (!found) found = await locateOutOfWindow(date, list);
  return found;
}

module.exports = { findByDateAndTeams };
