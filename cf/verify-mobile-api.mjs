/**
 * 移动端接口契约验证
 *
 * 为什么需要：手机 UI 没法在命令行里点，但页面绑定的字段名如果和后端对不上，
 * 用户看到的就是空白/报错。这个脚本把移动端每个页面读的字段逐个断言一遍，
 * 等于替 UI 做了一次「契约核对」。
 *
 * 已经靠它抓到 3 个真问题：
 *   1. 出入库明细的 type 是精确匹配，传 'transfer' 前缀查不到数据
 *   2. 采购单日期字段是 purchase_date，不是 order_date
 *   3. 出入库明细原本不支持 keyword（已补到后端）
 *
 * 用法：
 *   node cf/verify-mobile-api.mjs [base] [user] [pass]
 *   BASE=... node cf/verify-mobile-api.mjs
 *
 * 会创建 __冒烟测试 前缀的数据，收尾用 cf/smoke-cleanup.sql 清理。
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
    /* 非 JSON */
  }
  return { status: res.status, data, text }
}

/** 断言对象拥有这些字段（允许值为 null，但键必须存在） */
function hasKeys(obj, keys, label) {
  if (!obj || typeof obj !== 'object') {
    check(`${label} 是对象`, false, String(obj))
    return
  }
  const missing = keys.filter((k) => !(k in obj))
  check(`${label} 字段齐全`, missing.length === 0, missing.length ? `缺: ${missing.join(', ')}` : '')
}

const log = await call('POST', '/api/auth/login', {
  body: { username: USER, password: PASS },
  token: '',
})
if (log.status !== 200) {
  console.log(`登录失败（${log.status}）: ${log.text}`)
  process.exit(1)
}
T = log.data.access_token
section('0. 登录（移动端 Login.vue）')
check('返回 access_token', typeof log.data.access_token === 'string')
hasKeys(log.data.user, ['id', 'username', 'full_name'], 'login.user')

// ---------------- 1. 我的 ----------------
section('1. 我的（Me.vue）')
{
  const me = await call('GET', '/api/auth/me')
  check('GET /auth/me 200', me.status === 200, `status=${me.status}`)
  hasKeys(me.data, ['id', 'username', 'full_name'], 'me')

  const perms = await call('GET', '/api/auth/my-permissions')
  check('GET /auth/my-permissions 200', perms.status === 200, `status=${perms.status}`)
  check('permissions 是数组', Array.isArray(perms.data && perms.data.permissions))
  check('返回 role_name 字段', perms.data && 'role_name' in perms.data)

  // 改密码：用不存在的原密码，只验证接口可达与参数名正确（应 400 而不是 404/422）
  const cp = await call('POST', '/api/auth/change-password', {
    body: { old_password: 'definitely-wrong-0!Aa', new_password: 'Whatever1!Aa' },
  })
  check('POST /auth/change-password 可达（400 而非 404）', cp.status === 400, `status=${cp.status}`)
}

// ---------------- 2. 工作台 ----------------
section('2. 工作台（Home.vue）')
{
  const d = await call('GET', '/api/ext/dashboard')
  check('GET /ext/dashboard 200', d.status === 200, `status=${d.status}`)
  hasKeys(
    d.data,
    [
      'today_sales', 'today_sales_count', 'today_purchase', 'today_purchase_count',
      'pending_sales_out', 'pending_purchase_in', 'receivable', 'payable',
      'low_stock_count', 'inventory_total',
    ],
    'dashboard'
  )

  const sd = await call('GET', '/api/ext/sales-daily?days=7')
  check('GET /ext/sales-daily 200', sd.status === 200, `status=${sd.status}`)
  check('items 是 7 个', Array.isArray(sd.data?.items) && sd.data.items.length === 7,
    `len=${sd.data?.items?.length}`)
  hasKeys(sd.data, ['total_amount', 'total_count', 'avg_amount', 'items'], 'sales-daily')
  if (sd.data?.items?.length) hasKeys(sd.data.items[0], ['date', 'amount', 'count', 'purchase_amount'], 'sales-daily.items[0]')
}

