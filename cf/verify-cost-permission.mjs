/**
 * 成本价权限（product:cost）端到端验收
 *
 * 核心断言：没有该权限的角色，**接口里根本拿不到** purchase_price，
 * 而不是「前端藏起来了但 F12 能看到」。
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/$/, '')
const PW = 'CostTest!2345'

let pass = 0
let fail = 0
function check(label, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  OK   ${label}${extra ? '  ' + extra : ''}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${extra ? '  ' + extra : ''}`)
  }
}

async function login(username) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PW }),
  })
  if (res.status !== 200) throw new Error(`${username} 登录失败 ${res.status}: ${await res.text()}`)
  return (await res.json()).access_token
}

async function get(path, token) {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, data, text }
}

const sales = await login('costtest_sales')
const manager = await login('costtest_manager')
console.log('两个测试账号登录成功\n')

console.log('=== 1. 商品列表 ===')
{
  const s = await get('/api/products?page=1&page_size=5', sales)
  const m = await get('/api/products?page=1&page_size=5', manager)
  const sp = s.data?.items?.[0]
  const mp = m.data?.items?.[0]
  check('销售员：purchase_price 为 null', sp && sp.purchase_price === null, `值=${sp && sp.purchase_price}`)
  check('销售员：仍能看到 sale_price', sp && typeof sp.sale_price === 'number', `值=${sp && sp.sale_price}`)
  check('经理：purchase_price 是数字', mp && typeof mp.purchase_price === 'number', `值=${mp && mp.purchase_price}`)
  check('销售员接口响应里不含成本价数字', !/"purchase_price":\s*[0-9]/.test(s.text), '')
}

console.log('\n=== 2. 商品详情 ===')
{
  const list = await get('/api/products?page=1&page_size=1', manager)
  const id = list.data?.items?.[0]?.id
  if (id) {
    const s = await get(`/api/products/${id}`, sales)
    const m = await get(`/api/products/${id}`, manager)
    check('销售员：详情 purchase_price 为 null', s.data?.purchase_price === null, `值=${s.data?.purchase_price}`)
    check('经理：详情 purchase_price 是数字', typeof m.data?.purchase_price === 'number', `值=${m.data?.purchase_price}`)
  }
}

console.log('\n=== 3. 库存列表 ===')
{
  const s = await get('/api/inventory?page=1&page_size=5', sales)
  const m = await get('/api/inventory?page=1&page_size=5', manager)
  check('销售员：库存 purchase_price 为 null', s.data?.items?.[0]?.purchase_price === null,
    `值=${s.data?.items?.[0]?.purchase_price}`)
  check('经理：库存 purchase_price 是数字', typeof m.data?.items?.[0]?.purchase_price === 'number',
    `值=${m.data?.items?.[0]?.purchase_price}`)
}

console.log('\n=== 4. 报表·利润 ===')
{
  const s = await get('/api/ext/reports/profit', sales)
  const m = await get('/api/ext/reports/profit', manager)
  check('销售员：cost_visible = false', s.data?.cost_visible === false, `值=${s.data?.cost_visible}`)
  check('销售员：total_cost 为 null', s.data?.total_cost === null, `值=${s.data?.total_cost}`)
  check('销售员：profit 为 null', s.data?.profit === null, `值=${s.data?.profit}`)
  check('销售员：profit_rate 为 null', s.data?.profit_rate === null, `值=${s.data?.profit_rate}`)
  check('销售员：明细 cost/profit 为 null',
    (s.data?.detail || []).every((d) => d.cost === null && d.profit === null),
    JSON.stringify((s.data?.detail || [])[0] || {}))
  check('销售员：仍能拿到销售额', typeof s.data?.total_sale === 'number', `值=${s.data?.total_sale}`)
  check('经理：cost_visible = true', m.data?.cost_visible === true, `值=${m.data?.cost_visible}`)
  check('经理：profit 是数字', typeof m.data?.profit === 'number', `值=${m.data?.profit}`)
}

console.log('\n=== 5. 报表·库存 ===')
{
  const s = await get('/api/ext/reports/inventory', sales)
  const m = await get('/api/ext/reports/inventory', manager)
  check('销售员：cost_visible = false', s.data?.cost_visible === false, `值=${s.data?.cost_visible}`)
  check('销售员：total_value 为 null', s.data?.total_value === null, `值=${s.data?.total_value}`)
  check('销售员：明细 cost_price/value 为 null',
    (s.data?.items || []).every((i) => i.cost_price === null && i.value === null), '')
  check('经理：total_value 是数字', typeof m.data?.total_value === 'number', `值=${m.data?.total_value}`)
}

console.log('\n=== 6. CSV 导出（整列消失，不是留空）===')
{
  // ⚠️ 必须用 warehouse 角色来测：
  //  sales 角色本身没有 inventory:export，拿到的会是 403，
  //  那样「成本列是否被移除」根本没被验证到 —— 第一版就是这么假通过的。
  //  warehouse 有 inventory:*（含 export），但没有 product:cost。
  const wh = await login('costtest_wh')
  const m = await fetch(`${BASE}/api/ext/export/inventory`, { headers: { Authorization: `Bearer ${manager}` } })
  const whRes = await fetch(`${BASE}/api/ext/export/inventory`, { headers: { Authorization: `Bearer ${wh}` } })
  const whCsv = (await whRes.text()).replace(/^\ufeff/, '')
  const mCsv = (await m.text()).replace(/^\ufeff/, '')
  const whHead = whCsv.split('\r\n')[0]
  const mHead = mCsv.split('\r\n')[0]

  check('仓管导出请求成功（不是 403）', whRes.status === 200, `status=${whRes.status}`)
  check('仓管导出的表头不含「成本价」', !whHead.includes('成本价'), whHead)
  check('仓管导出的表头不含「金额」', !whHead.includes('金额'), whHead)
  check('仓管导出的表头列数比经理少 2 列',
    whHead.split(',').length === mHead.split(',').length - 2,
    `仓管 ${whHead.split(',').length} 列 / 经理 ${mHead.split(',').length} 列`)
  check('经理导出的表头含「成本价」', mHead.includes('成本价'), mHead)
  // 数据行里不能残留成本数字（5 列：商品,编码,仓库,数量,最低库存）
  const whRow = whCsv.split('\r\n')[1] || ''
  check('仓管数据行只有 5 列', whRow.split(',').length === 5, `${whRow.split(',').length} 列: ${whRow}`)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`  通过 ${pass}  失败 ${fail}`)
console.log('='.repeat(60))
process.exit(fail ? 1 : 0)
