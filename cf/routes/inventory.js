/**
 * 仓库 + 库存查询
 * 对应 backend/app/api/inventory.py
 */

import { bad, notFound, ok, json, paginated, paginationOf, intParam, boolParam, likeArg } from '../lib/http.js'
import { nowLocal, isoOf } from '../lib/time.js'
import { logOp } from '../lib/oplog.js'
import { canSeeCost } from '../lib/perms.js'

// ==================== 仓库 ====================

function warehouseResponse(w) {
  return {
    id: w.id,
    name: w.name,
    address: w.address ?? null,
    manager: w.manager ?? null,
    phone: w.phone ?? null,
    status: w.status ?? 1,
    created_at: isoOf(w.created_at),
  }
}

async function listWarehouses(ctx) {
  const rows = await ctx.db.all(
    'SELECT * FROM warehouses WHERE status = 1 ORDER BY id'
  )
  return json(rows.map(warehouseResponse))
}

async function createWarehouse(ctx) {
  const { db, body, user } = ctx
  const name = String(body?.name ?? '').trim()
  if (!name) bad('请输入仓库名称')

  if (await db.first('SELECT id FROM warehouses WHERE name = ?', name)) bad('仓库名称已存在')

  const id = await db.insert(
    `INSERT INTO warehouses (name, address, manager, phone, status, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`,
    name,
    body?.address ?? null,
    body?.manager ?? null,
    body?.phone ?? null,
    nowLocal(ctx.env)
  )
  await logOp(db, user, '库存管理', '新增仓库', name)

  const row = await db.first('SELECT * FROM warehouses WHERE id = ?', id)
  return json(warehouseResponse(row))
}

async function updateWarehouse(ctx) {
  const { db, body, user, params } = ctx
  const wid = Number(params.wid)

  const warehouse = await db.first('SELECT * FROM warehouses WHERE id = ?', wid)
  if (!warehouse) notFound('仓库不存在')

  const name = String(body?.name ?? '').trim()
  if (!name) bad('请输入仓库名称')

  if (await db.first('SELECT id FROM warehouses WHERE name = ? AND id != ?', name, wid)) {
    bad('仓库名称已存在')
  }

  await db.run(
    'UPDATE warehouses SET name = ?, address = ?, manager = ?, phone = ? WHERE id = ?',
    name,
    body?.address ?? null,
    body?.manager ?? null,
    body?.phone ?? null,
    wid
  )
  await logOp(db, user, '库存管理', '编辑仓库', name)

  const row = await db.first('SELECT * FROM warehouses WHERE id = ?', wid)
  return json(warehouseResponse(row))
}

async function deleteWarehouse(ctx) {
  const { db, user, params } = ctx
  const wid = Number(params.wid)

  const warehouse = await db.first('SELECT * FROM warehouses WHERE id = ?', wid)
  if (!warehouse) notFound('仓库不存在')

  const total = await db.count('SELECT COUNT(*) AS n FROM warehouses')
  if (total <= 1) bad('至少保留一个仓库，否则无法入库/出库')

  const used = await db.count(
    'SELECT COUNT(*) AS n FROM inventory WHERE warehouse_id = ? AND quantity != 0',
    wid
  )
  if (used > 0) bad(`该仓库仍有 ${used} 个商品存在库存，请先调拨或清零后再删除`)

  await db.batch([
    db.raw.prepare('DELETE FROM inventory WHERE warehouse_id = ?').bind(wid),
    db.raw.prepare('DELETE FROM warehouses WHERE id = ?').bind(wid),
  ])

  await logOp(db, user, '库存管理', '删除仓库', warehouse.name)
  return ok('删除成功')
}

// ==================== 库存 ====================

