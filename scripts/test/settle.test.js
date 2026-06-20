const test = require('node:test');
const assert = require('node:assert');
const { settleTicket } = require('../service/settleService');

// 标准化赛果（resultService 输出形态）
function makeResult(matchId, home, away, half, full) {
  const [hh, ha] = half.split(':').map(Number);
  const [fh, fa] = full.split(':').map(Number);
  return {
    matchId, matchNum: String(matchId), matchNumStr: String(matchId),
    matchDate: '2026-06-20', home, away,
    halfScore: { h: hh, a: ha }, fullScore: { h: fh, a: fa },
    winFlag: fh > fa ? 'H' : fh < fa ? 'A' : 'D',
    goalLine: -1, status: 'final'
  };
}

function sel(matchId, home, away, playType, pick, odds, amount) {
  return {
    date: '2026-06-20', teams: [home, away], playType, pick, odds, amount,
    handicap: playType === 'hhad' ? -1 : null,
    specificScores: ['1:0', '2:1', '2:0'],
    match: { matchNum: String(matchId), matchId, matchDate: '2026-06-20',
      home: { name: home }, away: { name: away } }
  };
}

const results = [
  makeResult(101, '美国', '澳大利亚', '1:0', '2:1'),  // 主胜, 比分2:1
  makeResult(102, '巴西', '摩洛哥', '0:0', '0:0')      // 平局, 比分0:0
];

test('parlay 全中派彩', () => {
  const ticket = {
    ticketId: 't1', mode: 'parlay', amount: 10,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45),
      sel(102, '巴西', '摩洛哥', 'had', '平', 3.0)
    ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.isHit, true);
  // 10 × (1.45×3.0=4.35) = 43.5
  assert.equal(r.payout, 43.5);
  assert.equal(r.profit, 33.5);
});

test('parlay 一项不中 -> 整票不中, payout=0', () => {
  const ticket = {
    ticketId: 't2', mode: 'parlay', amount: 10,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45), // 中
      sel(102, '巴西', '摩洛哥', 'had', '主胜', 5.0)      // 不中(实际平)
    ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.isHit, false);
  assert.equal(r.payout, 0);
  assert.equal(r.profit, -10);
});

test('single 部分中也算中, 各项独立派彩', () => {
  const ticket = {
    ticketId: 't3', mode: 'single', amount: 2,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45, 10), // 中: 10×1.45=14.5
      sel(102, '巴西', '摩洛哥', 'had', '主胜', 5.0, 20)      // 不中
    ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.isHit, true);          // 部分中也算中
  assert.equal(r.totalAmount, 30);
  assert.equal(r.payout, 14.5);
  assert.equal(r.profit, -15.5);
});

test('single 比分 + 其它比分 + 半全场组合', () => {
  const ticket = {
    ticketId: 't4', mode: 'single', amount: 2,
    selections: [
      sel(101, '美国', '澳大利亚', 'crs', '2:1', 7.0, 2),  // 中: 实际2:1
      sel(101, '美国', '澳大利亚', 'hafu', '主主', 2.15, 2), // 中: 半1:0全2:1
      sel(101, '美国', '澳大利亚', 'hhad', '平', 3.3, 2)     // 中: 让-1后1:1
    ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.isHit, true);
  // 2×7.0 + 2×2.15 + 2×3.3 = 14 + 4.3 + 6.6 = 24.9
  assert.equal(r.payout, 24.9);
});

test('跨场 parlay（不同 matchId）', () => {
  const ticket = {
    ticketId: 't5', mode: 'parlay', amount: 5,
    selections: [
      sel(101, '美国', '澳大利亚', 'crs', '2:1', 7.0),  // 中
      sel(102, '巴西', '摩洛哥', 'crs', '0:0', 9.0)      // 中
    ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.isHit, true);
  // 5 × (7.0×9.0=63) = 315
  assert.equal(r.payout, 315);
  assert.equal(r.status, 'settled');
});

test('票级 status: pending（比赛未开赛）', () => {
  // 用一个不在 results 里的 matchId -> 找不到赛果 -> settled=false
  const ticket = {
    ticketId: 't6', mode: 'single', amount: 10,
    selections: [ sel(999, '甲', '乙', 'had', '主胜', 2.0, 10) ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.status, 'pending');
  assert.equal(r.isHit, false);
  assert.equal(r.payout, 0);
});

test('票级 status: partial（跨场 parlay 部分开赛）', () => {
  const ticket = {
    ticketId: 't7', mode: 'parlay', amount: 10,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45), // 已开赛
      sel(999, '甲', '乙', 'had', '主胜', 2.0)            // 未开赛
    ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.status, 'partial');
  assert.equal(r.isHit, false); // parlay 未全开奖不派彩
  assert.equal(r.payout, 0);
});

test('parlay 提前死亡：一关已开奖没中，整串 alive=false + deadLegs', () => {
  const ticket = {
    ticketId: 't10', mode: 'parlay', amount: 10,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45), // 已开赛，中
      sel(102, '巴西', '摩洛哥', 'had', '主胜', 5.0),     // 已开赛，没中(实际平) -> 死
      sel(999, '甲', '乙', 'had', '主胜', 2.0)            // 未开赛
    ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.status, 'partial');   // 仍有未开赛 -> partial
  assert.equal(r.alive, false);        // 但已经死了
  assert.equal(r.isHit, false);
  assert.equal(r.payout, 0);
  assert.equal(r.deadLegs.length, 1);
  assert.deepEqual(r.deadLegs[0].teams, ['巴西', '摩洛哥']);
});

test('parlay 还活着：已开的关全中、仍有未开赛，alive=true', () => {
  const ticket = {
    ticketId: 't11', mode: 'parlay', amount: 10,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45), // 已开赛，中
      sel(999, '甲', '乙', 'had', '主胜', 2.0)            // 未开赛
    ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.status, 'partial');
  assert.equal(r.alive, true);         // 已开的都中了，还活着
  assert.equal(r.deadLegs.length, 0);
  assert.equal(r.payout, 0);           // 未全开不派彩
});

