/**
 * 对账（settlement）服务。
 *
 * 入口：POST /worldcup/result  { "date": "YYYY-MM-DD" }
 *
 * 行为：
 *   1. 读 data/bets/<date>/ 下所有 ticket_*.json
 *   2. 拉体彩赛果接口（getUniformMatchResultV1，含半全场 + winFlag + goalLine）
 *   3. 对每张票的每个 selection：
 *      - 按 matchId / matchNum / 队名 定位赛果
 *      - 用 utils/picks.isHit 判命中（had/hhad/crs(含其它比分)/ttg/hafu 全支持）
 *   4. 按 mode 结算：
 *      single：每项独立。payout=Σ(hit_i ? amount_i×odds_i : 0)；isHit=任一项命中
 *      parlay：全中才派彩。payout=allHit ? amount×Π(odds) : 0；isHit=全中
 *   5. 返回赛果 + 每票每项明细 + 汇总
 *
 * 跨场串关：一张 parlay 票的 selections 可能分属不同比赛日，赛果按各 selection
 * 自己的 date 去 getResultsByDate 取，再做并集索引。
 */

const path = require('path');
const fs = require('fs');
const { DATA_DIR, RESULT_VERIFY } = require('../config');
const { isValidDate } = require('../utils/dateUtil');
const { getResultsByDate, findResultForTicket } = require('./resultService');
const { loadOfficialResults, verifySelection } = require('./verifyService');
const { fetchLiveRaw } = require('./liveClient');
const { flattenLive } = require('../utils/liveNormalizer');
const { isHit, isDead } = require('../utils/picks');
const { round2, round4, capPayout } = require('../utils/money');

function ticketDir(date) {
  return path.join(DATA_DIR, 'bets', date);
}

function readTickets(date) {
  const dir = ticketDir(date);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /^ticket_.+\.json$/.test(f));
  const tickets = [];
  for (const f of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      if (parsed && parsed.ticketId) tickets.push(parsed);
    } catch (_) { /* skip broken file */ }
  }
  return tickets;
}

