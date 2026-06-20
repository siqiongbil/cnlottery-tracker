const test = require('node:test');
const assert = require('node:assert');
const { isDead } = require('../utils/picks');

// 构造一份标准化 live（liveNormalizer 输出形态）
function live({ h, a, half, hasHalfEnded, status = 'live' }) {
  return {
    matchId: 1, matchNumStr: '周六001', matchDate: '2026-06-20',
    home: '主队', away: '客队',
    liveScore: (h == null || a == null) ? null : { h, a },
    halfScore: half ? { h: half[0], a: half[1] } : null,
    hasHalfEnded: hasHalfEnded ?? Boolean(half),
    status
  };
}

test('ttg 具体数：已进球超过目标 -> 死', () => {
  // 买总进球 2，现在已经 2:1 = 3 球 -> 不可能再回到 2
  assert.equal(isDead('ttg', '2', live({ h: 2, a: 1 })), true);
});

test('ttg 具体数：等于目标 -> 还没死（还能再进）', () => {
  assert.equal(isDead('ttg', '2', live({ h: 1, a: 1 })), false);
});

test('ttg 具体数：低于目标 -> 没死', () => {
  assert.equal(isDead('ttg', '3', live({ h: 1, a: 1 })), false);
});

test('ttg 7+ 永不判死', () => {
  assert.equal(isDead('ttg', '7+', live({ h: 5, a: 1 })), false);
});

test('crs 具体比分：某方已超过目标 -> 死', () => {
  // 买 2:1，主队已经进 3 球 -> 不可能终场 2:1
  assert.equal(isDead('crs', '2:1', live({ h: 3, a: 0 })), true);
  // 客队已经进 2 球，目标客 1 -> 死
  assert.equal(isDead('crs', '2:1', live({ h: 0, a: 2 })), true);
});

test('crs 具体比分：都没超过 -> 没死（还能进到目标）', () => {
  assert.equal(isDead('crs', '2:1', live({ h: 1, a: 0 })), false);
  assert.equal(isDead('crs', '2:1', live({ h: 2, a: 1 })), false); // 正好到目标也没死
});

test('crs 其它比分：进行中不判死', () => {
  assert.equal(isDead('crs', '胜其它', live({ h: 3, a: 0 })), false);
});

test('had / hhad：进行中永不判死（可逆转）', () => {
  // 买主胜，现在 0:3 落后，理论上仍可逆转 -> 不判死
  assert.equal(isDead('had', '主胜', live({ h: 0, a: 3 })), false);
  assert.equal(isDead('hhad', '主胜', live({ h: 0, a: 3 })), false);
});

test('hafu：半场已结束且方向不符 -> 死', () => {
  // 买「主主」，半场 0:1（客领先）-> 半场方向已错，整场必不中
  assert.equal(isDead('hafu', '主主', live({ h: 0, a: 1, half: [0, 1], hasHalfEnded: true })), true);
});

test('hafu：半场已结束且方向相符 -> 没死', () => {
  // 买「主主」，半场 1:0（主领先）-> 前半段对，仍有希望
  assert.equal(isDead('hafu', '主主', live({ h: 1, a: 0, half: [1, 0], hasHalfEnded: true })), false);
});

test('hafu：半场未结束 -> 不判死（方向还会变）', () => {
  assert.equal(isDead('hafu', '主主', live({ h: 0, a: 1, hasHalfEnded: false })), false);
});

test('缺数据兜底：liveScore=null 一律不判死', () => {
  assert.equal(isDead('ttg', '2', live({ h: null, a: null })), false);
  assert.equal(isDead('crs', '2:1', live({ h: null, a: null })), false);
});

test('null live 不判死', () => {
  assert.equal(isDead('ttg', '2', null), false);
});
