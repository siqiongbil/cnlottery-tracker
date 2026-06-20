const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { TIME_ZONE } = require('../config');

dayjs.extend(utc);
dayjs.extend(timezone);

function today() {
  return dayjs().tz(TIME_ZONE).format('YYYY-MM-DD');
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

// 规整 asOf：接受 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm[:ss]'（也容忍 ISO 的 T）。非法返回 null。
function normalizeAsOf(v) {
  if (!v) return null;
  const s = String(v).trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s)) return s;
  return null;
}

module.exports = { today, isValidDate, normalizeAsOf };
