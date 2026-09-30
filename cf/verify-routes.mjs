/**
 * 路由面覆盖检查：把全部路由枚举出来，逐条真实请求一次。
 *
 * 目的：证明「112 条路由都已注册且可达」，而不是只靠数量统计。
 * 判定标准：无 token 请求时**不应返回 404**（404 = 路由不存在）。
 *   - 需鉴权的接口 → 401
 *   - 公开接口（登录、密码规则）→ 400/401 等业务码
 *
 * 用法：node cf/verify-routes.mjs [base]
 */
import { pathToFileURL } from 'url'

const BASE = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/$/, '')
const MODS = [
  'auth', 'users', 'products', 'customers', 'suppliers', 'inventory',
  'purchase', 'sales', 'stock', 'saleReturns', 'purchaseReturns',
  'payments', 'reports', 'system',
]

/** 把路径正则变成可请求的具体路径 */
function concretize(src) {
  let s = src.replace(/^\^/, '').replace(/\$$/, '')
  s = s.replace(/\(\?<[^>]+>\\d\+\)/g, '1')            // (?<id>\d+)      -> 1
  s = s.replace(/\(\?<[^>]+>\[\^\/\]\+\)/g, 'sales')   // (?<kind>[^/]+)  -> sales
  s = s.replace(/\(\?<[^>]+>([A-Za-z_]+)\)/g, '$1')    // (?<kind>inventory) -> inventory
  return s
}

const all = []
for (const m of MODS) {
  const mod = await import(pathToFileURL(`D:/Harness/public/cf/routes/${m}.js`).href)
  for (const r of mod.routes || []) {
    all.push({ module: m, method: r.method, path: concretize(r.path.source), perm: r.perm, pub: !!r.public })
  }
}

console.log(`目标：${BASE}`)
console.log(`枚举到 ${all.length} 条路由\n`)

let ok = 0
let missing = 0
const bad = []

for (const r of all) {
  let status = 0
  try {
    const res = await fetch(BASE + r.path, {
      method: r.method,
      headers: r.method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: r.method === 'GET' ? undefined : '{}',
    })
    status = res.status
  } catch (e) {
    status = -1
  }

  if (status === 404) {
    missing++
    bad.push(r)
    console.log(`  404  ${r.method.padEnd(6)} ${r.path}  (${r.module})`)
  } else if (status === -1) {
    missing++
    bad.push(r)
    console.log(`  ERR  ${r.method.padEnd(6)} ${r.path}  (${r.module})`)
  } else {
    ok++
  }
}

console.log(`\n${'='.repeat(60)}`)
console.log(`  已注册可达 ${ok} / ${all.length}`)
if (missing) {
  console.log(`  !! 有 ${missing} 条返回 404（未注册）`)
  for (const b of bad) console.log(`     ${b.method} ${b.path}`)
} else {
  console.log('  全部路由均已注册且可达（无 404）')
}
console.log('='.repeat(60))
process.exit(missing ? 1 : 0)