// ---------------- 3. 库存价格 ----------------
section('3. 库存价格（Stock.vue）与开销售单品选择（SaleNew.vue）')
let warehouseId = null
let productId = null
{
  const ws = await call('GET', '/api/inventory/warehouses')
  check('GET /inventory/warehouses 200', ws.status === 200, `status=${ws.status}`)
  const list = Array.isArray(ws.data) ? ws.data : ws.data?.items || []
  check('仓库是数组且非空', list.length > 0, `len=${list.length}`)
  if (list.length) {
    hasKeys(list[0], ['id', 'name'], 'warehouse[0]')
    warehouseId = list[0].id
  }

  const inv = await call('GET', '/api/inventory?page=1&page_size=20')
  check('GET /inventory 200', inv.status === 200, `status=${inv.status}`)
  hasKeys(inv.data, ['items', 'total', 'page', 'page_size'], 'inventory')
  check('库存列表非空（冒烟数据已建）', (inv.data?.items?.length || 0) > 0, `len=${inv.data?.items?.length}`)
  if (inv.data?.items?.length) {
    const it = inv.data.items[0]
    // Stock.vue / SaleNew.vue 全靠这几个字段渲染
    hasKeys(
      it,
      ['product_id', 'product_name', 'product_sku', 'product_spec', 'product_unit',
       'sale_price', 'purchase_price', 'quantity', 'min_stock', 'low', 'warehouse_name'],
      'inventory.items[0]'
    )
    productId = it.product_id
  }

  const low = await call('GET', '/api/inventory?page=1&page_size=5&low_stock=true')
  check('GET /inventory?low_stock=true 200', low.status === 200, `status=${low.status}`)

  const invW = await call('GET', `/api/inventory?page=1&page_size=5&warehouse_id=${warehouseId}`)
  check('库存按仓库筛选 200', invW.status === 200, `status=${invW.status}`)
  const bad = (invW.data?.items || []).find((x) => x.warehouse_id !== warehouseId)
  check('按仓库筛选结果全部属于该仓库', !bad, bad ? `出现 warehouse_id=${bad.warehouse_id}` : '')

  const kw = await call('GET', '/api/inventory?page=1&page_size=5&keyword=__冒烟测试')
  check('库存关键词搜索 200', kw.status === 200, `status=${kw.status}`)
}

// ---------------- 4. 客户欠款 ----------------
section('4. 客户欠款（Customers.vue）')
let customerId = null
{
  const cs = await call('GET', '/api/customers?page=1&page_size=20&status=1&keyword=__冒烟测试')
  check('GET /customers?status=1 200', cs.status === 200, `status=${cs.status}`)
  check('客户列表非空', (cs.data?.items?.length || 0) > 0, `len=${cs.data?.items?.length}`)
  if (cs.data?.items?.length) {
    hasKeys(cs.data.items[0], ['id', 'name', 'contact', 'phone'], 'customers.items[0]')
    customerId = cs.data.items[0].id

    const od = await call('GET', `/api/customers/${customerId}/outstanding`)
    check('GET /customers/{id}/outstanding 200', od.status === 200, `status=${od.status}`)
    check('欠款返回 amount 字段', od.data && typeof od.data.amount === 'number', JSON.stringify(od.data))
  }

  const ss = await call('GET', '/api/suppliers?page=1&page_size=5&status=1')
  check('GET /suppliers?status=1 200', ss.status === 200, `status=${ss.status}`)
  if (ss.data?.items?.length) hasKeys(ss.data.items[0], ['id', 'name'], 'suppliers.items[0]')
}

