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

/**
 * 发一次请求。
 *
 * 为什么要重试：`wrangler pages dev`（本地代理）在密集连续请求下会偶发掉连接，
 * 报 "Network connection lost"，**请求根本没到达 worker**（服务端日志里没有对应的
 * info 行）。这会让「审核」这类没有断言的调用静默失败，进而引发几十个连锁失败，
 * 把真正的根因埋掉。
 *
 * 判定依据：fetch 直接抛异常、或连接被重置 —— 即**没有拿到任何 HTTP 状态**。
 * 这跟「拿到了 400/500 业务错误」是两回事，后者绝不重试。
 * 重试是安全的：连接在到达 worker 前就断了，不存在写了一半的情况。
 */
const MAX_NET_RETRY = 3
let netRetries = 0

async function req(method, path, { token, body, raw } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res = null
  let lastErr = null

  for (let attempt = 1; attempt <= MAX_NET_RETRY; attempt++) {
    try {
      res = await fetch(BASE + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      break
    } catch (e) {
      lastErr = e
      if (attempt < MAX_NET_RETRY) {
        netRetries++
        await new Promise((r) => setTimeout(r, 300 * attempt))
      }
    }
  }

  if (!res) {
    // 重试完仍拿不到响应：如实报出来，不要伪装成业务错误
    console.log(`  !!   网络失败 ${method} ${path}（重试 ${MAX_NET_RETRY} 次）：${lastErr && lastErr.message}`)
    return { status: 0, data: null, text: '', headers: {}, netError: true }
  }

  let data = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = raw ? text : null
    }
  }
  return {
    status: res.status,
    data,
    text,
    headers: Object.fromEntries(res.headers.entries()),
  }
}

function section(title) {
  console.log(`\n${'='.repeat(66)}\n  ${title}\n${'='.repeat(66)}`)
}

/**
 * 取原始字节。
 * 为什么需要：Response.text() 按 WHATWG 规范用「UTF-8 decode」解码，
 * 会**自动剥掉开头的 BOM**，所以想验证 BOM 必须看 bytes。
 */
async function reqRaw(path, token) {
  const res = await fetch(BASE + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const bytes = new Uint8Array(await res.arrayBuffer())
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    bytes,
    text: new TextDecoder('utf-8').decode(bytes), // 这里也会去 BOM，用于解析内容
  }
}

