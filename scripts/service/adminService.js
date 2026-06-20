/**
 * 管理 / 维护操作。
 *
 * - clearCache：清三个上游接口的内存缓存（赔率/赛果/派彩）
 * - clearFiles：清落盘票据。按 date 清某天，或 all=true 清全部。
 *               危险操作，需 confirm=true。会先备份计数返回。
 */
const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('../config');
const oddsClient = require('./oddsClient');
const resultClient = require('./resultClient');
const bonusClient = require('./bonusClient');
const liveClient = require('./liveClient');
const { isValidDate } = require('../utils/dateUtil');

function clearCache() {
  return {
    odds: oddsClient.clearCache(),
    result: resultClient.clearCache(),
    bonus: bonusClient.clearCache(),
    live: liveClient.clearCache()
  };
}

function betsRoot() {
  return path.join(DATA_DIR, 'bets');
}

// 统计某目录下票据数
function countTickets(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => /^ticket_.+\.json$/.test(f)).length;
}

function rmDir(dir) {
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * 清落盘文件。
 * @param {object} opts { date?: 'YYYY-MM-DD', all?: boolean, confirm: boolean }
 */
function clearFiles(opts = {}) {
  const { date, all, confirm } = opts;

  if (!confirm) {
    const e = new Error('confirm=true is required to clear files');
    e.statusCode = 400;
    throw e;
  }
  if (!all && !date) {
    const e = new Error('either date or all=true is required');
    e.statusCode = 400;
    throw e;
  }
  if (date && !isValidDate(date)) {
    const e = new Error('date must be in YYYY-MM-DD format');
    e.statusCode = 400;
    throw e;
  }

  if (all) {
    const root = betsRoot();
    let removedDays = 0;
    let removedTickets = 0;
    if (fs.existsSync(root)) {
      for (const d of fs.readdirSync(root)) {
        const dir = path.join(root, d);
        if (!fs.statSync(dir).isDirectory()) continue;
        removedTickets += countTickets(dir);
        if (rmDir(dir)) removedDays += 1;
      }
    }
    return { scope: 'all', removedDays, removedTickets };
  }

  // 单日
  const dir = path.join(betsRoot(), date);
  const removedTickets = countTickets(dir);
  const existed = rmDir(dir);
  return { scope: 'date', date, existed, removedTickets };
}

module.exports = { clearCache, clearFiles };
