/**
 * 进销存系统 —— Cloudflare Pages Function 入口
 *
 * 替代 backend（FastAPI）的全部 API 路由：
 *   - 从请求里解析 path，按路由表匹配（正则 + 命名分组）
 *   - 公开路径直接放行；其余解析 JWT 取用户
 *   - 按路由声明的权限码校验（数组为 OR 语义，admin 通配）
 *   - 未实现的接口返回 501 并说明属于哪个阶段，避免前端拿到困惑的 404
 *
 * 配置：
 *   D1 绑定        DB        （wrangler.toml）
 *   JWT 密钥       SECRET_KEY（wrangler pages secret put SECRET_KEY）
 */

import { HttpError, errorBody, json } from '../../cf/lib/http.js'
import { makeDb } from '../../cf/lib/db.js'
import { decodeToken } from '../../cf/lib/crypto.js'
import { loadPermissions, hasPerm, needText } from '../../cf/lib/perms.js'
import { nowLocal } from '../../cf/lib/time.js'

import { routes as authRoutes } from '../../cf/routes/auth.js'
import { routes as userRoutes } from '../../cf/routes/users.js'
import { routes as productRoutes } from '../../cf/routes/products.js'
import { routes as customerRoutes } from '../../cf/routes/customers.js'
import { routes as supplierRoutes } from '../../cf/routes/suppliers.js'
import { routes as inventoryRoutes } from '../../cf/routes/inventory.js'
import { routes as purchaseRoutes } from '../../cf/routes/purchase.js'
import { routes as salesRoutes } from '../../cf/routes/sales.js'
import { routes as stockRoutes } from '../../cf/routes/stock.js'

const ROUTES = [
  ...authRoutes,
  ...userRoutes,
  ...productRoutes,
  ...customerRoutes,
  ...supplierRoutes,
  ...inventoryRoutes,
  ...purchaseRoutes,
  ...salesRoutes,
  ...stockRoutes,
]

/** 尚未移植的模块（按路径区分，返回 501 时告知阶段） */
const PENDING = [
  { re: /^\/api\/ext\/sale-returns/, module: '销售退货', phase: '阶段 3' },
  { re: /^\/api\/ext\/purchase-returns/, module: '采购退货', phase: '阶段 3' },
  { re: /^\/api\/ext\/payments/, module: '收付款', phase: '阶段 3' },
  { re: /^\/api\/ext\/receivables/, module: '应收应付', phase: '阶段 3' },
  { re: /^\/api\/ext\/reports/, module: '报表统计', phase: '阶段 4' },
  { re: /^\/api\/ext\/logs/, module: '操作日志', phase: '阶段 4' },
  { re: /^\/api\/ext\/dashboard/, module: '首页看板', phase: '阶段 4' },
  { re: /^\/api\/ext\/sales-daily/, module: '首页看板', phase: '阶段 4' },
  { re: /^\/api\/ext\/health-check/, module: '数据自检', phase: '阶段 4' },
  { re: /^\/api\/ext\/export/, module: 'CSV 导出', phase: '阶段 4' },
]

// ---------------- CORS ----------------

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
  }
}

function withCors(response) {
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v)
  return new Response(response.body, { status: response.status, headers })
}

// ---------------- 请求处理 ----------------

function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
    ''
  )
}

async function readBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'DELETE') {
    // DELETE 可能带 body（本项目没有），但查询参数仍是主要来源
    if (request.method === 'DELETE') return null
    return null
  }
  const text = await request.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

/** 解析 Bearer token 并取出用户行 */
async function resolveUser(request, db, secret) {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, '未登录或登录已过期')
  }

  const payload = await decodeToken(auth.slice(7).trim(), secret)
  if (!payload || !payload.sub) {
    throw new HttpError(401, '未登录或登录已过期')
  }

  const user = await db.first('SELECT * FROM users WHERE id = ?', Number(payload.sub))
  if (!user) throw new HttpError(401, '登录状态已失效，请重新登录')
  if (user.status === 0) throw new HttpError(403, '用户已被禁用')

  return user
}

function findRoute(method, pathname) {
  for (const route of ROUTES) {
    if (route.method !== method) continue
    const m = route.path.exec(pathname)
    if (!m) continue
    return { route, params: m.groups || {} }
  }
  return null
}

async function handle(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  const pathname = url.pathname

  // 健康检查
  if (pathname === '/api/health') {
    let dbOk = true
    let counts = null
    try {
      const db = makeDb(env)
      counts = {
        users: await db.count('SELECT COUNT(*) AS n FROM users'),
        products: await db.count('SELECT COUNT(*) AS n FROM products'),
      }
    } catch {
      dbOk = false
    }
    return json({ ok: dbOk, name: 'inventory', db: 'd1', counts, now: nowLocal(env) })
  }

  const matched = findRoute(method, pathname)

  if (!matched) {
    if (pathname.startsWith('/api/')) {
      const pending = PENDING.find((p) => p.re.test(pathname))
      if (pending) {
        throw new HttpError(
          501,
          `${pending.module} 接口尚未移植到 Cloudflare（计划 ${pending.phase}）。` +
            `当前已可用：登录、权限、用户、商品、分类、客户、供应商、仓库、库存查询。`
        )
      }
      throw new HttpError(404, `接口不存在：${method} ${pathname}`)
    }
    // 非 /api 路径交给静态资源（Pages 会自动处理，这里兜底）
    return context.next()
  }

  const { route, params } = matched
  const db = makeDb(env)

  let user = null
  let perms = null

  if (!route.public) {
    const secret = env.SECRET_KEY
    if (!secret) {
      throw new HttpError(
        500,
        'SECRET_KEY 未配置。执行：wrangler pages secret put SECRET_KEY --project-name=inventory'
      )
    }
    user = await resolveUser(request, db, secret)

    if (route.perm) {
      perms = await loadPermissions(db, user)
      if (!hasPerm(perms.codes, route.perm)) {
        throw new HttpError(403, needText(route.perm))
      }
    }
  }

  const ctx = {
    request,
    env,
    url,
    db,
    params,
    body: await readBody(request),
    user,
    perms,
    secret: env.SECRET_KEY,
    ip: clientIp(request),
  }

  return route.handler(ctx)
}

export async function onRequest(context) {
  if (context.request.method.toUpperCase() === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  try {
    return withCors(await handle(context))
  } catch (e) {
    if (e instanceof HttpError) {
      return withCors(errorBody(e.detail, e.status))
    }
    const detail = (e && e.message) || String(e)
    console.error(`[500] ${context.request.method} ${new URL(context.request.url).pathname}`)
    console.error(e && e.stack ? e.stack : e)
    return withCors(errorBody(`服务器内部错误：${detail}`, 500))
  }
}
