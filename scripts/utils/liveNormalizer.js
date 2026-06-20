/**
 * 体彩实时比分 raw -> 标准化进行中比分。
 *
 * 输入：getMatchDataPageListV1(method=live) 的 subMatchList[] 单元素
 * 输出：
 *   {
 *     matchId, matchNum, matchNumStr, matchDate,
 *     home, away,                       // homeTeamAllName / awayTeamAllName
 *     liveScore: { h, a } | null,       // 实时比分（h/a 字段；终场用 sectionsNo999）
 *     halfScore: { h, a } | null,       // sectionsNo1 半场比分（半场后才有）
 *     hasHalfEnded,                     // 半场是否已打完（hafu 判死门槛）
 *     status                            // 'pending' | 'live' | 'final'
 *   }
 *
 * 说明：进行中比赛的 h/a 字段在未开赛时为空串；拿不到比分时 liveScore=null，
 * 调用方据此「不判死」——绝不能因为缺数据误判一关已死。
 */

function parseScore(str) {
  if (str === undefined || str === null || str === '') return null;
  const m = String(str).match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return null;
  return { h: Number(m[1]), a: Number(m[2]) };
}

// h/a 各是一个数字（也容错带冒号的形式由 sectionsNo999 兜底）
function parseHA(h, a) {
  const hn = toIntOrNull(h);
  const an = toIntOrNull(a);
  if (hn == null || an == null) return null;
  return { h: hn, a: an };
}

function toIntOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// 半场是否已结束：有半场比分，或状态文案显示已进入中场/下半场/完场。
function halfEnded(m, half) {
  if (half) return true;
  const name = String(m.matchStatusName || '');
  return /中场|下半场|完场|全场|结束/.test(name);
}

// 比赛阶段：有全场比分=final；有实时比分或状态显示进行中=live；否则 pending。
function deriveStatus(m, live, full) {
  if (full) return 'final';
  const name = String(m.matchStatusName || '');
  if (/完场|结束|已派奖|派奖/.test(name)) return 'final';
  if (live || /上半场|下半场|中场|进行|加时|点球/.test(name)) return 'live';
  return 'pending';
}

function normalizeLive(m) {
  if (!m) return null;
  const half = parseScore(m.sectionsNo1);
  const full = parseScore(m.sectionsNo999);
  // 实时比分优先用 h/a；终场用全场比分兜底
  const live = parseHA(m.h, m.a) || full;
  return {
    matchId: m.matchId != null ? m.matchId : null,
    matchNum: m.matchNum != null ? String(m.matchNum) : '',
    matchNumStr: m.matchNumStr || '',
    matchDate: m.matchDate || '',
    home: m.homeTeamAllName || m.homeTeamAbbName || '',
    away: m.awayTeamAllName || m.awayTeamAbbName || '',
    liveScore: live,
    halfScore: half,
    hasHalfEnded: halfEnded(m, half),
    status: deriveStatus(m, live, full)
  };
}

function flattenLive(rawBody) {
  const value = rawBody && rawBody.value;
  const buckets = value && Array.isArray(value.matchInfoList) ? value.matchInfoList : [];
  const out = [];
  for (const bucket of buckets) {
    const subs = Array.isArray(bucket.subMatchList) ? bucket.subMatchList : [];
    for (const m of subs) {
      const n = normalizeLive(m);
      if (n) out.push(n);
    }
  }
  return out;
}

module.exports = { normalizeLive, flattenLive, parseScore };
