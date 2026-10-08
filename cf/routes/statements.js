/**
 * 对账单（客户应收 / 供应商应付）
 *
 * 口径必须与欠款页完全一致，否则「对账单期末余额」和列表上的欠款数字对不上：
 *   客户应收 = 已审核/已发货销售 − 收款 + 退款给客户 − 已审核退货
 *   供应商应付 = 已审核采购 − 付款 + 收供应商退款 − 已审核采购退货
 * 见 customers.js / suppliers.js 的 calcOutstanding。
 *
 * 为了让两边数字**恒等**，这里不引入新口径：
 * 把「增加」和「减少」两类流水按同一套状态过滤取出来，
 *   期末 = 期初 + Σ增加 − Σ减少
 * 当不传 start 时（即"全部"），期初为 0，期末就等于 calcOutstanding 的结果。
 *
 * 日期取值：
 *   单据用自身业务日期（sale_date / purchase_date）；
 *   退货表没有业务日期列，用 created_at 的日期部分；
 *   收付款用 voucher_date，缺失时回落到 created_at。
 *   都为空的极端情况下用当天兜底，避免整条记录凭空消失。
 */

import { HttpError, json } from '../lib/http.js'
import { allInChunks } from '../lib/db.js'
import { todayLocal } from '../lib/time.js'

/** 与 reports.js / calcOutstanding 一致的"已生效单据"状态 */
const ORDER_ACTIVE = '(1,2,3,5,6)'
/** 退货：已审核 / 已退货 */
const RETURN_ACTIVE = '(1,2)'

const DATE_IN_ORDER = "COALESCE(NULLIF(sale_date,''), substr(created_at,1,10))"
const DATE_IN_PURCHASE = "COALESCE(NULLIF(purchase_date,''), substr(created_at,1,10))"
const DATE_IN_RETURN = 'substr(created_at,1,10)'
const DATE_IN_PAYMENT = "COALESCE(NULLIF(voucher_date,''), substr(created_at,1,10))"

/**
 * 批量取若干单据的明细（商品名 / 规格 / 单位 / 数量），按单据 id 分组。
 *
 * 对账单要能看出"这单买卖的是什么、多少"，所以单据行要带明细。
 * 用 allInChunks 规避 D1 单语句 100 个绑定参数的上限。
 *
 * keyColumn 必须按表给对：单据明细表用 `order_id`，
 * **退货明细表用 `return_id`** —— 混用会报 no such column。
 * （曾经这里四张表统一写 order_id，因为当时测试数据里一笔退货都没有，
 *  allInChunks 对空数组会提前返回、SQL 根本没执行，所以没暴露。）
 */
async function loadItemsByParent(db, itemTable, keyColumn, parentIds) {
  const map = new Map()
  const rows = await allInChunks(
    db,
    parentIds,
    (ph) =>
      `SELECT it.${keyColumn} AS pid, it.quantity AS qty,
              p.name AS pname, p.spec AS spec, p.unit AS unit
         FROM ${itemTable} it
         LEFT JOIN products p ON p.id = it.product_id
        WHERE it.${keyColumn} IN (${ph})
        ORDER BY it.id`
  )
  for (const r of rows) {
    const key = Number(r.pid)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({
      product_name: r.pname || `商品#${key}`,
      spec: r.spec || '',
      unit: r.unit || '',
      quantity: Number(r.qty || 0),
    })
  }
  return map
}

/**
 * 客户：增加 = 销售单 / 退款给客户；减少 = 收款 / 销售退货
 */
async function customerRows(db, partnerId, fallbackDate) {
  const orders = await db.all(
    `SELECT id, ${DATE_IN_ORDER} AS d, order_no AS doc_no, total_amount AS inc, 0 AS dec
       FROM sales_orders
      WHERE customer_id = ? AND status IN ${ORDER_ACTIVE}`,
    partnerId
  )
  const returns = await db.all(
    `SELECT id, ${DATE_IN_RETURN} AS d, return_no AS doc_no, 0 AS inc, total_amount AS dec
       FROM sale_returns
      WHERE customer_id = ? AND status IN ${RETURN_ACTIVE}`,
    partnerId
  )
  const received = await db.all(
    `SELECT ${DATE_IN_PAYMENT} AS d, payment_no AS doc_no, 0 AS inc, amount AS dec
       FROM payments
      WHERE type = 1 AND partner_type = 'customer' AND partner_id = ?`,
    partnerId
  )
  const refunded = await db.all(
    `SELECT ${DATE_IN_PAYMENT} AS d, payment_no AS doc_no, amount AS inc, 0 AS dec
       FROM payments
      WHERE type = 2 AND partner_type = 'customer' AND partner_id = ?`,
    partnerId
  )

  // 单据明细表用 order_id；退货明细表用 return_id（两张表列名不同）
  const orderItems = await loadItemsByParent(db, 'sales_items', 'order_id', orders.map((o) => o.id))
  const returnItems = await loadItemsByParent(db, 'sale_return_items', 'return_id', returns.map((r) => r.id))

  return [
    ...orders.map((r) => ({ ...r, kind: '销售单', items: orderItems.get(Number(r.id)) || [] })),
    ...returns.map((r) => ({ ...r, kind: '销售退货', items: returnItems.get(Number(r.id)) || [] })),
    ...received.map((r) => ({ ...r, kind: '收款', items: [] })),
    ...refunded.map((r) => ({ ...r, kind: '退款给客户', items: [] })),
  ].map((r) => ({ ...r, d: r.d || fallbackDate }))
}

/**
 * 供应商：增加 = 采购单 / 收供应商退款；减少 = 付款 / 采购退货
 */