// 收集一批票里所有 selection 涉及的比赛日，分别拉赛果，建一个并集列表。
async function loadResultsForTickets(tickets, fallbackDate) {
  const dates = new Set();
  for (const t of tickets) {
    for (const s of t.selections || []) {
      if (s.date) dates.add(s.date);
      else if (s.match && s.match.matchDate) dates.add(s.match.matchDate);
    }
  }
  if (dates.size === 0 && fallbackDate) dates.add(fallbackDate);

  const all = [];
  const seen = new Set();
  for (const d of dates) {
    let list = [];
    try {
      list = await getResultsByDate(d);
    } catch (_) { list = []; }
    for (const r of list) {
      const key = r.matchId != null ? `id:${r.matchId}` : `${r.matchDate}|${r.home}|${r.away}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(r);
    }
  }
  return all;
}

function settleSelection(sel, results) {
  const actual = findResultForTicket(results, sel.match);
  const specificScores = Array.isArray(sel.specificScores) ? new Set(sel.specificScores) : null;
  const hit = actual ? isHit(sel.playType, sel.pick, actual, {
    handicap: sel.handicap,
    specificScores
  }) : false;

  return {
    selection: {
      date: sel.date,
      teams: sel.teams,
      playType: sel.playType,
      pick: sel.pick,
      odds: sel.odds,
      amount: sel.amount,
      handicap: sel.handicap ?? null
    },
    match: sel.match && {
      matchNum: sel.match.matchNum,
      matchId: sel.match.matchId,
      matchDate: sel.match.matchDate,
      home: sel.match.home,
      away: sel.match.away
    },
    actual: actual && {
      matchId: actual.matchId,
      home: actual.home,
      away: actual.away,
      halfScore: actual.halfScore,
      fullScore: actual.fullScore,
      winFlag: actual.winFlag,
      goalLine: actual.goalLine,
      status: actual.status
    },
    hit,
    settled: Boolean(actual && actual.status === 'final')
  };
}

function settleTicket(ticket, results, liveResults = []) {
  const mode = ticket.mode === 'single' ? 'single' : 'parlay';
  const selections = Array.isArray(ticket.selections) ? ticket.selections : [];
  const resolved = selections.map((s) => settleSelection(s, results));

  const settledCount = resolved.filter((r) => r.settled).length;
  const allSettled = resolved.length > 0 && settledCount === resolved.length;
  // 票级状态：pending=都没开赛 / partial=部分开赛 / settled=全部已开奖
  const status = settledCount === 0 ? 'pending' : (allSettled ? 'settled' : 'partial');

  let payout = 0;
  let isHitTicket = false;
  let totalAmount = 0;
  let capped = false;

  // 串关死活：任一「已开奖」的关没中 -> 整串已死（不可能再中，payout 锁定 0）。
  // 进行中的关：用 live 比分判「数学上已不可能再中」也算死（只判死，不动 payout）。
  //   alive=false 已死 / alive=true 还活着(已开的关全中，含已全中已派彩) / single 不适用=null
  let alive = null;
  let deadLegs = [];
  if (mode === 'parlay') {
    // 1) 已结算且没中的关（终场判死）
    const finalDead = resolved
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.settled && !r.hit)
      .map(({ r, i }) => ({
        index: i,
        teams: r.selection.teams,
        playType: r.selection.playType,
        pick: r.selection.pick,
        source: 'final'
      }));
    // 2) 未结算但 live 比分已确定不可能再中的关（进行中提前判死）
    const liveDead = [];
    for (let i = 0; i < resolved.length; i += 1) {
      const r = resolved[i];
      if (r.settled) continue; // 已结算的归 finalDead 管
      const live = liveResults.length ? findResultForTicket(liveResults, r.match) : null;
      const sel = selections[i];
      if (live && isDead(sel.playType, sel.pick, live)) {
        liveDead.push({
          index: i,
          teams: r.selection.teams,
          playType: r.selection.playType,
          pick: r.selection.pick,
          source: 'live',
          liveScore: live.liveScore
        });
      }
    }
    deadLegs = finalDead.concat(liveDead);
    alive = deadLegs.length === 0;
  }

  if (mode === 'single') {
    // single：每项独立、每项一注，逐项封顶；部分中也算中
    for (const r of resolved) {
      const amt = Number(r.selection.amount) || 0;
      totalAmount += amt;
      if (r.hit && r.selection.odds > 0) {
        const c = capPayout(amt * r.selection.odds);
        payout += c.value;
        if (c.capped) capped = true;
        isHitTicket = true;
      }
    }
    payout = round2(payout);
    totalAmount = round2(totalAmount);
  } else {
    // parlay：全部已开奖且全中才派彩；整票一注，整票封顶
    totalAmount = round2(Number(ticket.amount) || 0);
    const allHit = allSettled && resolved.every((r) => r.hit && r.selection.odds > 0);
    if (allHit) {
      let combined = 1;
      for (const r of resolved) combined *= r.selection.odds;
      const c = capPayout(totalAmount * round4(combined));
      payout = c.value;
      capped = c.capped;
      isHitTicket = true;
    }
  }

  // 待开奖（pending/partial 且尚未确定中奖）时，isHit/payout 仅为当前快照
  return {
    ticketId: ticket.ticketId,
    placedAt: ticket.placedAt,
    mode,
    status,
    settledCount,
    selectionCount: resolved.length,
    teams: resolved.map((r) => r.selection.teams),
    selections: resolved,
    totalAmount,
    payout,
    capped,
    isHit: isHitTicket,
    alive,        // 串关死活：false=已死 true=还活着/已中 null=single不适用
    deadLegs,     // 串关里已结算且没中的关（导致整串死亡的关）
    profit: round2(payout - totalAmount)
  };
}

// 判断是否值得拉 live：存在 parlay 票且至少有一关在 results 里还没终场。
// live 只服务串关提前判死活，single 不适用，全终场的票也不需要。
function shouldLoadLive(tickets, results) {
  for (const t of tickets) {
    if (t.mode === 'single') continue;
    const sels = Array.isArray(t.selections) ? t.selections : [];
    if (sels.length === 0) continue;
    const hasPending = sels.some((s) => {
      const actual = findResultForTicket(results, s.match);
      return !actual || actual.status !== 'final';
    });
    if (hasPending) return true;
  }
  return false;
}

// 拉 live 比分并标准化。失败/无意义时返回空数组（绝不让 live 拖垮结算）。
async function maybeLoadLive(tickets, results) {
  if (!shouldLoadLive(tickets, results)) return [];
  try {
    const raw = await fetchLiveRaw();
    return flattenLive(raw);
  } catch (_) {
    return [];
  }
}

async function settleByDate(date, opts = {}) {
  if (!date || !isValidDate(date)) {
    const e = new Error('date must be in YYYY-MM-DD format');
    e.statusCode = 400;
    throw e;
  }

  const tickets = readTickets(date);
  const results = await loadResultsForTickets(tickets, date);
  const dailyActualMatches = results.filter((r) => r.matchDate === date);

  // 只有当存在「parlay 且有未结算关」的票时才拉 live（省一次请求）。
  // live 仅用来给串关提前判死活，拉取失败不影响结算主流程。
  const liveResults = await maybeLoadLive(tickets, results);

  const settled = tickets.map((t) => settleTicket(t, results, liveResults));

  // 可选：用 getFixedBonusV1 官方结果交叉校验（默认关）
  const doVerify = opts.verify != null ? opts.verify : String(RESULT_VERIFY) === '1';
  let verifySummary;
  if (doVerify) {
    verifySummary = await attachOfficialVerification(settled);
  }

  const totalAmount = round2(settled.reduce((s, r) => s + r.totalAmount, 0));
  const totalPayout = round2(settled.reduce((s, r) => s + r.payout, 0));
  const totalProfit = round2(totalPayout - totalAmount);
  const hitCount = settled.filter((r) => r.isHit).length;
  const statusCount = {
    settled: settled.filter((r) => r.status === 'settled').length,
    partial: settled.filter((r) => r.status === 'partial').length,
    pending: settled.filter((r) => r.status === 'pending').length
  };

  return {
    date,
    summarizedAt: new Date().toISOString(),
    ticketCount: settled.length,
    hitCount,
    statusCount,
    totalAmount,
    totalPayout,
    totalProfit,
    verify: verifySummary,
    dailyActualMatches,
    tickets: settled
  };
}

/**
 * 给已结算的票附官方校验信息（就地修改 settled 里每个 selection 的 verify 字段）。
 * 返回汇总：检查了多少选项、几个一致、几个不一致、几个无数据。
 */
async function attachOfficialVerification(settledTickets) {
  const matchIds = [];
  for (const t of settledTickets) {
    for (const s of t.selections) {
      if (s.match && s.match.matchId != null) matchIds.push(s.match.matchId);
    }
  }
  const official = await loadOfficialResults(matchIds);

  let checked = 0;
  let agree = 0;
  let disagree = 0;
  let unavailable = 0;
  const mismatches = [];

  for (const t of settledTickets) {
    for (const s of t.selections) {
      const mid = s.match && s.match.matchId != null ? String(s.match.matchId) : null;
      const v = verifySelection(s, mid ? official.get(mid) : null);
      s.verify = v;
      if (!v.available) { unavailable += 1; continue; }
      if (v.agree === true) { checked += 1; agree += 1; }
      else if (v.agree === false) {
        checked += 1;
        disagree += 1;
        mismatches.push({
          ticketId: t.ticketId,
          matchId: mid,
          playType: s.selection.playType,
          pick: s.selection.pick,
          ourHit: s.hit,
          officialPick: v.official && v.official.pick
        });
      }
    }
  }

  return {
    enabled: true,
    checked,
    agree,
    disagree,
    unavailable,
    mismatches
  };
}

module.exports = {
  settleByDate,
  settleTicket,
  readTickets
};
