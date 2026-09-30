/**
 * 前端调用面 vs 后端实现面 对齐检查
 *
 * 验收前必做：把 frontend/src/api/modules.js 里所有接口路径抽出来，
 * 和 cf/routes 里实际注册的路由逐条比对，找出「前端会调但后端没有」的缺口。
 * 这类缺口在点页面时才会暴露成 404，提前扫一遍能省很多来回。
 *
 * 用法：node cf/verify-api-coverage.mjs
 */
import { readFileSync } from 'fs'
import { pathToFileURL } from 'url'

// ---------- 1. 抽前端调用 ----------
const src = readFileSync('D:/Harness/public/frontend/src/api/modules.js', 'utf8')

/** 只保留路径里的静态形状，参数统一成 {p} */
function normalize(p) {
  let s = String(p)
  s = s.replace(/\$\{[^}]*\}/g, '{p}') // ${id} -> {p}
  s = s.replace(/\?.*$/, '') // 去掉查询串
  if (!s.startsWith('/api')) s = '/api' + (s.startsWith('/') ? s : '/' + s)
  s = s.replace(/\/+$/, '')
  return s
}

const frontend = new Set()
const frontendRaw = []
const re = /\bapi\.(get|post|put|delete|patch)\s*\(\s*[`'"]([^`'"]+)[`'"]/g
let m
while ((m = re.exec(src))) {
  const method = m[1].toUpperCase()
  const path = normalize(m[2])
  frontend.add(`${method} ${path}`)
  frontendRaw.push({ method, path, raw: m[2] })
}

// ---------- 2. 抽后端路由 ----------
const MODS = [
  'auth', 'users', 'products', 'customers', 'suppliers', 'inventory',
  'purchase', 'sales', 'stock', 'saleReturns', 'purchaseReturns',
  'payments', 'reports', 'system',
]

/** 把路径正则归一成同样的形状：数字参数 -> {p} */
function shapeOf(src) {
  let s = src.replace(/^\^/, '').replace(/\$$/, '')
  s = s.replace(/\(\?<[^>]+>\\d\+\)/g, '{p}')
  s = s.replace(/\(\?<[^>]+>\[\^\/\]\+\)/g, '{p}')
  s = s.replace(/\(\?<[^>]+>([A-Za-z_]+)\)/g, '$1')
  s = s.replace(/\\/g, '')
  return s.replace(/\/+$/, '')
}

const backend = new Set()
const backendList = []
for (const mod of MODS) {
  const rmod = await import(pathToFileURL(`D:/Harness/public/cf/routes/${mod}.js`).href)
  for (const r of rmod.routes || []) {
    const shape = shapeOf(r.path.source)
    backend.add(`${r.method} ${shape}`)
    backendList.push({ method: r.method, path: shape, module: mod })
  }
}

// ---------- 3. 比对 ----------
console.log(`前端声明的调用：${frontend.size} 条`)
console.log(`后端注册的路由：${backend.size} 条\n`)

const missing = [...frontend].filter((k) => !backend.has(k)).sort()

console.log('='.repeat(66))
if (missing.length === 0) {
  console.log('  前端调用的每个接口后端都已实现（无缺口）')
} else {
  console.log(`  !! 有 ${missing.length} 个前端调用后端没有对应路由：`)
  for (const k of missing) {
    const raw = frontendRaw.find((x) => `${x.method} ${x.path}` === k)
    console.log(`     ${k}     ← ${raw ? raw.raw : ''}`)
  }
}
console.log('='.repeat(66))

// ---------- 4. 反向：后端有但前端没用到（仅供参考，不算问题） ----------
const unused = [...backend].filter((k) => !frontend.has(k)).sort()
if (unused.length) {
  console.log(`\n（参考）后端有、前端 modules.js 里没直接出现的 ${unused.length} 条：`)
  for (const k of unused) console.log(`     ${k}`)
}

process.exit(missing.length ? 1 : 0)