async function listInventory(ctx) {
  const { db, url } = ctx
  const { page, pageSize, offset } = paginationOf(url)

  const keyword = url.searchParams.get('keyword')
  const warehouseId = intParam(url.searchParams.get('warehouse_id'))
  const lowStock = boolParam(url.searchParams.get('low_stock'))

  const where = []
  const params = []

  if (keyword) {
    const k = likeArg(keyword)
    where.push(`(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')`)
    params.push(k, k)
  }
  if (warehouseId !== null && warehouseId !== undefined) {
    where.push('i.warehouse_id = ?')
    params.push(warehouseId)
  }
  if (lowStock) {
    where.push('i.quantity <= p.min_stock')
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = await db.count(
    `SELECT COUNT(*) AS n FROM inventory i JOIN products p ON p.id = i.product_id ${whereSql}`,
    ...params
  )

  const rows = await db.all(
    `SELECT i.id, i.product_id, i.warehouse_id, i.quantity, i.updated_at,
            p.name AS product_name, p.sku AS product_sku, p.min_stock AS min_stock,
            p.spec AS product_spec, p.unit AS product_unit,
            p.sale_price AS sale_price, p.purchase_price AS purchase_price,
            w.name AS warehouse_name
       FROM inventory i
       JOIN products p   ON p.id = i.product_id
       JOIN warehouses w ON w.id = i.warehouse_id
       ${whereSql}
      ORDER BY i.id
      LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset
  )

  // 说明：sale_price / purchase_price / product_spec / product_unit 是比 Python 版
  // 多出来的字段（超集）。移动端要在同一个列表里同时看到「库存 + 价格」，
  // 否则得再发一次商品请求再前端合并。桌面端不使用这些字段，不受影响。
  //
  // purchase_price 受 product:cost 权限控制：销售员默认看不到进价，
  // 这里直接返回 null（不是靠前端隐藏）。
  const showCost = canSeeCost(ctx.perms)
  const items = rows.map((r) => ({
    id: r.id,
    product_id: r.product_id,
    warehouse_id: r.warehouse_id,
    quantity: r.quantity ?? 0,
    updated_at: isoOf(r.updated_at),
    product_name: r.product_name ?? null,
    product_sku: r.product_sku ?? null,
    product_spec: r.product_spec ?? null,
    product_unit: r.product_unit ?? null,
    sale_price: r.sale_price ?? 0,
    purchase_price: showCost ? r.purchase_price ?? 0 : null,
    warehouse_name: r.warehouse_name ?? null,
    min_stock: r.min_stock ?? 0,
    low: (r.quantity ?? 0) <= (r.min_stock ?? 0),
  }))

  return paginated(total, page, pageSize, items)
}

/** 库存预警：现有库存 <= 最低库存 */
async function stockCheck(ctx) {
  const rows = await ctx.db.all(
    `SELECT p.id AS product_id, p.name AS product_name, p.sku AS product_sku,
            w.id AS warehouse_id, w.name AS warehouse_name,
            i.quantity AS current_stock, p.min_stock AS min_stock
       FROM inventory i
       JOIN products p   ON p.id = i.product_id
       JOIN warehouses w ON w.id = i.warehouse_id
      WHERE p.status = 1 AND i.quantity <= p.min_stock
      ORDER BY (p.min_stock - i.quantity) DESC`
  )

  return ok('success', rows.map((r) => ({
    product_id: r.product_id,
    product_name: r.product_name,
    product_sku: r.product_sku,
    warehouse_id: r.warehouse_id,
    warehouse_name: r.warehouse_name,
    current_stock: r.current_stock ?? 0,
    min_stock: r.min_stock ?? 0,
    deficit: (r.min_stock ?? 0) - (r.current_stock ?? 0),
  })))
}

/** 仓库列表被多个模块依赖，权限为 OR 集合 */
const WAREHOUSE_VIEW_PERMS = [
  'warehouse:view',
  'inventory:view',
  'transfer:view',
  'stockcheck:view',
  'purchase:view',
  'sales:view',
  'purchase_return:view',
  'sale_return:view',
]

export const routes = [
  { method: 'GET', path: /^\/api\/inventory\/warehouses$/, perm: WAREHOUSE_VIEW_PERMS, handler: listWarehouses },
  { method: 'POST', path: /^\/api\/inventory\/warehouses$/, perm: 'warehouse:add', handler: createWarehouse },
  { method: 'PUT', path: /^\/api\/inventory\/warehouses\/(?<wid>\d+)$/, perm: 'warehouse:edit', handler: updateWarehouse },
  { method: 'DELETE', path: /^\/api\/inventory\/warehouses\/(?<wid>\d+)$/, perm: 'warehouse:delete', handler: deleteWarehouse },

  { method: 'GET', path: /^\/api\/inventory\/stock-check$/, perm: ['inventory:view', 'stockcheck:view'], handler: stockCheck },
  { method: 'GET', path: /^\/api\/inventory$/, perm: ['inventory:view', 'transfer:view', 'stockcheck:view', 'purchase:view', 'sales:view'], handler: listInventory },
]
