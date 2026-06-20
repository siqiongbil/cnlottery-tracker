const test = require('node:test');
const assert = require('node:assert');
const { isHit, lookupOdds, normHafuPick, normTtgPick, normCrsPick } = require('../utils/picks');

// 构造一个标准化赛果
function actual(half, full, opts = {}) {
  const [hh, ha] = half.split(':').map(Number);
  const [fh, fa] = full.split(':').map(Number);
  return {
    halfScore: { h: hh, a: ha },
    fullScore: { h: fh, a: fa },
    winFlag: fh > fa ? 'H' : fh < fa ? 'A' : 'D',
    goalLine: opts.goalLine != null ? opts.goalLine : null,
    status: 'final'
  };
}

test('had 胜负平', () => {
  const a = actual('1:0', '2:1');
  assert.equal(isHit('had', '主胜', a), true);
  assert.equal(isHit('had', '平', a), false);
  assert.equal(isHit('had', '客胜', a), false);

  const draw = actual('0:0', '1:1');
  assert.equal(isHit('had', '平', draw), true);
  assert.equal(isHit('had', '主胜', draw), false);
});

test('hhad 让球（让球数从赛果 goalLine 取）', () => {
  // 主队 -1 让球，实际 2:1 -> 让后 1:1 平
  const a = actual('1:0', '2:1', { goalLine: -1 });
  assert.equal(isHit('hhad', '平', a), true);
  assert.equal(isHit('hhad', '主胜', a), false);

  // 主队 -1，实际 3:1 -> 让后 2:1 主胜
  const b = actual('1:0', '3:1', { goalLine: -1 });
  assert.equal(isHit('hhad', '主胜', b), true);

  // 客队 +1 (主队 goalLine=+1)，实际 1:1 -> 让后 2:1 主胜
  const c = actual('0:0', '1:1', { goalLine: 1 });
  assert.equal(isHit('hhad', '主胜', c), true);
});

test('hhad 用落票冻结的 handicap 覆盖赛果 goalLine', () => {
  const a = actual('1:0', '2:1', { goalLine: 0 });
  // 显式传 handicap=-1 -> 让后 1:1 平
  assert.equal(isHit('hhad', '平', a, { handicap: -1 }), true);
});

test('crs 具体比分', () => {
  const a = actual('1:0', '2:1');
  assert.equal(isHit('crs', '2:1', a), true);
  assert.equal(isHit('crs', '1:2', a), false);
  assert.equal(isHit('crs', '2 : 1', a), true); // 容错空格
});

test('crs 其它比分（超出已列范围）', () => {
  const specificScores = new Set(['1:0', '2:1', '2:0']); // 已单列
  // 实际 5:4，主胜，不在已列 -> 胜其它命中
  const big = actual('2:1', '5:4');
  assert.equal(isHit('crs', '胜其它', big, { specificScores }), true);
  assert.equal(isHit('crs', '平其它', big, { specificScores }), false);

  // 实际 2:1，在已列 -> 胜其它不命中（应押具体比分）
  const listed = actual('1:0', '2:1');
  assert.equal(isHit('crs', '胜其它', listed, { specificScores }), false);

  // 实际 4:4 平，不在已列 -> 平其它命中
  const drawBig = actual('2:2', '4:4');
  assert.equal(isHit('crs', '平其它', drawBig, { specificScores }), true);
});

test('ttg 总进球', () => {
  assert.equal(isHit('ttg', '3', actual('1:0', '2:1')), true); // 总3
  assert.equal(isHit('ttg', '2', actual('1:0', '2:1')), false);
  assert.equal(isHit('ttg', '7+', actual('3:1', '5:3')), true); // 总8 >=7
  assert.equal(isHit('ttg', '7+', actual('3:1', '4:2')), false); // 总6
  assert.equal(isHit('ttg', '0', actual('0:0', '0:0')), true);
});

test('hafu 半全场九宫格', () => {
  // 半场主胜 全场主胜 -> 主主
  const hh = actual('1:0', '2:1');
  assert.equal(isHit('hafu', '主主', hh), true);
  assert.equal(isHit('hafu', '平主', hh), false);

  // 半场平 全场主胜 -> 平主
  const dh = actual('0:0', '1:0');
  assert.equal(isHit('hafu', '平主', dh), true);

  // 半场客胜 全场平 -> 客平
  const ad = actual('0:1', '1:1');
  assert.equal(isHit('hafu', '客平', ad), true);

  // 字母写法 + 数字写法
  assert.equal(isHit('hafu', 'hh', hh), true);
  assert.equal(isHit('hafu', '33', hh), true); // 3主3主
});

test('未结束的比赛一律不命中', () => {
  const pending = { ...actual('1:0', '2:1'), status: 'pending' };
  assert.equal(isHit('had', '主胜', pending), false);
  assert.equal(isHit('crs', '2:1', pending), false);
});

test('lookupOdds 按 pick 取冻结赔率', () => {
  const odds = {
    had: { win: 1.45, draw: 4.0, lose: 6.5 },
    hhad: { handicap: -1, win: 2.1, draw: 3.3, lose: 2.8 },
    crs: { '2:1': 7.0, '胜其它': 45 },
    ttg: { 3: 3.3, '7+': 26 },
    hafu: { '主主': 2.15, '平客': 13 }
  };
  assert.equal(lookupOdds(odds, 'had', '主胜'), 1.45);
  assert.equal(lookupOdds(odds, 'had', '客胜'), 6.5);
  assert.equal(lookupOdds(odds, 'hhad', '平'), 3.3);
  assert.equal(lookupOdds(odds, 'crs', '2:1'), 7.0);
  assert.equal(lookupOdds(odds, 'crs', '胜其它'), 45);
  assert.equal(lookupOdds(odds, 'ttg', '3'), 3.3);
  assert.equal(lookupOdds(odds, 'ttg', '7+'), 26);
  assert.equal(lookupOdds(odds, 'hafu', '主主'), 2.15);
  assert.equal(lookupOdds(odds, 'had', '不存在'), null);
});

test('pick 规范化', () => {
  assert.equal(normCrsPick('2 : 1'), '2:1');
  assert.equal(normTtgPick('8'), '7+');
  assert.equal(normTtgPick('5'), '5');
  assert.equal(normHafuPick('hh'), '主主');
  assert.equal(normHafuPick('31'), '主平');
});
