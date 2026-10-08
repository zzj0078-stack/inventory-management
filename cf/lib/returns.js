/**
 * 销售退货 / 采购退货 —— 通用退货路由工厂
 *
 * 对应 backend/app/api/extended.py 的「销售退货」「采购退货」两段。
 * 两边结构高度对称，差异只有：表名 / 单号前缀 / 往来单位 / 原单类型 /
 * 数量字段 / 动作(入库↔出库) / 库存类型 / 权限码 / 文案。
 *
 * 状态机（退货单）：0 待审核 → 1 已审核 → 2 已入库(销售)/已出库(采购) → 3 已作废
 * 原单状态同步：无退货→回发货态；部分退回→5；全部退回→6
 */

import { bad, notFound, ok, json, paginated, paginationOf, intParam, likeArg } from './http.js'
import { nowLocal, isoOf, dateOf, dateStamp } from './time.js'
import { logOp } from './oplog.js'
import { planStock, defaultWarehouseId } from './stock.js'
import { allInChunks } from './db.js'

/** 生成单号：前缀 + yyyymmdd + 4 位序号（与 extended.py 的 gen_no 一致） */
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

/** 原单已退数量（按商品汇总），排除已作废的退货单（status 3） */
async function returnedQtyMap(db, cfg, orderId) {
  const rows = await db.all(
    `SELECT ri.product_id AS pid, SUM(ri.quantity) AS qty
       FROM ${cfg.table.item} ri
       JOIN ${cfg.table.ret}  r ON r.id = ri.return_id
      WHERE r.${cfg.source.fk} = ? AND r.status != 3
      GROUP BY ri.product_id`,
    orderId
  )
  const map = new Map()
  for (const r of rows) map.set(r.pid, Number(r.qty || 0))
  return map
}

/**
 * 指定仓库下这些商品的当前库存（product_id -> quantity）。
 *
 * 采购退货实际是「出库」，可退数量必须以库存为上限：
 * 货已经卖掉/调走了就不在库里，想退也退不出去。
 * warehouseId 来自数据库的整数，直接内联进 SQL（分块时参数位要留给 id）。
 */
async function stockQtyMap(db, warehouseId, pids) {
  const map = new Map()
  const ids = [...new Set((pids || []).filter(Boolean))]
  if (!ids.length) return map
  const wid = Number(warehouseId)
  for (const row of await allInChunks(
    db,
    ids,
    (ph) =>
      `SELECT product_id, quantity FROM inventory
        WHERE warehouse_id = ${wid} AND product_id IN (${ph})`
  )) {
    map.set(row.product_id, Number(row.quantity || 0))
  }
  return map
}

