/**
 * Regression test: statements must work for partners that HAVE RETURNS.
 *
 * Why this file exists
 * --------------------
 * The statement endpoint fetches line items per document. Orders keep their
 * items in sales_items / purchase_items, whose foreign key is `order_id`, but
 * RETURNS keep theirs in sale_return_items / purchase_return_items, whose
 * foreign key is `return_id`. The first implementation passed `order_id` for
 * all four tables.
 *
 * That shipped as a 500 -- D1_ERROR: no such column: it.order_id -- and no test
 * caught it, because every statement test used data with ZERO returns.
 * allInChunks returns early on an empty id list, so the malformed SQL was never
 * executed. Coverage that cannot reach the code path is not coverage.
 *
 * So this test deliberately creates a sale return AND a purchase return, then
 * asserts both statement endpoints answer 200 and that the return rows carry
 * their items.
 *
 * Requires a reachable server and the admin account:
 *   node cf/verify-statement-returns.mjs [base] [user] [pass]
 * Default base is the local dev server.
 *
 * ASCII only (AGENTS.md section 1).
 */

const BASE = (process.argv[2] || 'http://127.0.0.1:8788').replace(/\/$/, '')
const USER = process.argv[3] || 'admin'
const PASS = process.argv[4] || 'admin123'

let pass = 0
let fail = 0
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`  OK   ${label}${extra ? '  ' + extra : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${extra ? '  ' + extra : ''}`) }
}

const TAG = String(Date.now()).slice(-6)

async function call(method, path, body, token) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

function need(step, r) {
  if (r.status !== 200) {
    throw new Error(`${step}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`)
  }
  return r.data
}

// Document kinds as returned by the API. Chinese is written as escapes so this
// file stays pure ASCII (AGENTS.md section 1).
const saleOrder = '\u9500\u552e\u5355'            // sales order
const saleReturn = '\u9500\u552e\u9000\u8d27'      // sales return
const purchaseOrder = '\u91c7\u8d2d\u5355'         // purchase order
const purchaseReturn = '\u91c7\u8d2d\u9000\u8d27'  // purchase return

