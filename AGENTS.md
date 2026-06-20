# AGENTS.md

跨 agent 使用指南。本仓库的核心是一个**标准 Node.js CLI**（`scripts/cli.js`），任何能执行 shell 命令或调用函数的 agent / harness 都能用——不限于 Claude。

- **Claude 系**（Claude Code / claude.ai）：读根目录 `SKILL.md`，放进 skills 目录自动发现。
- **OpenAI Codex / 其他遵循 AGENTS.md 约定的 harness**：读本文件。
- **自建 agent，或外挂了执行循环的 function-calling 模型**（GPT、Claude、Hermes 等）：用 `tools.schema.json` 把 7 个命令注册成 function/tool。

> 术语：GPT / Hermes 等是**模型**，本身不执行命令；调用本 CLI 的是包着模型的 agent/harness（如 Codex，或你自建的应用）。

> ⚠️ 这是**记账与对账工具，不代购、不下注**。只记录投注、冻结当时赔率、按官方赛果对账盈亏。

## 这是什么

中国彩票落票记录 + 对账。当前彩种：竞彩足球（`jc-football`，世界杯等）。数据来自中国体彩官方接口（`webapi.sporttery.cn`）。

## 安装

```bash
npm install      # 依赖仅 axios / dayjs / dotenv，Node >= 18
npm test         # 68 个测试，命中 + 结算 + 判死规则覆盖
```

## 调用契约

```
node scripts/cli.js [<game>] <action> [--flag] [--key=value]
```

- `<game>` 省略时默认 `jc-football`。
- stdout 打印 JSON 信封 `{ code, msg, data }`，`code:200` 成功。
- 退出码：成功 0，失败 1（失败时信封打到 stderr）。
- 通用 flag：`--pretty` 缩进输出。
- 落盘目录用环境变量 `DATA_DIR` 固定（如 `DATA_DIR=~/.cnlottery-data`），否则票据按当前工作目录散落。

agent 解析方式：执行命令 → 读 stdout 的 JSON → 按 `code` 判断成败 → 用 `data` 组织自然语言回复。**不要把原始 JSON 直接甩给用户**，要解读（中了哪几关、盈亏多少、串关是否已死）。

## 命令一览

| action | 说明 | 关键参数 |
|---|---|---|
| `schedule` | 查赛程 + 五类玩法赔率 | `--date=YYYY-MM-DD`（可选） |
| `bet` | 落票 + 冻结赔率 | `--json='<票体JSON>'` 或 `--file=path.json` |
| `settle` | 查赛果并结算当天所有票 | `--date=YYYY-MM-DD`（必填）`--verify`（可选） |
| `stats` | 跨日期总盈亏统计 | `--from=` `--to=`（均可选） |
| `odds-history` | 历史赔率 | `--matchId=` 或 `--date= --teams=A,B`；`--asOf=` `--all` |
| `clear-cache` | 清上游接口内存缓存 | 无 |
| `clear-files` | 删落盘票据（危险） | `--confirm` 且 `--date=` 或 `--all` |

票体 JSON、玩法/pick 对照、单/串规则、判死活逻辑、错误码详见根目录 `SKILL.md`。function-calling 的结构化参数定义见 `tools.schema.json`。

## 示例

```bash
# 查赛程
node scripts/cli.js schedule --date=2026-06-21 --pretty

# 落串关（整票 10 元）
node scripts/cli.js bet --json='{"mode":"parlay","amount":10,"selections":[
  {"date":"2026-06-21","teams":["荷兰","瑞典"],"playType":"had","pick":"主胜"},
  {"date":"2026-06-21","teams":["德国","科特迪瓦"],"playType":"had","pick":"主胜"}]}'

# 结算
node scripts/cli.js settle --date=2026-06-21 --pretty
```

## function-calling 接入

`tools.schema.json` 是 OpenAI/通用 tool-use 格式（`tools[].function.{name,description,parameters}`）。把每个 tool 的调用落到对应 CLI 命令即可，例如 `cnlottery_bet({mode,amount,selections})` → `node scripts/cli.js bet --json='<把参数序列化成票体>'`。

## 安全约定

- `clear-files` 删数据，执行前必须向用户确认。
- 队名定位失败返回 `code:404`，改用准确队名或先 `schedule` 查 `matchId` 再用 `selection.matchId`。
- 上游接口异常返回 `code:502`。
