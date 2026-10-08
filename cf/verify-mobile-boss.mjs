/**
 * 老板界面接口契约验证
 *
 * 为什么需要：手机 UI 没法在命令行里点，但页面绑定的字段名如果和后端对不上，
 * 用户看到的就是空白/报错。这个脚本把「老板界面」4 个页面读的字段逐个断言一遍。
 *
 * 覆盖：
 *   看板 boss/Dashboard.vue   → /ext/dashboard、/ext/sales-daily、
 *                               /ext/reports/{sales,purchase,profit}、status=0 计数
 *   待审 boss/Approve.vue     → /sales?status=0、/purchase?status=0 的列表字段
 *   报表 boss/Reports.vue     → 4 张报表的全部字段
 *   欠款 boss/Debts.vue       → /ext/receivables、/customers、/{id}/outstanding
 *
 * 只读：不创建、不修改任何数据，所以**可以直接对生产跑**。
 *
 * 用法：
 *   node cf/verify-mobile-boss.mjs                                  # 本地
 *   node cf/verify-mobile-boss.mjs https://inventory-b4k.pages.dev admin 密码
 *   BASE=... SMOKE_USER=... SMOKE_PASS=... node cf/verify-mobile-boss.mjs
 */

const BASE = (process.argv[2] || process.env.BASE || 'http://127.0.0.1:8788').replace(/\/$/, '')
const USER = process.argv[3] || process.env.SMOKE_USER || 'admin'
const PASS = process.argv[4] || process.env.SMOKE_PASS || 'admin123'

let pass = 0
let fail = 0
const failures = []

function check(label, cond, extra = '') {
  if (cond) {
    pass++
  } else {
    fail++
    failures.push(label + (extra ? `  (${extra})` : ''))
    console.log(`  FAIL ${label}${extra ? '  ' + extra : ''}`)
  }
}

function section(t) {
  console.log(`\n=== ${t} ===`)
}

/** 字段存在性（允许 null，但 key 必须在 —— 页面读的是 key） */
const has = (obj, keys) => obj && keys.every((k) => Object.prototype.hasOwnProperty.call(obj, k))
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

let T = ''

async function call(method, path, { body, token = T } = {}) {
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
    data = text
  }
  return { status: res.status, data }
}

const today = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
const monthStart = () => today().slice(0, 8) + '01'