async function supplierRows(db, partnerId, fallbackDate) {
  const orders = await db.all(
    `SELECT id, ${DATE_IN_PURCHASE} AS d, order_no AS doc_no, total_amount AS inc, 0 AS dec
       FROM purchase_orders
      WHERE supplier_id = ? AND status IN ${ORDER_ACTIVE}`,
    partnerId
  )
  const returns = await db.all(
    `SELECT id, ${DATE_IN_RETURN} AS d, return_no AS doc_no, 0 AS inc, total_amount AS dec
       FROM purchase_returns
      WHERE supplier_id = ? AND status IN ${RETURN_ACTIVE}`,
    partnerId
  )
  const paid = await db.all(
    `SELECT ${DATE_IN_PAYMENT} AS d, payment_no AS doc_no, 0 AS inc, amount AS dec
       FROM payments
      WHERE type = 2 AND partner_type = 'supplier' AND partner_id = ?`,
    partnerId
  )
  const refund = await db.all(
    `SELECT ${DATE_IN_PAYMENT} AS d, payment_no AS doc_no, amount AS inc, 0 AS dec
       FROM payments
      WHERE type = 1 AND partner_type = 'supplier' AND partner_id = ?`,
    partnerId
  )

  // 单据明细表用 order_id；退货明细表用 return_id（两张表列名不同）
  const orderItems = await loadItemsByParent(db, 'purchase_items', 'order_id', orders.map((o) => o.id))
  const returnItems = await loadItemsByParent(db, 'purchase_return_items', 'return_id', returns.map((r) => r.id))

  return [
    ...orders.map((r) => ({ ...r, kind: '采购单', items: orderItems.get(Number(r.id)) || [] })),
    ...returns.map((r) => ({ ...r, kind: '采购退货', items: returnItems.get(Number(r.id)) || [] })),
    ...paid.map((r) => ({ ...r, kind: '付款', items: [] })),
    ...refund.map((r) => ({ ...r, kind: '收供应商退款', items: [] })),
  ].map((r) => ({ ...r, d: r.d || fallbackDate }))
}

/** 同一天内让单据顺序稳定：单据 → 退货 → 收付款 */
const KIND_ORDER = {
  销售单: 0, 采购单: 0,
  销售退货: 1, 采购退货: 1,
  收款: 2, 付款: 2,
  退款给客户: 3, 收供应商退款: 3,
}

async function buildStatement(ctx, side) {
  const { db, env, url } = ctx
  const partnerId = Number(url.searchParams.get('partner_id') || 0)
  const start = (url.searchParams.get('start') || '').trim()
  const end = (url.searchParams.get('end') || '').trim()

  if (!partnerId) {
    throw new HttpError(400, '请选择往来单位')
  }

  const isCustomer = side === 'customer'
  const table = isCustomer ? 'customers' : 'suppliers'
  const p = await db.first(`SELECT * FROM ${table} WHERE id = ?`, partnerId)
  if (!p) {
    throw new HttpError(404, isCustomer ? '客户不存在' : '供应商不存在')
  }

  const today = todayLocal(env)
  const all = isCustomer
    ? await customerRows(db, partnerId, today)
    : await supplierRows(db, partnerId, today)

  // 期初 = 起始日之前的净额；不传 start 时相当于"从头看"，期初为 0
  let opening = 0
  if (start) {
    for (const r of all) {
      if (r.d < start) opening += Number(r.inc || 0) - Number(r.dec || 0)
    }
  }

  const inRange = all.filter((r) => {
    if (start && r.d < start) return false
    if (end && r.d > end) return false
    return true
  })

  inRange.sort((a, b) => {
    if (a.d !== b.d) return a.d < b.d ? -1 : 1
    const ka = KIND_ORDER[a.kind] ?? 9
    const kb = KIND_ORDER[b.kind] ?? 9
    if (ka !== kb) return ka - kb
    return String(a.doc_no).localeCompare(String(b.doc_no))
  })

  let balance = opening
  let totalIncrease = 0
  let totalDecrease = 0
  const rows = inRange.map((r) => {
    const inc = Number(r.inc || 0)
    const dec = Number(r.dec || 0)
    totalIncrease += inc
    totalDecrease += dec
    balance += inc - dec
    const items = r.items || []
    return {
      date: r.d,
      kind: r.kind,
      doc_no: r.doc_no,
      increase: inc,
      decrease: dec,
      balance,
      // 单据/退货单的业务内容：商品、规格、单位、数量
      items,
      // 便于列表直接显示：商品×数量、商品×数量
      items_summary: items
        .map((i) => `${i.product_name}×${i.quantity}${i.unit || ''}`)
        .join('、'),
      items_quantity: items.reduce((s, i) => s + Number(i.quantity || 0), 0),
    }
  })

  return json({
    side,
    partner: {
      id: p.id,
      name: p.name,
      contact: p.contact || '',
      phone: p.phone || '',
      address: p.address || '',
    },
    start: start || null,
    end: end || null,
    opening_balance: opening,
    rows,
    total_increase: totalIncrease,
    total_decrease: totalDecrease,
    closing_balance: balance,
    row_count: rows.length,
  })
}

export const routes = [
  {
    method: 'GET',
    path: /^\/api\/ext\/statement\/customer$/,
    perm: 'customer:view',
    handler: (ctx) => buildStatement(ctx, 'customer'),
  },
  {
    method: 'GET',
    path: /^\/api\/ext\/statement\/supplier$/,
    perm: 'supplier:view',
    handler: (ctx) => buildStatement(ctx, 'supplier'),
  },
]
