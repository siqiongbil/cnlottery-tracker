/**
 * 落票接口：POST /worldcup/bets
 *
 * 输入：
 *   {
 *     "mode": "single" | "parlay",          // 单 / 串；不传按 selections.length 推断
 *     "amount": 2,                           // parlay=整票注额; single=各选项默认注额(可被覆盖)
 *     "selections": [
 *       {
 *         "date": "2026-06-20",
 *         "teams": ["美国", "澳大利亚"],      // 1 或 2 个队名，定位比赛
 *         "matchId": 2040239,                // 可选；直接指定比赛(出窗口/重名时最稳)
 *         "playType": "had",                 // had/hhad/crs/ttg/hafu
 *         "pick": "主胜",                     // 见 utils/picks.js
 *         "amount": 10,                      // 可选(single 用); 不传用票级 amount
 *         "odds": 1.45                       // 可选; 缺省时按当时体彩快照补并冻结
 *       }
 *     ]
 *   }
 *
 * 计算：
 *   single：每选项独立。combinedOdds=null；theoreticalPayout=Σ(amount_i × odds_i)
 *   parlay：联合。combinedOdds=Π(odds)；theoreticalPayout=amount × combinedOdds
 *
 * 落盘：data/bets/<date>/ticket_<id>.json  +  index.json
 *   <date> 取首个 selection 的 date（票级归档日）。整段体彩 raw 落盘防赔率消失。
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { DATA_DIR } = require('../config');
const { fetchRaw } = require('./oddsClient');
const { flattenMatches } = require('./oddsService');
const { closingOddsTable } = require('./oddsHistoryService');
const { locateOutOfWindow } = require('./matchLocator');
const { isValidDate, normalizeAsOf } = require('../utils/dateUtil');
const { normType, lookupOdds } = require('../utils/picks');
const { round2, round4, capPayout } = require('../utils/money');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ticketId(date) {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const rand = crypto.randomBytes(3).toString('hex');
  return `ticket_${date.replace(/-/g, '')}_${ts}_${rand}`;
}

function ticketDir(date) {
  return path.join(DATA_DIR, 'bets', date);
}

function validateSelections(selections) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw httpErr('selections must be a non-empty array', 400);
  }
  for (const s of selections) {
    if (!s || typeof s !== 'object') throw httpErr('each selection must be an object', 400);
    if (!normType(s.playType)) throw httpErr(`unsupported playType: ${s.playType}`, 400);
    if (!s.pick) throw httpErr('pick is required', 400);
    if (!s.date || !isValidDate(s.date)) throw httpErr(`selection.date must be YYYY-MM-DD: ${s.date}`, 400);
    const teamList = toTeamList(s.teams);
    if (teamList.length === 0) throw httpErr('selection.teams is required', 400);
  }
}

function toTeamList(teams) {
  if (Array.isArray(teams)) return teams.map((s) => String(s || '').trim()).filter(Boolean);
  return String(teams || '').split(/[,，/|]/).map((s) => s.trim()).filter(Boolean);
}

function httpErr(msg, code) {
  const e = new Error(msg);
  e.statusCode = code;
  return e;
}

// 收集某场比赛「已列具体比分」集合，落盘以便结算判定 crs 其它比分。
// match.odds 缺失（出窗口比赛）时，回退用历史接口取到的 crs 表。
function specificScoreKeys(match, fallbackCrs) {
  const crs = (match && match.odds && match.odds.crs) || fallbackCrs;
  if (!crs) return [];
  return Object.keys(crs).filter((k) => /^\d+:\d+$/.test(k));
}

// 规整 asOf：接受 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm:ss'（见 utils/dateUtil.normalizeAsOf）

function hashBody(body) {
  try {
    return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  } catch (_) {
    return '';
  }
}

// 票面指纹：mode + 每个选项(matchId|date|teams|playType|pick) — 用于重复落票检测
function ticketFingerprint(mode, resolvedSelections) {
  const parts = resolvedSelections.map((s) => {
    const key = s.match.matchId != null ? `m${s.match.matchId}` : `${s.date}|${s.teams.join('+')}`;
    return `${key}|${s.playType}|${s.pick}`;
  });
  parts.sort();
  return crypto.createHash('sha256').update(`${mode}::${parts.join('::')}`).digest('hex').slice(0, 16);
}

function appendIndex(date, summary) {
  const dir = ticketDir(date);
  ensureDir(dir);
  const indexPath = path.join(dir, 'index.json');
  let arr = [];
  if (fs.existsSync(indexPath)) {
    try {
      arr = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      if (!Array.isArray(arr)) arr = [];
    } catch (_) {
      arr = [];
    }
  }
  arr.push(summary);
  // 原子写：先写临时文件再 rename，避免写到一半被中断/并发读到坏 JSON。
  // 注：仍有读-改-写竞态（极并发下可能丢一条索引），但票据本身不丢，index 可由 ticket 文件重建。
  const tmp = path.join(dir, `.index.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
  fs.renameSync(tmp, indexPath);
}

// 在已落盘票据里找相同指纹（同一归档日内）
function findDuplicate(date, fingerprint) {
  const dir = ticketDir(date);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^ticket_.+\.json$/.test(f));
  for (const f of files) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      if (doc && doc.fingerprint === fingerprint) return doc.ticketId;
    } catch (_) { /* skip */ }
  }
  return null;
}

