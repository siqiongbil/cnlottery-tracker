#!/usr/bin/env node
/**
 * cnlottery-tracker CLI —— 中国彩票落票 + 对账（记账，不代购）。
 *
 * 多彩种总入口。当前支持彩种：
 *   jc-football  竞彩足球（世界杯等）— 业务逻辑见 service/ utils/，对接体彩官方接口
 * 规划中：竞彩篮球、北单、大乐透等（数字彩逻辑另成一套，届时分到 games/ 下）。
 *
 * 用法：node cli.js [<game>] <action> [options]
 *   <game> 省略时默认 jc-football（当前唯一竞猜型彩种，向后兼容）。
 *
 * 业务逻辑（service/ utils/）由原 HTTP 服务原样复用，零损失。
 * 每条命令打印 { code, msg, data } JSON（和 HTTP 接口同一信封），失败时 code≠200 且退出码=1。
 *
 *   node cli.js [jc-football] schedule [--date=YYYY-MM-DD]
 *   node cli.js [jc-football] bet --json='{...}'              # 票体 JSON（mode/amount/selections）
 *   node cli.js [jc-football] settle --date=YYYY-MM-DD [--verify]
 *   node cli.js [jc-football] stats [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 *   node cli.js [jc-football] odds-history (--matchId=ID | --date=YYYY-MM-DD --teams=A,B) [--asOf=...] [--all]
 *   node cli.js [jc-football] clear-cache
 *   node cli.js [jc-football] clear-files --confirm (--date=YYYY-MM-DD | --all)
 *
 * 通用：--token=... 覆盖 API_TOKEN（CLI 本地直跑通常不需要鉴权）；--pretty 缩进输出。
 */

const { getOddsByDate, getOddsAll } = require('./service/oddsService');
const { placeBet } = require('./service/betService');
const { settleByDate } = require('./service/settleService');
const { getStats } = require('./service/statsService');
const { getOddsHistory } = require('./service/oddsHistoryService');
const { findByDateAndTeams } = require('./service/matchLookupForHistory');
const { clearCache, clearFiles } = require('./service/adminService');
const { isValidDate, today, normalizeAsOf } = require('./utils/dateUtil');
const cfg = require('./config');

