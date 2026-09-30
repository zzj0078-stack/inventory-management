/**
 * D1 用量实测：每种操作花了多少次查询、读了多少行、写了多少行
 *
 * 为什么要这个：D1 的限制是「按量」的 ——
 *   - 每个 Worker 调用最多 1000 次查询（免费 50）
 *   - 免费计划每天 10 万行写入 / 500 万行读取
 * 光看代码猜不出来，这个脚本直接读响应头（X-D1-Queries 等）把真实数字打出来，
 * 再按「20 人公司一天大概多少操作」折算成配额占比。
 *
 * 用法：
 *   node cf/verify-d1-cost.mjs [base] [user] [pass]
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/$/, '')
const USER = process.argv[3] || 'admin'
const PASS = process.argv[4] || 'admin123'

const rows = []

async function call(method, path, { token, body } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    /* 非 JSON */
  }
  return {
    status: res.status,
    data,
    cost: {
      queries: Number(res.headers.get('x-d1-queries') || 0),
      read: Number(res.headers.get('x-d1-rows-read') || 0),
      written: Number(res.headers.get('x-d1-rows-written') || 0),
    },
  }
}

function record(label, res, note = '') {
  rows.push({ label, status: res.status, ...res.cost, note })
  const flag = res.status >= 400 ? '  ⚠' : ''
  console.log(
    `  ${String(res.status).padEnd(4)} ${label.padEnd(34)}` +
      `查询 ${String(res.cost.queries).padStart(4)}  ` +
      `读 ${String(res.cost.read).padStart(7)}  ` +
      `写 ${String(res.cost.written).padStart(6)}${flag}`
  )
}

// ---------------- 登录 ----------------
const login = await call('POST', '/api/auth/login', { body: { username: USER, password: PASS } })
if (login.status !== 200) {
  console.log(`登录失败（${login.status}）：${JSON.stringify(login.data)}`)
  process.exit(1)
}
const T = login.data.access_token

console.log(`目标：${BASE}\n`)
console.log('=== 读操作 ===')
record('登录', login)
record('首页看板', await call('GET', '/api/ext/dashboard', { token: T }))
record('销售日报 7 天', await call('GET', '/api/ext/sales-daily?days=7', { token: T }))
record('商品列表 page_size=20', await call('GET', '/api/products?page=1&page_size=20', { token: T }))
record('商品列表 page_size=100', await call('GET', '/api/products?page=1&page_size=100', { token: T }))
record('客户列表', await call('GET', '/api/customers?page=1&page_size=20&status=1', { token: T }))
record('库存列表 page_size=100', await call('GET', '/api/inventory?page=1&page_size=100', { token: T }))
record('销售单列表', await call('GET', '/api/sales?page=1&page_size=20', { token: T }))
record('销售单列表 page_size=100', await call('GET', '/api/sales?page=1&page_size=100', { token: T }))
record('报表·利润（全商品）', await call('GET', '/api/ext/reports/profit', { token: T }))
record('报表·销售', await call('GET', '/api/ext/reports/sales', { token: T }))
record('报表·库存', await call('GET', '/api/ext/reports/inventory', { token: T }))
record('应收应付', await call('GET', '/api/ext/receivables', { token: T }))
record('操作日志列表', await call('GET', '/api/ext/logs?page=1&page_size=20', { token: T }))
record('数据自检（全库扫描）', await call('GET', '/api/ext/health-check', { token: T }))
record('CSV 导出·销售', await call('GET', '/api/ext/export/sales', { token: T }))

// 找一个有明细的销售单测详情
let saleId = null
{
  const list = await call('GET', '/api/sales?page=1&page_size=1', { token: T })
  saleId = list.data?.items?.[0]?.id
}
if (saleId) {
  record(`销售单详情（id=${saleId}）`, await call('GET', `/api/sales/${saleId}`, { token: T }))
}

console.log('\n=== 写操作 ===')
{
  // 取 150 个商品 + 一个客户，建一张大单
  const prods = await call('GET', '/api/products?page=1&page_size=100', { token: T })
  const prods2 = await call('GET', '/api/products?page=2&page_size=100', { token: T })
  const ids = [...(prods.data?.items || []), ...(prods2.data?.items || [])].map((p) => p.id)
  const cust = await call('GET', '/api/customers?page=1&page_size=1&status=1', { token: T })
  const customerId = cust.data?.items?.[0]?.id

  if (ids.length >= 100 && customerId) {
    const big = await call('POST', '/api/sales', {
      token: T,
      body: {
        customer_id: customerId,
        remark: '__D1成本实测',
        items: ids.slice(0, 150).map((pid) => ({ product_id: pid, quantity: 1, price: 10 })),
      },
    })
    record(`新建销售单（${ids.slice(0, 150).length} 条明细）`, big)
    const newId = big.data?.id
    if (newId) {
      record('审核销售单', await call('PUT', `/api/sales/${newId}/approve`, { token: T }))
    }
  } else {
    console.log(`  跳过新建大单（商品 ${ids.length} 个，客户 ${customerId ? '有' : '无'}）`)
  }

  // 收付款一笔
  if (customerId) {
    record(
      '登记收款',
      await call('POST', '/api/ext/payments', {
        token: T,
        body: { type: 1, partner_type: 'customer', partner_id: customerId, amount: 1, payment_method: '现金', remark: '__D1成本实测' },
      })
    )
  }
}