async function placeBet(payload = {}) {
  const { mode, amount, selections } = payload;

  validateSelections(selections);

  const inferredMode = (mode === 'single' || mode === 'parlay')
    ? mode
    : (selections.length === 1 ? 'single' : 'parlay');

  const ticketAmount = Number.isFinite(Number(amount)) && Number(amount) > 0 ? round2(Number(amount)) : 2;

  // 票级 asOf：买票时间。选项可各自覆盖。传了就按那个时点的历史赔率冻结。
  const ticketAsOf = normalizeAsOf(payload.asOf);

  // 1. 拉一次体彩 raw（滚动窗口，全玩法一次拿）
  const rawBody = await fetchRaw();

  // 2. 每个选项定位比赛 + 冻结赔率
  const resolved = [];
  for (const s of selections) {
    const teamList = toTeamList(s.teams);
    // 1) 先在滚动窗口里按 matchId(若用户给了) 或 队名+日期定位
    let match = findInWindowSync(s.date, teamList, rawBody, s.matchId);
    // 2) 滚动窗口 miss（比赛已出窗口）→ 回退赛程列表/赛果接口反查 matchId
    if (!match) {
      match = await locateOutOfWindow(s.date, teamList);
    }
    if (!match) {
      throw httpErr(`match not found for ${teamList.join('/')} on ${s.date}`, 404);
    }

    const t = normType(s.playType);
    const selAsOf = normalizeAsOf(s.asOf) || ticketAsOf;

    const userOdds = Number(s.odds);
    const provided = Number.isFinite(userOdds) && userOdds > 0;
    let odds = provided ? userOdds : null;
    let oddsSource = provided ? 'user' : null;
    let oddsAt = null;
    let histTable = null; // 历史接口取到的赔率表（出窗口比赛补 specificScores 用）
    // 让球默认取实时快照
    let handicap = t === 'hhad' && match.odds && match.odds.hhad
      ? (match.odds.hhad.handicap != null ? match.odds.hhad.handicap : null)
      : null;

    // 优先级：用户传的 odds > asOf 历史赔率 > 落盘当下快照 > 历史最新收盘（出窗口比赛兜底）
    if (!provided && selAsOf && match.matchId != null) {
      const hist = await closingOddsTable(match.matchId, selAsOf);
      if (hist) histTable = hist;
      const histOdds = hist && lookupOdds(hist.odds, t, s.pick);
      if (histOdds != null) {
        odds = histOdds;
        oddsSource = 'history';
        oddsAt = hist.at[t] || null;
        if (t === 'hhad' && hist.handicap != null) handicap = hist.handicap;
      }
    }
    if (!provided && odds == null) {
      const live = lookupOdds(match.odds, s.playType, s.pick);
      if (live != null) {
        odds = live;
        oddsSource = 'snapshot';
      }
    }
    // 滚动窗口已无此比赛（出窗口）且未指定 asOf：用历史接口取全程最新收盘价
    if (!provided && odds == null && match.matchId != null) {
      const hist = await closingOddsTable(match.matchId); // 不传 asOf = 最新
      if (hist) histTable = hist;
      const histOdds = hist && lookupOdds(hist.odds, t, s.pick);
      if (histOdds != null) {
        odds = histOdds;
        oddsSource = 'history';
        oddsAt = hist.at[t] || null;
        if (t === 'hhad' && hist.handicap != null) handicap = hist.handicap;
      }
    }

    const selAmount = Number.isFinite(Number(s.amount)) && Number(s.amount) > 0
      ? round2(Number(s.amount))
      : ticketAmount;

    resolved.push({
      date: s.date,
      teams: teamList,
      playType: t,
      pick: String(s.pick),
      odds: odds != null ? round2(odds) : null,
      oddsSource,
      oddsAsOf: selAsOf || null,
      oddsAt,
      handicap,
      amount: selAmount,
      specificScores: specificScoreKeys(match, histTable && histTable.odds && histTable.odds.crs),
      match: {
        matchNum: match.matchNum,
        matchId: match.matchId,
        matchNumDate: match.matchNumDate,
        matchDate: match.matchDate,
        matchTime: match.matchTime,
        home: match.home,
        away: match.away,
        updateAt: match.updateAt
      }
    });
  }

  // 3. 计算
  const calc = computeCalc(inferredMode, ticketAmount, resolved);

  // 4. 归档日 = 首选项日期
  const archiveDate = resolved[0].date;
  const fingerprint = ticketFingerprint(inferredMode, resolved);

  const dup = findDuplicate(archiveDate, fingerprint);
  if (dup) {
    throw httpErr(`duplicate ticket already exists: ${dup}`, 409);
  }

  const id = ticketId(archiveDate);
  const dir = ticketDir(archiveDate);
  ensureDir(dir);

  const filedDoc = {
    ticketId: id,
    placedAt: new Date().toISOString(),
    mode: inferredMode,
    amount: ticketAmount,
    archiveDate,
    fingerprint,
    selections: resolved,
    calc,
    rawSnapshotHash: hashBody(rawBody),
    raw: rawBody
  };

  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(filedDoc, null, 2));

  appendIndex(archiveDate, {
    ticketId: id,
    placedAt: filedDoc.placedAt,
    mode: inferredMode,
    selectionCount: resolved.length,
    teams: resolved.map((s) => s.teams),
    totalAmount: calc.totalAmount,
    combinedOdds: calc.combinedOdds,
    theoreticalPayout: calc.theoreticalPayout
  });

  // 返回时不回传整段 raw（太大），其余照返
  const { raw, ...resp } = filedDoc;
  return resp;
}

