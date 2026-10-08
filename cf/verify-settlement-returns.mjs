/**
 * Regression test: a partially-returned order must count as settled once the
 * customer has paid the reduced amount.
 *
 * Scenario
 *   order 1000, approved + shipped
 *   return 300 on that order, approved   -> the customer really owes 700
 *   payment 700 allocated to the order
 *   expected: settled
 *   buggy   : partial, with outstanding 1000 - 700 = 300
 *
 * Root cause of the original bug: the settlement check compared the payment
 * against the order's ORIGINAL total and ignored returns. Returns reduce what is
 * actually owed, so the order could never reach "settled" and kept showing up in
 * the allocation picker as an outstanding document.
 *
 * ASCII only (AGENTS.md section 1).
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/$/, '')
const TAG = String(Date.now()).slice(-6)

let pass = 0
let fail = 0
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  OK   ${label}${extra ? '  ' + extra : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${extra ? '  ' + extra : ''}`) }
}

async function call(method, path, body, token) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(BASE + path, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

function need(step, r) {
  if (r.status !== 200) throw new Error(`${step}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
  return r.data
}

const run = async () => {
  const T = need('login', await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123' })).access_token

  const cat = need('cat', await call('POST', '/api/products/categories', { name: 'RT-' + TAG }, T))
  const p = need('prod', await call('POST', '/api/products',
    { name: '\u9000\u8d27\u8d27', category_id: cat.id, sku: 'RT-' + TAG, unit: '\u4ef6', purchase_price: 1, sale_price: 1 }, T))
  const cus = need('cus', await call('POST', '/api/customers', { name: 'K-RT-' + TAG }, T))
  const sup = need('sup', await call('POST', '/api/suppliers', { name: 'S-RT-' + TAG }, T))

  // stock
  const seedPo = need('seedPo', await call('POST', '/api/purchase', {
    supplier_id: sup.id, items: [{ product_id: p.id, quantity: 500, price: 1 }],
  }, T))
  need('seedPo approve', await call('PUT', '/api/purchase/' + seedPo.id + '/approve', undefined, T))
  const pod = need('seedPo get', await call('GET', '/api/purchase/' + seedPo.id, undefined, T))
  need('seedPo receive', await call('PUT', '/api/purchase/' + seedPo.id + '/receive', {
    items: pod.items.map((i) => ({ item_id: i.id, quantity: i.quantity })),
  }, T))

  // order of 1000, shipped
  const so = need('sale', await call('POST', '/api/sales', {
    customer_id: cus.id, items: [{ product_id: p.id, quantity: 10, price: 100 }],
  }, T))
  need('approve', await call('PUT', '/api/sales/' + so.id + '/approve', undefined, T))
  const sod = need('so get', await call('GET', '/api/sales/' + so.id, undefined, T))
  need('ship', await call('PUT', '/api/sales/' + so.id + '/ship', {
    items: sod.items.map((i) => ({ item_id: i.id, quantity: i.quantity })),
  }, T))

  // return 300 worth (3 of 10)
  const sr = need('return', await call('POST', '/api/ext/sale-returns', {
    sales_order_id: so.id, customer_id: cus.id, reason: '\u90e8\u5206\u9000\u8d27',
    items: [{ product_id: p.id, quantity: 3, price: 100 }],
  }, T))
  need('return approve', await call('PUT', '/api/ext/sale-returns/' + sr.id + '/approve', undefined, T))

  // customer pays the reduced amount
  need('payment', await call('POST', '/api/ext/payments', {
    type: 1, partner_type: 'customer', partner_id: cus.id, amount: 700,
    payment_method: '\u73b0\u91d1', voucher_date: '2026-10-09',
    allocations: [{ related_type: 'sales_order', related_id: so.id, amount: 700 }],
  }, T))

  const g = need('order', await call('GET', '/api/sales/' + so.id, undefined, T))
  console.log(`order ${g.order_no}: total=${g.total_amount} settled=${g.settled_amount} outstanding=${g.outstanding_amount} -> ${g.settlement} (${g.settlement_text})`)

  const open = need('open', await call('GET', `/api/ext/open-orders?partner_type=customer&partner_id=${cus.id}`, undefined, T))
  const orow = (open.items || []).find((i) => i.id === so.id)
  console.log(`open-orders: outstanding=${orow && orow.outstanding} settled=${orow && orow.settled} open_count=${open.open_count}`)

  console.log('\n--- expectation ---')
  console.log('  the customer owes 1000 - 300 (returned) = 700, and paid 700, so:')
  check('order is settled (was the bug: partial)', g.settlement === 'settled', `${g.settlement} outstanding=${g.outstanding_amount}`)
  check('outstanding is 0', g.outstanding_amount === 0, String(g.outstanding_amount))
  check('returned amount is exposed as 300', g.returned_amount === 300, String(g.returned_amount))
  check('payable amount is exposed as 700', g.payable_amount === 700, String(g.payable_amount))
  check('open-orders marks it settled', !!(orow && orow.settled === true), JSON.stringify(orow))
  check('open_count excludes it', open.open_count === 0, String(open.open_count))

  console.log('\n' + '='.repeat(60))
  console.log(`  passed ${pass}, failed ${fail}`)
  console.log('='.repeat(60))
  process.exit(fail === 0 ? 0 : 1)
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
