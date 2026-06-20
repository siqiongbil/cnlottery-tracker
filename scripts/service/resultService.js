/**
 * 赛果服务：拉体彩赛果接口 + 标准化 + 按日期/对账键查找。
 *
 * 对账优先级：matchId 精确 > matchNumStr 精确 > 队名+日期模糊。
 * 落票时我们存了 match.matchId / matchNum(=matchNumStr) / matchDate / 队名，
 * 所以这里建立多重索引供 settleService 命中。
 */
const { fetchResultRaw } = require('./resultClient');
const { flattenResults } = require('../utils/resultNormalizer');

function normName(n) {
  return String(n || '').trim().replace(/\s+/g, '').replace(/[队]$/g, '');
}

/**
 * 取某日赛果（标准化）。体彩赛果接口按比赛日筛 matchDate。
 */
async function getResultsByDate(date) {
  const raw = await fetchResultRaw(date, date);
  const all = flattenResults(raw);
  return all.filter((r) => !date || r.matchDate === date);
}

/**
 * 在赛果列表里为一张票定位对应比赛。
 * ticketMatch: { matchId, matchNum, matchDate, home:{name}, away:{name} }
 */
function findResultForTicket(results, ticketMatch) {
  if (!ticketMatch) return null;

  const wantId = ticketMatch.matchId != null ? String(ticketMatch.matchId) : null;
  if (wantId) {
    const byId = results.find((r) => r.matchId != null && String(r.matchId) === wantId);
    if (byId) return byId;
  }

  const wantNum = ticketMatch.matchNum ? String(ticketMatch.matchNum) : null;
  if (wantNum) {
    const byNum = results.find((r) => r.matchNumStr === wantNum || r.matchNum === wantNum);
    if (byNum) return byNum;
  }

  const tHome = normName(ticketMatch.home && ticketMatch.home.name);
  const tAway = normName(ticketMatch.away && ticketMatch.away.name);
  const tDate = ticketMatch.matchDate;
  if (!tHome && !tAway) return null;

  return (
    results.find((r) => {
      if (tDate && r.matchDate && r.matchDate !== tDate) return false;
      const rH = normName(r.home);
      const rA = normName(r.away);
      return (rH === tHome && rA === tAway) || (rH === tAway && rA === tHome);
    }) || null
  );
}

module.exports = { getResultsByDate, findResultForTicket, normName };
