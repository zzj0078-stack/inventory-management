/**
 * 进销存 Cloudflare 版 —— 冒烟测试
 *
 * 用法：
 *   node cf/smoke-test.mjs                        # 默认测本地 http://127.0.0.1:8788
 *   node cf/smoke-test.mjs https://xxx.pages.dev  # 测线上
 *
 * 覆盖：健康检查 / 登录鉴权 / 权限 / 角色 / 用户 / 分类 / 商品 / 客户 / 供应商 / 仓库 / 库存
 * 会创建临时数据并在结束时清理。
 */

const BASE = (process.argv[2] || process.env.BASE || 'http://127.0.0.1:8788').replace(/\/$/, '')

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
    const r1 = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong-password' } })
    check('错误密码 → 401', r1.status === 401, `status=${r1.status}`)

    const r2 = await req('GET', '/api/users')
    check('无 token 访问 → 401', r2.status === 401, `status=${r2.status}`)

    const r3 = await req('GET', '/api/users', { token: 'garbage.token.value' })
    check('伪造 token → 401', r3.status === 401, `status=${r3.status}`)

    const r4 = await req('POST', '/api/auth/password-rules')
    const r4b = await req('GET', '/api/auth/password-rules')
    check('密码规则接口免登录', r4b.status === 200, `status=${r4b.status}`)
    check('密码规则文案正确', (r4b.data?.rules || '').includes('至少 8 位'))

    const r5 = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } })
    check('正确密码 → 200', r5.status === 200, `status=${r5.status}`)
    check('返回 access_token', typeof r5.data?.access_token === 'string' && r5.data.access_token.split('.').length === 3)
    check('返回 user 对象', r5.data?.user?.username === 'admin')
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

    const r2 = await req('GET', '/api/users?keyword=admin', { token: T })
    check('关键词搜索生效', (r2.data?.total || 0) >= 1, `total=${r2.data?.total}`)

    const r3 = await req('GET', '/api/users/1', { token: T })
    check('用户详情 200', r3.status === 200)
    check('详情含 role_name', r3.data?.role_name === 'admin')
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
  section('10. 未实现接口 / 404 语义')
  {
    const r1 = await req('GET', '/api/purchase', { token: T })
    check('未实现模块 → 501', r1.status === 501, `status=${r1.status}`)
    check('501 提示包含阶段信息', /阶段/.test(r1.data?.detail || ''), r1.data?.detail)

    const r2 = await req('GET', '/api/ext/payments', { token: T })
    check('收付款 → 501', r2.status === 501, `status=${r2.status}`)

    const r3 = await req('GET', '/api/nonexistent-endpoint', { token: T })
    check('未知接口 → 404', r3.status === 404, `status=${r3.status}`)

    const r4 = await req('GET', '/api/ext/reports/sales', { token: T })
    check('报表 → 501', r4.status === 501, `status=${r4.status}`)
  }

  // ---------------- 清理 ----------------
  section('11. 清理测试数据')
  {
    if (productId) {
      const r = await req('DELETE', `/api/products/${productId}`, { token: T })
      check('删除商品', r.status === 200, `status=${r.status}`)
    }
    if (customerId) {
      const r = await req('DELETE', `/api/customers/${customerId}`, { token: T })
      check('删除客户', r.status === 200, `status=${r.status}`)
    }
    if (supplierId) {
      const r = await req('DELETE', `/api/suppliers/${supplierId}`, { token: T })
      check('删除供应商', r.status === 200, `status=${r.status}`)
    }
    if (categoryId) {
      const r = await req('DELETE', `/api/products/categories/${categoryId}`, { token: T })
      check('删除分类', r.status === 200, `status=${r.status}`)
    }
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
