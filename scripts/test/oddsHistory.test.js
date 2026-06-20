const test = require('node:test');
const assert = require('node:assert');

// 模拟 getFixedBonusV1 的 oddsHistory，验证 closing/trace + asOf 过滤逻辑。
// 通过 monkey-patch bonusClient.fetchBonusRaw 注入假数据。
const bonusClient = require('../service/bonusClient');

const FAKE = {
  value: {
    oddsHistory: {
      matchId: 999, homeTeamAllName: '甲', awayTeamAllName: '乙', leagueAllName: '世界杯',
      hadList: [
        { h: '1.50', d: '3.00', a: '5.00', updateDate: '2026-06-17', updateTime: '09:00:00' },
        { h: '1.45', d: '3.10', a: '5.20', updateDate: '2026-06-19', updateTime: '10:00:00' },
        { h: '1.44', d: '3.90', a: '5.60', updateDate: '2026-06-19', updateTime: '20:00:00' },
        { h: '1.40', d: '4.00', a: '6.00', updateDate: '2026-06-20', updateTime: '02:00:00' }
      ],
      crsList: [
        { s01s00: '6.00', 's-1sh': '40.0', updateDate: '2026-06-19', updateTime: '10:00:00' }
      ]
    }
  }
};

let orig;
test.before(() => { orig = bonusClient.fetchBonusRaw; bonusClient.fetchBonusRaw = async () => FAKE; });
test.after(() => { bonusClient.fetchBonusRaw = orig; });

// 必须在 patch 之后 require，确保拿到被替换的引用
const { getOddsHistory } = require('../service/oddsHistoryService');

test('closing: asOf=19 取当天最后一条收盘', async () => {
  const r = await getOddsHistory({ matchId: 999, asOf: '2026-06-19' });
  assert.equal(r.mode, 'closing');
  // 19号最后一条是 20:00 的 1.44
  assert.deepEqual(r.odds.had, { win: 1.44, draw: 3.9, lose: 5.6 });
  assert.equal(r.updatedAt.had, '2026-06-19 20:00:00');
});

test('closing: 不传 asOf 取全程最新（含20号）', async () => {
  const r = await getOddsHistory({ matchId: 999 });
  assert.deepEqual(r.odds.had, { win: 1.4, draw: 4.0, lose: 6.0 });
});

test('closing: asOf=17 只看到17号', async () => {
  const r = await getOddsHistory({ matchId: 999, asOf: '2026-06-17' });
  assert.deepEqual(r.odds.had, { win: 1.5, draw: 3.0, lose: 5.0 });
});

test('trace: asOf=19 当天全部变动', async () => {
  const r = await getOddsHistory({ matchId: 999, asOf: '2026-06-19', all: true });
  assert.equal(r.mode, 'trace');
  assert.equal(r.trace.had.length, 2); // 19号两条(10:00, 20:00)
  assert.equal(r.trace.had[0].at, '2026-06-19 10:00:00');
  assert.equal(r.trace.had[1].odds.win, 1.44);
});

test('crs 历史用 s-1sh 格式也能解析其它比分', async () => {
  const r = await getOddsHistory({ matchId: 999, asOf: '2026-06-19' });
  assert.equal(r.odds.crs['1:0'], 6.0);
  assert.equal(r.odds.crs['胜其它'], 40.0);
});

test('closing: asOf 带时间 11:38 取该时刻前最近一次刷新', async () => {
  const r = await getOddsHistory({ matchId: 999, asOf: '2026-06-19 11:38' });
  assert.equal(r.mode, 'closing');
  // 19号有 10:00 和 20:00 两条；11:38 之前最近的是 10:00 的 1.45
  assert.deepEqual(r.odds.had, { win: 1.45, draw: 3.1, lose: 5.2 });
  assert.equal(r.updatedAt.had, '2026-06-19 10:00:00');
});

test('closing: asOf 纯日期取当天收盘（区别于带时间）', async () => {
  const r = await getOddsHistory({ matchId: 999, asOf: '2026-06-19' });
  // 纯日期 → 23:59:59 天花板 → 当天最后一条 20:00 的 1.44
  assert.equal(r.updatedAt.had, '2026-06-19 20:00:00');
});

test('缺 matchId 报错', async () => {
  await assert.rejects(() => getOddsHistory({}), /matchId is required/);
});
