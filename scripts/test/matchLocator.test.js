const test = require('node:test');
const assert = require('node:assert');

// 验证 matchLocator：滚动窗口外用赛程列表/赛果接口按 date+teams 反查 matchId。
// patch 命名空间引用（matchLocator 经命名空间调用，故可被替换）。
const resultService = require('../service/resultService');
const matchListClient = require('../service/matchListClient');

const FAKE_RESULTS = [
  { matchId: 2040239, matchNum: '029', matchNumStr: '周五029', matchDate: '2026-06-20',
    home: '美国', away: '澳大利亚',
    halfScore: { h: 0, a: 0 }, fullScore: { h: 1, a: 0 }, winFlag: 'H', goalLine: -1, status: 'final' },
  { matchId: 2040240, matchNum: '030', matchNumStr: '周五030', matchDate: '2026-06-20',
    home: '土耳其', away: '巴拉圭',
    halfScore: { h: 1, a: 0 }, fullScore: { h: 2, a: 1 }, winFlag: 'H', goalLine: 0, status: 'final' }
];

// getMatchListV1 raw 结构：value.matchInfoList[].subMatchList[]
const FAKE_MATCHLIST = {
  success: true, errorCode: '0',
  value: {
    matchInfoList: [
      { businessDate: '2026-06-19', subMatchList: [
        { matchId: 2040239, matchNumStr: '周五029', matchDate: '2026-06-20', homeTeamAllName: '美国', awayTeamAllName: '澳大利亚', matchStatus: 'Selling' },
        { matchId: 2040242, matchNumStr: '周五032', matchDate: '2026-06-20', homeTeamAllName: '土耳其', awayTeamAllName: '巴拉圭', matchStatus: 'Selling' }
      ] },
      { businessDate: '2026-06-20', subMatchList: [
        { matchId: 2040243, matchNumStr: '周六033', matchDate: '2026-06-21', homeTeamAllName: '荷兰', awayTeamAllName: '瑞典', matchStatus: 'Selling' }
      ] }
    ]
  }
};

let origResult;
let origMatchList;
test.before(() => {
  origResult = resultService.getResultsByDate;
  resultService.getResultsByDate = async (date) => (date === '2026-06-20' ? FAKE_RESULTS : []);
  origMatchList = matchListClient.fetchMatchListRaw;
  matchListClient.fetchMatchListRaw = async () => FAKE_MATCHLIST;
});
test.after(() => {
  resultService.getResultsByDate = origResult;
  matchListClient.fetchMatchListRaw = origMatchList;
});

const { locateViaResults, locateViaMatchList, locateOutOfWindow, flattenMatchList, teamsMatch, norm } = require('../service/matchLocator');

test('locateViaResults 两队名定位已结束比赛 -> 取到 matchId', async () => {
  const m = await locateViaResults('2026-06-20', ['美国', '澳大利亚']);
  assert.ok(m);
  assert.equal(m.matchId, 2040239);
  assert.equal(m.home.name, '美国');
  assert.equal(m.away.name, '澳大利亚');
  assert.equal(m.source, 'results');
});

test('单队名也能定位', async () => {
  const m = await locateViaResults('2026-06-20', ['巴拉圭']);
  assert.ok(m);
  assert.equal(m.matchId, 2040240);
});

test('队名带"队"后缀/空格容错', async () => {
  const m = await locateViaResults('2026-06-20', ['美国队', ' 澳大利亚 ']);
  assert.ok(m);
  assert.equal(m.matchId, 2040239);
});

test('日期对不上 -> null', async () => {
  const m = await locateViaResults('2026-06-21', ['美国', '澳大利亚']);
  assert.equal(m, null);
});

test('队名对不上 -> null', async () => {
  const m = await locateViaResults('2026-06-20', ['巴西', '阿根廷']);
  assert.equal(m, null);
});

test('teamsMatch / norm 单元', () => {
  assert.equal(norm(' 美国队 '), '美国');
  assert.equal(teamsMatch('美国', '澳大利亚', ['美国', '澳大利亚']), true);
  assert.equal(teamsMatch('美国', '澳大利亚', ['澳大利亚', '美国']), true); // 顺序无关
  assert.equal(teamsMatch('美国', '澳大利亚', ['美国']), true);
  assert.equal(teamsMatch('美国', '澳大利亚', ['日本']), false);
});

test('flattenMatchList 扁平 matchInfoList[].subMatchList[]', () => {
  const list = flattenMatchList(FAKE_MATCHLIST);
  assert.equal(list.length, 3);
  const us = list.find((x) => x.matchId === 2040239);
  assert.equal(us.home, '美国');
  assert.equal(us.away, '澳大利亚');
  assert.equal(us.matchDate, '2026-06-20');
});

test('locateViaMatchList 定位在售比赛(赔率窗口已滑出) -> matchId', async () => {
  const m = await locateViaMatchList('2026-06-20', ['美国', '澳大利亚']);
  assert.ok(m);
  assert.equal(m.matchId, 2040239);
  assert.equal(m.source, 'matchList');
});

test('locateViaMatchList 日期需匹配 matchDate(非业务日)', async () => {
  // 美澳 matchDate=2026-06-20；用 06-19 查应 null
  const m = await locateViaMatchList('2026-06-19', ['美国', '澳大利亚']);
  assert.equal(m, null);
});

test('locateOutOfWindow 优先 matchList：命中则不查赛果', async () => {
  let resultCalled = false;
  const saved = resultService.getResultsByDate;
  resultService.getResultsByDate = async () => { resultCalled = true; return []; };
  const m = await locateOutOfWindow('2026-06-20', ['美国', '澳大利亚']);
  resultService.getResultsByDate = saved;
  assert.equal(m.source, 'matchList');
  assert.equal(resultCalled, false); // matchList 命中，未触达赛果
});

test('locateOutOfWindow matchList miss -> 落到赛果', async () => {
  const saved = matchListClient.fetchMatchListRaw;
  matchListClient.fetchMatchListRaw = async () => ({ success: true, errorCode: '0', value: { matchInfoList: [] } });
  const m = await locateOutOfWindow('2026-06-20', ['美国', '澳大利亚']);
  matchListClient.fetchMatchListRaw = saved;
  assert.ok(m);
  assert.equal(m.matchId, 2040239);
  assert.equal(m.source, 'results'); // matchList 空 -> 赛果兜底
});
