/**
 * 进销存 Cloudflare 版 —— 冒烟测试
 *
 * 用法：
 *   node cf/smoke-test.mjs                                   # 本地，默认 admin/admin123
 *   node cf/smoke-test.mjs https://xxx.pages.dev             # 线上，默认 admin/admin123
 *   node cf/smoke-test.mjs https://xxx.pages.dev user pass   # 指定账号密码
 *
 * 也可用环境变量：BASE / SMOKE_USER / SMOKE_PASS
 *
 * 注意：线上若已按安全建议改过 admin 密码，必须传入新密码，
 *       否则登录 401 是预期行为，不是故障。
 *
 * 覆盖：健康检查 / 登录鉴权 / 权限 / 角色 / 用户 / 分类 / 商品 / 客户 / 供应商 /
 *       仓库 / 库存 / 采购单 / 销售单 / 库存流水 / 调拨 / 盘点 / 删除保护 / 权限边界
 *
 * 会创建 __冒烟测试* 前缀的数据；接口清理不掉的部分（已收货单据、有库存的商品）
 * 交给 cf/smoke-cleanup.sql。
 */

const BASE = (process.argv[2] || process.env.BASE || 'http://127.0.0.1:8788').replace(/\/$/, '')
const SMOKE_USER = process.argv[3] || process.env.SMOKE_USER || 'admin'
const SMOKE_PASS = process.argv[4] || process.env.SMOKE_PASS || 'admin123'

let pass = 0
let fail = 0
const failures = []