console.log('\n=== 批量操作（最容易撞限制的）===')
{
  const preview = await call('GET', '/api/ext/stock-checks/preview', { token: T })
  record(`盘点底稿预览（${preview.data?.items?.length || 0} 项）`, preview)

  // 建底稿必须带上明细（预览给出的账面数即实盘数，diff=0）
  const checkItems = (preview.data?.items || []).map((i) => ({
    product_id: i.product_id,
    system_quantity: i.system_quantity,
    actual_quantity: i.system_quantity,
  }))

  const create = await call('POST', '/api/ext/stock-checks', {
    token: T,
    body: { warehouse_id: preview.data?.warehouse_id, items: checkItems, remark: '__D1成本实测' },
  })
  record(`盘点建底稿（${checkItems.length} 项）`, create, '逐行插入时 = N 条语句')
  const checkId = create.data?.id

  if (checkId) {
    // 审核走 planStock：每项一条 UPDATE + 一条流水 INSERT，是最重的路径
    record(`盘点审核（${checkItems.length} 项）`, await call('PUT', `/api/ext/stock-checks/${checkId}/approve`, { token: T }))
    await call('PUT', `/api/ext/stock-checks/${checkId}/cancel`, { token: T })
  }

  record('生成期初流水（重建全部）', await call('POST', '/api/ext/stock-logs/init?overwrite=true', { token: T }))
}

// ---------------- 汇总 ----------------
// 只看真正写库的操作来折算每日写入量 —— 读操作写 0 行，混进来会把中位数拉成 0
const writes = rows.filter((r) => r.written > 0)
const maxQ = Math.max(...rows.map((r) => r.queries))
const maxW = Math.max(...rows.map((r) => r.written))
const heaviestQ = rows.find((r) => r.queries === maxQ)
const heaviestW = rows.find((r) => r.written === maxW)

const sumW = rows.reduce((s, r) => s + r.written, 0)
const sumQ = rows.reduce((s, r) => s + r.queries, 0)

console.log(`\n${'='.repeat(78)}`)
console.log(`  共测 ${rows.length} 种操作：查询合计 ${sumQ}，写入合计 ${sumW} 行`)
console.log('')
console.log(`  ① 单次调用查询次数上限（免费 50 / 付费 1000）`)
console.log(`     最多的一次：${maxQ} 次 —— ${heaviestQ.label}`)
console.log(`     ${maxQ > 50 ? '❌ 免费计划会超' : `✅ 免费计划安全（余量 ${50 - maxQ}）`}，付费计划安全`)
console.log('')
console.log(`  ② 单次操作写入行数（免费 100,000 行/天）`)
console.log(`     最多的一次：${maxW} 行 —— ${heaviestW.label}`)
console.log(`     占每日额度 ${((maxW / 100000) * 100).toFixed(2)}%`)
console.log('')

// 按「20 人公司一天多少操作」折算：给出乐观/常见/繁忙三档
const scenarios = [
  ['清闲（50 次写操作/天）', 50],
  ['常见（300 次写操作/天）', 300],
  ['繁忙（1000 次写操作/天）', 1000],
]
const avgW = writes.length ? sumW / writes.length : 0
const maxWriteRows = writes.length ? Math.max(...writes.map((r) => r.written)) : 0

console.log(`  ③ 折算到每天（写操作平均 ${avgW.toFixed(1)} 行/次，最多 ${maxWriteRows} 行/次）`)
for (const [name, n] of scenarios) {
  const avgDaily = avgW * n
  const worstDaily = maxWriteRows * n
  console.log(
    `     ${name.padEnd(22)} 平均 ${Math.round(avgDaily).toLocaleString('zh-CN').padStart(9)} 行/天` +
      `（占 ${((avgDaily / 100000) * 100).toFixed(1)}%）` +
      `  最坏 ${Math.round(worstDaily).toLocaleString('zh-CN').padStart(10)} 行/天` +
      `（占 ${((worstDaily / 100000) * 100).toFixed(0)}%）`
  )
}
console.log('')
console.log('  ④ 本库实时用量（wrangler d1 info inventory 可复查）')
console.log('     免费额度：写 100,000 行/天、读 5,000,000 行/天、存储 5 GB')
console.log(`${'='.repeat(78)}`)

