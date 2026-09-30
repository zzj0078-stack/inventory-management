/**
 * 库存流水 / 库存调拨 / 库存盘点
 * 对应 backend/app/api/extended.py 的 stock-logs / stock-transfers / stock-checks 段
 */

import { bad, notFound, ok, json, paginated, paginationOf, intParam, boolParam } from '../lib/http.js'
import { nowLocal, isoOf, dateStamp } from '../lib/time.js'
import { logOp } from '../lib/oplog.js'
import { planStock } from '../lib/stock.js'

/** 生成单号：前缀 + yyyymmdd + 4 位序号 */
async function genNo(db, table, field, prefix, env) {
  const p = prefix + dateStamp(env)
  const last = await db.first(
    `SELECT ${field} AS no FROM ${table} WHERE ${field} LIKE ? ORDER BY id DESC LIMIT 1`,
    p + '%'
  )
  const n = last ? Number.parseInt(String(last.no).slice(-4), 10) : 0
  const seq = Number.isFinite(n) ? n + 1 : 1
  return p + String(seq).padStart(4, '0')
}

// ==================== 库存流水 ====================

async function listStockLogs(ctx) {
  const { db, url } = ctx
  const { page, pageSize, offset } = paginationOf(url)

  const where = []
  const params = []

  const productId = intParam(url.searchParams.get('product_id'))
  if (productId) {
    where.push('l.product_id = ?')
    params.push(productId)
  }
  const warehouseId = intParam(url.searchParams.get('warehouse_id'))
  if (warehouseId) {
    where.push('l.warehouse_id = ?')
    params.push(warehouseId)
  }
  const type = url.searchParams.get('type')
  if (type) {
    where.push('l.type = ?')
    params.push(type)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await db.count(`SELECT COUNT(*) AS n FROM stock_logs l ${whereSql}`, ...params)

  const rows = await db.all(
    `SELECT l.*, p.name AS product_name, w.name AS warehouse_name
       FROM stock_logs l
       LEFT JOIN products p   ON p.id = l.product_id
       LEFT JOIN warehouses w ON w.id = l.warehouse_id
       ${whereSql}
      ORDER BY l.id DESC
      LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset
  )

  return paginated(
    total,
    page,
    pageSize,
    rows.map((s) => ({
      id: s.id,
      product_id: s.product_id,
      product_name: s.product_name || '',
      warehouse_id: s.warehouse_id,
      warehouse_name: s.warehouse_name || '',
      type: s.type,
      quantity: s.quantity,
      before_quantity: s.before_quantity,
      after_quantity: s.after_quantity,
      related_no: s.related_no,
      remark: s.remark,
      created_at: isoOf(s.created_at),
    }))
  )
}

async function stockLogStat(ctx) {
  const { db } = ctx
  const logCount = await db.count('SELECT COUNT(*) AS n FROM stock_logs')
  const invCount = await db.count('SELECT COUNT(*) AS n FROM inventory')
  return json({
    log_count: logCount,
    inventory_count: invCount,
    need_init: logCount === 0 && invCount > 0,
  })
}

/** 按当前库存生成期初流水 */
async function initStockLogs(ctx) {
  const { db, url, env } = ctx
  const overwrite = boolParam(url.searchParams.get('overwrite'))

  const existing = await db.count('SELECT COUNT(*) AS n FROM stock_logs')
  if (existing && !overwrite) {
    bad(`已有 ${existing} 条库存流水。如需按当前库存重建，请勾选「清空后重建」`)
  }

  const rows = await db.all(
    `SELECT i.product_id, i.warehouse_id, i.quantity
       FROM inventory i
       JOIN products p   ON p.id = i.product_id
       JOIN warehouses w ON w.id = i.warehouse_id
      WHERE i.quantity != 0`
  )

  const now = nowLocal(env)
  const statements = []
  if (overwrite) statements.push(db.raw.prepare('DELETE FROM stock_logs'))

  for (const r of rows) {
    statements.push(
      db.raw
        .prepare(
          `INSERT INTO stock_logs
             (product_id, warehouse_id, type, quantity, before_quantity, after_quantity,
              related_type, related_id, related_no, remark, created_at)
           VALUES (?, ?, 'init', ?, 0, ?, 'init', NULL, '', '期初库存', ?)`
        )
        .bind(r.product_id, r.warehouse_id, r.quantity, r.quantity, now)
    )
  }

  if (statements.length) await db.batch(statements)

  await logOp(db, ctx.user, '库存管理', '生成期初流水', `${rows.length} 条`)
  return json({ created: rows.length, message: `已生成 ${rows.length} 条期初库存流水` })
}

// ==================== 库存调拨 ====================

const TRANSFER_STATUS = { 0: '待审核', 2: '已完成', 3: '已作废' }

async function loadTransferItems(db, transferIds) {
  if (!transferIds.length) return new Map()

  const ph = transferIds.map(() => '?').join(',')
  const rows = await db.all(
    `SELECT ti.transfer_id, ti.product_id, ti.quantity,
            p.name AS product_name, p.spec, p.unit
       FROM stock_transfer_items ti
       LEFT JOIN products p ON p.id = ti.product_id
      WHERE ti.transfer_id IN (${ph})
      ORDER BY ti.id`,
    ...transferIds
  )

  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.transfer_id)) map.set(r.transfer_id, [])
    map.get(r.transfer_id).push({
      product_id: r.product_id,
      product_name: r.product_name || '',
      spec: r.spec || '',
      unit: r.unit || '',
      quantity: r.quantity,
    })
  }
  return map
}

async function transferOut(ctx, t, items) {
  const { db } = ctx
  const fw = await db.first('SELECT name FROM warehouses WHERE id = ?', t.from_warehouse_id)
  const tw = await db.first('SELECT name FROM warehouses WHERE id = ?', t.to_warehouse_id)

  return {
    id: t.id,
    transfer_no: t.transfer_no,
    status: t.status,
    status_text: TRANSFER_STATUS[t.status] ?? '',
    from_warehouse_id: t.from_warehouse_id,
    from_warehouse_name: fw ? fw.name : '',
    to_warehouse_id: t.to_warehouse_id,
    to_warehouse_name: tw ? tw.name : '',
    remark: t.remark,
    created_at: isoOf(t.created_at),
    items: items || [],
  }
}

async function listTransfers(ctx) {
  const { db, url } = ctx
  const { page, pageSize, offset } = paginationOf(url)

  const total = await db.count('SELECT COUNT(*) AS n FROM stock_transfers')
  const rows = await db.all(
    'SELECT * FROM stock_transfers ORDER BY id DESC LIMIT ? OFFSET ?',
    pageSize,
    offset
  )

  const itemMap = await loadTransferItems(db, rows.map((t) => t.id))
  const items = []
  for (const t of rows) items.push(await transferOut(ctx, t, itemMap.get(t.id) || []))

  return paginated(total, page, pageSize, items)
}

async function getTransfer(ctx) {
  const { db, params } = ctx
  const id = Number(params.tid)

  const t = await db.first('SELECT * FROM stock_transfers WHERE id = ?', id)
  if (!t) notFound('调拨单不存在')

  const itemMap = await loadTransferItems(db, [id])
  return json(await transferOut(ctx, t, itemMap.get(id) || []))
}

async function createTransfer(ctx) {
  const { db, body, env } = ctx
  const src = body?.from_warehouse_id ? Number(body.from_warehouse_id) : null
  const dst = body?.to_warehouse_id ? Number(body.to_warehouse_id) : null
  const rawItems = Array.isArray(body?.items) ? body.items : []

  if (!src || !dst) bad('请选择源仓库和目标仓库')
  if (src === dst) bad('源仓库与目标仓库不能相同')

  if (!(await db.first('SELECT id FROM warehouses WHERE id = ?', src))) bad(`源仓库 #${src} 不存在`)
  if (!(await db.first('SELECT id FROM warehouses WHERE id = ?', dst))) bad(`目标仓库 #${dst} 不存在`)

  const valid = rawItems
    .map((i) => ({ product_id: Number(i.product_id), quantity: Number.parseInt(i.quantity, 10) }))
    .filter((i) => i.product_id && Number.isFinite(i.quantity) && i.quantity > 0)

  if (!valid.length) bad('调拨明细不能为空（需选择商品且数量大于 0）')

  for (const i of valid) {
    if (!(await db.first('SELECT id FROM products WHERE id = ?', i.product_id))) {
      bad(`商品 #${i.product_id} 不存在`)
    }
  }

  const tno = await genNo(db, 'stock_transfers', 'transfer_no', 'TF', env)
  const now = nowLocal(env)

  const id = await db.insert(
    `INSERT INTO stock_transfers
       (transfer_no, from_warehouse_id, to_warehouse_id, status, remark, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?)`,
    tno,
    src,
    dst,
    body?.remark ?? null,
    ctx.user.id,
    now,
    now
  )

  // 明细整体写入；失败则补偿删除主单
  try {
    await db.batch(
      valid.map((i) =>
        db.raw
          .prepare(
            'INSERT INTO stock_transfer_items (transfer_id, product_id, quantity, created_at) VALUES (?, ?, ?, ?)'
          )
          .bind(id, i.product_id, i.quantity, now)
      )
    )
  } catch (e) {
    await db.batch([
      db.raw.prepare('DELETE FROM stock_transfer_items WHERE transfer_id = ?').bind(id),
      db.raw.prepare('DELETE FROM stock_transfers WHERE id = ?').bind(id),
    ])
    throw e
  }

  await logOp(db, ctx.user, '库存调拨', '新增', tno)
  return json({ id, transfer_no: tno })
}

async function approveTransfer(ctx) {
  const { db, env, params } = ctx
  const id = Number(params.tid)

  const t = await db.first('SELECT * FROM stock_transfers WHERE id = ?', id)
  if (!t) notFound('调拨单不存在')
  if (t.status !== 0) bad('状态错误')

  const items = await db.all(
    'SELECT * FROM stock_transfer_items WHERE transfer_id = ? ORDER BY id',
    id
  )
  if (!items.length) bad('调拨明细为空')

  // 逐行规划：先出源仓（校验库存），再入目标仓；最后一次性原子提交
  const statements = []
  for (const item of items) {
    const out = await planStock(ctx, {
      productId: item.product_id,
      warehouseId: t.from_warehouse_id,
      delta: -Number(item.quantity),
      type: 'transfer_out',
      relatedType: 'transfer',
      relatedId: t.id,
      relatedNo: t.transfer_no,
    })
    const into = await planStock(ctx, {
      productId: item.product_id,
      warehouseId: t.to_warehouse_id,
      delta: Number(item.quantity),
      type: 'transfer_in',
      relatedType: 'transfer',
      relatedId: t.id,
      relatedNo: t.transfer_no,
    })
    statements.push(...out.statements, ...into.statements)
  }

  statements.push(
    db.raw
      .prepare('UPDATE stock_transfers SET status = 2, updated_at = ? WHERE id = ?')
      .bind(nowLocal(env), id)
  )

  await db.batch(statements)
  await logOp(db, ctx.user, '库存调拨', '审核完成', t.transfer_no)
  return ok('调拨完成')
}

async function cancelTransfer(ctx) {
  const { db, env, params } = ctx
  const id = Number(params.tid)

  const t = await db.first('SELECT * FROM stock_transfers WHERE id = ?', id)
  if (!t) notFound('调拨单不存在')
  if (t.status !== 0) bad('状态错误')

  await db.run(
    'UPDATE stock_transfers SET status = 3, updated_at = ? WHERE id = ?',
    nowLocal(env),
    id
  )
  await logOp(db, ctx.user, '库存调拨', '作废', t.transfer_no)
  return ok('作废成功')
}

// ==================== 库存盘点 ====================

const CHECK_STATUS = { 0: '待审核', 1: '已调账', 2: '已作废' }

async function loadCheckItems(db, checkIds) {
  if (!checkIds.length) return new Map()

  const ph = checkIds.map(() => '?').join(',')
  const rows = await db.all(
    `SELECT ci.check_id, ci.product_id, ci.system_quantity, ci.actual_quantity, ci.diff,
            p.name AS product_name, p.spec, p.unit
       FROM stock_check_items ci
       LEFT JOIN products p ON p.id = ci.product_id
      WHERE ci.check_id IN (${ph})
      ORDER BY ci.id`,
    ...checkIds
  )

  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.check_id)) map.set(r.check_id, [])
    map.get(r.check_id).push({
      product_id: r.product_id,
      product_name: r.product_name || '',
      spec: r.spec || '',
      unit: r.unit || '',
      system_quantity: r.system_quantity,
      actual_quantity: r.actual_quantity,
      diff: r.diff,
    })
  }
  return map
}