function computeCalc(mode, ticketAmount, resolved) {
  if (mode === 'parlay') {
    let combined = 1;
    let priced = true;
    for (const s of resolved) {
      if (s.odds == null || s.odds <= 0) { priced = false; break; }
      combined *= s.odds;
    }
    combined = priced ? round4(combined) : null;
    let theoreticalPayout = null;
    let capped = false;
    if (combined != null) {
      const c = capPayout(ticketAmount * combined); // 整票 = 一注，整票封顶
      theoreticalPayout = c.value;
      capped = c.capped;
    }
    return {
      mode,
      totalAmount: ticketAmount,
      combinedOdds: combined,
      theoreticalPayout,
      capped
    };
  }
  // single：每项独立，每项 = 一注，逐项封顶
  const totalAmount = round2(resolved.reduce((sum, s) => sum + s.amount, 0));
  let theoreticalPayout = 0;
  let capped = false;
  for (const s of resolved) {
    if (s.odds == null || s.odds <= 0) continue;
    const c = capPayout(s.amount * s.odds);
    theoreticalPayout += c.value;
    if (c.capped) capped = true;
  }
  return {
    mode,
    totalAmount,
    combinedOdds: null,
    theoreticalPayout: round2(theoreticalPayout),
    capped
  };
}

// 在滚动窗口 raw 里定位比赛：优先 matchId（若提供），否则 date+队名。
function findInWindowSync(date, teams, rawBody, matchId) {
  const norm = (n) => String(n || '').trim().replace(/\s+/g, '').replace(/[队]$/g, '');
  const matches = flattenMatches(rawBody);
  if (matchId != null && matchId !== '') {
    const byId = matches.find((m) => m.matchId != null && String(m.matchId) === String(matchId));
    if (byId) return byId;
  }
  const list = teams.map(norm).filter(Boolean);
  const sameDay = matches.filter((m) => String(m.matchDate || '') === date);
  if (list.length === 1) {
    const one = list[0];
    return sameDay.find((m) => norm(m.home && m.home.name) === one || norm(m.away && m.away.name) === one) || null;
  }
  const [a, b] = list;
  return sameDay.find((m) => {
    const home = norm(m.home && m.home.name);
    const away = norm(m.away && m.away.name);
    return (home === a || away === a) && (home === b || away === b);
  }) || null;
}

module.exports = { placeBet, ticketDir, ticketId };
