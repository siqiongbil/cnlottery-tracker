/**
 * 总盈亏统计：跨日期汇总所有票的投入 / 返奖 / 盈亏，并给逐项明细。
 *
 * GET /worldcup/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   不传 from/to：统计 data/bets 下所有已落盘日期。
 *
 * 复用 settleByDate（每天结算一次），汇总：
 *   - 总投入 / 总返奖 / 总盈亏 / 命中票数
 *   - 按玩法(playType) 分组的盈亏
 *   - flat 明细：每个选项哪场、什么玩法、pick、赔率、命中、盈亏
 */
const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('../config');
const { isValidDate } = require('../utils/dateUtil');
const { settleByDate } = require('./settleService');
const { round2 } = require('../utils/money');

function betsRoot() {
  return path.join(DATA_DIR, 'bets');
}

// 列出 data/bets 下所有形如 YYYY-MM-DD 且含票据的日期
function listBetDates() {
  const root = betsRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => {
      const dir = path.join(root, d);
      try {
        return fs.statSync(dir).isDirectory()
          && fs.readdirSync(dir).some((f) => /^ticket_.+\.json$/.test(f));
      } catch (_) {
        return false;
      }
    })
    .sort();
}

function inRange(d, from, to) {
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

async function getStats(opts = {}) {
  const { from, to } = opts;
  if (from && !isValidDate(from)) {
    const e = new Error('from must be in YYYY-MM-DD format');
    e.statusCode = 400;
    throw e;
  }
  if (to && !isValidDate(to)) {
    const e = new Error('to must be in YYYY-MM-DD format');
    e.statusCode = 400;
    throw e;
  }

  const dates = listBetDates().filter((d) => inRange(d, from, to));

  let totalAmount = 0;
  let totalPayout = 0;
  let ticketCount = 0;
  let hitCount = 0;
  const statusCount = { settled: 0, partial: 0, pending: 0 };
  const byPlayType = {}; // playType -> { amount, payout, profit, count, hit }
  const details = []; // 逐选项明细
  const byDate = []; // 每日小计

  for (const date of dates) {
    const day = await settleByDate(date, { verify: false });
    totalAmount += day.totalAmount;
    totalPayout += day.totalPayout;
    ticketCount += day.ticketCount;
    hitCount += day.hitCount;
    if (day.statusCount) {
      statusCount.settled += day.statusCount.settled || 0;
      statusCount.partial += day.statusCount.partial || 0;
      statusCount.pending += day.statusCount.pending || 0;
    }

    byDate.push({
      date,
      ticketCount: day.ticketCount,
      totalAmount: day.totalAmount,
      totalPayout: day.totalPayout,
      totalProfit: day.totalProfit
    });

    for (const t of day.tickets) {
      for (const s of t.selections) {
        const pt = s.selection.playType;
        if (!byPlayType[pt]) byPlayType[pt] = { amount: 0, payout: 0, profit: 0, count: 0, hit: 0 };
        const g = byPlayType[pt];
        g.count += 1;
        if (s.hit) g.hit += 1;

        // 选项级盈亏：single 各项独立可算；parlay 选项不单独派彩，盈亏归到票级，明细只标注 hit
        let selAmount = null;
        let selPayout = null;
        let selProfit = null;
        if (t.mode === 'single') {
          selAmount = Number(s.selection.amount) || 0;
          selPayout = s.hit && s.selection.odds > 0 ? round2(selAmount * s.selection.odds) : 0;
          selProfit = round2(selPayout - selAmount);
          g.amount += selAmount;
          g.payout += selPayout;
          g.profit += selProfit;
        }

        details.push({
          date,
          ticketId: t.ticketId,
          mode: t.mode,
          ticketStatus: t.status,
          match: s.match ? `${teamName(s.match.home)} vs ${teamName(s.match.away)}` : '',
          matchNum: s.match ? s.match.matchNum : '',
          playType: pt,
          pick: s.selection.pick,
          odds: s.selection.odds,
          amount: selAmount,
          hit: s.hit,
          settled: s.settled,
          payout: selPayout,
          profit: selProfit
        });
      }
    }
  }

  // 收尾四舍五入
  for (const k of Object.keys(byPlayType)) {
    const g = byPlayType[k];
    g.amount = round2(g.amount);
    g.payout = round2(g.payout);
    g.profit = round2(g.profit);
  }

  return {
    range: { from: from || (dates[0] || null), to: to || (dates[dates.length - 1] || null) },
    dateCount: dates.length,
    ticketCount,
    hitCount,
    statusCount,
    totalAmount: round2(totalAmount),
    totalPayout: round2(totalPayout),
    totalProfit: round2(totalPayout - totalAmount),
    byPlayType,
    byDate,
    details
  };
}

function teamName(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  return t.name || '';
}

module.exports = { getStats, listBetDates };
