/**
 * 业务时区工具
 *
 * 与 backend/app/core/timeutil.py 行为一致：
 * 不管服务器时区，一律按 APP_TIMEZONE（默认 Asia/Shanghai）输出，
 * 格式 'YYYY-MM-DD HH:MM:SS.ffffff'，与 SQLAlchemy 写入 SQLite 的格式兼容。
 */

const DEFAULT_TZ = 'Asia/Shanghai'

function zone(env) {
  return (env && env.APP_TIMEZONE) || DEFAULT_TZ
}

function partsOf(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const out = {}
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value
  }
  return out
}

/** 'YYYY-MM-DD HH:MM:SS.ffffff' */
export function nowLocal(env) {
  const d = new Date()
  const p = partsOf(d, zone(env))
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}.${ms}000`
}

/** 'YYYY-MM-DD HH:MM:SS' */
export function nowLocalSec(env) {
  return nowLocal(env).slice(0, 19)
}

/** 'YYYY-MM-DD' */
export function todayLocal(env) {
  const p = partsOf(new Date(), zone(env))
  return `${p.year}-${p.month}-${p.day}`
}

/** 'YYYY-MM' —— 记账期间 */
export function currentPeriod(env) {
  return todayLocal(env).slice(0, 7)
}

/** 业务时区下的 yyyymmdd，用于单号 */
export function dateStamp(env) {
  const p = partsOf(new Date(), zone(env))
  return `${p.year}${p.month}${p.day}`
}

/**
 * 把库里的 'YYYY-MM-DD HH:MM:SS.ffffff' 转成 FastAPI 输出的 ISO 形式
 * 'YYYY-MM-DDTHH:MM:SS.ffffff'，前端展示逻辑无需改动。
 */
export function isoOf(value) {
  if (!value) return value ?? null
  const s = String(value)
  return s.includes('T') ? s : s.replace(' ', 'T')
}

/** 只保留日期部分（DATE 列，FastAPI 输出 'YYYY-MM-DD'） */
export function dateOf(value) {
  if (!value) return value ?? null
  return String(value).slice(0, 10)
}

/**
 * 把 'YYYY-MM-DD' 补成当天末尾，用于 `created_at <= ?` 的范围上界。
 *
 * 为什么需要：created_at 存的是 'YYYY-MM-DD HH:MM:SS.ffffff'（TEXT），
 * 直接和 '2026-09-30' 比字符串时，'2026-09-30 10:00:00' > '2026-09-30'
 * （前 10 位相同后，长的那串更大），导致**结束日期当天的数据全部被漏掉**。
 * Python 版存在这个问题，Cloudflare 版已修正。
 */
export function endOfDayBound(value) {
  if (!value) return value
  const s = String(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s} 23:59:59.999999` : s
}

/** 日期加减天数（只处理 'YYYY-MM-DD'，用 UTC 避免时区偏移） */
export function addDays(dateStr, delta) {
  const base = new Date(`${dateStr}T00:00:00Z`)
  return new Date(base.getTime() + delta * 86400000).toISOString().slice(0, 10)
}

