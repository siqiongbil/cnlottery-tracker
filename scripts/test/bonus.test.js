const test = require('node:test');
const assert = require('node:assert');
const { normalizeBonus, crsPickFromCombination, ttgPickFromCombination, hafuPickFromCombination } = require('../utils/bonusNormalizer');
const { verifySelection } = require('../service/verifyService');

test('crs 官方组合码映射', () => {
  assert.equal(crsPickFromCombination('1:0'), '1:0');
  assert.equal(crsPickFromCombination('2 : 1'), '2:1');
  assert.equal(crsPickFromCombination('-1:H'), '胜其它');
  assert.equal(crsPickFromCombination('-1:D'), '平其它');
  assert.equal(crsPickFromCombination('-1:A'), '负其它');
});

test('ttg 官方组合码映射', () => {
  assert.equal(ttgPickFromCombination('0'), '0');
  assert.equal(ttgPickFromCombination('6'), '6');
  assert.equal(ttgPickFromCombination('7'), '7+');
});

test('hafu 官方组合码映射 (半:全)', () => {
  assert.equal(hafuPickFromCombination('D:H'), '平主');
  assert.equal(hafuPickFromCombination('H:H'), '主主');
  assert.equal(hafuPickFromCombination('A:D'), '客平');
});

test('normalizeBonus 整体翻译', () => {
  const raw = {
    value: {
      isCancel: 0,
      sectionsNo999: '1:0',
      matchResultList: [
        { code: 'HAD', combination: 'H', combinationDesc: '胜', odds: '1.94', goalLine: '', refundStatus: '0', matchId: 2040238 },
        { code: 'HHAD', combination: 'D', combinationDesc: '(-1)平', odds: '3.32', goalLine: '-1', refundStatus: '0', matchId: 2040238 },
        { code: 'CRS', combination: '1:0', combinationDesc: '1:0', odds: '7.00', goalLine: '', refundStatus: '0', matchId: 2040238 },
        { code: 'TTG', combination: '1', combinationDesc: '1', odds: '4.35', goalLine: '', refundStatus: '0', matchId: 2040238 },
        { code: 'HAFU', combination: 'D:H', combinationDesc: '平胜', odds: '4.70', goalLine: '', refundStatus: '0', matchId: 2040238 }
      ]
    }
  };
  const n = normalizeBonus(raw);
  assert.equal(n.matchId, 2040238);
  assert.equal(n.isCancel, false);
  assert.deepEqual(n.fullScore, { h: 1, a: 0 });
  assert.equal(n.results.had.pick, '主胜');
  assert.equal(n.results.hhad.pick, '平');
  assert.equal(n.results.hhad.goalLine, -1);
  assert.equal(n.results.crs.pick, '1:0');
  assert.equal(n.results.ttg.pick, '1');
  assert.equal(n.results.hafu.pick, '平主');
});

// 构造一个 settledSelection 形态
function settledSel(playType, pick, hit) {
  return { selection: { playType, pick }, hit };
}

const official = {
  isCancel: false,
  results: {
    had: { pick: '主胜', odds: 1.94, refundStatus: '0' },
    crs: { pick: '1:0', odds: 7.0, refundStatus: '0' },
    hafu: { pick: '平主', odds: 4.7, refundStatus: '0' }
  }
};

test('verifySelection 一致 (我们算中, 官方也中)', () => {
  const v = verifySelection(settledSel('had', '主胜', true), official);
  assert.equal(v.available, true);
  assert.equal(v.officialHit, true);
  assert.equal(v.agree, true);
});

test('verifySelection 一致 (我们算不中, 官方也不中)', () => {
  const v = verifySelection(settledSel('had', '客胜', false), official);
  assert.equal(v.officialHit, false);
  assert.equal(v.agree, true);
});

test('verifySelection 不一致 (我们算中, 官方不中)', () => {
  const v = verifySelection(settledSel('crs', '2:1', true), official);
  assert.equal(v.officialHit, false); // 官方中的是 1:0
  assert.equal(v.agree, false);
});

test('verifySelection 无官方数据', () => {
  const v = verifySelection(settledSel('had', '主胜', true), null);
  assert.equal(v.available, false);
});

test('verifySelection 比赛取消', () => {
  const v = verifySelection(settledSel('had', '主胜', true), { isCancel: true, results: {} });
  assert.equal(v.isCancel, true);
  assert.equal(v.agree, null);
});
