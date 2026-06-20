/**
 * getFixedBonusV1 raw -> 标准化「官方中奖结果」。
 *
 * 把官方 matchResultList 的机器码翻译成本项目 utils/picks 用的 pick 词汇，
 * 这样结算时能直接和我们自算的命中比对。
 *
 * 官方组合码：
 *   HAD/HHAD: combination = H/D/A           -> 主胜/平/客胜
 *   CRS:      combination = "1:0" / "-1:H"   -> "1:0" / 胜其它
 *             ("-1:H"/"-1:D"/"-1:A" 是其它比分的胜/平/负，对应 raw 的 s-1sh/s-1sd/s-1sa)
 *   TTG:      combination = "0".."7"         -> "0".."6" / "7+"
 *   HAFU:     combination = "D:H" (半:全)     -> 平主  (H主 D平 A客)
 *
 * 输出：
 *   {
 *     matchId, isCancel, fullScore,
 *     results: {
 *       had:  { pick: "主胜", odds: 1.94, refundStatus: "0" },
 *       hhad: { pick: "平",  odds: 3.32, goalLine: -1, refundStatus: "0" },
 *       crs:  { pick: "1:0", odds: 7.00, ... },
 *       ttg:  { pick: "1",   odds: 4.35, ... },
 *       hafu: { pick: "平主", odds: 4.70, ... }
 *     }
 *   }
 */

const WDL = { H: '主胜', D: '平', A: '客胜' };
const HAFU_LETTER = { H: '主', D: '平', A: '客' };

function parseScore(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d+)\s*:\s*(\d+)$/);
  return m ? { h: Number(m[1]), a: Number(m[2]) } : null;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// CRS 官方组合 -> 我们的 pick
function crsPickFromCombination(comb) {
  const t = String(comb || '').trim();
  // 其它比分： "-1:H" / "-1:D" / "-1:A"
  const other = t.match(/^-1\s*:\s*([HDA])$/i);
  if (other) {
    const k = other[1].toUpperCase();
    return k === 'H' ? '胜其它' : k === 'D' ? '平其它' : '负其它';
  }
  const sm = t.match(/^(\d+)\s*:\s*(\d+)$/);
  if (sm) return `${Number(sm[1])}:${Number(sm[2])}`;
  return t;
}

// TTG 官方组合 -> 我们的 pick（7 视为 7+）
function ttgPickFromCombination(comb) {
  const t = String(comb || '').trim();
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return n >= 7 ? '7+' : String(n);
}

// HAFU 官方组合 "D:H" -> "平主"
function hafuPickFromCombination(comb) {
  const t = String(comb || '').trim().toUpperCase();
  const m = t.match(/^([HDA])\s*:\s*([HDA])$/);
  if (!m) return t;
  return HAFU_LETTER[m[1]] + HAFU_LETTER[m[2]];
}

function pickFromResultItem(item) {
  const code = String(item.code || '').toUpperCase();
  const comb = item.combination;
  if (code === 'HAD' || code === 'HHAD') return WDL[String(comb || '').toUpperCase()] || null;
  if (code === 'CRS') return crsPickFromCombination(comb);
  if (code === 'TTG') return ttgPickFromCombination(comb);
  if (code === 'HAFU') return hafuPickFromCombination(comb);
  return null;
}

function normalizeBonus(rawBody) {
  const v = rawBody && rawBody.value;
  if (!v) return null;
  const list = Array.isArray(v.matchResultList) ? v.matchResultList : [];
  const results = {};
  for (const item of list) {
    const code = String(item.code || '').toLowerCase();
    if (!code) continue;
    results[code] = {
      pick: pickFromResultItem(item),
      combination: item.combination,
      combinationDesc: item.combinationDesc,
      odds: toNum(item.odds),
      goalLine: item.goalLine !== '' && item.goalLine != null ? toNum(item.goalLine) : null,
      refundStatus: item.refundStatus
    };
  }
  return {
    matchId: list[0] ? list[0].matchId : (v.oddsHistory && v.oddsHistory.matchId) || null,
    isCancel: v.isCancel === 1 || v.isCancel === '1',
    fullScore: parseScore(v.sectionsNo999),
    results
  };
}

module.exports = {
  normalizeBonus,
  crsPickFromCombination,
  ttgPickFromCombination,
  hafuPickFromCombination
};
