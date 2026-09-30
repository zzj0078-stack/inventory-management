/**
 * 首页看板 / 销售日报 / 报表统计
 * 对应 backend/app/api/extended.py 的 dashboard、sales-daily、reports 段
 */

import { json } from '../lib/http.js'
import { todayLocal, addDays, endOfDayBound } from '../lib/time.js'
import { canSeeCost } from '../lib/perms.js'

const ACTIVE = '(1,2,3,5,6)' // 已审核/部分/已完成/部分退货/已退货 —— 统计口径

// ==================== 首页看板 ====================

async function dashboard(ctx) {
  const { db, env } = ctx
  const today = todayLocal(env)

  const sumToday = async (table) =>
    Number(
      (await db.scalar(
        `SELECT COALESCE(SUM(total_amount), 0) AS v FROM ${table}
          WHERE date(created_at) = ? AND status IN ${ACTIVE}`,
        today
      )) || 0
    )

  const countToday = async (table) =>
    db.count(`SELECT COUNT(*) AS n FROM ${table} WHERE date(created_at) = ? AND status IN ${ACTIVE}`, today)

  const todaySales = await sumToday('sales_orders')
  const todaySalesCount = await countToday('sales_orders')
  const todayPurchase = await sumToday('purchase_orders')
  const todayPurchaseCount = await countToday('purchase_orders')

  // 待处理：已审核但还没收/发货
  const pendingPurchaseIn = await db.count('SELECT COUNT(*) AS n FROM purchase_orders WHERE status = 1')
  const pendingSalesOut = await db.count('SELECT COUNT(*) AS n FROM sales_orders WHERE status = 1')

  const totalOf = async (table) =>
    Number(
      (await db.scalar(`SELECT COALESCE(SUM(total_amount), 0) AS v FROM ${table} WHERE status IN ${ACTIVE}`)) || 0
    )

  const salesTotal = await totalOf('sales_orders')
  const purchaseTotal = await totalOf('purchase_orders')

  // 收付款按对象类型区分（退款给客户影响应收，收供应商退款影响应付）
  const paySum = async (type, partnerType) =>
    Number(
      (await db.scalar(
        'SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE type = ? AND partner_type = ?',
        type,
        partnerType
      )) || 0
    )

  const recvCust = await paySum(1, 'customer')
  const refundCust = await paySum(2, 'customer')
  const paidSupp = await paySum(2, 'supplier')
  const refundSupp = await paySum(1, 'supplier')

  const sumReturn = async (table) =>
    Number((await db.scalar(`SELECT COALESCE(SUM(total_amount), 0) AS v FROM ${table} WHERE status IN (1,2)`)) || 0)

  const saleRet = await sumReturn('sale_returns')
  const purchRet = await sumReturn('purchase_returns')

  const lowStockCount = await db.count(
    `SELECT COUNT(*) AS n FROM inventory i JOIN products p ON p.id = i.product_id
      WHERE p.status = 1 AND i.quantity <= p.min_stock`
  )
  const inventoryTotal = Number(
    (await db.scalar('SELECT COALESCE(SUM(quantity), 0) AS v FROM inventory')) || 0
  )

  return json({
    today_sales: todaySales,
    today_sales_count: todaySalesCount,
    today_purchase: todayPurchase,
    today_purchase_count: todayPurchaseCount,
    pending_purchase_in: pendingPurchaseIn,
    pending_sales_out: pendingSalesOut,
    receivable: salesTotal - recvCust + refundCust - saleRet,
    payable: purchaseTotal - paidSupp + refundSupp - purchRet,
    low_stock_count: lowStockCount,
    inventory_total: Math.trunc(inventoryTotal),
  })
}

// ==================== 销售日报 ====================

async function salesDaily(ctx) {
  const { db, env, url } = ctx

  let days = Number.parseInt(url.searchParams.get('days') ?? '30', 10)
  if (!Number.isFinite(days) || days < 1) days = 30
  if (days > 365) days = 365

  const end = todayLocal(env)
  const start = addDays(end, -(days - 1))
  const endBound = endOfDayBound(end)

  const srows = await db.all(
    `SELECT date(created_at) AS d,
            COALESCE(SUM(total_amount), 0) AS amt,
            COUNT(id) AS cnt
       FROM sales_orders
      WHERE status IN ${ACTIVE} AND date(created_at) >= ? AND date(created_at) <= ?
      GROUP BY date(created_at)`,
    start,
    end
  )
  const byDate = new Map(srows.map((r) => [String(r.d), [Number(r.amt || 0), Number(r.cnt || 0)]]))

  const prows = await db.all(
    `SELECT date(created_at) AS d, COALESCE(SUM(total_amount), 0) AS amt
       FROM purchase_orders
      WHERE status IN ${ACTIVE} AND date(created_at) >= ? AND date(created_at) <= ?
      GROUP BY date(created_at)`,
    start,
    end
  )
  const pby = new Map(prows.map((r) => [String(r.d), Number(r.amt || 0)]))

  // 缺日补 0
  const items = []
  for (let i = 0; i < days; i++) {
    const key = addDays(start, i)
    const [amt, cnt] = byDate.get(key) || [0, 0]
    items.push({
      date: key,
      amount: amt,
      count: cnt,
      purchase_amount: pby.get(key) || 0,
    })
  }

  const totalAmount = items.reduce((s, x) => s + x.amount, 0)
  const totalCount = items.reduce((s, x) => s + x.count, 0)

  return json({
    days,
    start,
    end,
    total_amount: totalAmount,
    total_count: totalCount,
    avg_amount: days ? Math.round((totalAmount / days) * 100) / 100 : 0,
    items,
  })
}