// ---------------- 5. 销售单列表 / 详情 ----------------
section('5. 销售单（Sales.vue / SaleDetail.vue）')
let saleId = null
{
  // 不带 status 取列表：冒烟测试跑完后单据停在「已退货」等终态，
  // 按 status=1 会查空。字段形状与状态无关，取任意一张即可。
  const list = await call('GET', '/api/sales?page=1&page_size=20')
  check('GET /sales 200', list.status === 200, `status=${list.status}`)
  // 状态筛选单独验证可达性（Sales.vue 的 chips）
  for (const s of [0, 1, 2, 3, 6]) {
    const r = await call('GET', `/api/sales?page=1&page_size=5&status=${s}`)
    check(`/sales?status=${s} 200`, r.status === 200, `status=${r.status}`)
  }
  if (list.data?.items?.length) {
    // Sales.vue 用到的字段
    hasKeys(
      list.data.items[0],
      ['id', 'order_no', 'customer_name', 'total_amount', 'sale_date', 'status',
       'item_count', 'product_summary'],
      'sales.items[0]'
    )
    saleId = list.data.items[0].id
  } else {
    check('销售单列表有数据', false, '空：请先跑 smoke-test.mjs 建数据，或本脚本需要已有草稿/已审核单')
  }

  // 关键词搜索（Sales.vue 搜索框）
  const kw = await call('GET', '/api/sales?page=1&page_size=5&keyword=SO')
  check('销售单关键词搜索 200', kw.status === 200, `status=${kw.status}`)

  if (saleId) {
    const det = await call('GET', `/api/sales/${saleId}`)
    check('GET /sales/{id} 200', det.status === 200, `status=${det.status}`)
    hasKeys(
      det.data,
      ['id', 'order_no', 'status', 'customer_name', 'customer_contact', 'customer_phone',
       'sale_date', 'warehouse_name', 'seller', 'total_amount', 'freight', 'tax_amount', 'items'],
      'sales.detail'
    )
    check('明细非空', (det.data?.items?.length || 0) > 0)
    if (det.data?.items?.length) {
      // SaleDetail.vue 明细行用到 shipped_quantity / pending_quantity
      hasKeys(
        det.data.items[0],
        ['id', 'product_name', 'product_spec', 'product_unit', 'price', 'quantity',
         'amount', 'shipped_quantity', 'pending_quantity'],
        'sales.detail.items[0]'
      )
    }
  }
}

// ---------------- 6. 采购收货 ----------------
section('6. 采购收货（Purchase.vue / PurchaseDetail.vue）')
{
  const list = await call('GET', '/api/purchase?page=1&page_size=20')
  check('GET /purchase 200', list.status === 200, `status=${list.status}`)
  if (list.data?.items?.length) {
    hasKeys(
      list.data.items[0],
      ['id', 'order_no', 'supplier_name', 'total_amount', 'purchase_date', 'status', 'item_count'],
      'purchase.items[0]'
    )
    const pid = list.data.items[0].id
    const det = await call('GET', `/api/purchase/${pid}`)
    check('GET /purchase/{id} 200', det.status === 200, `status=${det.status}`)
    hasKeys(
      det.data,
      ['order_no', 'status', 'supplier_name', 'supplier_contact', 'supplier_phone',
       'purchase_date', 'warehouse_name', 'total_amount', 'freight', 'tax_amount', 'items'],
      'purchase.detail'
    )
    if (det.data?.items?.length) {
      hasKeys(
        det.data.items[0],
        ['id', 'product_name', 'price', 'quantity', 'amount', 'received_quantity', 'pending_quantity'],
        'purchase.detail.items[0]'
      )
    }
  } else {
    check('采购单列表有数据', false, '空：请先跑 smoke-test.mjs 建数据')
  }

  // 部分收货筛选
  const p2 = await call('GET', '/api/purchase?page=1&page_size=5&status=2')
  check('GET /purchase?status=2 200', p2.status === 200, `status=${p2.status}`)
}

