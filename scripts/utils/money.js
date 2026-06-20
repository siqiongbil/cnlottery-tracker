/**
 * 金额相关工具：四舍五入 + 单注奖金封顶。
 *
 * 体彩竞彩单注最高奖金封顶（默认 100 万/注，见 config.MAX_PAYOUT_PER_BET）。
 *   - single：每个选项 = 一注，逐项封顶
 *   - parlay：整票 = 一注，对整票封顶
 */
const { MAX_PAYOUT_PER_BET } = require('../config');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// 对单注派彩封顶。返回 { value, capped }。CAP<=0 表示不封顶。
function capPayout(raw) {
  const cap = Number(MAX_PAYOUT_PER_BET);
  if (!Number.isFinite(cap) || cap <= 0) return { value: round2(raw), capped: false };
  if (raw > cap) return { value: round2(cap), capped: true };
  return { value: round2(raw), capped: false };
}

module.exports = { round2, round4, capPayout, MAX_PAYOUT_PER_BET };