const run = async () => {
  console.log(`base: ${BASE}\n`)

  const T = need('login', await call('POST', '/api/auth/login', { username: USER, password: PASS })).access_token

  const cat = need('category', await call('POST', '/api/products/categories', { name: 'RET-' + TAG }, T))
  const pa = need('product A', await call('POST', '/api/products', {
    name: '\u87ba\u4e1d\u7532', category_id: cat.id, sku: 'RA-' + TAG,
    unit: '\u4e2a', purchase_price: 10, sale_price: 30,
  }, T))
  const pb = need('product B', await call('POST', '/api/products', {
    name: '\u57ab\u7247\u4e59', category_id: cat.id, sku: 'RB-' + TAG,
    unit: '\u5305', purchase_price: 5, sale_price: 15,
  }, T))

  const cus = need('customer', await call('POST', '/api/customers', { name: 'K-RET-' + TAG }, T))
  const sup = need('supplier', await call('POST', '/api/suppliers', { name: 'S-RET-' + TAG }, T))

  // stock both products
  const seedPo = need('seed purchase', await call('POST', '/api/purchase', {
    supplier_id: sup.id,
    items: [
      { product_id: pa.id, quantity: 500, price: 10 },
      { product_id: pb.id, quantity: 500, price: 5 },
    ],
  }, T))
  need('seed approve', await call('PUT', '/api/purchase/' + seedPo.id + '/approve', undefined, T))
  const seedPod = need('seed get', await call('GET', '/api/purchase/' + seedPo.id, undefined, T))
  need('seed receive', await call('PUT', '/api/purchase/' + seedPo.id + '/receive', {
    items: seedPod.items.map((i) => ({ item_id: i.id, quantity: i.quantity })),
  }, T))

  // ---- sale -> ship -> return (the path that 500'd) ----
  const so = need('sales order', await call('POST', '/api/sales', {
    customer_id: cus.id,
    sale_date: '2026-08-15',
    items: [
      { product_id: pa.id, quantity: 5, price: 30 },
      { product_id: pb.id, quantity: 4, price: 15 },
    ],
  }, T))
  need('sales approve', await call('PUT', '/api/sales/' + so.id + '/approve', undefined, T))
  const sod = need('sales get', await call('GET', '/api/sales/' + so.id, undefined, T))
  need('sales ship', await call('PUT', '/api/sales/' + so.id + '/ship', {
    items: sod.items.map((i) => ({ item_id: i.id, quantity: i.quantity })),
  }, T))

  const sr = need('sale return', await call('POST', '/api/ext/sale-returns', {
    sales_order_id: so.id,
    customer_id: cus.id,
    reason: '\u8d28\u91cf\u95ee\u9898',
    items: [{ product_id: pa.id, quantity: 1, price: 30 }],
  }, T))
  need('sale return approve', await call('PUT', '/api/ext/sale-returns/' + sr.id + '/approve', undefined, T))
  console.log(`seeded sale return ${sr.return_no}`)

  // ---- purchase -> receive -> return ----
  const po = need('purchase order', await call('POST', '/api/purchase', {
    supplier_id: sup.id,
    purchase_date: '2026-08-05',
    items: [
      { product_id: pa.id, quantity: 10, price: 10 },
      { product_id: pb.id, quantity: 6, price: 5 },
    ],
  }, T))
  need('purchase approve', await call('PUT', '/api/purchase/' + po.id + '/approve', undefined, T))
  // a purchase return requires the order to be received
  const pod = need('purchase get', await call('GET', '/api/purchase/' + po.id, undefined, T))
  need('purchase receive', await call('PUT', '/api/purchase/' + po.id + '/receive', {
    items: pod.items.map((i) => ({ item_id: i.id, quantity: i.quantity })),
  }, T))

  const pr = need('purchase return', await call('POST', '/api/ext/purchase-returns', {
    purchase_order_id: po.id,
    supplier_id: sup.id,
    reason: '\u591a\u53d1',
    items: [{ product_id: pa.id, quantity: 2, price: 10 }],
  }, T))
  need('purchase return approve', await call('PUT', '/api/ext/purchase-returns/' + pr.id + '/approve', undefined, T))
  console.log(`seeded purchase return ${pr.return_no}\n`)

  // ---------------- the assertions ----------------

  console.log('=== statement/customer with a return present ===')
  const stc = await call('GET', `/api/ext/statement/customer?partner_id=${cus.id}`, undefined, T)
  check('HTTP 200 (was a 500: no such column it.order_id)', stc.status === 200,
    stc.status === 200 ? '' : JSON.stringify(stc.data).slice(0, 200))

  if (stc.status === 200) {
    const rows = stc.data.rows || []
    const orderRow = rows.find((r) => r.kind === saleOrder)
    const retRow = rows.find((r) => r.kind === saleReturn)

    check('order row present', !!orderRow, orderRow ? orderRow.doc_no : 'missing')
    check('order row carries its items', !!(orderRow && orderRow.items.length), orderRow ? `${orderRow.items.length} items` : '')
    check('order row quantity total is 9', !!(orderRow && orderRow.items_quantity === 9), orderRow ? String(orderRow.items_quantity) : '')
    check('return row present', !!retRow, retRow ? retRow.doc_no : 'missing')
    check('return row carries its items (the regression)', !!(retRow && retRow.items.length), retRow ? JSON.stringify(retRow.items) : '')
    check('return row quantity total is 1', !!(retRow && retRow.items_quantity === 1), retRow ? String(retRow.items_quantity) : '')
    check('return row decreases the balance', !!(retRow && retRow.decrease === 30))
    check('return item is the returned product',
      !!(retRow && retRow.items[0] && retRow.items[0].product_name === '\u87ba\u4e1d\u7532'),
      retRow ? JSON.stringify(retRow.items) : '')
  }

  console.log('\n=== statement/supplier with a return present ===')
  const sts = await call('GET', `/api/ext/statement/supplier?partner_id=${sup.id}`, undefined, T)
  check('HTTP 200 (was a 500: no such column it.order_id)', sts.status === 200,
    sts.status === 200 ? '' : JSON.stringify(sts.data).slice(0, 200))

  if (sts.status === 200) {
    const rows = sts.data.rows || []
    const orderRow = rows.find((r) => r.kind === purchaseOrder)
    const retRow = rows.find((r) => r.kind === purchaseReturn)

    check('purchase order row present', !!orderRow)
    check('purchase order row carries its items', !!(orderRow && orderRow.items.length))
    check('purchase return row present', !!retRow, retRow ? retRow.doc_no : 'missing')
    check('purchase return row carries its items (the regression)', !!(retRow && retRow.items.length),
      retRow ? JSON.stringify(retRow.items) : '')
    check('purchase return quantity total is 2', !!(retRow && retRow.items_quantity === 2),
      retRow ? String(retRow.items_quantity) : '')
  }

  console.log('\n=== closing balance still equals outstanding ===')
  const oc = need('customer outstanding', await call('GET', '/api/customers/' + cus.id + '/outstanding', undefined, T))
  const os = need('supplier outstanding', await call('GET', '/api/suppliers/' + sup.id + '/outstanding', undefined, T))
  check('customer closing === outstanding', stc.data.closing_balance === oc.amount,
    `${stc.data.closing_balance} vs ${oc.amount}`)
  check('supplier closing === outstanding', sts.data.closing_balance === os.amount,
    `${sts.data.closing_balance} vs ${os.amount}`)

  console.log('\n' + '='.repeat(60))
  console.log(`  passed ${pass}, failed ${fail}`)
  console.log('='.repeat(60))
  process.exit(fail === 0 ? 0 : 1)
}

run().catch((e) => { console.error('ERR', e.message); process.exit(1) })
