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

