# cnlottery-tracker

中国彩票**落票记录 + 对账**的 Claude Code Agent Skill。CLI 形态，按需调用、不占端口。**记账工具，不代购、不下注**——只帮你记录投注、冻结当时赔率、按官方赛果对账盈亏。

多彩种总入口。当前支持**竞彩足球**（`jc-football`，世界杯等），规划兼容竞彩篮球、北单、大乐透等。数据对接中国体彩官方接口（`webapi.sporttery.cn`）。

由 Express 服务（worldcup-odds-service）重写而来：路由层换成 CLI 命令分发，`service/` + `utils/` 业务逻辑原样复用，五类玩法的命中/判死规则由 68 个测试守护。

## 能力（竞彩足球）

| 命令 | 说明 |
|---|---|
| `schedule` | 查赛程 + 五类玩法赔率（had/hhad/crs/ttg/hafu） |
| `bet` | 落票 + 冻结赔率，整段体彩 raw 落盘 |
| `settle` | 查赛果并结算当天所有票（含串关进行中提前判死活） |
| `stats` | 跨日期总盈亏统计 + 逐项明细 |
| `odds-history` | 某场比赛随时间变动的历史赔率 |
| `clear-cache` / `clear-files` | 清缓存 / 清落盘票据 |

## 安装

```bash
npm install
npm test     # 68 个测试，命中 + 结算 + 判死规则覆盖
```

Node ≥ 18。依赖仅 `axios` / `dayjs` / `dotenv`。

## 作为 Claude Code Skill 使用

把本目录放进 Claude Code 的 skills 路径即可被自动发现：

- 项目级：`<你的项目>/.claude/skills/cnlottery-tracker/`
- 用户级：`~/.claude/skills/cnlottery-tracker/`

之后用自然语言即可触发，例如「帮我落一张串关」「今天的票结算一下」。`SKILL.md` 是给 agent 看的操作说明书。

## 跨 agent 使用（Codex / GPT / Hermes 等）

核心是一个标准 CLI（argv 进、JSON 出、退出码 0/1），不绑定任何 agent。一核多壳：

- **Claude 系**：读 `SKILL.md`（本仓库根目录）。
- **Codex 及遵循 AGENTS.md 约定的 agent**：读 `AGENTS.md`。
- **任意 function-calling 模型**：用 `tools.schema.json` 把 7 个命令注册成 tool/function，落到对应 `node scripts/cli.js <action>` 调用。

## 直接用 CLI

命令形如 `node scripts/cli.js [<game>] <action>`，`<game>` 省略时默认 `jc-football`。

```bash
# 查赛程
node scripts/cli.js schedule --date=2026-06-21 --pretty

# 落一张串关（整票 10 元）
node scripts/cli.js bet --json='{"mode":"parlay","amount":10,"selections":[
  {"date":"2026-06-21","teams":["荷兰","瑞典"],"playType":"had","pick":"主胜"},
  {"date":"2026-06-21","teams":["德国","科特迪瓦"],"playType":"had","pick":"主胜"}]}'

# 结算
node scripts/cli.js settle --date=2026-06-21 --pretty
```

每条命令打印 `{ code, msg, data }` JSON；`--pretty` 缩进输出。

## 数据落盘

票据落到 `data/bets/<比赛日>/`，每张票一个 `ticket_*.json`（含整段体彩 raw，防赔率窗口滑出后丢失）+ 一个 `index.json` 索引。用 `DATA_DIR` 环境变量固定落盘位置，避免散落在不同工作目录。

`data/` 默认 gitignore，不会进仓库。

## 数据来源

- 赔率：`getMatchCalculatorV1.qry`
- 赛果：`getUniformMatchResultV1.qry`（含半全场比分）
- 派彩/校验：`getFixedBonusV1.qry`
- 实时比分：`getMatchDataPageListV1.qry?method=live`（进行中比分，串关提前判死活）

> 接口需带 `Referer`/`Origin` 头绕过体彩 WAF，已在 `scripts/config/index.js` 默认配置；可用环境变量覆盖，见 `.env.example`（如有）。

## 玩法 / pick 速查

| playType | 玩法 | pick |
|---|---|---|
| `had` | 胜负平 | `主胜`/`平`/`客胜` |
| `hhad` | 让球胜负平 | `主胜`/`平`/`客胜` |
| `crs` | 比分 | `2:1`、`胜其它`/`平其它`/`负其它` |
| `ttg` | 总进球 | `0`..`6`、`7+` |
| `hafu` | 半全场 | `主主`..`客客` |

## 免责声明

- 本项目是**个人记账与对账工具**，仅用于记录投注、冻结当时赔率、按官方赛果核算盈亏。**不提供代购、不下注、不参与任何资金交易。**
- 与中国体育彩票及任何彩票发行机构**无任何关联、不受其授权或背书**。数据通过公开接口获取，仅供个人学习与记账参考，不保证准确、及时或可用。
- 请遵守所在地区法律法规，理性对待彩票。使用本工具产生的任何后果由使用者自行承担。

## License

MIT
