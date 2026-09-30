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

    // 金额汇总（不受分页影响），active 口径与财务管理一致
    const sumOf = async (states) => {
      const marks = states.map(() => '?').join(',')
      return Number(
        (await db.scalar(
          `SELECT COALESCE(SUM(total_amount), 0) AS v FROM ${R} WHERE status IN (${marks})`,
          ...states
        )) || 0
      )
    }

    const summary = {
      all: await sumOf([0, 1, 2, 3]),
      active: await sumOf([1, 2]),
      draft: await sumOf([0]),
      void: await sumOf([3]),
      count: await db.count(`SELECT COUNT(*) AS n FROM ${R}`),
    }

    const items = []
    for (const r of rows) items.push(await returnOut(ctx, cfg, r))

    return paginated(total, page, pageSize, items, summary)
  }

  /** 把退货单行转成响应（含往来单位名、原单号、明细） */
  async function returnOut(ctx, cfg, r) {
    const { db } = ctx
    const p = cfg.party

    const partner = r[p.fk]
      ? await db.first(`SELECT id, name, contact, phone FROM ${p.table} WHERE id = ?`, r[p.fk])
      : null

    let sourceNo = ''
    if (r[cfg.source.fk]) {
      const o = await db.first(`SELECT order_no FROM ${O} WHERE id = ?`, r[cfg.source.fk])
      sourceNo = o ? o.order_no : `⚠ ${cfg.source.doc}#${r[cfg.source.fk]} 已删除`
    }

    const rawItems = await db.all(
      `SELECT * FROM ${RI} WHERE return_id = ? ORDER BY id`,
      r.id
    )

    const pids = [...new Set(rawItems.map((i) => i.product_id).filter(Boolean))]
    const prodMap = new Map()
    if (pids.length) {
      const ph = pids.map(() => '?').join(',')
      for (const row of await db.all(
        `SELECT id, name, spec, unit FROM products WHERE id IN (${ph})`,
        ...pids
      )) {
        prodMap.set(row.id, row)
      }
    }

    // 列表查询已 JOIN 出 partner_name / source_order_no，详情路径下再查一次
    const partnerName =
      r.partner_name !== undefined ? r.partner_name : partner ? partner.name : ''
    const resolvedSourceNo =
      r.source_order_no !== undefined ? r.source_order_no : sourceNo

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
      [`${p.respPrefix}_contact`]: partner ? partner.contact ?? '' : '',
      [`${p.respPrefix}_phone`]: partner ? partner.phone ?? '' : '',
      // 明细：Python 版只回 product_id/quantity/price/amount，
      // 这里多带商品名/规格/单位（超集，不破坏调用方）
      items: rawItems.map((i) => {
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
      const ph = pids.map(() => '?').join(',')
      for (const p of await db.all(
        `SELECT id, name, spec, unit FROM products WHERE id IN (${ph})`,
        ...pids
      )) {
        prodMap.set(p.id, p)
      }
    }

    const partner = order[P.fk]
      ? await db.first(`SELECT id, name, contact, phone FROM ${P.table} WHERE id = ?`, order[P.fk])
      : null

    const items = orderItems.map((it) => {
      const prod = prodMap.get(it.product_id)
      const base = Number(it[cfg.source.qtyField] || 0)
      const already = returned.get(it.product_id) || 0
      return {
        product_id: it.product_id,
        product_name: prod ? prod.name : `商品#${it.product_id}`,
        product_spec: prod ? prod.spec ?? '' : '',
        product_unit: prod ? prod.unit ?? '' : '',
        sold_quantity: it.quantity,
        [cfg.source.qtyField]: base,
        returned_quantity: already,
        available_quantity: Math.max(base - already, 0),
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
      warehouse_id: order.warehouse_id ?? null,
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

    for (const it of items) {
      const pid = Number(it.product_id)
      const qty = Number.parseInt(it.quantity, 10) || 0
      if (qty <= 0) bad('退货数量必须大于 0')

      const avail = (baseMap.get(pid) || 0) - (already.get(pid) || 0)
      if (qty > avail) {
        const prod = await db.first('SELECT name FROM products WHERE id = ?', pid)
        bad(`「${prod ? prod.name : pid}」可退数量仅 ${avail}，本次退货 ${qty} 超出`)
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

    // Python 版用「默认仓库」，不用原单仓库，这里保持一致
    const wid = await defaultWarehouseId(db, env)

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