function hasBom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
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
    // 85 = 84 条基线 + product:cost（查看成本价，后加的，用于隐藏进价）
    check('权限清单 85 条', Array.isArray(r3.data) && r3.data.length === 85, `count=${r3.data?.length}`)
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
  section('10. 四阶段接口全部已实现 / 404 语义')
  {
    const expect200 = async (path, label) => {
      const r = await req('GET', path, { token: T })
      check(`${label} → 200`, r.status === 200, `status=${r.status} ${r.data?.detail || ''}`)
      return r
    }

    await expect200('/api/purchase', '采购单')
    await expect200('/api/sales', '销售单')
    await expect200('/api/ext/stock-logs', '库存流水')
    await expect200('/api/ext/payments', '收付款')
    await expect200('/api/ext/sale-returns', '销售退货')
    await expect200('/api/ext/purchase-returns', '采购退货')
    await expect200('/api/ext/receivables', '应收应付')
    await expect200('/api/ext/reports/sales', '报表·销售')
    await expect200('/api/ext/reports/inventory', '报表·库存')
    await expect200('/api/ext/logs', '操作日志')
    await expect200('/api/ext/health-check', '数据自检')
    await expect200('/api/ext/dashboard', '首页看板')
    await expect200('/api/ext/sales-daily', '销售日报')

    const r3 = await req('GET', '/api/nonexistent-endpoint', { token: T })
    check('未知接口 → 404', r3.status === 404, `status=${r3.status}`)
    check('404 提示含路径', /不存在/.test(r3.data?.detail || ''), r3.data?.detail)

    const r4 = await req('GET', '/api/ext/export/unknown-kind', { token: T })
    check('未知导出类型 → 404', r4.status === 404, `status=${r4.status}`)

    const r5 = await req('GET', '/api/users')
    check('无 token 仍 401（未因放量而失守）', r5.status === 401, `status=${r5.status}`)
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

    // 必须断言：之前这里不断言，审核失败会被静默吞掉，导致后面一连串
    // 失败都指向「发货」而不是真正的根因。
    const rap = await req('PUT', `/api/sales/${salesId}/approve`, { token: T })
    check('销售单审核 200', rap.status === 200, `status=${rap.status} ${rap.data?.detail || ''}`)

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
    if (uid) {
      const del = await req('DELETE', `/api/users/${uid}`, { token: T })
      // 该用户已登录过、产生过操作日志 → 后端应改为「停用」而不是 500
      check('删除有历史记录的用户 → 200（改为停用，不报外键错）',
        del.status === 200, `status=${del.status}`)
      check('返回 disabled=true 与说明', del.data?.disabled === true && !!del.data?.message,
        del.data?.message)

      // 停用后应无法登录：后端对 status=0 返回 403（比 401 更准确地区分了「禁用」）
      const relogin = await req('POST', '/api/auth/login', {
        body: { username: 'smoke_noperm', password: 'Smoke!2345' },
      })
      check('停用后无法登录 → 403', relogin.status === 403, `status=${relogin.status}`)
      check('提示「已被禁用」', /已被禁用/.test(relogin.data?.detail || ''), relogin.data?.detail)
    }
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

  // ---------------- 首页看板 + 销售日报 ----------------
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  section('24. 首页看板 + 销售日报')
  {
    const r1 = await req('GET', '/api/ext/dashboard', { token: T })
    check('看板 200', r1.status === 200, `status=${r1.status}`)
    const d = r1.data || {}

    check('今日销售额 = 80', Math.abs(d.today_sales - 80) < 0.01, String(d.today_sales))
    check('今日销售笔数 = 1', d.today_sales_count === 1, String(d.today_sales_count))
    check('今日采购额 = 110', Math.abs(d.today_purchase - 110) < 0.01, String(d.today_purchase))
    check('今日采购笔数 = 1', d.today_purchase_count === 1, String(d.today_purchase_count))
    check('待收货 = 0（无已审核未收货单）', d.pending_purchase_in === 0, String(d.pending_purchase_in))
    check('待发货 = 0', d.pending_sales_out === 0, String(d.pending_sales_out))
    check('库存总量 = 10（8 + 2）', d.inventory_total === 10, String(d.inventory_total))
    check('低库存预警 = 1（wh2 剩 2 ≤ 最低 5）', d.low_stock_count === 1, String(d.low_stock_count))

    // 看板的应收应付必须和 /receivables 完全一致（两处口径不能漂）
    const rec = await req('GET', '/api/ext/receivables', { token: T })
    check('看板应收 = 应收应付接口', Math.abs(d.receivable - rec.data.receivable) < 0.01,
      `${d.receivable} vs ${rec.data.receivable}`)
    check('看板应付 = 应收应付接口', Math.abs(d.payable - rec.data.payable) < 0.01,
      `${d.payable} vs ${rec.data.payable}`)

    const r2 = await req('GET', '/api/ext/sales-daily?days=7', { token: T })
    check('销售日报 200', r2.status === 200, `status=${r2.status}`)
    check('返回 7 天（缺日补 0）', (r2.data?.items || []).length === 7, String(r2.data?.items?.length))
    check('最后一天 = 今天', r2.data?.items?.[6]?.date === today, r2.data?.items?.[6]?.date)
    check('起始日 = 6 天前', r2.data?.start === r2.data?.items?.[0]?.date, r2.data?.start)
    check('7 天销售额 = 80', Math.abs((r2.data?.total_amount ?? 0) - 80) < 0.01, String(r2.data?.total_amount))
    check('7 天笔数 = 1', r2.data?.total_count === 1, String(r2.data?.total_count))
    check('日均额已计算', typeof r2.data?.avg_amount === 'number', String(r2.data?.avg_amount))
    check('日期连续递增', (r2.data?.items || []).every((x, i, a) => i === 0 || x.date > a[i - 1].date))

    const r3 = await req('GET', '/api/ext/sales-daily?days=999', { token: T })
    check('days 上限收敛到 365', r3.data?.days === 365, String(r3.data?.days))
    const r4 = await req('GET', '/api/ext/sales-daily?days=0', { token: T })
    check('days=0 回落到默认 30', r4.data?.days === 30, String(r4.data?.days))
  }

  // ---------------- 报表 ----------------
  section('25. 报表 ×4')
  {
    const r1 = await req('GET', '/api/ext/reports/sales', { token: T })
    check('报表·销售 200', r1.status === 200, `status=${r1.status}`)
    check('销售额 = 80', Math.abs(r1.data?.total_amount - 80) < 0.01, String(r1.data?.total_amount))
    check('销售单数 = 1', r1.data?.order_count === 1, String(r1.data?.order_count))
    check('按客户分组含测试客户',
      (r1.data?.by_customer || []).some((x) => x.name === '__冒烟测试客户'), JSON.stringify(r1.data?.by_customer))
    check('按商品分组含测试商品',
      (r1.data?.by_product || []).some((x) => x.name === '__冒烟测试商品'), JSON.stringify(r1.data?.by_product))

    // 关键回归：结束日期当天的数据不能被漏掉
    // （Python 版 created_at <= 'YYYY-MM-DD' 会漏掉当天，这里已修）
    const r1b = await req('GET', `/api/ext/reports/sales?start_date=${today}&end_date=${today}`, { token: T })
    check('报表·销售 单日区间含当天数据 = 80', Math.abs(r1b.data?.total_amount - 80) < 0.01,
      `${r1b.data?.total_amount}（若为 0 则「结束日期漏当天」的 bug 复现了）`)

    const r2 = await req('GET', '/api/ext/reports/purchase', { token: T })
    check('报表·采购 200', r2.status === 200, `status=${r2.status}`)
    check('采购额 = 110', Math.abs(r2.data?.total_amount - 110) < 0.01, String(r2.data?.total_amount))
    check('按供应商分组含测试供应商',
      (r2.data?.by_supplier || []).some((x) => x.name === '__冒烟测试供应商'))

    const r3 = await req('GET', '/api/ext/reports/profit', { token: T })
    check('报表·利润 200', r3.status === 200, `status=${r3.status}`)
    check('销售收入 = 80', Math.abs(r3.data?.total_sale - 80) < 0.01, String(r3.data?.total_sale))
    check('成本 = 4 × 10.5 = 42', Math.abs(r3.data?.total_cost - 42) < 0.01, String(r3.data?.total_cost))
    check('毛利 = 38', Math.abs(r3.data?.profit - 38) < 0.01, String(r3.data?.profit))
    check('毛利率 = 47.5%', Math.abs(r3.data?.profit_rate - 47.5) < 0.01, String(r3.data?.profit_rate))
    check('按毛利倒序且明细有商品名',
      (r3.data?.detail || [])[0]?.name === '__冒烟测试商品', r3.data?.detail?.[0]?.name)

    const r4 = await req('GET', '/api/ext/reports/inventory', { token: T })
    check('报表·库存 200', r4.status === 200, `status=${r4.status}`)
    check('库存总量 = 10', r4.data?.total_qty === 10, String(r4.data?.total_qty))
    check('库存金额 = 10 × 10.5 = 105', Math.abs(r4.data?.total_value - 105) < 0.01, String(r4.data?.total_value))
    check('明细带仓库名与低库存标记',
      (r4.data?.items || []).length === 2 && typeof r4.data?.items?.[0]?.low === 'boolean',
      `rows=${r4.data?.items?.length}`)
  }

  // ---------------- 操作日志 ----------------
  section('26. 操作日志')
  {
    const r1 = await req('GET', '/api/ext/logs', { token: T })
    check('日志列表 200', r1.status === 200, `status=${r1.status}`)
    check('有日志记录', (r1.data?.total || 0) > 0, `total=${r1.data?.total}`)
    const row = (r1.data?.items || [])[0]
    check('日志字段完整',
      !!row?.username && !!row?.module && !!row?.action && !!row?.created_at,
      `${row?.username}/${row?.module}/${row?.action}`)

    const r2 = await req('GET', '/api/ext/logs?module=' + encodeURIComponent('采购管理'), { token: T })
    check('按模块筛选 200', r2.status === 200)
    check('筛选结果模块正确', (r2.data?.items || []).every((x) => x.module === '采购管理'),
      `total=${r2.data?.total}`)

    const r3 = await req('GET', '/api/ext/logs?keyword=' + encodeURIComponent('__冒烟测试客户'), { token: T })
    check('关键词搜索 200', r3.status === 200)
    check('搜到相关日志', (r3.data?.total || 0) > 0, `total=${r3.data?.total}`)
  }

  // ---------------- 数据自检 ----------------
  section('27. 数据自检（干净数据应无问题）')
  {
    const r1 = await req('GET', '/api/ext/health-check', { token: T })
    check('自检 200', r1.status === 200, `status=${r1.status}`)
    check('ok = true', r1.data?.ok === true, JSON.stringify(r1.data?.issues?.slice(0, 2)))
    check('错误数 = 0', r1.data?.error_count === 0, String(r1.data?.error_count))
    check('警告数 = 0（金额与明细一致）', r1.data?.warn_count === 0,
      JSON.stringify((r1.data?.issues || []).filter((i) => i.level === 'warn')))
    check('可修复数 = 0', r1.data?.fixable_count === 0, String(r1.data?.fixable_count))

    const r2 = await req('POST', '/api/ext/health-check/fix', { token: T })
    check('一键修复 200', r2.status === 200, `status=${r2.status}`)
    check('无问题时可修复数 = 0', r2.data?.fixed_count === 0, String(r2.data?.fixed_count))
    check('修复后 ok = true', r2.data?.ok === true)
  }

  // ---------------- CSV 导出 ----------------
  section('28. CSV 导出 ×6')
  {
    const parseCsv = (text) => {
      const body = text.replace(/^\ufeff/, '')
      return body.split('\r\n').filter((l) => l.length > 0).map((l) => l.split(','))
    }

    const cases = [
      ['inventory', ['商品', '商品编码', '仓库', '数量', '成本价', '金额', '最低库存'], 2],
      ['sales', ['销售单号', '客户', '金额', '状态', '发票号', '送货地址', '创建时间'], 1],
      ['purchase', ['采购单号', '供应商', '金额', '状态', '发票号', '创建时间'], 1],
      ['stocklog', ['ID', '商品', '仓库', '类型', '数量', '变动前', '变动后', '关联单号', '时间'], 1],
      ['payments', ['单号', '类型', '对象类型', '往来单位', '金额', '支付方式', '凭证号', '备注', '时间'], 3],
      ['logs', ['ID', '用户', '模块', '动作', '对象', '详情', '时间'], 1],
    ]

    for (const [kind, header, minRows] of cases) {
      const r = await reqRaw(`/api/ext/export/${kind}`, T)
      check(`导出 ${kind} 200`, r.status === 200, `status=${r.status}`)
      check(`导出 ${kind} Content-Type`,
        String(r.headers?.['content-type'] || '').includes('text/csv'),
        r.headers?.['content-type'])
      check(`导出 ${kind} 带 BOM（Excel 不乱码）`, hasBom(r.bytes),
        `前 3 字节 = ${[...r.bytes.slice(0, 3)].map((b) => b.toString(16)).join(' ')}`)
      const rows = parseCsv(r.text || '')
      check(`导出 ${kind} 表头正确`, JSON.stringify(rows[0]) === JSON.stringify(header), JSON.stringify(rows[0]))
      check(`导出 ${kind} 至少 ${minRows} 行数据`, rows.length - 1 >= minRows, `rows=${rows.length - 1}`)
      check(`导出 ${kind} 带下载文件名`,
        /attachment; filename=".+\.csv"/.test(String(r.headers?.['content-disposition'] || '')),
        r.headers?.['content-disposition'])
    }

    // 关键回归：Python 版状态映射残缺（status=3 被标成「已作废」，>=4 直接崩）
    const rs = await reqRaw('/api/ext/export/sales', T)
    const srows = parseCsv(rs.text || '')
    check('销售导出状态显示「已退货」而非「已作废」', srows[1]?.[3] === '已退货', srows[1]?.[3])

    const rp = await reqRaw('/api/ext/export/purchase', T)
    const prows = parseCsv(rp.text || '')
    check('采购导出状态显示「部分退货」', prows[1]?.[3] === '部分退货', prows[1]?.[3])
  }

  // ---------------- 商品图片上传 ----------------
  section('29. 商品图片上传（KV 存储）')
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64'
    )
    const fd = new FormData()
    fd.append('file', new Blob([png], { type: 'image/png' }), 'smoke.png')
    const res = await fetch(`${BASE}/api/products/upload-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${T}` },
      body: fd,
    })
    const body = await res.json().catch(() => null)
    check('上传图片 200', res.status === 200, `status=${res.status} ${body?.detail || ''}`)
    check('返回 /uploads/products/ URL',
      typeof body?.url === 'string' && body.url.startsWith('/uploads/products/'), body?.url)
    check('文件名格式 yyyymmdd_12hex.ext', /^\d{8}_[0-9a-f]{12}\.png$/.test(body?.name || ''), body?.name)

    if (body?.url) {
      const got = await fetch(BASE + body.url)
      const bytes = Buffer.from(await got.arrayBuffer())
      check('图片可回读且字节一致', got.status === 200 && bytes.equals(png),
        `status=${got.status} ${bytes.length}/${png.length}`)
      check('回读 Content-Type 正确',
        (got.headers.get('content-type') || '').includes('image/png'), got.headers.get('content-type'))
    }
  }

  // ---------------- 清理 ----------------
  section('30. 尽力清理（收尾由 cf/smoke-cleanup.sql 完成）')
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
  if (netRetries) {
    // 本地 wrangler 代理偶发掉连接，重试次数单独报出来，
    // 免得把「环境抖动」误读成「接口不稳定」
    console.log(`  网络重试 ${netRetries} 次（本地 dev 代理抖动，非接口问题）`)
  }
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