function check(label, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  OK   ${label}${extra ? '  ' + extra : ''}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  FAIL ${label}${extra ? '  ' + extra : ''}`)
  }
}

async function req(method, path, { token, body, raw } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let data = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = raw ? text : null
    }
  }
  return { status: res.status, data, text }
}

function section(title) {
  console.log(`\n${'='.repeat(66)}\n  ${title}\n${'='.repeat(66)}`)
}

async function main() {
  console.log(`目标：${BASE}`)

  // ---------------- 健康检查 ----------------
  section('1. 健康检查 / D1 绑定')
  {
    const r = await req('GET', '/api/health')
    check('GET /api/health 返回 200', r.status === 200, `status=${r.status}`)
    check('D1 绑定可用', r.data?.ok === true && r.data?.db === 'd1')
    check('时区格式正确（Asia/Shanghai）', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(r.data?.now || ''), r.data?.now)
  }

  // ---------------- 鉴权 ----------------
  section('2. 登录 / 鉴权')
  {
    const r1 = await req('POST', '/api/auth/login', { body: { username: SMOKE_USER, password: 'wrong-password' } })
    check('错误密码 → 401', r1.status === 401, `status=${r1.status}`)

    const r2 = await req('GET', '/api/users')
    check('无 token 访问 → 401', r2.status === 401, `status=${r2.status}`)

    const r3 = await req('GET', '/api/users', { token: 'garbage.token.value' })
    check('伪造 token → 401', r3.status === 401, `status=${r3.status}`)

    const r4 = await req('POST', '/api/auth/password-rules')
    const r4b = await req('GET', '/api/auth/password-rules')
    check('密码规则接口免登录', r4b.status === 200, `status=${r4b.status}`)
    check('密码规则文案正确', (r4b.data?.rules || '').includes('至少 8 位'))

    const r5 = await req('POST', '/api/auth/login', { body: { username: SMOKE_USER, password: SMOKE_PASS } })
    check('正确密码 → 200', r5.status === 200, `status=${r5.status}`)
    check('返回 access_token', typeof r5.data?.access_token === 'string' && r5.data.access_token.split('.').length === 3)
    check('返回 user 对象', r5.data?.user?.username === SMOKE_USER)
    check('user.is_admin = true', r5.data?.user?.is_admin === true)
    globalThis.TOKEN = r5.data?.access_token
  }

  const T = globalThis.TOKEN
  if (!T) {
    console.log('\n登录失败，后续测试无法继续')
    return finish()
  }

  // ---------------- 权限 ----------------
  section('3. 权限 / 角色')
  {
    const r1 = await req('GET', '/api/auth/my-permissions', { token: T })
    check('my-permissions 返回通配符', JSON.stringify(r1.data?.permissions) === '["*"]', JSON.stringify(r1.data?.permissions))
    check('role_name = admin', r1.data?.role_name === 'admin')

    const r2 = await req('GET', '/api/auth/roles', { token: T })
    check('角色列表 200', r2.status === 200)
    check('角色数 = 7', Array.isArray(r2.data) && r2.data.length === 7, `count=${r2.data?.length}`)
    check('角色带 permission_ids', Array.isArray(r2.data?.[0]?.permission_ids))

    const r3 = await req('GET', '/api/auth/permissions', { token: T })
    check('权限清单 84 条', Array.isArray(r3.data) && r3.data.length === 84, `count=${r3.data?.length}`)
    check('权限带中文模块名', typeof r3.data?.[0]?.module_label === 'string', r3.data?.[0]?.module_label)
  }

  // ---------------- 用户 ----------------
  section('4. 用户管理')
  {
    const r1 = await req('GET', '/api/users', { token: T })
    check('用户列表 200', r1.status === 200)
    check('分页结构完整', 'total' in (r1.data || {}) && 'items' in (r1.data || {}) && 'page_size' in (r1.data || {}))
    check('至少 1 个用户', (r1.data?.total || 0) >= 1)

    const r2 = await req('GET', '/api/users?keyword=' + encodeURIComponent(SMOKE_USER), { token: T })
    check('关键词搜索生效', (r2.data?.total || 0) >= 1, `total=${r2.data?.total}`)

    const me = await req('GET', '/api/auth/me', { token: T })
    const myId = me.data?.id
    check('拿到当前用户 id', !!myId, `id=${myId}`)

    const r3 = await req('GET', '/api/users/' + myId, { token: T })
    check('用户详情 200', r3.status === 200)
    check('详情含 role_name', r3.data?.role_name === 'admin', r3.data?.role_name)
    check('详情含 permission_count', typeof r3.data?.permission_count === 'number')
  }

  // ---------------- 分类 ----------------
  section('5. 商品分类')
  let categoryId = null
  {
    const r1 = await req('POST', '/api/products/categories', { token: T, body: { name: '__冒烟测试分类', sort_order: 99 } })
    check('新增分类 200', r1.status === 200, `status=${r1.status}`)
    categoryId = r1.data?.id

    const r2 = await req('POST', '/api/products/categories', { token: T, body: { name: '__冒烟测试分类' } })
    check('重名分类 → 400', r2.status === 400, `status=${r2.status}`)

    const r3 = await req('GET', '/api/products/categories', { token: T })
    check('分类列表 200', r3.status === 200)
    check('新分类在列表中', (r3.data || []).some((c) => c.id === categoryId))
  }

  // ---------------- 商品 ----------------
  section('6. 商品 CRUD')
  let productId = null
  {
    const sku = '__SMOKE_' + Date.now()
    const r1 = await req('POST', '/api/products', {
      token: T,
      body: {
        name: '__冒烟测试商品',
        sku,
        unit: '个',
        category_id: categoryId,
        purchase_price: 10.5,
        sale_price: 20,
        min_stock: 5,
        spec: '红色 / L',
        remark: '',
      },
    })
    check('新增商品 200', r1.status === 200, `status=${r1.status} ${r1.data?.detail || ''}`)
    productId = r1.data?.id
    check('返回 category_name', r1.data?.category_name === '__冒烟测试分类', r1.data?.category_name)
    check('空 remark 归一为 null', r1.data?.remark === null, JSON.stringify(r1.data?.remark))
    check('价格为数字', r1.data?.purchase_price === 10.5, String(r1.data?.purchase_price))

    const r2 = await req('POST', '/api/products', { token: T, body: { name: '重复编码', sku, unit: '个' } })
    check('重复 sku → 400', r2.status === 400, `status=${r2.status}`)

    const r3 = await req('GET', `/api/products?keyword=__SMOKE_${''}`, { token: T })
    check('商品列表 200', r3.status === 200)

    const r4 = await req('GET', `/api/products?keyword=${encodeURIComponent('__冒烟测试商品')}`, { token: T })
    check('关键词搜索到新商品', (r4.data?.items || []).some((p) => p.id === productId), `total=${r4.data?.total}`)

    const r5 = await req('GET', `/api/products/${productId}`, { token: T })
    check('商品详情 200', r5.status === 200)
    check('详情字段完整', r5.data?.unit === '个' && r5.data?.sku === sku)

    const r6 = await req('PUT', `/api/products/${productId}`, { token: T, body: { sale_price: 33.33 } })
    check('更新商品 200', r6.status === 200, `status=${r6.status}`)
    check('部分更新生效', r6.data?.sale_price === 33.33, String(r6.data?.sale_price))
    check('未传字段未被清空', r6.data?.unit === '个' && r6.data?.name === '__冒烟测试商品')

    const r7 = await req('DELETE', `/api/products/categories/${categoryId}`, { token: T })
    check('分类被商品引用 → 400', r7.status === 400, `status=${r7.status}`)
  }

  // ---------------- 客户 ----------------
  section('7. 客户')
  let customerId = null
  {
    const r1 = await req('POST', '/api/customers', {
      token: T,
      body: { name: '__冒烟测试客户', contact: '张三', phone: '13800000000', credit_limit: 5000 },
    })
    check('新增客户 200', r1.status === 200, `status=${r1.status} ${r1.data?.detail || ''}`)
    customerId = r1.data?.id

    const r2 = await req('POST', '/api/customers', { token: T, body: { name: '__冒烟测试客户' } })
    check('重名客户 → 400', r2.status === 400, `status=${r2.status}`)

    const r3 = await req('GET', '/api/customers?keyword=__冒烟测试', { token: T })
    check('客户列表 200', r3.status === 200)
    check('搜到新客户', (r3.data?.items || []).some((c) => c.id === customerId))

    const r4 = await req('GET', `/api/customers/${customerId}/outstanding`, { token: T })
    check('应收查询 200', r4.status === 200)
    check('无单据时应收 = 0', r4.data?.amount === 0, `amount=${r4.data?.amount}`)
    check('字段 amount/receivable 一致', r4.data?.amount === r4.data?.receivable)
    check('has_debt = false', r4.data?.has_debt === false)
  }

  // ---------------- 供应商 ----------------
  section('8. 供应商')
  let supplierId = null
  {
    const r1 = await req('POST', '/api/suppliers', {
      token: T,
      body: { name: '__冒烟测试供应商', contact: '李四', phone: '13900000000' },
    })
    check('新增供应商 200', r1.status === 200, `status=${r1.status} ${r1.data?.detail || ''}`)
    supplierId = r1.data?.id

    const r2 = await req('GET', `/api/suppliers/${supplierId}/outstanding`, { token: T })
    check('应付查询 200', r2.status === 200)
    check('无单据时应付 = 0', r2.data?.amount === 0, `amount=${r2.data?.amount}`)
    check('字段 amount/payable 一致', r2.data?.amount === r2.data?.payable)

    const r3 = await req('GET', '/api/suppliers?keyword=__冒烟测试', { token: T })
    check('供应商列表 200', r3.status === 200)
  }

  // ---------------- 仓库 / 库存 ----------------
  section('9. 仓库 / 库存')
  {
    const r1 = await req('GET', '/api/inventory/warehouses', { token: T })
    check('仓库列表 200', r1.status === 200)
    check('默认仓库存在', (r1.data || []).some((w) => w.name === '默认仓库'), `count=${r1.data?.length}`)

    const r2 = await req('GET', '/api/inventory', { token: T })
    check('库存列表 200', r2.status === 200)
    check('库存分页结构', 'total' in (r2.data || {}) && 'items' in (r2.data || {}))

    const r3 = await req('GET', '/api/inventory/stock-check', { token: T })
    check('库存预警 200', r3.status === 200)
    check('预警返回 code/message/data', r3.data?.code === 200 && Array.isArray(r3.data?.data))
  }

  // ---------------- 错误语义 ----------------
  section('10. 已实现 / 未实现 / 404 语义')
  {
    const r1 = await req('GET', '/api/purchase', { token: T })
    check('采购单已实现 → 200', r1.status === 200, `status=${r1.status}`)

    const r1b = await req('GET', '/api/sales', { token: T })
    check('销售单已实现 → 200', r1b.status === 200, `status=${r1b.status}`)

    const r1c = await req('GET', '/api/ext/stock-logs', { token: T })
    check('库存流水已实现 → 200', r1c.status === 200, `status=${r1c.status}`)

    const r1d = await req('GET', '/api/ext/payments', { token: T })
    check('收付款已实现 → 200', r1d.status === 200, `status=${r1d.status}`)

    const r1e = await req('GET', '/api/ext/sale-returns', { token: T })
    check('销售退货已实现 → 200', r1e.status === 200, `status=${r1e.status}`)

    const r1f = await req('GET', '/api/ext/receivables', { token: T })
    check('应收应付已实现 → 200', r1f.status === 200, `status=${r1f.status}`)

    const r2 = await req('GET', '/api/ext/reports/sales', { token: T })
    check('报表（阶段4）→ 501', r2.status === 501, `status=${r2.status}`)
    check('501 提示包含阶段信息', /阶段/.test(r2.data?.detail || ''), r2.data?.detail)

    const r3 = await req('GET', '/api/nonexistent-endpoint', { token: T })
    check('未知接口 → 404', r3.status === 404, `status=${r3.status}`)

    const r4 = await req('GET', '/api/ext/logs', { token: T })
    check('操作日志（阶段4）→ 501', r4.status === 501, `status=${r4.status}`)

    const r5 = await req('GET', '/api/ext/dashboard', { token: T })
    check('首页看板（阶段4）→ 501', r5.status === 501, `status=${r5.status}`)

    const r6 = await req('GET', '/api/ext/export/sales', { token: T })
    check('CSV 导出（阶段4）→ 501', r6.status === 501, `status=${r6.status}`)
  }

  // ---------------- 采购单全流程 ----------------
  section('11. 采购单：下单 → 审核 → 分批收货')
  let purchaseId = null
  let purchaseItemId = null
  let whId = null
  {
    const whs = await req('GET', '/api/inventory/warehouses', { token: T })
    whId = whs.data?.[0]?.id ?? null
    check('取到默认仓库', !!whId, `id=${whId}`)

    const r1 = await req('POST', '/api/purchase', {
      token: T,
      body: {
        supplier_id: supplierId,
        warehouse_id: whId,
        buyer: '__采购员',
        freight: 5,
        remark: '__冒烟测试采购',
        items: [{ product_id: productId, quantity: 10, price: 10.5, tax_rate: 13 }],
      },
    })
    check('新增采购单 200', r1.status === 200, `status=${r1.status} ${r1.data?.detail || ''}`)
    purchaseId = r1.data?.id
    purchaseItemId = r1.data?.items?.[0]?.id

    check('单号格式 PO+yyyymmdd+4位', /^PO\d{12}$/.test(r1.data?.order_no || ''), r1.data?.order_no)
    check('初始状态 = 草稿', r1.data?.status === 0 && r1.data?.status_text === '草稿', r1.data?.status_text)
    // 价内税：小计 10×10.5=105，内含税 105−105/1.13=12.08，合计 105+5=110
    check('价内税内含税额 = 12.08', Math.abs((r1.data?.tax_amount ?? 0) - 12.08) < 0.01, String(r1.data?.tax_amount))
    check('整单合计 = 小计+运费 = 110', Math.abs((r1.data?.total_amount ?? 0) - 110) < 0.01, String(r1.data?.total_amount))
    check('带出供应商名', r1.data?.supplier_name === '__冒烟测试供应商', r1.data?.supplier_name)
    check('明细带出商品名', r1.data?.items?.[0]?.product_name === '__冒烟测试商品', r1.data?.items?.[0]?.product_name)
    check('待收数量 = 10', r1.data?.items?.[0]?.pending_quantity === 10)

    const r2 = await req('PUT', `/api/purchase/${purchaseId}/receive`, {
      token: T,
      body: { items: [{ item_id: purchaseItemId, quantity: 6 }] },
    })
    check('草稿状态不能收货 → 400', r2.status === 400, `status=${r2.status}`)

    const r3 = await req('PUT', `/api/purchase/${purchaseId}/approve`, { token: T })
    check('审核 200', r3.status === 200, `status=${r3.status}`)

    const r3b = await req('PUT', `/api/purchase/${purchaseId}`, {
      token: T,
      body: { supplier_id: supplierId, remark: '__冒烟测试采购', items: [{ product_id: productId, quantity: 1, price: 1 }] },
    })
    check('已审核不能编辑 → 400', r3b.status === 400, `status=${r3b.status}`)

    const r4 = await req('PUT', `/api/purchase/${purchaseId}/receive`, {
      token: T,
      body: { items: [{ item_id: purchaseItemId, quantity: 6 }] },
    })
    check('部分收货 200', r4.status === 200, `status=${r4.status} ${r4.data?.detail || ''}`)
    check('提示「本次入库 6」', /入库 6/.test(r4.data?.message || ''), r4.data?.message)

    const d1 = await req('GET', `/api/purchase/${purchaseId}`, { token: T })
    check('状态 = 部分收货', d1.data?.status === 2 && d1.data?.status_text === '部分收货', d1.data?.status_text)
    check('已收 6 / 待收 4',
      d1.data?.items?.[0]?.received_quantity === 6 && d1.data?.items?.[0]?.pending_quantity === 4,
      `recv=${d1.data?.items?.[0]?.received_quantity} pending=${d1.data?.items?.[0]?.pending_quantity}`)

    const r5 = await req('PUT', `/api/purchase/${purchaseId}/receive`, {
      token: T,
      body: { items: [{ item_id: purchaseItemId, quantity: 99 }] },
    })
    check('超收 → 400', r5.status === 400, `status=${r5.status}`)
    check('超收提示含「超过待收数量」', /超过待收数量/.test(r5.data?.detail || ''), r5.data?.detail)

    const r6 = await req('PUT', `/api/purchase/${purchaseId}/receive`, {
      token: T,
      body: { items: [{ item_id: purchaseItemId, quantity: 4 }] },
    })
    check('收齐剩余 4 200', r6.status === 200, `status=${r6.status}`)

    const d2 = await req('GET', `/api/purchase/${purchaseId}`, { token: T })
    check('状态 = 已收货', d2.data?.status === 3 && d2.data?.status_text === '已收货', d2.data?.status_text)

    const r7 = await req('PUT', `/api/purchase/${purchaseId}/receive`, {
      token: T,
      body: { items: [{ item_id: purchaseItemId, quantity: 1 }] },
    })
    check('收满后再收 → 400', r7.status === 400, `status=${r7.status}`)

    const inv = await req('GET', `/api/inventory?warehouse_id=${whId}`, { token: T })
    const row = (inv.data?.items || []).find((x) => x.product_id === productId)
    check('收货后库存 = 10', row?.quantity === 10, `quantity=${row?.quantity}`)

    const list = await req('GET', '/api/purchase?keyword=__冒烟测试供应商', { token: T })
    check('采购列表关键词可搜到', (list.data?.items || []).some((o) => o.id === purchaseId), `total=${list.data?.total}`)
    check('列表带商品摘要', !!list.data?.items?.[0]?.product_summary, list.data?.items?.[0]?.product_summary)
  }

  // ---------------- 销售单全流程 ----------------
  section('12. 销售单：下单 → 审核 → 分批发货 + 库存不足保护')
  let salesId = null
  let salesItemId = null
  {
    const r1 = await req('POST', '/api/sales', {
      token: T,
      body: {
        customer_id: customerId,
        warehouse_id: whId,
        seller: '__销售员',
        remark: '__冒烟测试销售',
        items: [{ product_id: productId, quantity: 4, price: 20, tax_rate: 0 }],
      },
    })
    check('新增销售单 200', r1.status === 200, `status=${r1.status} ${r1.data?.detail || ''}`)
    salesId = r1.data?.id
    salesItemId = r1.data?.items?.[0]?.id

    check('单号格式 SO+yyyymmdd+4位', /^SO\d{12}$/.test(r1.data?.order_no || ''), r1.data?.order_no)
    check('合计 = 4×20 = 80', Math.abs((r1.data?.total_amount ?? 0) - 80) < 0.01, String(r1.data?.total_amount))
    check('税率 0 → 税额 0', Math.abs(r1.data?.tax_amount ?? 0) < 0.01, String(r1.data?.tax_amount))
    check('带出客户名', r1.data?.customer_name === '__冒烟测试客户', r1.data?.customer_name)

    await req('PUT', `/api/sales/${salesId}/approve`, { token: T })

    const r2 = await req('PUT', `/api/sales/${salesId}/ship`, {
      token: T,
      body: { items: [{ item_id: salesItemId, quantity: 4 }] },
    })
    check('发货 4 200', r2.status === 200, `status=${r2.status} ${r2.data?.detail || ''}`)
    check('提示「本次出库 4」', /出库 4/.test(r2.data?.message || ''), r2.data?.message)

    const d1 = await req('GET', `/api/sales/${salesId}`, { token: T })
    check('状态 = 已发货', d1.data?.status === 3 && d1.data?.status_text === '已发货', d1.data?.status_text)

    const inv1 = await req('GET', `/api/inventory?warehouse_id=${whId}`, { token: T })
    const row1 = (inv1.data?.items || []).find((x) => x.product_id === productId)
    check('发货后库存 = 6', row1?.quantity === 6, `quantity=${row1?.quantity}`)

    // 库存不足：下单 100，库存只有 6，发货应被拦下且不产生任何写库
    const r3 = await req('POST', '/api/sales', {
      token: T,
      body: { customer_id: customerId, warehouse_id: whId, remark: '__冒烟测试销售', items: [{ product_id: productId, quantity: 100, price: 20 }] },
    })
    const bigId = r3.data?.id
    const bigItemId = r3.data?.items?.[0]?.id
    await req('PUT', `/api/sales/${bigId}/approve`, { token: T })

    const r4 = await req('PUT', `/api/sales/${bigId}/ship`, {
      token: T,
      body: { items: [{ item_id: bigItemId, quantity: 100 }] },
    })
    check('库存不足发货 → 400', r4.status === 400, `status=${r4.status}`)
    check('提示含「库存不足」', /库存不足/.test(r4.data?.detail || ''), r4.data?.detail)

    const inv2 = await req('GET', `/api/inventory?warehouse_id=${whId}`, { token: T })
    const row2 = (inv2.data?.items || []).find((x) => x.product_id === productId)
    check('失败发货未改动库存（仍为 6）', row2?.quantity === 6, `quantity=${row2?.quantity}`)

    // 清掉这张大单的痕迹（作废后可删）
    await req('PUT', `/api/sales/${bigId}/cancel`, { token: T })
    const del = await req('DELETE', `/api/sales/${bigId}`, { token: T })
    check('作废后可删除大单', del.status === 200, `status=${del.status}`)
  }

  // ---------------- 库存流水 ----------------
  section('13. 库存流水')
  {
    const r1 = await req('GET', '/api/ext/stock-logs', { token: T })
    check('流水列表 200', r1.status === 200, `status=${r1.status}`)
    const types = new Set((r1.data?.items || []).map((x) => x.type))
    check('含 purchase_in', types.has('purchase_in'), [...types].join(','))
    check('含 sale_out', types.has('sale_out'))

    const row = (r1.data?.items || []).find((x) => x.type === 'purchase_in')
    check('流水带商品名/仓库名', !!row?.product_name && !!row?.warehouse_name, `${row?.product_name}/${row?.warehouse_name}`)
    check('流水 before/after 一致', row?.after_quantity === row?.before_quantity + row?.quantity,
      `${row?.before_quantity}->${row?.after_quantity} qty=${row?.quantity}`)

    const r2 = await req('GET', '/api/ext/stock-logs/stat', { token: T })
    check('流水统计 200', r2.status === 200)
    check('need_init = false（已有流水）', r2.data?.need_init === false, String(r2.data?.need_init))
    check('log_count > 0', (r2.data?.log_count || 0) > 0)

    const r3 = await req('POST', '/api/ext/stock-logs/init', { token: T })
    check('已有流水时重复生成 → 400', r3.status === 400, `status=${r3.status}`)
  }

  // ---------------- 库存调拨 ----------------
  section('14. 库存调拨')
  let wh2 = null
  {
    const r0 = await req('POST', '/api/inventory/warehouses', { token: T, body: { name: '__冒烟测试仓库2' } })
    check('新增第二个仓库 200', r0.status === 200, `status=${r0.status} ${r0.data?.detail || ''}`)
    wh2 = r0.data?.id

    const r1 = await req('POST', '/api/ext/stock-transfers', {
      token: T,
      body: { from_warehouse_id: whId, to_warehouse_id: wh2, remark: '__冒烟测试调拨', items: [{ product_id: productId, quantity: 2 }] },
    })
    check('新增调拨单 200', r1.status === 200, `status=${r1.status} ${r1.data?.detail || ''}`)
    const tid = r1.data?.id
    check('调拨单号格式 TF+yyyymmdd+4位', /^TF\d{12}$/.test(r1.data?.transfer_no || ''), r1.data?.transfer_no)

    const r1b = await req('POST', '/api/ext/stock-transfers', {
      token: T,
      body: { from_warehouse_id: whId, to_warehouse_id: whId, remark: '__冒烟测试调拨', items: [{ product_id: productId, quantity: 1 }] },
    })
    check('源=目标 → 400', r1b.status === 400, `status=${r1b.status}`)

    const r2 = await req('PUT', `/api/ext/stock-transfers/${tid}/approve`, { token: T })
    check('调拨审核 200', r2.status === 200, `status=${r2.status} ${r2.data?.detail || ''}`)

    const inv = await req('GET', '/api/inventory', { token: T })
    const src = (inv.data?.items || []).find((x) => x.product_id === productId && x.warehouse_id === whId)
    const dst = (inv.data?.items || []).find((x) => x.product_id === productId && x.warehouse_id === wh2)
    check('源仓 6−2 = 4', src?.quantity === 4, `quantity=${src?.quantity}`)
    check('目标仓 +2 = 2', dst?.quantity === 2, `quantity=${dst?.quantity}`)

    const r3 = await req('PUT', `/api/ext/stock-transfers/${tid}/approve`, { token: T })
    check('重复审核 → 400', r3.status === 400, `status=${r3.status}`)

    const logs = await req('GET', '/api/ext/stock-logs?type=transfer_out', { token: T })
    check('产生 transfer_out 流水', (logs.data?.items || []).some((x) => x.related_no === r1.data?.transfer_no))
  }

  // ---------------- 库存盘点 ----------------
  section('15. 库存盘点')
  {
    const r1 = await req('GET', `/api/ext/stock-checks/preview?warehouse_id=${whId}`, { token: T })
    check('盘点底稿 200', r1.status === 200, `status=${r1.status}`)
    const draft = (r1.data?.items || []).find((x) => x.product_id === productId)
    check('底稿含本次测试商品', !!draft, `items=${r1.data?.items?.length}`)
    check('底稿账面数 = 4', draft?.system_quantity === 4, `system=${draft?.system_quantity}`)

    const r2 = await req('POST', '/api/ext/stock-checks', {
      token: T,
      body: {
        warehouse_id: whId,
        remark: '__冒烟测试盘点',
        items: [{ product_id: productId, system_quantity: draft?.system_quantity ?? 0, actual_quantity: (draft?.system_quantity ?? 0) + 3 }],
      },
    })
    check('新增盘点单 200', r2.status === 200, `status=${r2.status} ${r2.data?.detail || ''}`)
    const cid = r2.data?.id
    check('盘点单号格式 SC+yyyymmdd+4位', /^SC\d{12}$/.test(r2.data?.check_no || ''), r2.data?.check_no)

    const r3 = await req('GET', `/api/ext/stock-checks/${cid}`, { token: T })
    check('盘点单 diff 自动计算 = +3', r3.data?.items?.[0]?.diff === 3, `diff=${r3.data?.items?.[0]?.diff}`)

    const r4 = await req('PUT', `/api/ext/stock-checks/${cid}/approve`, { token: T })
    check('盘点审核 200', r4.status === 200, `status=${r4.status} ${r4.data?.detail || ''}`)

    const inv = await req('GET', '/api/inventory', { token: T })
    const row = (inv.data?.items || []).find((x) => x.product_id === productId && x.warehouse_id === whId)
    check('盘盈后库存 4+3 = 7', row?.quantity === 7, `quantity=${row?.quantity}`)

    const logs = await req('GET', '/api/ext/stock-logs?type=adjust_in', { token: T })
    check('产生 adjust_in 流水', (logs.data?.items || []).length > 0)
  }

  // ---------------- 单据删除保护 ----------------
  section('16. 单据删除保护')
  {
    const r1 = await req('DELETE', `/api/purchase/${purchaseId}`, { token: T })
    check('已收货采购单不能删 → 400', r1.status === 400, `status=${r1.status}`)

    const r2 = await req('DELETE', `/api/sales/${salesId}`, { token: T })
    check('已发货销售单不能删 → 400', r2.status === 400, `status=${r2.status}`)

    const r3 = await req('POST', '/api/purchase', {
      token: T,
      body: { supplier_id: supplierId, warehouse_id: whId, remark: '__冒烟测试采购', items: [{ product_id: productId, quantity: 1, price: 1 }] },
    })
    const draftId = r3.data?.id
    const r4 = await req('DELETE', `/api/purchase/${draftId}`, { token: T })
    check('草稿单可删除', r4.status === 200, `status=${r4.status}`)

    const r5 = await req('POST', `/api/purchase/${draftId}/approve`, { token: T })
    check('已删除的单不能审核 → 404', r5.status === 404, `status=${r5.status}`)
  }

  // ---------------- 权限边界 ----------------
  section('17. 权限边界（非管理员）')
  {
    const r1 = await req('POST', '/api/auth/roles', {
      token: T,
      body: { name: '__冒烟测试空角色', description: '无任何权限', permission_ids: [] },
    })
    check('新增空权限角色 200', r1.status === 200, `status=${r1.status} ${r1.data?.detail || ''}`)
    const roleId = r1.data?.id

    const r2 = await req('POST', '/api/users', {
      token: T,
      body: {
        username: 'smoke_noperm',
        password: 'Smoke!2345',
        full_name: '__冒烟测试无权限用户',
        role_id: roleId,
      },
    })
    check('新增无权限用户 200', r2.status === 200, `status=${r2.status} ${r2.data?.detail || ''}`)
    const uid = r2.data?.id
    check('空角色 permission_count = 0', r2.data?.permission_count === 0, String(r2.data?.permission_count))

    const r3 = await req('POST', '/api/auth/login', { body: { username: 'smoke_noperm', password: 'Smoke!2345' } })
    check('无权限用户可登录', r3.status === 200, `status=${r3.status}`)
    const T2 = r3.data?.access_token

    const r4 = await req('GET', '/api/products', { token: T2 })
    check('无 product:view → 403', r4.status === 403, `status=${r4.status}`)
    check('403 提示需要权限', /权限不足/.test(r4.data?.detail || ''), r4.data?.detail)

    const r5 = await req('GET', '/api/auth/my-permissions', { token: T2 })
    check('无需权限码的接口可访问 → 200', r5.status === 200, `status=${r5.status}`)
    check('权限列表为空', JSON.stringify(r5.data?.permissions) === '[]', JSON.stringify(r5.data?.permissions))

    const r6 = await req('POST', '/api/users', { token: T2, body: { username: 'x', password: 'Abc!12345', role_id: 1 } })
    check('无 user:add → 403', r6.status === 403, `status=${r6.status}`)

    // 清理
    if (uid) await req('DELETE', `/api/users/${uid}`, { token: T })
    if (roleId) await req('DELETE', `/api/auth/roles/${roleId}`, { token: T })
  }

  // ---------------- 库存查询helper（阶段 3 用）----------------
  const stockOf = async (warehouseId) => {
    const r = await req('GET', `/api/inventory?warehouse_id=${warehouseId}`, { token: T })
    return (r.data?.items || []).find((x) => x.product_id === productId)?.quantity
  }

  // ---------------- 销售退货 ----------------
  section('19. 销售退货：可退查询 → 部分退货 → 作废回退 → 整单退货')
  let sr1 = null
  let sr2 = null
  let sr3 = null
  {
    const before = await stockOf(whId)

    const r1 = await req('GET', '/api/ext/sale-returns/returnable', { token: T })
    check('可退原单列表 200', r1.status === 200, `status=${r1.status}`)
    const target = (r1.data?.items || []).find((o) => o.id === salesId)
    check('已发货销售单出现在可退列表', !!target, `total=${r1.data?.total}`)
    check('可退件数 = 4', target?.returnable_quantity === 4, String(target?.returnable_quantity))

    const r2 = await req('GET', `/api/ext/sale-returns/available/${salesId}`, { token: T })
    check('可退明细 200', r2.status === 200, `status=${r2.status}`)
    const it = (r2.data?.items || [])[0]
    check('可退数量 = 4', it?.available_quantity === 4, String(it?.available_quantity))
    check('带出原成交价 20', it?.price === 20, String(it?.price))
    check('带出客户名', r2.data?.customer_name === '__冒烟测试客户', r2.data?.customer_name)

    const r3 = await req('POST', '/api/ext/sale-returns', {
      token: T,
      body: { customer_id: customerId, items: [{ product_id: productId, quantity: 1, price: 20 }] },
    })
    check('不关联原单 → 400', r3.status === 400, `status=${r3.status}`)
    check('提示「必须关联原单」', /必须关联原单/.test(r3.data?.detail || ''), r3.data?.detail)

    const r4 = await req('POST', '/api/ext/sale-returns', {
      token: T,
      body: { sales_order_id: salesId, customer_id: customerId, items: [{ product_id: productId, quantity: 99, price: 20 }] },
    })
    check('超退 → 400', r4.status === 400, `status=${r4.status}`)
    check('超退提示「可退数量仅 4」', /可退数量仅 4/.test(r4.data?.detail || ''), r4.data?.detail)

    // 退 2
    const r5 = await req('POST', '/api/ext/sale-returns', {
      token: T,
      body: {
        sales_order_id: salesId,
        customer_id: customerId,
        reason: '__冒烟测试退货',
        items: [{ product_id: productId, quantity: 2, price: 20 }],
      },
    })
    check('新增销售退货 200', r5.status === 200, `status=${r5.status} ${r5.data?.detail || ''}`)
    sr1 = r5.data?.id
    check('单号格式 SR+yyyymmdd+4位', /^SR\d{12}$/.test(r5.data?.return_no || ''), r5.data?.return_no)

    const r6 = await req('GET', `/api/ext/sale-returns/available/${salesId}`, { token: T })
    check('待审核退货已占额度（剩余可退 2）', (r6.data?.items || [])[0]?.available_quantity === 2,
      String((r6.data?.items || [])[0]?.available_quantity))

    const rl = await req('GET', '/api/ext/sale-returns?keyword=' + encodeURIComponent('SR'), { token: T })
    check('退货列表带 summary 汇总', typeof rl.data?.summary?.all === 'number', JSON.stringify(rl.data?.summary))
    check('summary.active 只算已审核/已退货', rl.data?.summary?.active === 0, String(rl.data?.summary?.active))

    await req('PUT', `/api/ext/sale-returns/${sr1}/approve`, { token: T })
    const r7 = await req('PUT', `/api/ext/sale-returns/${sr1}/receive`, { token: T })
    check('销售退货入库 200', r7.status === 200, `status=${r7.status} ${r7.data?.detail || ''}`)

    const o1 = await req('GET', `/api/sales/${salesId}`, { token: T })
    check('原单状态 → 部分退货(5)', o1.data?.status === 5, `status=${o1.data?.status} ${o1.data?.status_text}`)

    check('退货入库后库存 +2', (await stockOf(whId)) === before + 2, `${before} -> ${await stockOf(whId)}`)

    // 退剩余 2 并作废 → 原单应回到「部分退货」而不是「已退货」
    const r8 = await req('POST', '/api/ext/sale-returns', {
      token: T,
      body: { sales_order_id: salesId, customer_id: customerId, items: [{ product_id: productId, quantity: 2, price: 20 }] },
    })
    sr2 = r8.data?.id
    await req('PUT', `/api/ext/sale-returns/${sr2}/approve`, { token: T })
    const r9 = await req('PUT', `/api/ext/sale-returns/${sr2}/cancel`, { token: T })
    check('退货单作废 200', r9.status === 200, `status=${r9.status}`)

    const o2 = await req('GET', `/api/sales/${salesId}`, { token: T })
    check('作废后原单仍为部分退货(5)', o2.data?.status === 5, `status=${o2.data?.status}`)

    // 再退 2 并入库 → 原单应为「已退货」
    const r10 = await req('POST', '/api/ext/sale-returns', {
      token: T,
      body: { sales_order_id: salesId, customer_id: customerId, items: [{ product_id: productId, quantity: 2, price: 20 }] },
    })
    sr3 = r10.data?.id
    await req('PUT', `/api/ext/sale-returns/${sr3}/approve`, { token: T })
    await req('PUT', `/api/ext/sale-returns/${sr3}/receive`, { token: T })

    const o3 = await req('GET', `/api/sales/${salesId}`, { token: T })
    check('全部退回后原单 → 已退货(6)', o3.data?.status === 6, `status=${o3.data?.status} ${o3.data?.status_text}`)

    const r11 = await req('POST', '/api/ext/sale-returns', {
      token: T,
      body: { sales_order_id: salesId, customer_id: customerId, items: [{ product_id: productId, quantity: 1, price: 20 }] },
    })
    check('退满后再退 → 400', r11.status === 400, `status=${r11.status}`)

    const rd = await req('GET', `/api/ext/sale-returns/${sr1}`, { token: T })
    check('退货详情 200', rd.status === 200, `status=${rd.status}`)
    check('详情带来源单号', rd.data?.source_order_no === o3.data?.order_no, rd.data?.source_order_no)
    check('详情带商品名', rd.data?.items?.[0]?.product_name === '__冒烟测试商品', rd.data?.items?.[0]?.product_name)
  }

  // ---------------- 采购退货 ----------------
  section('20. 采购退货：可退查询 → 部分退货 → 出库')
  {
    const before = await stockOf(whId)

    const r1 = await req('GET', '/api/ext/purchase-returns/returnable', { token: T })
    check('可退原单列表 200', r1.status === 200, `status=${r1.status}`)
    const target = (r1.data?.items || []).find((o) => o.id === purchaseId)
    check('已收货采购单出现在可退列表', !!target, `total=${r1.data?.total}`)
    check('可退件数 = 10', target?.returnable_quantity === 10, String(target?.returnable_quantity))

    const r2 = await req('GET', `/api/ext/purchase-returns/available/${purchaseId}`, { token: T })
    check('可退明细 200', r2.status === 200, `status=${r2.status}`)
    const it = (r2.data?.items || [])[0]
    check('可退数量 = 10', it?.available_quantity === 10, String(it?.available_quantity))
    check('带出原成交价 10.5', it?.price === 10.5, String(it?.price))
    check('带出供应商名', r2.data?.supplier_name === '__冒烟测试供应商', r2.data?.supplier_name)

    const r3 = await req('POST', '/api/ext/purchase-returns', {
      token: T,
      body: { supplier_id: supplierId, items: [{ product_id: productId, quantity: 1, price: 10.5 }] },
    })
    check('不关联原单 → 400', r3.status === 400, `status=${r3.status}`)

    const r4 = await req('POST', '/api/ext/purchase-returns', {
      token: T,
      body: { purchase_order_id: purchaseId, supplier_id: supplierId, items: [{ product_id: productId, quantity: 99, price: 10.5 }] },
    })
    check('超退 → 400', r4.status === 400, `status=${r4.status}`)
    check('超退提示「可退数量仅 10」', /可退数量仅 10/.test(r4.data?.detail || ''), r4.data?.detail)

    const r5 = await req('POST', '/api/ext/purchase-returns', {
      token: T,
      body: {
        purchase_order_id: purchaseId,
        supplier_id: supplierId,
        reason: '__冒烟测试退货',
        items: [{ product_id: productId, quantity: 3, price: 10.5 }],
      },
    })
    check('新增采购退货 200', r5.status === 200, `status=${r5.status} ${r5.data?.detail || ''}`)
    const pr1 = r5.data?.id
    check('单号格式 PR+yyyymmdd+4位', /^PR\d{12}$/.test(r5.data?.return_no || ''), r5.data?.return_no)

    await req('PUT', `/api/ext/purchase-returns/${pr1}/approve`, { token: T })
    const r6 = await req('PUT', `/api/ext/purchase-returns/${pr1}/ship`, { token: T })
    check('采购退货出库 200', r6.status === 200, `status=${r6.status} ${r6.data?.detail || ''}`)

    const o1 = await req('GET', `/api/purchase/${purchaseId}`, { token: T })
    check('原单状态 → 部分退货(5)', o1.data?.status === 5, `status=${o1.data?.status} ${o1.data?.status_text}`)

    check('退货出库后库存 −3', (await stockOf(whId)) === before - 3, `${before} -> ${await stockOf(whId)}`)

    const prl = await req('GET', '/api/ext/purchase-returns?status=2', { token: T })
    check('按状态筛选退货单', (prl.data?.items || []).length > 0, `total=${prl.data?.total}`)
    check('状态文案 = 已退货', prl.data?.items?.[0]?.status_text === '已退货', prl.data?.items?.[0]?.status_text)
  }

  // ---------------- 收付款 + 凭证 ----------------
  section('21. 收付款：四象限凭证 + 编辑 + 删除')
  let payRecvCust = null
  let payRecvSup = null
  let payPaySup = null
  let payRefundCust = null
  {
    const mk = async (label, body, wants) => {
      const r = await req('POST', '/api/ext/payments', { token: T, body })
      check(`${label} 200`, r.status === 200, `status=${r.status} ${r.data?.detail || ''}`)
      if (r.status !== 200) return null
      for (const [k, v] of Object.entries(wants)) {
        check(`${label} · ${k}`, r.data?.[k] === v, `${r.data?.[k]}（期望 ${v}）`)
      }
      return r.data
    }

    // 收款 · 客户 → 借 银行存款 / 贷 应收账款
    const c = await mk('收客户货款', {
      type: 1, partner_type: 'customer', partner_id: customerId, amount: 100,
      payment_method: '银行转账', voucher_date: '2026-09-30',
    }, { credit_account: '应收账款', debit_account: '银行存款' })
    payRecvCust = c?.id
    check('凭证号格式 记-YYYY-MM-0001', /^记-\d{4}-\d{2}-\d{4}$/.test(c?.voucher_no || ''), c?.voucher_no)
    check('摘要 = 收<客户名>货款', c?.summary === '收__冒烟测试客户货款', c?.summary)

    // 收款 · 供应商 → 借 银行存款 / 贷 应付账款
    const s = await mk('收供应商退款', {
      type: 1, partner_type: 'supplier', partner_id: supplierId, amount: 50, payment_method: '现金',
    }, { credit_account: '应付账款', debit_account: '库存现金' })
    payRecvSup = s?.id

    // 付款 · 供应商 → 借 应付账款 / 贷 银行存款
    const p = await mk('付供应商货款', {
      type: 2, partner_type: 'supplier', partner_id: supplierId, amount: 80, payment_method: '银行转账',
    }, { debit_account: '应付账款', credit_account: '银行存款' })
    payPaySup = p?.id
    check('摘要 = 付<供应商名>货款', p?.summary === '付__冒烟测试供应商货款', p?.summary)

    // 付款 · 客户 → 借 应收账款 / 贷 银行存款
    const rc = await mk('退款给客户', {
      type: 2, partner_type: 'customer', partner_id: customerId, amount: 30, payment_method: '银行转账',
    }, { debit_account: '应收账款', credit_account: '银行存款' })
    payRefundCust = rc?.id

    const bad1 = await req('POST', '/api/ext/payments', {
      token: T,
      body: { type: 1, partner_type: 'customer', partner_id: customerId, amount: 0 },
    })
    check('金额 0 → 400', bad1.status === 400, `status=${bad1.status}`)

    const l = await req('GET', '/api/ext/payments', { token: T })
    check('收付款列表 200', l.status === 200)
    check('列表带往来单位名', (l.data?.items || []).some((x) => x.partner_name === '__冒烟测试客户'))
    check('列表带凭证字段', !!((l.data?.items || [])[0]?.debit_account))

    const l2 = await req('GET', '/api/ext/payments?type=1', { token: T })
    check('按类型筛选（收款 2 笔）', (l2.data?.total || 0) >= 2, `total=${l2.data?.total}`)
    check('筛选结果都是收款', (l2.data?.items || []).every((x) => x.type === 1))

    // 编辑：改金额 → 摘要/借贷重算，凭证号保留
    const u = await req('PUT', `/api/ext/payments/${payRecvCust}`, { token: T, body: { amount: 120 } })
    check('编辑收付款 200', u.status === 200, `status=${u.status} ${u.data?.detail || ''}`)
    check('凭证号保持不变', u.data?.voucher_no === c?.voucher_no, `${u.data?.voucher_no} vs ${c?.voucher_no}`)

    const after = await req('GET', '/api/ext/payments', { token: T })
    const edited = (after.data?.items || []).find((x) => x.id === payRecvCust)
    check('编辑后金额 = 120', edited?.amount === 120, String(edited?.amount))
    check('编辑后摘要重算（仍含客户名）', /__冒烟测试客户/.test(edited?.summary || ''), edited?.summary)

    const del = await req('DELETE', `/api/ext/payments/${payRefundCust}`, { token: T })
    check('删除收付款 200', del.status === 200, `status=${del.status}`)
    const gone = await req('DELETE', `/api/ext/payments/${payRefundCust}`, { token: T })
    check('重复删除 → 404', gone.status === 404, `status=${gone.status}`)
    payRefundCust = null // 已删，后面应收应付公式要按实际算
  }

  // ---------------- 应收应付 ----------------
  section('22. 应收应付公式')
  {
    const r = await req('GET', '/api/ext/receivables', { token: T })
    check('应收应付 200', r.status === 200, `status=${r.status}`)
    const d = r.data || {}

    // 自洽性：公式两端必须一致（防止字段与公式脱节）
    const expectRecv = d.sales_total - d.recv_from_customer + d.refund_to_customer - d.sale_returned
    const expectPay = d.purchase_total - d.paid_to_supplier + d.refund_from_supplier - d.purchase_returned
    check('应收 = 销售额 − 收客户货款 + 退款给客户 − 销售退货',
      Math.abs(d.receivable - expectRecv) < 0.01, `${d.receivable} vs ${expectRecv}`)
    check('应付 = 采购额 − 付供应商货款 + 收供应商退款 − 采购退货',
      Math.abs(d.payable - expectPay) < 0.01, `${d.payable} vs ${expectPay}`)

    // 具体数值：销售单 4×20=80；采购单 10×10.5+5=110
    check('销售额 = 80', Math.abs(d.sales_total - 80) < 0.01, String(d.sales_total))
    check('采购额 = 110', Math.abs(d.purchase_total - 110) < 0.01, String(d.purchase_total))
    check('收客户货款 = 120（编辑后）', Math.abs(d.recv_from_customer - 120) < 0.01, String(d.recv_from_customer))
    check('退款给客户 = 0（已删除）', Math.abs(d.refund_to_customer - 0) < 0.01, String(d.refund_to_customer))
    check('付供应商货款 = 80', Math.abs(d.paid_to_supplier - 80) < 0.01, String(d.paid_to_supplier))
    check('收供应商退款 = 50', Math.abs(d.refund_from_supplier - 50) < 0.01, String(d.refund_from_supplier))
    check('销售退货 = 80（2+2 件 ×20）', Math.abs(d.sale_returned - 80) < 0.01, String(d.sale_returned))
    check('采购退货 = 31.5（3 × 10.5）', Math.abs(d.purchase_returned - 31.5) < 0.01, String(d.purchase_returned))
    check('兼容字段 received/paid', d.received === d.recv_from_customer && d.paid === d.paid_to_supplier)
  }

  // ---------------- 清理 ----------------
  section('23. 尽力清理（收尾由 cf/smoke-cleanup.sql 完成）')
  {
    // 已收货/已发货的单据接口不允许删除，且商品有库存时也不能删，
    // 这些残留由 cf/smoke-cleanup.sql 用 SQL 彻底清掉。
    if (customerId) {
      const r = await req('DELETE', `/api/customers/${customerId}`, { token: T })
      console.log(`  info 删除客户 -> HTTP ${r.status}${r.status !== 200 ? '（被单据引用，留给 SQL 清理）' : ''}`)
    }
    if (supplierId) {
      const r = await req('DELETE', `/api/suppliers/${supplierId}`, { token: T })
      console.log(`  info 删除供应商 -> HTTP ${r.status}${r.status !== 200 ? '（被单据引用，留给 SQL 清理）' : ''}`)
    }
    if (productId) {
      const r = await req('DELETE', `/api/products/${productId}`, { token: T })
      console.log(`  info 删除商品 -> HTTP ${r.status}${r.status !== 200 ? '（有库存/被引用，留给 SQL 清理）' : ''}`)
    }
    if (wh2) {
      const r = await req('DELETE', `/api/inventory/warehouses/${wh2}`, { token: T })
      console.log(`  info 删除测试仓库2 -> HTTP ${r.status}${r.status !== 200 ? '（有库存，留给 SQL 清理）' : ''}`)
    }
    if (categoryId) {
      const r = await req('DELETE', `/api/products/categories/${categoryId}`, { token: T })
      console.log(`  info 删除分类 -> HTTP ${r.status}${r.status !== 200 ? '（被引用，留给 SQL 清理）' : ''}`)
    }
    check('清理阶段执行完毕', true)
  }

  return finish()
}

function finish() {
  console.log(`\n${'='.repeat(66)}`)
  console.log(`  通过 ${pass}  失败 ${fail}`)
  if (failures.length) {
    console.log('  失败项：')
    for (const f of failures) console.log(`    - ${f}`)
  }
  console.log(`${'='.repeat(66)}`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('\n测试异常中断：', e)
  process.exit(1)
})
