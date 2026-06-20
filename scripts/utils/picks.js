/**
 * 玩法(playType) + 选项(pick) 的统一语义。
 *
 * betService 用它「按 pick 取冻结赔率」，settleService 用它「按 pick 判命中」，
 * 两边共用同一套规则，避免规则漂移。
 *
 * 支持玩法：
 *   had   胜负平        pick: 主胜 / 平 / 客胜
 *   hhad  让球胜负平     pick: 主胜 / 平 / 客胜   （带 handicap）
 *   crs   比分          pick: "2:1" / 胜其它 / 平其它 / 负其它
 *   ttg   总进球        pick: "0".."6" / "7+"
 *   hafu  半全场        pick: 主主/主平/主客/平主/平平/平客/客主/客平/客客
 */

// 玩法别名 -> 标准 code
const TYPE_ALIAS = {
  had: 'had',
  winner: 'had', // winner 按主客胜负平等价 had
  hhad: 'hhad',
  crs: 'crs',
  score: 'crs', // 旧字段
  ttg: 'ttg',
  hafu: 'hafu'
};

const VALID_TYPES = new Set(['had', 'hhad', 'crs', 'ttg', 'hafu']);

function normType(type) {
  return TYPE_ALIAS[String(type || '').toLowerCase()] || null;
}

// 胜负平三选一：主胜/平/客胜 -> 'win'/'draw'/'lose'
function parseWdlSide(pick) {
  const t = String(pick || '').trim();
  if (!t) return null;
  if (t.includes('主胜') || t === '主' || t === '胜' || t === '3') return 'win';
  if (t.includes('客胜') || t.includes('主负') || t === '客' || t === '负' || t === '0') return 'lose';
  if (t.includes('平') || t === '1' || t === '和') return 'draw';
  return null;
}

// crs 比分 pick 规范化："2 : 1" -> "2:1"；其它比分原样
function normCrsPick(pick) {
  const t = String(pick || '').trim();
  const m = t.match(/^(\d+)\s*:\s*(\d+)$/);
  if (m) return `${Number(m[1])}:${Number(m[2])}`;
  if (t === '胜其它' || t === '平其它' || t === '负其它') return t;
  return t; // 容错：原样返回，命中时再判
}

// ttg pick 规范化：7/8/9.. -> "7+"，0..6 -> 数字字符串
function normTtgPick(pick) {
  const t = String(pick || '').trim();
  if (t === '7+' || t === '7') return '7+';
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return n >= 7 ? '7+' : String(n);
}

// hafu pick 规范化：支持 "主主" 或字母 "hh"
const HAFU_LETTER = { h: '主', d: '平', a: '客' };
const HAFU_SET = new Set(['主主', '主平', '主客', '平主', '平平', '平客', '客主', '客平', '客客']);
function normHafuPick(pick) {
  const t = String(pick || '').trim();
  if (HAFU_SET.has(t)) return t;
  const low = t.toLowerCase();
  if (/^[hda]{2}$/.test(low)) return HAFU_LETTER[low[0]] + HAFU_LETTER[low[1]];
  // 数字写法 33/31/30/.. (3主1平0客 老体彩习惯) — 3=主 1=平 0=客
  const numMap = { 3: '主', 1: '平', 0: '客' };
  if (/^[310]{2}$/.test(t)) return numMap[t[0]] + numMap[t[1]];
  return null;
}

/**
 * 按 pick 从标准化 odds 取冻结赔率。取不到返回 null。
 * odds: oddsService.toMatch 产出的 { had, hhad, crs, ttg, hafu }
 */