async function main() {
  console.log(`目标：${BASE}`)
  console.log(`账号：${USER}`)

  // ---------------- 登录 ----------------
  section('登录与角色')
  const login = await call('POST', '/api/auth/login', { body: { username: USER, password: PASS }, token: '' })
  check('登录返回 200', login.status === 200, `status=${login.status}`)
  if (login.status !== 200) {
    console.log('\n登录失败，后续检查无法进行。')
    console.log(`提示：线上若已按安全建议改过 admin 密码，必须传入新密码。`)
    process.exit(1)
  }
  T = login.data.access_token
  check('返回 access_token', typeof T === 'string' && T.length > 20)
  check('返回 user 对象', has(login.data.user, ['id', 'username']))

  const perms = await call('GET', '/api/auth/my-permissions')
  check('my-permissions 返回 200', perms.status === 200)
  check('含 permissions 数组', Array.isArray(perms.data.permissions))
  check('含 role_name 字段（老板判定依赖它）', has(perms.data, ['role_name']))

  const roleName = String(perms.data.role_name || '').toLowerCase()
  const isWildcard = perms.data.permissions.includes('*')
  const bossByRole = isWildcard || roleName === 'manager'
  console.log(
    `  角色=${perms.data.role_name}  权限数=${perms.data.permissions.length}  ` +
      `界面=${bossByRole ? '老板' : '员工'}`
  )

  // ---------------- 看板（boss/Dashboard.vue）----------------
  section('看板 Dashboard.vue')
  const dash = await call('GET', '/api/ext/dashboard')
  check('dashboard 返回 200', dash.status === 200, `status=${dash.status}`)
  check(
    'dashboard 字段齐全',
    has(dash.data, [
      'today_sales',
      'today_sales_count',
      'today_purchase',
      'today_purchase_count',
      'pending_sales_out',
      'pending_purchase_in',
      'receivable',
      'payable',
      'low_stock_count',
      'inventory_total',
    ])
  )
  check('today_sales 是数字', isNum(dash.data.today_sales))

  const daily = await call('GET', '/api/ext/sales-daily?days=7')
  check('sales-daily 返回 200', daily.status === 200)
  check('sales-daily 含 total_amount / items', has(daily.data, ['total_amount', 'items']))
  check('sales-daily 补足 7 天', Array.isArray(daily.data.items) && daily.data.items.length === 7)
  if (daily.data.items && daily.data.items.length) {
    check('items[0] 含 date / amount', has(daily.data.items[0], ['date', 'amount']))
  }

  const pendingSales = await call('GET', '/api/sales?status=0&page_size=1')
  const pendingPurchase = await call('GET', '/api/purchase?status=0&page_size=1')
  check('待审销售单计数可取', pendingSales.status === 200 && isNum(pendingSales.data.total))
  check('待审采购单计数可取', pendingPurchase.status === 200 && isNum(pendingPurchase.data.total))
  console.log(`  待审：销售 ${pendingSales.data.total} / 采购 ${pendingPurchase.data.total}`)

  // ---------------- 待审（boss/Approve.vue）----------------
  section('待审 Approve.vue')
  const saleFields = ['id', 'order_no', 'status', 'total_amount', 'created_at', 'customer_name']
  const purchFields = ['id', 'order_no', 'status', 'total_amount', 'created_at', 'supplier_name']

  const sale0 = await call('GET', '/api/sales?page=1&page_size=20&status=0')
  check('销售单 status=0 列表可取', sale0.status === 200)
  if (sale0.data.items && sale0.data.items.length) {
    check('销售单行含页面所需字段', has(sale0.data.items[0], saleFields), JSON.stringify(Object.keys(sale0.data.items[0])))
  } else {
    console.log('  （本地无待审销售单，字段断言跳过；明细字段与 /sales?status=3 一致）')
    const anySale = await call('GET', '/api/sales?page=1&page_size=1')
    if (anySale.data.items && anySale.data.items.length) {
      check('销售单行含页面所需字段', has(anySale.data.items[0], saleFields))
    }
  }

  const pur0 = await call('GET', '/api/purchase?page=1&page_size=20&status=0')
  check('采购单 status=0 列表可取', pur0.status === 200)
  if (pur0.data.items && pur0.data.items.length) {
    check('采购单行含页面所需字段', has(pur0.data.items[0], purchFields))
  } else {
    const anyPur = await call('GET', '/api/purchase?page=1&page_size=1')
    if (anyPur.data.items && anyPur.data.items.length) {
      check('采购单行含页面所需字段', has(anyPur.data.items[0], purchFields))
    }
  }

  // ---------------- 报表（boss/Reports.vue）----------------
  section('报表 Reports.vue')
  const range = `start_date=${monthStart()}&end_date=${today()}`

  const rSales = await call('GET', `/api/ext/reports/sales?${range}`)
  check('销售报表 200', rSales.status === 200, `status=${rSales.status}`)
  check(
    '销售报表字段齐全',
    has(rSales.data, ['total_amount', 'order_count', 'by_customer', 'by_product'])
  )
  if (rSales.data.by_customer && rSales.data.by_customer.length) {
    check('by_customer 含 name/amount', has(rSales.data.by_customer[0], ['name', 'amount']))
  }
  if (rSales.data.by_product && rSales.data.by_product.length) {
    check('by_product 含 name/qty/amount', has(rSales.data.by_product[0], ['name', 'qty', 'amount']))
  }

  const rPurch = await call('GET', `/api/ext/reports/purchase?${range}`)
  check('采购报表 200', rPurch.status === 200, `status=${rPurch.status}`)
  check(
    '采购报表字段齐全',
    has(rPurch.data, ['total_amount', 'order_count', 'by_supplier', 'by_product'])
  )

  const rProfit = await call('GET', `/api/ext/reports/profit?${range}`)
  check('利润报表 200', rProfit.status === 200, `status=${rProfit.status}`)
  check(
    '利润报表字段齐全',
    has(rProfit.data, ['total_sale', 'total_cost', 'profit', 'profit_rate', 'cost_visible', 'detail'])
  )
  check('cost_visible 是布尔', typeof rProfit.data.cost_visible === 'boolean')
  if (rProfit.data.detail && rProfit.data.detail.length) {
    check('detail 含 name/qty/sale/cost/profit', has(rProfit.data.detail[0], ['name', 'qty', 'sale', 'cost', 'profit']))
  }

  const rInv = await call('GET', '/api/ext/reports/inventory')
  check('库存报表 200', rInv.status === 200, `status=${rInv.status}`)
  check('库存报表字段齐全', has(rInv.data, ['total_qty', 'total_value', 'cost_visible', 'items']))
  if (rInv.data.items && rInv.data.items.length) {
    check(
      'items[0] 含页面所需字段',
      has(rInv.data.items[0], [
        'product_name',
        'sku',
        'warehouse_name',
        'quantity',
        'cost_price',
        'value',
        'min_stock',
        'low',
      ])
    )
  }

  // ---------------- 欠款（boss/Debts.vue）----------------
  section('欠款 Debts.vue')
  const recv = await call('GET', '/api/ext/receivables')
  check('receivables 返回 200', recv.status === 200, `status=${recv.status}`)
  check(
    'receivables 字段齐全（页面明细口径直接用这些 key）',
    has(recv.data, [
      'receivable',
      'payable',
      'sales_total',
      'purchase_total',
      'recv_from_customer',
      'refund_to_customer',
      'paid_to_supplier',
      'refund_from_supplier',
      'sale_returned',
      'purchase_returned',
    ])
  )

  const custs = await call('GET', '/api/customers?page=1&page_size=100&status=1')
  check('客户列表 200', custs.status === 200)
  check('客户列表含 total / items', has(custs.data, ['total', 'items']))
  if (custs.data.items && custs.data.items.length) {
    check('客户行含 id / name', has(custs.data.items[0], ['id', 'name']))
    const one = await call('GET', `/api/customers/${custs.data.items[0].id}/outstanding`)
    check('单客户欠款 200', one.status === 200, `status=${one.status}`)
    check('单客户欠款含 amount', has(one.data, ['amount']))
    console.log(`  首个客户欠款：${one.data.amount}`)
  }

  // ---------------- 结果 ----------------
  console.log('\n' + '='.repeat(56))
  if (fail === 0) {
    console.log(`  老板界面契约全部通过：${pass} / ${pass}`)
  } else {
    console.log(`  通过 ${pass}，失败 ${fail}`)
    console.log('  失败项：')
    failures.forEach((f) => console.log(`    - ${f}`))
  }
  console.log('='.repeat(56))
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(1)
})
