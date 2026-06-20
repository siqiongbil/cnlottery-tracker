---
name: cnlottery-tracker
description: 中国彩票落票记录与对账（记账，不代购）。当前支持竞彩足球（世界杯等）：查赛程/赔率、记录(落)一张竞彩票、查赛果并结算盈亏、跨日盈亏统计、查历史赔率。支持单关/串关，五类玩法 had/hhad/crs/ttg/hafu，数据来自中国体彩官方接口。规划中：竞彩篮球、北单、大乐透等。当用户要记录彩票投注、查赛程赔率、对账结算、统计盈亏时使用。
---

# 中国彩票落票 + 对账（cnlottery-tracker）

通过本地 CLI 记录彩票投注并对账。**这是记账工具，不代购、不下注**。所有数据来自官方接口（体彩 `webapi.sporttery.cn`），落盘到本地 `data/` 目录。

多彩种总入口，命令形如 `node scripts/cli.js [<game>] <action>`。当前支持彩种：

| game | 彩种 | 状态 |
|---|---|---|
| `jc-football` | 竞彩足球（世界杯等） | ✅ 可用 |
| 竞彩篮球 / 北单 / 大乐透 等 | — | 🚧 规划中 |

`<game>` 省略时默认 `jc-football`（当前唯一彩种，向后兼容）。下文命令均以竞彩足球为例。

## 何时用

- 查赛程 / 五类玩法赔率 →「今天有哪些世界杯比赛」「荷兰对瑞典赔率多少」
- 记录一张票 →「帮我落一张串关：荷兰主胜 + 德国让一球，10 块」
- 查赛果并结算 →「今天的票结算一下」「20 号那天赢了多少」
- 跨日盈亏统计 →「这几天总共盈亏多少」
- 历史赔率 →「20 号比赛在 19 号的赔率」

## 准备

首次使用需安装依赖（在 skill 目录）：

```bash
cd <skill-dir> && npm install
```

落盘目录默认 `data/`（相对当前工作目录）。可用环境变量 `DATA_DIR` 指定，建议统一固定一个，例如 `export DATA_DIR=~/.cnlottery-data`，否则票据会散落在不同 cwd。

## 命令总览

每条命令打印 `{ code, msg, data }` JSON（`code:200` 成功，否则失败且退出码 1）。加 `--pretty` 缩进输出便于阅读。彩种参数 `jc-football` 可省略。

```bash
node scripts/cli.js jc-football schedule [--date=YYYY-MM-DD]
node scripts/cli.js jc-football bet --json='<票体JSON>'
node scripts/cli.js jc-football settle --date=YYYY-MM-DD [--verify]
node scripts/cli.js jc-football stats [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
node scripts/cli.js jc-football odds-history (--matchId=ID | --date=YYYY-MM-DD --teams=队A,队B) [--asOf=...] [--all]
node scripts/cli.js jc-football clear-cache
node scripts/cli.js jc-football clear-files --confirm (--date=YYYY-MM-DD | --all)
```

## 数据模型（落票必读）

一张票 = `mode`（单/串） + `selections[]`（若干选项）。**比赛归属在每个选项里**，所以串关可跨不同比赛、不同比赛日。

| 字段 | 含义 |
|---|---|
| `mode` | `single`(单) / `parlay`(串)。不传按 selections 数量推断 |
| `amount` | `parlay`=整票一注的注额；`single`=各选项默认注额（可被逐项 `selection.amount` 覆盖） |
| `selections[].date` | 比赛日 `YYYY-MM-DD` |
| `selections[].teams` | 1 或 2 个队名（定位比赛；同日同队最多一场） |
| `selections[].matchId` | 可选；直接指定比赛（出窗口/重名时最稳） |
| `selections[].playType` | `had` / `hhad` / `crs` / `ttg` / `hafu` |
| `selections[].pick` | 选号，见下表 |
| `selections[].amount` | 可选，single 模式下生效 |
| `selections[].odds` | 可选；省略时后端按当时体彩快照补并冻结 |

**单 vs 串：**
- `single`：每选项独立结算，`返奖=Σ(命中项 amount×odds)`，部分命中也算整票命中。
- `parlay`：所有选项联合，`合并赔率=Π(odds)`，`返奖=amount×合并赔率`，**全中才派彩**。

### 玩法 / pick 对照

| playType | 玩法 | pick 示例 | 视角 |
|---|---|---|---|
| `had`  | 胜负平（不让球） | `主胜` / `平` / `客胜` | 主队 |
| `hhad` | 让球胜负平 | `主胜` / `平` / `客胜`（让球数落票时冻结） | 主队 |
| `crs`  | 比分 | `2:1`、`胜其它` / `平其它` / `负其它` | 主:客 |
| `ttg`  | 总进球 | `0`..`6`、`7+` | 主客加总 |
| `hafu` | 半全场 | `主主` `主平` `主客` `平主` `平平` `平客` `客主` `客平` `客客`（也接受 `hh`/`33`） | 半场+全场 |

## 典型流程

**1. 查赛程取队名/赔率**（落票前先确认队名拼写与是否在售）：
```bash
node scripts/cli.js schedule --date=2026-06-21 --pretty
```

**2. 落一张串关**（荷兰主胜 + 德国主胜，整票 10 元）：
```bash
node scripts/cli.js bet --pretty --json='{
  "mode":"parlay","amount":10,
  "selections":[
    {"date":"2026-06-21","teams":["荷兰","瑞典"],"playType":"had","pick":"主胜"},
    {"date":"2026-06-21","teams":["德国","科特迪瓦"],"playType":"had","pick":"主胜"}
  ]
}'
```
落票返回每个选项定位到的比赛、冻结赔率（`oddsSource: user|snapshot|history`）、`calc.combinedOdds`/`theoreticalPayout`。重复落票（同 mode + 同选项指纹）返回 `code:409`。

**3. 结算某天**：
```bash
node scripts/cli.js settle --date=2026-06-21 --pretty
```
返回赛果 + 每票每项命中明细 + 汇总（`totalProfit` 等）。票级 `status`：`pending`(都没开赛)/`partial`(部分开)/`settled`(全开)。

## 串关进行中提前判死活

结算时若票里有未开赛/进行中的关，会额外拉实时比分接口，对**数学上已不可能再中**的关提前判死：

| 玩法 | 进行中判死条件 |
|---|---|
| `ttg` 具体数 N | 已进球 > N（`7+` 不判死） |
| `crs` 具体比分 | 某方已超目标（其它比分不判死） |
| `hafu` | 半场已结束且方向 ≠ pick 首字 |
| `had`/`hhad` | 不判死（可逆转） |

只影响串关 `alive`/`deadLegs`（`source: final|live` 标明来源），**不动** `payout`/`isHit`/`settled`（仍只认终场赛果）。

## 注意

- 队名定位失败返回 `code:404`，此时改用 `--date` + 准确队名，或先 `schedule` 查到 `matchId` 再用 `selection.matchId` 指定。
- `clear-files` 是危险操作，会删落盘票据，必须带 `--confirm`，且需 `--date` 或 `--all`。删前向用户确认。
- 上游体彩接口异常返回 `code:502`。
- 把结果讲给用户时用自然语言解读（中了哪几关、盈亏多少、串关是否已死），不要直接甩 JSON。

## 错误码

| code | 含义 |
|---|---|
| 400 | 参数/玩法不支持/日期格式错 |
| 404 | 比赛/票据未找到 |
| 409 | 重复落票 |
| 500 | 运行异常 |
| 502 | 体彩上游接口异常 |