async function checkOut(ctx, c, items) {
  const { db } = ctx
  const wh = await db.first('SELECT name FROM warehouses WHERE id = ?', c.warehouse_id)
  return {
    id: c.id,
    check_no: c.check_no,
    status: c.status,
    status_text: CHECK_STATUS[c.status] ?? '',
    warehouse_id: c.warehouse_id,
    warehouse_name: wh ? wh.name : '',
    remark: c.remark,
    created_at: isoOf(c.created_at),
    items: items || [],
  }
}

async function listChecks(ctx) {
  const { db, url } = ctx
  const { page, pageSize, offset } = paginationOf(url)

  const total = await db.count('SELECT COUNT(*) AS n FROM stock_checks')
  const rows = await db.all(
    'SELECT * FROM stock_checks ORDER BY id DESC LIMIT ? OFFSET ?',
    pageSize,
    offset
  )

  const itemMap = await loadCheckItems(db, rows.map((c) => c.id))
  const items = []
  for (const c of rows) items.push(await checkOut(ctx, c, itemMap.get(c.id) || []))

  return paginated(total, page, pageSize, items)
}

/** 生成盘点底稿：该仓库全部启用商品 + 账面数量 */
async function previewCheck(ctx) {
  const { db, url } = ctx
  const warehouseId = intParam(url.searchParams.get('warehouse_id'), 1)

  const rows = await db.all(
    `SELECT p.id AS product_id, p.name AS product_name, p.spec, p.unit,
            COALESCE(i.quantity, 0) AS system_quantity
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id AND i.warehouse_id = ?
      WHERE p.status = 1
      ORDER BY p.id`,
    warehouseId
  )

  return json({
    warehouse_id: warehouseId,
    items: rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      spec: r.spec || '',
      unit: r.unit || '',
      system_quantity: r.system_quantity,
      actual_quantity: r.system_quantity,
      diff: 0,
    })),
  })
}