test('parlay 全中：alive=true + isHit', () => {
  const ticket = {
    ticketId: 't12', mode: 'parlay', amount: 10,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45),
      sel(102, '巴西', '摩洛哥', 'had', '平', 3.0)
    ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.alive, true);
  assert.equal(r.isHit, true);
});

test('single 票 alive=null（不适用）', () => {
  const ticket = {
    ticketId: 't13', mode: 'single', amount: 10,
    selections: [ sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45, 10) ]
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.alive, null);
  assert.deepEqual(r.deadLegs, []);
});

// 标准化 live（liveNormalizer 输出形态）
function makeLive(matchId, home, away, h, a, half) {
  return {
    matchId, matchNum: String(matchId), matchNumStr: String(matchId),
    matchDate: '2026-06-20', home, away,
    liveScore: { h, a },
    halfScore: half ? { h: Number(half.split(':')[0]), a: Number(half.split(':')[1]) } : null,
    hasHalfEnded: Boolean(half),
    status: 'live'
  };
}

test('parlay 进行中提前判死：live 比分确定一关已不可能中 -> alive=false, source=live', () => {
  // 关1已开赛中；关2(未开赛)买总进球2，但 live 已 2:1=3球 -> 进行中判死
  const ticket = {
    ticketId: 't14', mode: 'parlay', amount: 10,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45), // 已终场，中
      sel(202, '德国', '日本', 'ttg', '2', 4.0)           // 未终场，live 3球 -> 死
    ]
  };
  const live = [makeLive(202, '德国', '日本', 2, 1)];
  const r = settleTicket(ticket, results, live);
  assert.equal(r.status, 'partial');   // 关2无终场赛果，仍 partial
  assert.equal(r.alive, false);        // 但 live 已判死
  assert.equal(r.deadLegs.length, 1);
  assert.equal(r.deadLegs[0].source, 'live');
  assert.deepEqual(r.deadLegs[0].teams, ['德国', '日本']);
  assert.equal(r.payout, 0);
});

test('parlay 进行中未判死：live 比分仍有希望 -> alive=true', () => {
  const ticket = {
    ticketId: 't15', mode: 'parlay', amount: 10,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45), // 终场，中
      sel(202, '德国', '日本', 'had', '主胜', 2.0)        // 未终场，had 进行中永不判死
    ]
  };
  const live = [makeLive(202, '德国', '日本', 0, 2)]; // 落后但 had 不判死
  const r = settleTicket(ticket, results, live);
  assert.equal(r.alive, true);
  assert.equal(r.deadLegs.length, 0);
});

test('终场判死与 live 判死并存：deadLegs 含 final + live 两条', () => {
  const ticket = {
    ticketId: 't16', mode: 'parlay', amount: 10,
    selections: [
      sel(102, '巴西', '摩洛哥', 'had', '主胜', 5.0),   // 已终场没中(实际平) -> final 死
      sel(202, '德国', '日本', 'crs', '2:1', 8.0)        // 未终场，live 已 3:0 -> live 死
    ]
  };
  const live = [makeLive(202, '德国', '日本', 3, 0)];
  const r = settleTicket(ticket, results, live);
  assert.equal(r.alive, false);
  assert.equal(r.deadLegs.length, 2);
  const sources = r.deadLegs.map((d) => d.source).sort();
  assert.deepEqual(sources, ['final', 'live']);
});

test('不传 live（向后兼容）：行为与原先一致', () => {
  const ticket = {
    ticketId: 't17', mode: 'parlay', amount: 10,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 1.45),
      sel(999, '甲', '乙', 'had', '主胜', 2.0)
    ]
  };
  const r = settleTicket(ticket, results); // 不传 liveResults
  assert.equal(r.alive, true);
  assert.equal(r.deadLegs.length, 0);
});

test('奖金封顶：single 单项超 100 万被封顶', () => {
  const ticket = {
    ticketId: 't8', mode: 'single', amount: 2,
    selections: [ sel(101, '美国', '澳大利亚', 'had', '主胜', 600000, 2) ] // 2×60万=120万 > 100万
  };
  const r = settleTicket(ticket, results);
  assert.equal(r.capped, true);
  assert.equal(r.payout, 1000000);
});

test('奖金封顶：parlay 整票超 100 万被封顶', () => {
  const ticket = {
    ticketId: 't9', mode: 'parlay', amount: 100,
    selections: [
      sel(101, '美国', '澳大利亚', 'had', '主胜', 200),
      sel(102, '巴西', '摩洛哥', 'had', '平', 100)
    ]
  };
  const r = settleTicket(ticket, results);
  // 100 × (200×100=20000) = 200万 > 100万
  assert.equal(r.capped, true);
  assert.equal(r.payout, 1000000);
});