// ---------------- 7. 出入库明细 ----------------
section('7. 出入库明细（StockLog.vue）')
{
  const all = await call('GET', '/api/ext/stock-logs?page=1&page_size=20')
  check('GET /ext/stock-logs 200', all.status === 200, `status=${all.status}`)
  check('流水非空（冒烟数据已建）', (all.data?.items?.length || 0) > 0, `len=${all.data?.items?.length}`)
  if (all.data?.items?.length) {
    hasKeys(
      all.data.items[0],
      ['id', 'product_name', 'warehouse_name', 'type', 'quantity', 'before_quantity',
       'after_quantity', 'related_no', 'created_at'],
      'stocklog.items[0]'
    )
  }

  // 每个 chip 的 type 都必须能查到数据（精确匹配，不能传前缀）
  for (const t of ['purchase_in', 'sale_out', 'sale_return_in', 'purchase_return_out', 'transfer_in', 'transfer_out', 'adjust_in', 'adjust_out']) {
    const r = await call('GET', `/api/ext/stock-logs?page=1&page_size=5&type=${t}`)
    check(`type=${t} 请求成功`, r.status === 200, `status=${r.status}`)
    // 若有结果，必须全部是该 type（验证精确匹配语义）
    const wrong = (r.data?.items || []).find((x) => x.type !== t)
    check(`type=${t} 过滤精确`, !wrong, wrong ? `混入 ${wrong.type}` : '')
  }

  // 关键词（本次为移动端新增的后端能力）
  const kw = await call('GET', '/api/ext/stock-logs?page=1&page_size=5&keyword=__冒烟测试')
  check('关键词搜索 200', kw.status === 200, `status=${kw.status}`)
  check('关键词搜到数据', (kw.data?.total || 0) > 0, `total=${kw.data?.total}`)

  const kwNo = await call('GET', '/api/ext/stock-logs?page=1&page_size=5&keyword=zzz-绝对不存在-zzz')
  check('不存在的关键词返回 0 条', kwNo.data?.total === 0, `total=${kwNo.data?.total}`)
}

// ---------------- 8. 登记收款 ----------------
section('8. 登记收款（PayNew.vue）')
{
  if (!customerId) {
    check('登记收款可测（需要有客户）', false, '没有客户数据')
  } else {
    const before = await call('GET', `/api/customers/${customerId}/outstanding`)
    const pay = await call('POST', '/api/ext/payments', {
      body: {
        type: 1,
        partner_type: 'customer',
        partner_id: customerId,
        amount: 1,
        payment_method: '现金',
        remark: '__冒烟测试移动端收款',
      },
    })
    check('POST /ext/payments 200', pay.status === 200, `status=${pay.status} ${pay.data?.detail || ''}`)
    check('返回 voucher_no', typeof pay.data?.voucher_no === 'string', pay.data?.voucher_no)
    check('返回 id', !!pay.data?.id)

    const after = await call('GET', `/api/customers/${customerId}/outstanding`)
    check('收款后欠款减少 1',
      Math.abs((before.data?.amount || 0) - (after.data?.amount || 0) - 1) < 0.005,
      `${before.data?.amount} -> ${after.data?.amount}`)

    // 付款给供应商也要能用（PayNew 的类型切换）
    const sups = await call('GET', '/api/suppliers?page=1&page_size=1&status=1')
    const supId = sups.data?.items?.[0]?.id
    if (supId) {
      const pay2 = await call('POST', '/api/ext/payments', {
        body: {
          type: 2,
          partner_type: 'supplier',
          partner_id: supId,
          amount: 1,
          payment_method: '银行转账',
          remark: '__冒烟测试移动端付款',
        },
      })
      check('供应商付款 200', pay2.status === 200, `status=${pay2.status} ${pay2.data?.detail || ''}`)
      check('供应商付款返回 voucher_no', typeof pay2.data?.voucher_no === 'string')
    }
  }
}

console.log(`\n${'='.repeat(62)}`)
console.log(`  移动端接口契约：通过 ${pass}  失败 ${fail}`)
if (failures.length) {
  console.log('\n  失败项：')
  failures.forEach((f) => console.log(`    - ${f}`))
}
console.log('='.repeat(62))
process.exit(fail ? 1 : 0)
