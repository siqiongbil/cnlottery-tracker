/**
 * 统一「比赛定位」回退器。
 *
 * 体彩 getMatchCalculatorV1 是滚动窗口：比赛结束一段时间后被移出，按队名就再也搜不到。
 * 但赛果接口 getUniformMatchResultV1 按「比赛日区间」返回，含 matchId + 队名，
 * 且对已结束的比赛长期可查。所以滚动窗口按队名定位失败时，改用赛果接口反查 matchId。
 *
 * 拿到 matchId 后，历史赔率(getFixedBonusV1)/补价/对账都不再依赖滚动窗口。
 *
 * 本模块只负责「滚动窗口之外」的回退定位（赛果接口）；滚动窗口内的定位仍由
 * 调用方各自完成（betService 复用已在手的 raw，matchLookupForHistory 自己拉）。
 */
const resultService = require('./resultService');
const matchListClient = require('./matchListClient');

function norm(n) {
  return String(n || '').trim().replace(/\s+/g, '').replace(/[队]$/g, '');
}

// 1 或 2 个队名是否匹配某场（单队：主或客任一命中；两队：双方都在）
function teamsMatch(homeName, awayName, list) {
  const home = norm(homeName);
  const away = norm(awayName);
  if (list.length === 1) return home === list[0] || away === list[0];
  const [a, b] = list;
  return (home === a || away === a) && (home === b || away === b);
}

/**
 * 滚动窗口找不到时，用赛果接口按 date+teams 反查（已结束比赛）。
 * 返回与滚动窗口 match 同构的对象（odds 留空，由调用方按 matchId 用历史接口补），拉不到返回 null。
 */
async function locateViaResults(date, teams) {
  const list = (Array.isArray(teams) ? teams : [teams]).map(norm).filter(Boolean);
  if (!date || list.length === 0) return null;

  let results = [];
  try {
    results = await resultService.getResultsByDate(date);
  } catch (_) {
    return null;
  }

  const r = results.find((x) => teamsMatch(x.home, x.away, list));
  if (!r || r.matchId == null) return null;

  return {
    matchNum: r.matchNumStr || r.matchNum || '',
    matchNumDate: '',
    matchDate: r.matchDate || date,
    matchTime: '',
    matchId: r.matchId,
    home: { name: r.home },
    away: { name: r.away },
    odds: {},
    updateAt: '',
    source: 'results'
  };
}

// 把 getMatchListV1 raw 扁平成定位所需的精简比赛列表
function flattenMatchList(raw) {
  const value = raw && raw.value;
  const buckets = value && Array.isArray(value.matchInfoList) ? value.matchInfoList : [];
  const out = [];
  for (const bucket of buckets) {
    const subs = Array.isArray(bucket.subMatchList) ? bucket.subMatchList : [];
    for (const m of subs) {
      out.push({
        matchId: m.matchId != null ? m.matchId : null,
        matchDate: m.matchDate || '',
        matchNumStr: m.matchNumStr || m.matchNum || '',
        home: m.homeTeamAllName || m.homeTeam || '',
        away: m.awayTeamAllName || m.awayTeam || ''
      });
    }
  }
  return out;
}

/**
 * 赔率窗口找不到时，用赛程列表接口(getMatchListV1)按 date+teams 反查。
 * 覆盖「赔率窗口已滑出但仍在售 / 刚开赛未出赛果」的比赛。拉不到返回 null。
 */
async function locateViaMatchList(date, teams) {
  const list = (Array.isArray(teams) ? teams : [teams]).map(norm).filter(Boolean);
  if (!date || list.length === 0) return null;

  let raw;
  try {
    raw = await matchListClient.fetchMatchListRaw();
  } catch (_) {
    return null;
  }

  const m = flattenMatchList(raw)
    .filter((x) => String(x.matchDate || '') === date)
    .find((x) => teamsMatch(x.home, x.away, list));
  if (!m || m.matchId == null) return null;

  return {
    matchNum: m.matchNumStr || '',
    matchNumDate: '',
    matchDate: m.matchDate || date,
    matchTime: '',
    matchId: m.matchId,
    home: { name: m.home },
    away: { name: m.away },
    odds: {},
    updateAt: '',
    source: 'matchList'
  };
}

/**
 * 滚动赔率窗口之外的统一定位入口。
 * 先查赛程列表(在售/刚开赛)，miss 再查赛果(已结束)。任一命中即返回。
 */
async function locateOutOfWindow(date, teams) {
  return (await locateViaMatchList(date, teams)) || (await locateViaResults(date, teams));
}

module.exports = { locateViaResults, locateViaMatchList, locateOutOfWindow, flattenMatchList, norm, teamsMatch };