function lookupOdds(odds, type, pick) {
  const t = normType(type);
  if (!t || !odds) return null;

  if (t === 'had' || t === 'hhad') {
    const block = odds[t];
    if (!block) return null;
    const side = parseWdlSide(pick);
    if (side === 'win') return num(block.win);
    if (side === 'draw') return num(block.draw);
    if (side === 'lose') return num(block.lose);
    return null;
  }
  if (t === 'crs') {
    if (!odds.crs) return null;
    return num(odds.crs[normCrsPick(pick)]);
  }
  if (t === 'ttg') {
    if (!odds.ttg) return null;
    const key = normTtgPick(pick);
    return key == null ? null : num(odds.ttg[key]);
  }
  if (t === 'hafu') {
    if (!odds.hafu) return null;
    const key = normHafuPick(pick);
    return key == null ? null : num(odds.hafu[key]);
  }
  return null;
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 判命中。actual = resultNormalizer 标准化赛果：
 *   { halfScore:{h,a}, fullScore:{h,a}, winFlag, goalLine, status }
 * handicap：让球数（hhad 用），优先取 actual.goalLine。
 * specificScores：该场「已列具体比分」集合（判 crs 其它比分用）。
 */
function isHit(type, pick, actual, opts = {}) {
  const t = normType(type);
  if (!t || !actual || actual.status !== 'final') return false;
  const full = actual.fullScore;
  if (!full) return false;
  const fh = full.h;
  const fa = full.a;

  if (t === 'had') {
    const side = parseWdlSide(pick);
    if (side === 'win') return fh > fa;
    if (side === 'draw') return fh === fa;
    if (side === 'lose') return fh < fa;
    return false;
  }

  if (t === 'hhad') {
    const hc = opts.handicap != null ? Number(opts.handicap)
      : (actual.goalLine != null ? Number(actual.goalLine) : 0);
    const adjH = fh + (Number.isFinite(hc) ? hc : 0);
    const side = parseWdlSide(pick);
    if (side === 'win') return adjH > fa;
    if (side === 'draw') return adjH === fa;
    if (side === 'lose') return adjH < fa;
    return false;
  }

  if (t === 'crs') {
    const p = normCrsPick(pick);
    // 其它比分
    if (p === '胜其它' || p === '平其它' || p === '负其它') {
      const specific = opts.specificScores; // Set<"h:a"> 已单列的具体比分
      const key = `${fh}:${fa}`;
      const inList = specific ? specific.has(key) : false;
      if (inList) return false; // 命中的是具体比分档，不是其它
      if (p === '胜其它') return fh > fa;
      if (p === '平其它') return fh === fa;
      if (p === '负其它') return fh < fa;
      return false;
    }
    const m = p.match(/^(\d+):(\d+)$/);
    if (!m) return false;
    return Number(m[1]) === fh && Number(m[2]) === fa;
  }

  if (t === 'ttg') {
    const key = normTtgPick(pick);
    if (key == null) return false;
    const total = fh + fa;
    if (key === '7+') return total >= 7;
    return total === Number(key);
  }

  if (t === 'hafu') {
    const half = actual.halfScore;
    if (!half) return false;
    const wantKey = normHafuPick(pick);
    if (!wantKey) return false;
    const halfSide = wdl(half.h, half.a); // 主/平/客
    const fullSide = wdl(fh, fa);
    return (halfSide + fullSide) === wantKey;
  }

  return false;
}

function wdl(h, a) {
  if (h > a) return '主';
  if (h < a) return '客';
  return '平';
}

/**
 * 判「进行中是否已确定死」——以当前比分为起点，剩余比赛无论怎么踢都不可能再中。
 *
 * 与 isHit 是不同语义：isHit 问「终场是否中」，isDead 问「进行中是否已无可能中」。
 * 绝不能拿 isHit 套当前比分反推（had 主胜 0:1 还能扳平绝杀，不是死）。
 *
 * 只对「数学上能确定死」的玩法判死，其余一律返回 false（维持 pending，不误判）：
 *   ttg 具体数 N   已进球数 > N -> 死（进球不会变少）
 *   crs 具体比分    任一方已超过目标比分 -> 死
 *   hafu          半场已结束且半场方向 ≠ pick 首字 -> 死（前半段已错，整场必不中）
 *
 * live: liveNormalizer 标准化 { liveScore:{h,a}, halfScore, hasHalfEnded, status }
 * 拿不到所需数据时返回 false（不判死）。
 */
function isDead(type, pick, live) {
  const t = normType(type);
  if (!t || !live) return false;
  const score = live.liveScore;

  if (t === 'ttg') {
    if (!score) return false;
    const key = normTtgPick(pick);
    if (key == null || key === '7+') return false; // 7+ 永远还有希望
    const target = Number(key);
    return (score.h + score.a) > target;
  }

  if (t === 'crs') {
    if (!score) return false;
    const p = normCrsPick(pick);
    const m = p.match(/^(\d+):(\d+)$/);
    if (!m) return false; // 胜其它/平其它/负其它：结果域太大，进行中不判死
    return score.h > Number(m[1]) || score.a > Number(m[2]);
  }

  if (t === 'hafu') {
    if (!live.hasHalfEnded || !live.halfScore) return false;
    const wantKey = normHafuPick(pick);
    if (!wantKey) return false;
    const halfSide = wdl(live.halfScore.h, live.halfScore.a);
    return halfSide !== wantKey[0]; // 半场方向与 pick 首字不符 -> 整场必不中
  }

  // had / hhad：领先可被扳平、平可被打破，终场前不判死
  return false;
}

module.exports = {
  VALID_TYPES,
  normType,
  parseWdlSide,
  normCrsPick,
  normTtgPick,
  normHafuPick,
  lookupOdds,
  isHit,
  isDead
};
