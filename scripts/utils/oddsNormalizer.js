/**
 * 体彩 raw 数据 -> 标准化赔率。
 *
 * 对外统一字段：
 *   had:  { win, draw, lose }
 *   hhad: { handicap, win, draw, lose }
 *   hafu: { '主主','主平','主客','平主','平平','平客','客主','客平','客客' } — 半全场九宫格
 *   crs:  { '1:0':6.5, '2:1':8.0, '胜其它':45, '平其它':250, '负其它':250 } — 比分(含其它比分)
 *   ttg:  { 0:7.0, 1:4.5, ..., '7+':26 } — 总进球
 *
 * ---- 体彩真实字段 (实测 2026/06) ----
 *   crs:  s00s00=0:0, s01s00=1:0, s02s01=2:1 ... 形如 s{HH}s{AA}；
 *         s1sh=胜其它, s1sd=平其它, s1sa=负其它；后缀 f 是涨跌标记(忽略)
 *   ttg:  s0,s1,...,s7  (s7 当作 7+)
 *   hafu: hh,hd,ha,dh,dd,da,ah,ad,aa  (首字母=半场, 次字母=全场; h主 d平 a客)
 */

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function numOr(v, fallback) {
  const n = num(v);
  return n === null ? fallback : n;
}

function normalizeHad(raw) {
  if (!raw) return null;
  const h = num(raw.h), d = num(raw.d), a = num(raw.a);
  if (h === null && d === null && a === null) return null;
  return { win: numOr(h, 0), draw: numOr(d, 0), lose: numOr(a, 0) };
}

function normalizeHhad(raw) {
  if (!raw) return null;
  const h = num(raw.h), d = num(raw.d), a = num(raw.a);
  if (h === null && d === null && a === null) return null;
  let handicap = null;
  if (raw.goalLine !== undefined && raw.goalLine !== '') {
    handicap = Number(raw.goalLine);
    if (!Number.isFinite(handicap)) handicap = null;
  } else if (raw.goalLineValue) {
    handicap = Number(raw.goalLineValue);
  }
  return {
    handicap,
    win: numOr(h, 0),
    draw: numOr(d, 0),
    lose: numOr(a, 0)
  };
}

function readHandicap(raw) {
  if (!raw) return null;
  if (raw.goalLine !== undefined && raw.goalLine !== '') return String(raw.goalLine);
  if (raw.goalLineValue) return String(raw.goalLineValue);
  return null;
}

// CRS：体彩用 s{HH}s{AA} (例 s02s01 => 2:1) + s1sh/s1sd/s1sa (胜/平/负 其它)。
// 标准化为 { "2:1": 5.50, ..., "胜其它": 45, "平其它": 250, "负其它": 250 }。
const CRS_SCORE_RE = /^s(\d{2})s(\d{2})$/;
const CRS_OTHER = {
  s1sh: '胜其它', s1sd: '平其它', s1sa: '负其它',
  's-1sh': '胜其它', 's-1sd': '平其它', 's-1sa': '负其它'
};

function normalizeCrs(raw) {
  if (!raw) return null;
  const out = {};
  for (const k of Object.keys(raw)) {
    if (k.endsWith('f')) continue; // 涨跌标记
    const sm = k.match(CRS_SCORE_RE);
    if (sm) {
      const n = num(raw[k]);
      if (n !== null && n > 0) out[`${Number(sm[1])}:${Number(sm[2])}`] = n;
      continue;
    }
    if (CRS_OTHER[k]) {
      const n = num(raw[k]);
      if (n !== null && n > 0) out[CRS_OTHER[k]] = n;
    }
  }
  return Object.keys(out).length ? out : null;
}

// TTG：体彩 s0..s7，s7 视为 "7+"。
function normalizeTtg(raw) {
  if (!raw) return null;
  const out = {};
  for (const k of Object.keys(raw)) {
    const m = k.match(/^s(\d+)$/);
    if (!m) continue;
    const n = num(raw[k]);
    if (n === null || n <= 0) continue;
    const g = Number(m[1]);
    out[g >= 7 ? '7+' : g] = n;
  }
  return Object.keys(out).length ? out : null;
}

// HAFU：体彩 hh/hd/ha/dh/dd/da/ah/ad/aa。首字母=半场,次字母=全场; h主 d平 a客。
const HAFU_LETTER = { h: '主', d: '平', a: '客' };
const HAFU_KEYS = ['hh', 'hd', 'ha', 'dh', 'dd', 'da', 'ah', 'ad', 'aa'];

function normalizeHafu(raw) {
  if (!raw) return null;
  const out = {};
  for (const k of HAFU_KEYS) {
    const n = num(raw[k]);
    if (n === null || n <= 0) continue;
    const label = HAFU_LETTER[k[0]] + HAFU_LETTER[k[1]]; // 例 hh -> "主主"
    out[label] = n;
  }
  return Object.keys(out).length ? out : null;
}

// 把体彩主体的 oddsList 转成备用快照
function normalizeOddsList(oddsList) {
  const out = {};
  if (!Array.isArray(oddsList)) return out;
  for (const item of oddsList) {
    const code = String(item.poolCode || '').toLowerCase();
    if (!code) continue;
    out[code] = {
      handicap: readHandicap(item),
      win: num(item.h),
      draw: num(item.d),
      lose: num(item.a)
    };
  }
  return out;
}

module.exports = {
  normalizeHad,
  normalizeHhad,
  readHandicap,
  normalizeOddsList,
  normalizeCrs,
  normalizeTtg,
  normalizeHafu
};