async function getCheck(ctx) {
  const { db, params } = ctx
  const id = Number(params.cid)

  const c = await db.first('SELECT * FROM stock_checks WHERE id = ?', id)
  if (!c) notFound('盘点单不存在')

  const itemMap = await loadCheckItems(db, [id])
  return json(await checkOut(ctx, c, itemMap.get(id) || []))
}

async function createCheck(ctx) {
  const { db, body, env } = ctx
  const rawItems = Array.isArray(body?.items) ? body.items : []
  if (!rawItems.length) bad('盘点明细不能为空')

  const warehouseId = body?.warehouse_id ? Number(body.warehouse_id) : null
  if (!warehouseId) bad('请选择盘点仓库')
  if (!(await db.first('SELECT id FROM warehouses WHERE id = ?', warehouseId))) {
    bad(`仓库不存在：${warehouseId}`)
  }

  const cno = await genNo(db, 'stock_checks', 'check_no', 'SC', env)
  const now = nowLocal(env)

  const id = await db.insert(
    `INSERT INTO stock_checks (check_no, warehouse_id, remark, created_by, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
    cno,
    warehouseId,
    body?.remark ?? null,
    ctx.user.id,
    now,
    now
  )

  try {
    await db.batch(
      rawItems.map((it) => {
        const sysQty = Number.parseInt(it.system_quantity ?? 0, 10) || 0
        const actQty = Number.parseInt(it.actual_quantity ?? sysQty, 10) || 0
        return db.raw
          .prepare(
            `INSERT INTO stock_check_items
               (check_id, product_id, system_quantity, actual_quantity, diff, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .bind(id, Number(it.product_id), sysQty, actQty, actQty - sysQty, now)
      })
    )
  } catch (e) {
    await db.batch([
      db.raw.prepare('DELETE FROM stock_check_items WHERE check_id = ?').bind(id),
      db.raw.prepare('DELETE FROM stock_checks WHERE id = ?').bind(id),
    ])
    throw e
  }

  await logOp(db, ctx.user, '库存盘点', '新增', cno)
  return json({ id, check_no: cno })
}

