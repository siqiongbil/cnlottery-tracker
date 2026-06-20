/**
 * 体彩赛果 raw -> 标准化赛果。
 *
 * 输入：getUniformMatchResultV1 的 value.matchResult[] 单元素
 * 输出：
 *   {
 *     matchId, matchNum, matchNumStr, matchDate,
 *     home, away,                       // allHomeTeam / allAwayTeam
 *     halfScore: { h, a } | null,       // sectionsNo1 "0:0"
 *     fullScore: { h, a } | null,       // sectionsNo999 "1:0"
 *     winFlag,                          // 'H' | 'D' | 'A' | ''
 *     goalLine,                         // 让球数字 (例 -1)，无则 null
 *     status                            // 'final' | 'pending'
 *   }
 *
 * status：poolStatus==='Payout' 或 matchResultStatus==='2' 视为已开奖(final)。
 */

function parseScore(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return null;
  return { h: Number(m[1]), a: Number(m[2]) };
}

function toNumOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isFinal(m) {
  if (String(m.poolStatus || '').toLowerCase() === 'payout') return true;
  if (String(m.matchResultStatus) === '2') return true;
  // 有全场比分也视为已完赛
  return Boolean(parseScore(m.sectionsNo999));
}

function normalizeResult(m) {
  if (!m) return null;
  return {
    matchId: m.matchId != null ? m.matchId : null,
    matchNum: m.matchNum != null ? String(m.matchNum) : '',
    matchNumStr: m.matchNumStr || '',
    matchDate: m.matchDate || '',
    home: m.allHomeTeam || m.homeTeam || '',
    away: m.allAwayTeam || m.awayTeam || '',
    halfScore: parseScore(m.sectionsNo1),
    fullScore: parseScore(m.sectionsNo999),
    winFlag: m.winFlag || '',
    goalLine: toNumOrNull(m.goalLine),
    status: isFinal(m) ? 'final' : 'pending'
  };
}

function flattenResults(rawBody) {
  const value = rawBody && rawBody.value;
  const list = value && Array.isArray(value.matchResult) ? value.matchResult : [];
  return list.map(normalizeResult).filter(Boolean);
}

module.exports = { normalizeResult, flattenResults, parseScore };