// --- 极简 argv 解析：--key=value / --flag / --key value ---
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        out[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out[body] = argv[i + 1];
        i += 1;
      } else {
        out[body] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function httpErr(msg, code) {
  const e = new Error(msg);
  e.statusCode = code;
  return e;
}

function ok(data) {
  return { code: 200, msg: 'success', data };
}

function splitTeams(s) {
  return String(s || '').split(/[,，/|]/).map((x) => x.trim()).filter(Boolean);
}

// --- 子命令 ---

async function cmdSchedule(args) {
  const dateParam = args.date || '';
  if (dateParam && !isValidDate(dateParam)) throw httpErr('date must be in YYYY-MM-DD format', 400);
  let data;
  if (dateParam) {
    data = await getOddsByDate(dateParam);
  } else {
    const t = today();
    data = await getOddsByDate(t);
    if (data.total === 0) {
      const all = await getOddsAll();
      data = { date: t, total: all.total, matches: all.matches };
    }
  }
  return ok({
    ...data,
    source: { api: cfg.SPORTTERY_API_BASE, pools: cfg.SPORTTERY_DEFAULT_POOLS, fetchAt: new Date().toISOString() }
  });
}

async function cmdBet(args) {
  let body;
  if (args.json) {
    try { body = JSON.parse(args.json); } catch (_) { throw httpErr('--json is not valid JSON', 400); }
  } else if (args.file) {
    const fs = require('fs');
    body = JSON.parse(fs.readFileSync(args.file, 'utf-8'));
  } else {
    throw httpErr('bet requires --json=\'{...}\' or --file=path.json (mode/amount/selections)', 400);
  }
  const filed = await placeBet(body);
  return ok(filed);
}

async function cmdSettle(args) {
  const date = args.date || '';
  const verify = args.verify ? true : undefined;
  const result = await settleByDate(date, { verify });
  return ok(result);
}

async function cmdStats(args) {
  if (args.from && !isValidDate(args.from)) throw httpErr('from must be in YYYY-MM-DD format', 400);
  if (args.to && !isValidDate(args.to)) throw httpErr('to must be in YYYY-MM-DD format', 400);
  const data = await getStats({ from: args.from || undefined, to: args.to || undefined });
  return ok(data);
}

async function cmdOddsHistory(args) {
  let matchId = args.matchId;
  const asOf = normalizeAsOf(args.asOf);
  if (args.asOf && !asOf) throw httpErr('asOf must be YYYY-MM-DD or YYYY-MM-DD HH:mm[:ss]', 400);
  const all = args.all === true || args.all === '1' || args.all === 'true';

  if (!matchId) {
    const date = args.date || '';
    if (!date || !isValidDate(date)) throw httpErr('matchId, or date+teams, is required', 400);
    const teamList = splitTeams(args.teams);
    if (teamList.length === 0) throw httpErr('teams is required when matchId is absent', 400);
    const match = await findByDateAndTeams(date, teamList);
    if (!match || match.matchId == null) throw httpErr(`match not found for ${teamList.join('/')} on ${date}`, 404);
    matchId = match.matchId;
  }
  const data = await getOddsHistory({ matchId, asOf: asOf || undefined, all });
  return ok(data);
}

async function cmdClearCache() {
  return ok({ cleared: clearCache() });
}

async function cmdClearFiles(args) {
  const result = clearFiles({
    date: args.date,
    all: args.all === true || args.all === '1' || args.all === 'true',
    confirm: args.confirm === true || args.confirm === '1' || args.confirm === 'true'
  });
  return ok(result);
}

const COMMANDS = {
  schedule: cmdSchedule,
  bet: cmdBet,
  settle: cmdSettle,
  stats: cmdStats,
  'odds-history': cmdOddsHistory,
  'clear-cache': cmdClearCache,
  'clear-files': cmdClearFiles
};

// 已支持的彩种。新增彩种时在此登记，并把其 action 表接入分发。
const GAMES = {
  'jc-football': COMMANDS
};
const DEFAULT_GAME = 'jc-football';

function usage() {
  return [
    'cnlottery-tracker — 中国彩票落票 + 对账 CLI（记账，不代购）',
    '',
    '用法: node cli.js [<game>] <action> [options]',
    '  <game> 省略时默认 jc-football',
    '',
    '彩种:',
    '  jc-football   竞彩足球（世界杯等）',
    '',
    'jc-football 的 action:',
    '  schedule [--date=YYYY-MM-DD]                查赛程 + 五类玩法赔率',
    '  bet --json=\'{...}\'                          落票 + 冻结赔率（票体 JSON）',
    '  settle --date=YYYY-MM-DD [--verify]         查赛果并结算当天所有票',
    '  stats [--from=...] [--to=...]               跨日期总盈亏统计',
    '  odds-history (--matchId=ID | --date=.. --teams=A,B) [--asOf=..] [--all]',
    '  clear-cache                                 清上游接口内存缓存',
    '  clear-files --confirm (--date=.. | --all)   清落盘票据（危险）',
    '',
    '通用: --pretty 缩进输出  --token=.. 覆盖 API_TOKEN'
  ].join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const first = argv[0];
  if (!first || first === '-h' || first === '--help' || first === 'help') {
    console.log(usage());
    process.exit(0);
  }

  // 第一个 token 是彩种则吃掉，否则按默认彩种处理（向后兼容旧的 `cli.js settle`）。
  let rest = argv;
  let game = DEFAULT_GAME;
  if (GAMES[first]) {
    game = first;
    rest = argv.slice(1);
  }

  const actions = GAMES[game];
  const cmd = rest[0];
  const handler = actions[cmd];
  if (!handler) {
    console.error(JSON.stringify({ code: 400, msg: `unknown action '${cmd || ''}' for game '${game}'` }));
    console.error(usage());
    process.exit(1);
  }
  const args = parseArgs(rest.slice(1));
  if (args.token) process.env.API_TOKEN = String(args.token); // 占位：CLI 本地直跑一般无需鉴权

  try {
    const result = await handler(args);
    console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
  } catch (e) {
    const code = e.statusCode || 500;
    console.error(JSON.stringify({ code, msg: e.message || 'internal error' }, null, args.pretty ? 2 : 0));
    process.exit(1);
  }
}

main();