export function makeReturnRoutes(cfg) {
  const R = cfg.table.ret
  const RI = cfg.table.item
  const O = cfg.source.table
  const OI = cfg.source.item
  const P = cfg.party

  // ---------------- 列表 ----------------
  async function list(ctx) {
    const { db, url } = ctx
    const { page, pageSize, offset } = paginationOf(url)

    const where = []
    const params = []

    const keyword = url.searchParams.get('keyword')
    if (keyword) {
      where.push(`r.return_no LIKE ? ESCAPE '\\'`)
      params.push(likeArg(keyword))
    }
    const statusRaw = url.searchParams.get('status')
    const status = intParam(statusRaw)
    if (statusRaw !== null && statusRaw !== '' && status !== null) {
      where.push('r.status = ?')
      params.push(status)
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = await db.count(`SELECT COUNT(*) AS n FROM ${R} r ${whereSql}`, ...params)

    const rows = await db.all(
      `SELECT r.*, p.name AS partner_name, p.contact AS partner_contact, p.phone AS partner_phone,
              o.order_no AS source_order_no
         FROM ${R} r
         LEFT JOIN ${P.table} p ON p.id = r.${P.fk}
         LEFT JOIN ${O} o       ON o.id = r.${cfg.source.fk}
         ${whereSql}
        ORDER BY r.id DESC
        LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset
    )

    // 金额汇总（不受分页影响），active 口径与财务管理一致。
    // 原来 4 个状态各查一次 + count 一次 = 5 条查询；合成一条条件聚合即可，
    // 少 4 次查询在「每次调用查询次数」受限时很值钱。
    const s = (await db.first(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN (0,1,2,3) THEN total_amount ELSE 0 END), 0) AS all_amt,
         COALESCE(SUM(CASE WHEN status IN (1,2)   THEN total_amount ELSE 0 END), 0) AS active_amt,
         COALESCE(SUM(CASE WHEN status = 0        THEN total_amount ELSE 0 END), 0) AS draft_amt,
         COALESCE(SUM(CASE WHEN status = 3        THEN total_amount ELSE 0 END), 0) AS void_amt,
         COUNT(*) AS cnt
       FROM ${R}`
    )) || {}

    const summary = {
      all: Number(s.all_amt || 0),
      active: Number(s.active_amt || 0),
      draft: Number(s.draft_amt || 0),
      void: Number(s.void_amt || 0),
      count: Number(s.cnt || 0),
    }

    // 整页一次性转换（原来逐行 returnOut 是 N+1：每行 4 条查询）
    const items = await returnOutMany(ctx, cfg, rows)

    return paginated(total, page, pageSize, items, summary)
  }

  /** 纯转换：所有关联数据由调用方备好（列表路径直接用 JOIN 出来的字段） */
  function shapeReturn(cfg, r, { partner, sourceNo, rawItems, prodMap }) {
    const p = cfg.party

    // 列表查询已经 JOIN 出 partner_name / source_order_no，有就直接用
    const partnerName =
      r.partner_name !== undefined ? r.partner_name : partner ? partner.name : ''
    const resolvedSourceNo =
      r.source_order_no !== undefined ? r.source_order_no : sourceNo || ''

    return {
      id: r.id,
      return_no: r.return_no,
      total_amount: r.total_amount ?? 0,
      status: r.status,
      status_text: cfg.statusText[r.status] ?? '',
      reason: r.reason ?? null,
      remark: r.remark ?? null,
      created_at: isoOf(r.created_at),
      [cfg.source.fk]: r[cfg.source.fk] ?? null,
      source_order_no: resolvedSourceNo,
      [p.fk]: r[p.fk] ?? null,
      [`${p.respPrefix}_name`]: partnerName || '',
      [`${p.respPrefix}_contact`]: partner
        ? partner.contact ?? ''
        : r.partner_contact ?? '',
      [`${p.respPrefix}_phone`]: partner ? partner.phone ?? '' : r.partner_phone ?? '',
      // 明细：Python 版只回 product_id/quantity/price/amount，
      // 这里多带商品名/规格/单位（超集，不破坏调用方）
      items: (rawItems || []).map((i) => {
        const prod = prodMap.get(i.product_id)
        return {
          product_id: i.product_id,
          product_name: prod ? prod.name : `商品#${i.product_id}`,
          product_spec: prod ? prod.spec ?? '' : '',
          product_unit: prod ? prod.unit ?? '' : '',
          quantity: i.quantity,
          price: i.price ?? 0,
          amount: i.amount ?? 0,
        }
      }),
    }
  }

  /** 批量取商品信息 */
  async function loadReturnProducts(db, items) {
    const pids = [...new Set(items.map((i) => i.product_id).filter(Boolean))]
    const prodMap = new Map()
    if (!pids.length) return prodMap
    // 分块：D1 单条语句最多 100 个绑定参数（退货明细商品种类多时会超）
    for (const row of await allInChunks(
      db,
      pids,
      (ph) => `SELECT id, name, spec, unit FROM products WHERE id IN (${ph})`
    )) {
      prodMap.set(row.id, row)
    }
    return prodMap
  }

  /** 单张退货单（详情用）：一张单最多 4 条查询，可以接受 */
  async function returnOut(ctx, cfg, r) {
    const { db } = ctx
    const p = cfg.party

    // 列表路径带了 JOIN 字段时就不必再查（原来无条件查，列表每行白跑 2 条）
    const partner =
      r.partner_name === undefined && r[p.fk]
        ? await db.first(`SELECT id, name, contact, phone FROM ${p.table} WHERE id = ?`, r[p.fk])
        : null

    let sourceNo = ''
    if (r.source_order_no === undefined && r[cfg.source.fk]) {
      const o = await db.first(`SELECT order_no FROM ${O} WHERE id = ?`, r[cfg.source.fk])
      sourceNo = o ? o.order_no : `⚠ ${cfg.source.doc}#${r[cfg.source.fk]} 已删除`
    }

    const rawItems = await db.all(`SELECT * FROM ${RI} WHERE return_id = ? ORDER BY id`, r.id)
    const prodMap = await loadReturnProducts(db, rawItems)

    return shapeReturn(cfg, r, { partner, sourceNo, rawItems, prodMap })
  }

  /**
   * 整页退货单（列表用）—— 每种关联只查一次，查询数与页大小无关。
   * 原来逐行 returnOut：每行 4 条查询，一页 20 行 = 80 条，
   * 会撞 D1「每次 Worker 调用查询次数」上限（免费 50）。
   */
  async function returnOutMany(ctx, cfg, rows) {
    if (!rows.length) return []
    const { db } = ctx
    const p = cfg.party
    const rids = rows.map((r) => r.id)

    const allItems = await allInChunks(
      db,
      rids,
      (ph) => `SELECT * FROM ${RI} WHERE return_id IN (${ph}) ORDER BY id`
    )
    const itemsByReturn = new Map()
    for (const it of allItems) {
      if (!itemsByReturn.has(it.return_id)) itemsByReturn.set(it.return_id, [])
      itemsByReturn.get(it.return_id).push(it)
    }

    const prodMap = await loadReturnProducts(db, allItems)

    const partnerMap = new Map()
    for (const x of await allInChunks(
      db,
      [...new Set(rows.map((r) => r[p.fk]).filter(Boolean))],
      (ph) => `SELECT id, name, contact, phone FROM ${p.table} WHERE id IN (${ph})`
    )) {
      partnerMap.set(x.id, x)
    }

    const srcMap = new Map()
    for (const x of await allInChunks(
      db,
      [...new Set(rows.map((r) => r[cfg.source.fk]).filter(Boolean))],
      (ph) => `SELECT id, order_no FROM ${O} WHERE id IN (${ph})`
    )) {
      srcMap.set(x.id, x.order_no)
    }

    return rows.map((r) => {
      const sid = r[cfg.source.fk]
      return shapeReturn(cfg, r, {
        partner: partnerMap.get(r[p.fk]) || null,
        sourceNo: sid
          ? srcMap.has(sid)
            ? srcMap.get(sid)
            : `⚠ ${cfg.source.doc}#${sid} 已删除`
          : '',
        rawItems: itemsByReturn.get(r.id) || [],
        prodMap,
      })
    })
  }

  // ---------------- 详情（前端编辑/打印用）----------------
  async function get(ctx) {
    const r = await ctx.db.first(`SELECT * FROM ${R} WHERE id = ?`, Number(ctx.params.rid))
    if (!r) notFound(`${cfg.doc}不存在`)
    return json(await returnOut(ctx, cfg, r))
  }

  // ---------------- 可退原单列表 ----------------
  async function returnable(ctx) {
    const { db, url } = ctx
    const { page, pageSize, offset } = paginationOf(url)

    const where = ['o.status IN (2,3,5,6)']
    const params = []
    const keyword = url.searchParams.get('keyword')
    if (keyword) {
      where.push(`o.order_no LIKE ? ESCAPE '\\'`)
      params.push(likeArg(keyword))
    }

    const whereSql = `WHERE ${where.join(' AND ')}`
    const total = await db.count(`SELECT COUNT(*) AS n FROM ${O} o ${whereSql}`, ...params)

    const orders = await db.all(
      `SELECT o.* FROM ${O} o ${whereSql} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset
    )

    const items = []
    for (const o of orders) {
      const orderItems = await db.all(`SELECT * FROM ${OI} WHERE order_id = ? ORDER BY id`, o.id)
      const returned = await returnedQtyMap(db, cfg, o.id)

      let remain = 0
      for (const it of orderItems) {
        const base = Number(it[cfg.source.qtyField] || 0)
        remain += Math.max(base - (returned.get(it.product_id) || 0), 0)
      }

      const partner = o[P.fk]
        ? await db.first(`SELECT name FROM ${P.table} WHERE id = ?`, o[P.fk])
        : null

      items.push({
        id: o.id,
        order_no: o.order_no,
        date: dateOf(o[cfg.source.dateField]),
        partner_name: partner ? partner.name : '',
        total_amount: o.total_amount ?? 0,
        status: o.status,
        status_text: cfg.source.statusText[o.status] ?? '',
        returnable_quantity: remain,
      })
    }

    return paginated(total, page, pageSize, items)
  }

  // ---------------- 按原单生成可退明细 ----------------
  async function available(ctx) {
    const { db, params } = ctx
    const orderId = Number(params.order_id)

    const order = await db.first(`SELECT * FROM ${O} WHERE id = ?`, orderId)
    if (!order) notFound(`${cfg.source.doc}不存在`)
    if (![2, 3, 5, 6].includes(order.status)) {
      bad(`仅已${cfg.source.actWord}或部分${cfg.source.actWord}的${cfg.source.doc}可以退货`)
    }

    const returned = await returnedQtyMap(db, cfg, orderId)
    const orderItems = await db.all(`SELECT * FROM ${OI} WHERE order_id = ? ORDER BY id`, orderId)

    const pids = [...new Set(orderItems.map((i) => i.product_id).filter(Boolean))]
    const prodMap = new Map()
    if (pids.length) {
      // 分块：原单明细超过 100 种商品时，不分块会撞 D1 的 100 参数上限
      for (const p of await allInChunks(
        db,
        pids,
        (ph) => `SELECT id, name, spec, unit FROM products WHERE id IN (${ph})`
      )) {
        prodMap.set(p.id, p)
      }
    }

    const partner = order[P.fk]
      ? await db.first(`SELECT id, name, contact, phone FROM ${P.table} WHERE id = ?`, order[P.fk])
      : null

    // 采购退货（limitByStock）：可退数量还要受当前库存限制。
    // 仓库取与本单收货相同的那个，保证「校验的库存」就是「出库要扣的库存」。
    let wid = order.warehouse_id ?? null
    let stockMap = new Map()
    if (cfg.limitByStock) {
      if (!wid) wid = await defaultWarehouseId(db, ctx.env)
      stockMap = await stockQtyMap(db, wid, orderItems.map((i) => i.product_id))
    }

    const items = orderItems.map((it) => {
      const prod = prodMap.get(it.product_id)
      const base = Number(it[cfg.source.qtyField] || 0)
      const already = returned.get(it.product_id) || 0
      // 按原单能退多少
      const orderRemain = Math.max(base - already, 0)
      // 当前库存里有多少
      const stock = cfg.limitByStock ? stockMap.get(it.product_id) || 0 : orderRemain
      return {
        product_id: it.product_id,
        product_name: prod ? prod.name : `商品#${it.product_id}`,
        product_spec: prod ? prod.spec ?? '' : '',
        product_unit: prod ? prod.unit ?? '' : '',
        sold_quantity: it.quantity,
        [cfg.source.qtyField]: base,
        returned_quantity: already,
        // 仅当 limitByStock 时有意义：当前库存 + 只按原单算的可退
        stock_quantity: cfg.limitByStock ? stock : undefined,
        order_returnable_quantity: orderRemain,
        available_quantity: cfg.limitByStock ? Math.max(Math.min(orderRemain, stock), 0) : orderRemain,
        price: it.price ?? 0, // 原成交价（含税）
        tax_rate: it.tax_rate ?? 0,
      }
    })

    return json({
      [cfg.source.fk]: order.id,
      order_no: order.order_no,
      [cfg.source.dateField]: dateOf(order[cfg.source.dateField]),
      [P.fk]: order[P.fk] ?? null,
      [`${P.respPrefix}_name`]: partner ? partner.name : '',
      [`${P.respPrefix}_contact`]: partner ? partner.contact ?? '' : '',
      [`${P.respPrefix}_phone`]: partner ? partner.phone ?? '' : '',
      warehouse_id: wid,
      items,
    })
  }

  // ---------------- 新增（必须关联原单，数量严格校验）----------------
  async function create(ctx) {
    const { db, body, env } = ctx
    const items = Array.isArray(body?.items) ? body.items : []
    if (!items.length) bad('退货明细不能为空')

    const orderId = body?.[cfg.source.fk]
    if (!orderId) bad(`请先选择来源${cfg.source.doc}，退货必须关联原单`)

    const order = await db.first(`SELECT * FROM ${O} WHERE id = ?`, Number(orderId))
    if (!order) bad(`${cfg.source.doc}不存在：${orderId}`)
    if (![2, 3, 5, 6].includes(order.status)) {
      bad(`仅已${cfg.source.actWord}或部分${cfg.source.actWord}的${cfg.source.doc}可以退货`)
    }

    const orderItems = await db.all(`SELECT * FROM ${OI} WHERE order_id = ? ORDER BY id`, order.id)
    const baseMap = new Map(orderItems.map((i) => [i.product_id, Number(i[cfg.source.qtyField] || 0)]))
    const already = await returnedQtyMap(db, cfg, order.id)

    // 可退上限 = min(原单未退数量, 当前库存)。退货要出库，库里没有就退不出去。
    let stockMap = new Map()
    if (cfg.limitByStock) {
      const wid = order.warehouse_id || (await defaultWarehouseId(db, env))
      stockMap = await stockQtyMap(db, wid, items.map((i) => Number(i.product_id)))
    }

    for (const it of items) {
      const pid = Number(it.product_id)
      const qty = Number.parseInt(it.quantity, 10) || 0
      if (qty <= 0) bad('退货数量必须大于 0')

      const orderRemain = Math.max((baseMap.get(pid) || 0) - (already.get(pid) || 0), 0)
      const stock = cfg.limitByStock ? stockMap.get(pid) || 0 : orderRemain
      const avail = cfg.limitByStock ? Math.max(Math.min(orderRemain, stock), 0) : orderRemain
      if (qty > avail) {
        const prod = await db.first('SELECT name FROM products WHERE id = ?', pid)
        bad(
          cfg.limitByStock
            ? `「${prod ? prod.name : pid}」可退数量仅 ${avail}（原单可退 ${orderRemain}，当前库存 ${stock}），本次退货 ${qty} 超出`
            : `「${prod ? prod.name : pid}」可退数量仅 ${avail}，本次退货 ${qty} 超出`
        )
      }
      already.set(pid, (already.get(pid) || 0) + qty)
    }

    const returnNo = await genNo(db, R, 'return_no', cfg.prefix, env)
    const total = items.reduce((s, i) => s + Number(i.quantity) * Number(i.price ?? 0), 0)
    const now = nowLocal(env)

    const id = await db.insert(
      `INSERT INTO ${R}
         (return_no, ${cfg.source.fk}, ${P.fk}, total_amount, status, reason, remark,
          created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      returnNo,
      order.id,
      body?.[P.fk] ?? order[P.fk] ?? null,
      total,
      body?.reason ?? null,
      body?.remark ?? null,
      ctx.user.id,
      now,
      now
    )

    // 明细整批写入；失败则补偿删除主单
    try {
      await db.batch(
        items.map((it) =>
          db.raw
            .prepare(
              `INSERT INTO ${RI} (return_id, product_id, quantity, price, amount, created_at)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .bind(
              id,
              Number(it.product_id),
              Number(it.quantity),
              Number(it.price ?? 0),
              Number(it.quantity) * Number(it.price ?? 0),
              now
            )
        )
      )
    } catch (e) {
      await db.batch([
        db.raw.prepare(`DELETE FROM ${RI} WHERE return_id = ?`).bind(id),
        db.raw.prepare(`DELETE FROM ${R} WHERE id = ?`).bind(id),
      ])
      throw e
    }

    await logOp(db, ctx.user, cfg.module, '新增', returnNo, `金额:${total}`)
    return json({ id, return_no: returnNo })
  }

  // ---------------- 审核 ----------------
  async function approve(ctx) {
    const { db, env, params } = ctx
    const id = Number(params.rid)

    const r = await db.first(`SELECT * FROM ${R} WHERE id = ?`, id)
    if (!r) notFound(`${cfg.doc}不存在`)
    if (r.status !== 0) bad('状态错误')

    await db.run(
      `UPDATE ${R} SET status = 1, updated_at = ? WHERE id = ?`,
      nowLocal(env),
      id
    )
    await logOp(db, ctx.user, cfg.module, '审核', r.return_no)
    return ok('审核成功')
  }

  // ---------------- 入库 / 出库 ----------------
  async function act(ctx) {
    const { db, env, params } = ctx
    const id = Number(params.rid)

    const r = await db.first(`SELECT * FROM ${R} WHERE id = ?`, id)
    if (!r) notFound(`${cfg.doc}不存在`)
    if (r.status !== 1) bad('状态错误')

    const items = await db.all(`SELECT * FROM ${RI} WHERE return_id = ? ORDER BY id`, id)
    if (!items.length) bad('退货明细为空')

    // 采购退货（limitByStock）与本单收货用同一个仓库：
    // 否则会出现「按 A 仓校验可退、却扣 B 仓库存」。
    // 销售退货是入库，仍用默认仓库。
    let wid
    if (cfg.limitByStock && r[cfg.source.fk]) {
      const ord = await db.first(`SELECT warehouse_id FROM ${O} WHERE id = ?`, r[cfg.source.fk])
      wid = (ord && ord.warehouse_id) || (await defaultWarehouseId(db, env))
    } else {
      wid = await defaultWarehouseId(db, env)
    }

    const statements = []
    for (const item of items) {
      const plan = await planStock(ctx, {
        productId: item.product_id,
        warehouseId: wid,
        delta: cfg.act.delta * Number(item.quantity),
        type: cfg.act.stockType,
        relatedType: cfg.act.relatedType,
        relatedId: r.id,
        relatedNo: r.return_no,
      })
      statements.push(...plan.statements)
    }

    statements.push(
      db.raw
        .prepare(`UPDATE ${R} SET status = 2, updated_at = ? WHERE id = ?`)
        .bind(nowLocal(env), id)
    )

    // 库存 + 流水 + 退货单状态，一次原子提交
    await db.batch(statements)
    await logOp(db, ctx.user, cfg.module, cfg.act.logWord, r.return_no)

    // 同步原单状态（衍生字段，放在批提交之后单独更新）
    if (r[cfg.source.fk]) await syncOrderStatus(ctx, cfg, r[cfg.source.fk], r.return_no)

    return ok(cfg.act.doneMessage)
  }

  // ---------------- 作废 ----------------
  async function cancel(ctx) {
    const { db, env, params } = ctx
    const id = Number(params.rid)

    const r = await db.first(`SELECT * FROM ${R} WHERE id = ?`, id)
    if (!r) notFound(`${cfg.doc}不存在`)
    if (r.status > 1) bad('状态错误')

    await db.run(`UPDATE ${R} SET status = 3, updated_at = ? WHERE id = ?`, nowLocal(env), id)
    await logOp(db, ctx.user, cfg.module, '作废', r.return_no)

    // 作废后重新判定原单状态（可能从「部分退货/已退货」回退到「已发货」）
    if (r[cfg.source.fk]) await syncOrderStatus(ctx, cfg, r[cfg.source.fk], r.return_no)

    return ok('作废成功')
  }

  /**
   * 根据退货情况同步原单状态
   *   无退货    → 回到 已发货/已收货(3) 或 部分发货/部分收货(2)
   *   部分退回  → 5 部分退货
   *   全部退回  → 6 已退货
   * 草稿(0)/已审核(1)/已关闭(4) 不参与
   */
  async function syncOrderStatus(ctx, cfg, orderId, returnNo) {
    const { db } = ctx

    const order = await db.first(`SELECT * FROM ${O} WHERE id = ?`, orderId)
    if (!order || [0, 1, 4].includes(order.status)) return null

    const orderItems = await db.all(`SELECT * FROM ${OI} WHERE order_id = ? ORDER BY id`, orderId)
    const returned = await returnedQtyMap(db, cfg, orderId)

    let totalRet = 0
    let totalOut = 0
    let allFully = true

    for (const it of orderItems) {
      const base = Number(it[cfg.source.qtyField] || 0)
      const got = returned.get(it.product_id) || 0
      totalRet += got
      totalOut += base
      if (got < base) allFully = false
    }

    let next
    if (totalRet === 0) {
      next = totalOut > 0 ? 3 : 2
    } else if (allFully && totalOut > 0) {
      next = 6 // 已退货
    } else {
      next = 5 // 部分退货
    }

    if (next === order.status) return next

    await db.run(
      `UPDATE ${O} SET status = ?, updated_at = ? WHERE id = ?`,
      next,
      nowLocal(ctx.env),
      orderId
    )
    // Python 版这里也用 user=None（系统行为）
    await logOp(db, null, '系统', '状态流转', order.order_no, `${order.status} -> ${next}`)
    return next
  }

  const base = `/api/ext/${cfg.base}`

  return [
    { method: 'GET', path: new RegExp(`^${base}$`), perm: cfg.perm.view, handler: list },
    { method: 'POST', path: new RegExp(`^${base}$`), perm: cfg.perm.add, handler: create },
    { method: 'GET', path: new RegExp(`^${base}/returnable$`), perm: cfg.perm.view, handler: returnable },
    { method: 'GET', path: new RegExp(`^${base}/available/(?<order_id>\\d+)$`), perm: cfg.perm.view, handler: available },
    { method: 'GET', path: new RegExp(`^${base}/(?<rid>\\d+)$`), perm: cfg.perm.view, handler: get },
    { method: 'PUT', path: new RegExp(`^${base}/(?<rid>\\d+)/approve$`), perm: cfg.perm.approve, handler: approve },
    { method: 'PUT', path: new RegExp(`^${base}/(?<rid>\\d+)/${cfg.act.route}$`), perm: cfg.perm.act, handler: act },
    { method: 'PUT', path: new RegExp(`^${base}/(?<rid>\\d+)/cancel$`), perm: cfg.perm.cancel, handler: cancel },
  ]
}
