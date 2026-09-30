/**
 * HTTP 响应 / 错误小工具
 *
 * 响应体形状与 FastAPI 端保持一致，前端 axios 拦截器无需改动：
 *   成功列表      { total, page, page_size, items, summary }
 *   成功单对象    { ...字段 }
 *   成功消息      { code: 200, message, data }
 *   失败          { detail: "..." }        ← FastAPI 的默认错误体
 */

export class HttpError extends Error {
  constructor(status, detail) {
    super(detail)
    this.name = 'HttpError'
    this.status = status
    this.detail = detail
  }
}

export const bad = (msg) => {
  throw new HttpError(400, msg)
}
export const unauthorized = (msg = '未登录或登录已过期') => {
  throw new HttpError(401, msg)
}
export const forbidden = (msg = '权限不足') => {
  throw new HttpError(403, msg)
}
export const notFound = (msg = '记录不存在') => {
  throw new HttpError(404, msg)
}
export const notImplemented = (msg) => {
  throw new HttpError(501, msg)
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  })
}

/** FastAPI 风格的错误体 */
export function errorBody(detail, status) {
  return json({ detail }, status)
}

/** ResponseModel：{ code, message, data } */
export function ok(message = 'success', data = null) {
  return json({ code: 200, message, data })
}

/** PaginatedResponse */
export function paginated(total, page, pageSize, items, summary = null) {
  return json({ total, page, page_size: pageSize, items, summary })
}

// ---------------- 参数处理 ----------------

export function intParam(value, def = null) {
  if (value === null || value === undefined || value === '') return def
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : def
}

export function boolParam(value, def = false) {
  if (value === null || value === undefined || value === '') return def
  return value === 'true' || value === '1' || value === true
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** 分页参数归一（与 FastAPI 的 Query(ge=1) 行为对齐） */
export function paginationOf(url, { defaultSize = 20, maxSize = 1000 } = {}) {
  let page = intParam(url.searchParams.get('page'), 1)
  let pageSize = intParam(url.searchParams.get('page_size'), defaultSize)
  if (!Number.isFinite(page) || page < 1) page = 1
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = defaultSize
  if (pageSize > maxSize) pageSize = maxSize
  return { page, pageSize, offset: (page - 1) * pageSize }
}

/**
 * LIKE 模糊匹配参数（对应 SQLAlchemy 的 .contains()）
 * % 和 _ 转义，避免用户输入被当通配符
 */
export function likeArg(keyword) {
  return '%' + String(keyword).replace(/[\\%_]/g, (c) => '\\' + c) + '%'
}