// ==================== 报表：销售 ====================

async function salesReport(ctx) {
  const { db, url } = ctx
  const startDate = url.searchParams.get('start_date')
  const endDate = url.searchParams.get('end_date')

  const where = [`o.status IN ${ACTIVE}`]
  const params = []
  if (startDate) {
    where.push('o.created_at >= ?')
    params.push(startDate)
  }
  if (endDate) {
    where.push('o.created_at <= ?')
    params.push(endOfDayBound(endDate))
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const totalAmount = Number(
    (await db.scalar(`SELECT COALESCE(SUM(o.total_amount), 0) AS v FROM sales_orders o ${whereSql}`, ...params)) || 0
  )
  const orderCount = await db.count(`SELECT COUNT(*) AS n FROM sales_orders o ${whereSql}`, ...params)

  const byCustomer = await db.all(
    `SELECT c.name AS name, SUM(o.total_amount) AS amount
       FROM sales_orders o JOIN customers c ON c.id = o.customer_id
       ${whereSql}
      GROUP BY c.name
      ORDER BY amount DESC`,
    ...params
  )

  const byProduct = await db.all(
    `SELECT p.name AS name, SUM(i.quantity) AS qty, SUM(i.amount) AS amount
       FROM sales_items i
       JOIN sales_orders o ON o.id = i.order_id
       JOIN products p     ON p.id = i.product_id
       ${whereSql}
      GROUP BY p.name
      ORDER BY amount DESC`,
    ...params
  )

  return json({
    total_amount: totalAmount,
    order_count: orderCount,
    by_customer: byCustomer.map((r) => ({ name: r.name, amount: Number(r.amount || 0) })),
    by_product: byProduct.map((r) => ({
      name: r.name,
      qty: Math.trunc(Number(r.qty || 0)),
      amount: Number(r.amount || 0),
    })),
  })
}

// ==================== 报表：采购 ====================

async function purchaseReport(ctx) {
  const { db, url } = ctx
  const startDate = url.searchParams.get('start_date')
  const endDate = url.searchParams.get('end_date')

  const where = [`o.status IN ${ACTIVE}`]
  const params = []
  if (startDate) {
    where.push('o.created_at >= ?')
    params.push(startDate)
  }
  if (endDate) {
    where.push('o.created_at <= ?')
    params.push(endOfDayBound(endDate))
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const totalAmount = Number(
    (await db.scalar(`SELECT COALESCE(SUM(o.total_amount), 0) AS v FROM purchase_orders o ${whereSql}`, ...params)) || 0
  )
  const orderCount = await db.count(`SELECT COUNT(*) AS n FROM purchase_orders o ${whereSql}`, ...params)

  const bySupplier = await db.all(
    `SELECT s.name AS name, SUM(o.total_amount) AS amount
       FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id
       ${whereSql}
      GROUP BY s.name
      ORDER BY amount DESC`,
    ...params
  )

  const byProduct = await db.all(
    `SELECT p.name AS name, SUM(i.quantity) AS qty, SUM(i.amount) AS amount
       FROM purchase_items i
       JOIN purchase_orders o ON o.id = i.order_id
       JOIN products p        ON p.id = i.product_id
       ${whereSql}
      GROUP BY p.name
      ORDER BY amount DESC`,
    ...params
  )

  return json({
    total_amount: totalAmount,
    order_count: orderCount,
    by_supplier: bySupplier.map((r) => ({ name: r.name, amount: Number(r.amount || 0) })),
    by_product: byProduct.map((r) => ({
      name: r.name,
      qty: Math.trunc(Number(r.qty || 0)),
      amount: Number(r.amount || 0),
    })),
  })
}

// ==================== 报表：利润（按商品）====================

async function profitReport(ctx) {
  const { db, url } = ctx
  const startDate = url.searchParams.get('start_date')
  const endDate = url.searchParams.get('end_date')

  const where = [`o.status IN ${ACTIVE}`]
  const params = []
  if (startDate) {
    where.push('o.created_at >= ?')
    params.push(startDate)
  }
  if (endDate) {
    where.push('o.created_at <= ?')
    params.push(endOfDayBound(endDate))
  }

  // 用 JOIN 一次取全，而不是「先查 product_id 再 IN (...) 回查商品」。
  // 后者在卖过的商品超过 100 个时会撞上 D1 的「每查询最多 100 个绑定参数」
  // 限制，直接报 too many SQL variables（150 个商品时实测 500）。
  // JOIN 顺带也实现了「跳过已删除商品」的语义。
  const rows = await db.all(
    `SELECT p.id            AS product_id,
            p.name          AS name,
            p.purchase_price AS purchase_price,
            SUM(i.quantity) AS total_qty,
            SUM(i.amount)   AS total_sale_amount
       FROM sales_items i
       JOIN sales_orders o ON o.id = i.order_id
       JOIN products p     ON p.id = i.product_id
      WHERE ${where.join(' AND ')}
      GROUP BY p.id, p.name, p.purchase_price`,
    ...params
  )

  // 成本/毛利属于敏感数据：没有 product:cost（销售员默认没有）时不返回，
  // 不是靠前端隐藏列 —— 前端藏了照样能直接从接口拿到。
  const showCost = canSeeCost(ctx.perms)

  let totalSale = 0
  let totalCost = 0
  const detail = []

  for (const r of rows) {
    const qty = Number(r.total_qty || 0)
    const sale = Number(r.total_sale_amount || 0)
    const cost = qty * Number(r.purchase_price || 0)
    totalSale += sale
    totalCost += cost
    detail.push({
      name: r.name,
      qty: Math.trunc(qty),
      sale,
      cost: showCost ? cost : null,
      profit: showCost ? sale - cost : null,
    })
  }

  // 没权限时按销售额排序，避免用毛利排序间接泄露成本高低
  detail.sort((a, b) => (showCost ? b.profit - a.profit : b.sale - a.sale))

  return json({
    total_sale: totalSale,
    total_cost: showCost ? totalCost : null,
    profit: showCost ? totalSale - totalCost : null,
    profit_rate:
      showCost && totalSale > 0
        ? Math.round(((totalSale - totalCost) / totalSale) * 10000) / 100
        : null,
    cost_visible: showCost,
    detail,
  })
}

// ==================== 报表：库存 ====================

async function inventoryReport(ctx) {
  const { db } = ctx

  const rows = await db.all(
    `SELECT i.quantity AS quantity,
            p.name AS product_name, p.sku AS sku, p.purchase_price AS purchase_price,
            p.min_stock AS min_stock,
            w.name AS warehouse_name
       FROM inventory i
       JOIN products p   ON p.id = i.product_id
       JOIN warehouses w ON w.id = i.warehouse_id
      ORDER BY p.name, w.name`
  )

  // 库存金额 = 数量 × 成本价，同样属于成本信息
  const showCost = canSeeCost(ctx.perms)

  let totalQty = 0
  let totalValue = 0
  const items = []

  for (const r of rows) {
    const qty = Number(r.quantity || 0)
    const costPrice = Number(r.purchase_price || 0)
    const value = qty * costPrice
    totalQty += qty
    totalValue += value
    items.push({
      product_name: r.product_name,
      sku: r.sku || '',
      warehouse_name: r.warehouse_name,
      quantity: qty,
      cost_price: showCost ? costPrice : null,
      value: showCost ? value : null,
      min_stock: r.min_stock ?? 0,
      low: qty <= Number(r.min_stock ?? 0),
    })
  }

  return json({
    total_qty: totalQty,
    total_value: showCost ? totalValue : null,
    cost_visible: showCost,
    items,
  })
}

export const routes = [
  { method: 'GET', path: /^\/api\/ext\/dashboard$/, perm: 'dashboard:view', handler: dashboard },
  { method: 'GET', path: /^\/api\/ext\/sales-daily$/, perm: 'dashboard:view', handler: salesDaily },
  { method: 'GET', path: /^\/api\/ext\/reports\/sales$/, perm: 'report:view', handler: salesReport },
  { method: 'GET', path: /^\/api\/ext\/reports\/purchase$/, perm: 'report:view', handler: purchaseReport },
  { method: 'GET', path: /^\/api\/ext\/reports\/profit$/, perm: 'report:view', handler: profitReport },
  { method: 'GET', path: /^\/api\/ext\/reports\/inventory$/, perm: 'report:view', handler: inventoryReport },
]
