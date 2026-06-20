const { fetchRaw } = require('./oddsClient');
const {
  normalizeHad,
  normalizeHhad,
  normalizeOddsList,
  normalizeCrs,
  normalizeTtg,
  normalizeHafu
} = require('../utils/oddsNormalizer');

function pick(m, baseList, code, key) {
  if (m[code] && m[code][key] !== undefined) return m[code][key];
  if (baseList[code] && baseList[code][key] !== undefined) return baseList[code][key];
  return undefined;
}

function pickRawBlocks(m) {
  const out = {};
  for (const code of ['had', 'hhad', 'hafu', 'crs', 'ttg']) {
    if (m[code]) out[code] = m[code];
  }
  const list = normalizeOddsList(m.oddsList);
  for (const code of Object.keys(list)) {
    if (!out[code]) out[code] = list[code];
  }
  return Object.keys(out).length ? out : undefined;
}

function composeUpdateAt(m) {
  const fromBlock = m.hhad || m.had || {};
  const d = fromBlock.updateDate;
  const t = fromBlock.updateTime;
  if (d && t) return `${d} ${t}`;
  if (m.oddsList && m.oddsList[0]) {
    const o = m.oddsList[0];
    if (o.updateDate && o.updateTime) return `${o.updateDate} ${o.updateTime}`;
  }
  return '';
}

function toMatch(m) {
  const baseList = normalizeOddsList(m.oddsList);
  const odds = {};

  const had = normalizeHad({
    h: pick(m, baseList, 'had', 'h'),
    d: pick(m, baseList, 'had', 'd'),
    a: pick(m, baseList, 'had', 'a')
  });
  if (had) odds.had = had;

  const hhad = normalizeHhad({
    h: pick(m, baseList, 'hhad', 'h'),
    d: pick(m, baseList, 'hhad', 'd'),
    a: pick(m, baseList, 'hhad', 'a'),
    goalLine: (m.hhad && m.hhad.goalLine) || (baseList.hhad && baseList.hhad.handicap),
    goalLineValue: (m.hhad && m.hhad.goalLineValue) || (baseList.hhad && baseList.hhad.handicap)
  });
  if (hhad) {
    odds.hhad = {
      handicap: hhad.handicap,
      win: hhad.win,
      draw: hhad.draw,
      lose: hhad.lose
    };
  }

  const hafu = normalizeHafu(m.hafu || {});
  if (hafu) odds.hafu = hafu;

  const crs = normalizeCrs(m.crs || {});
  if (crs) odds.crs = crs;

  const ttg = normalizeTtg(m.ttg || {});
  if (ttg) odds.ttg = ttg;

  return {
    matchNum: m.matchNumStr || '',
    matchNumDate: m.matchNumDate || '',
    businessDate: m.businessDate || '',
    matchDate: m.matchDate || '',
    matchTime: m.matchTime || '',
    league: m.leagueAllName || '',
    leagueCode: m.leagueCode || '',
    matchId: m.matchId || null,
    status: m.matchStatus || '',

    home: {
      id: m.homeTeamId || null,
      name: m.homeTeamAllName || '',
      rank: m.homeRank || '',
      code: m.homeTeamCode || ''
    },
    away: {
      id: m.awayTeamId || null,
      name: m.awayTeamAllName || '',
      rank: m.awayRank || '',
      code: m.awayTeamCode || ''
    },

    odds,
    updateAt: composeUpdateAt(m)
  };
}

function flattenMatches(rawBody) {
  const value = rawBody && rawBody.value;
  const buckets = value && Array.isArray(value.matchInfoList) ? value.matchInfoList : [];
  const matches = [];
  for (const bucket of buckets) {
    const subs = Array.isArray(bucket.subMatchList) ? bucket.subMatchList : [];
    for (const m of subs) {
      matches.push(toMatch(m));
    }
  }
  return matches;
}

function filterByDate(matches, date) {
  return matches.filter((m) => m.matchDate === date);
}

async function getOddsByDate(date) {
  const body = await fetchRaw();
  const all = flattenMatches(body);
  return {
    date,
    total: all.filter((m) => m.matchDate === date).length,
    matches: all.filter((m) => m.matchDate === date)
  };
}

async function getOddsAll(pools) {
  const body = await fetchRaw(pools);
  return {
    total: flattenMatches(body).length,
    matches: flattenMatches(body)
  };
}

module.exports = {
  flattenMatches,
  filterByDate,
  getOddsByDate,
  getOddsAll,
  toMatch
};