async function approveCheck(ctx) {
  const { db, env, params } = ctx
  const id = Number(params.cid)

  const c = await db.first('SELECT * FROM stock_checks WHERE id = ?', id)
  if (!c) notFound('盘点单不存在')
  if (c.status !== 0) bad('状态错误')

  const items = await db.all(
    'SELECT * FROM stock_check_items WHERE check_id = ? ORDER BY id',
    id
  )

  const statements = []
  for (const item of items) {
    const diff = Number(item.diff || 0)
    if (diff === 0) continue

    const plan = await planStock(ctx, {
      productId: item.product_id,
      warehouseId: c.warehouse_id,
      delta: diff,
      type: diff > 0 ? 'adjust_in' : 'adjust_out',
      relatedType: 'stock_check',
      relatedId: c.id,
      relatedNo: c.check_no,
      remark: diff > 0 ? '盘盈' : '盘亏',
    })
    statements.push(...plan.statements)
  }

  statements.push(
    db.raw
      .prepare('UPDATE stock_checks SET status = 1, updated_at = ? WHERE id = ?')
      .bind(nowLocal(env), id)
  )

  await db.batch(statements)
  await logOp(db, ctx.user, '库存盘点', '审核调账', c.check_no)
  return ok('盘点完成，库存已调整')
}

