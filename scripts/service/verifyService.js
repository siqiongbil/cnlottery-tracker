/**
 * 官方校验服务（可选）。
 *
 * 用 getFixedBonusV1 按 matchId 拉「官方中奖组合 + 派彩赔率」，
 * 给结算结果做交叉验证：把我们自算的命中(hit) 与官方中奖 pick 比对。
 *
 * 默认关闭（RESULT_VERIFY=1 开启）。开启时每个涉及的 matchId 发一次请求（有缓存）。
 */
const { fetchBonusRaw } = require('./bonusClient');
const { normalizeBonus } = require('../utils/bonusNormalizer');
const { normType } = require('../utils/picks');

/**
 * 批量拉一组 matchId 的官方结果，返回 Map<matchId(string), normalizedBonus>。
 * 单个 matchId 失败不影响其它（该场 verify 标记为 unavailable）。
 */
async function loadOfficialResults(matchIds) {
  const map = new Map();
  const ids = [...new Set(matchIds.filter((id) => id != null && id !== ''))];
  for (const id of ids) {
    try {
      const raw = await fetchBonusRaw(id);
      const n = normalizeBonus(raw);
      if (n) map.set(String(id), n);
    } catch (_) { /* 单场失败跳过 */ }
  }
  return map;
}

/**
 * 给单个结算选项附官方信息 + 比对结论。
 * settledSel: settleService.settleSelection 的产出（含 selection.playType/pick、hit）
 * official:   normalizeBonus 产出（可能为 undefined）
 */
function verifySelection(settledSel, official) {
  if (!official) {
    return { available: false };
  }
  if (official.isCancel) {
    return { available: true, isCancel: true, agree: null };
  }
  const t = normType(settledSel.selection.playType);
  const off = official.results && official.results[t];
  if (!off) {
    return { available: true, agree: null };
  }
  // 官方中奖 pick 与本选项 pick 是否一致 -> 该选项「应中」
  const officialHit = samePick(t, settledSel.selection.pick, off.pick);
  return {
    available: true,
    official: {
      pick: off.pick,
      odds: off.odds,
      goalLine: off.goalLine,
      refundStatus: off.refundStatus
    },
    officialHit,
    agree: officialHit === settledSel.hit
  };
}

// 用各玩法规范化后比较两个 pick 是否同一选项
const { normCrsPick, normTtgPick, normHafuPick, parseWdlSide } = require('../utils/picks');
function samePick(type, a, b) {
  if (a == null || b == null) return false;
  if (type === 'had' || type === 'hhad') return parseWdlSide(a) === parseWdlSide(b);
  if (type === 'crs') return normCrsPick(a) === normCrsPick(b);
  if (type === 'ttg') return normTtgPick(a) === normTtgPick(b);
  if (type === 'hafu') return normHafuPick(a) === normHafuPick(b);
  return String(a) === String(b);
}

module.exports = { loadOfficialResults, verifySelection };