async function cancelCheck(ctx) {
  const { db, env, params } = ctx
  const id = Number(params.cid)

  const c = await db.first('SELECT * FROM stock_checks WHERE id = ?', id)
  if (!c) notFound('盘点单不存在')
  if (c.status !== 0) bad('状态错误')

  await db.run(
    'UPDATE stock_checks SET status = 2, updated_at = ? WHERE id = ?',
    nowLocal(env),
    id
  )
  await logOp(db, ctx.user, '库存盘点', '作废', c.check_no)
  return ok('作废成功')
}

// ==================== 路由表 ====================

export const routes = [
  { method: 'GET', path: /^\/api\/ext\/stock-logs$/, perm: 'stocklog:view', handler: listStockLogs },
  { method: 'GET', path: /^\/api\/ext\/stock-logs\/stat$/, perm: 'stocklog:view', handler: stockLogStat },
  { method: 'POST', path: /^\/api\/ext\/stock-logs\/init$/, perm: 'stocklog:init', handler: initStockLogs },

  { method: 'GET', path: /^\/api\/ext\/stock-transfers$/, perm: 'transfer:view', handler: listTransfers },
  { method: 'POST', path: /^\/api\/ext\/stock-transfers$/, perm: 'transfer:add', handler: createTransfer },
  { method: 'GET', path: /^\/api\/ext\/stock-transfers\/(?<tid>\d+)$/, perm: 'transfer:view', handler: getTransfer },
  { method: 'PUT', path: /^\/api\/ext\/stock-transfers\/(?<tid>\d+)\/approve$/, perm: 'transfer:approve', handler: approveTransfer },
  { method: 'PUT', path: /^\/api\/ext\/stock-transfers\/(?<tid>\d+)\/cancel$/, perm: 'transfer:cancel', handler: cancelTransfer },

  { method: 'GET', path: /^\/api\/ext\/stock-checks$/, perm: 'stockcheck:view', handler: listChecks },
  { method: 'GET', path: /^\/api\/ext\/stock-checks\/preview$/, perm: 'stockcheck:view', handler: previewCheck },
  { method: 'POST', path: /^\/api\/ext\/stock-checks$/, perm: 'stockcheck:add', handler: createCheck },
  { method: 'GET', path: /^\/api\/ext\/stock-checks\/(?<cid>\d+)$/, perm: 'stockcheck:view', handler: getCheck },
  { method: 'PUT', path: /^\/api\/ext\/stock-checks\/(?<cid>\d+)\/approve$/, perm: 'stockcheck:approve', handler: approveCheck },
  { method: 'PUT', path: /^\/api\/ext\/stock-checks\/(?<cid>\d+)\/cancel$/, perm: 'stockcheck:cancel', handler: cancelCheck },
]
