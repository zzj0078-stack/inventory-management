/**
 * 采购单 / 销售单 —— 通用订单路由工厂
 *
 * Python 里 purchase.py 与 sales.py 近乎重复（各 400+ 行），差异只在：
 *   表名 / 单号前缀 / 往来单位(供应商↔客户) / 日期字段 / 人员字段 /
 *   收货↔发货 / 入库↔出库 / 权限码 / 提示文案
 * 这里用工厂参数化，保证两边行为由构造决定、不会各自漂移。
 *
 * 对应用户端：backend/app/api/purchase.py、backend/app/api/sales.py
 */

import { bad, notFound, ok, json, paginated, paginationOf, intParam, likeArg } from './http.js'
import { nowLocal, dateOf, isoOf, dateStamp, endOfDayBound } from './time.js'
import { logOp } from './oplog.js'
import { planStock } from './stock.js'
import { allInChunks, multiRowInsert } from './db.js'

// ---------------- 价内税 ----------------

/**
 * 价内税口径：单价已含税
 *   金额小计 = 数量 × 单价（含税）
 *   内含税额 = Σ(小计 − 小计 / (1 + 税率/100))
 *   整单合计 = Σ小计 + 运费
 */
export function calcAmounts(items, freight = 0) {
  const r2 = (n) => Math.round(n * 100) / 100
  let goods = 0
  let tax = 0

  for (const it of items || []) {
    const q = Number(it.quantity ?? 0)
    const p = Number(it.price ?? 0)
    const r = Number(it.tax_rate ?? 0)
    const gross = q * p
    goods += gross
    if (r > -100) tax += gross - gross / (1 + r / 100)
  }

  const f = Number(freight || 0)
  return { goods: r2(goods), tax: r2(tax), total: r2(goods + f) }
}

// ---------------- 单号 ----------------

async function generateOrderNo(db, table, prefix, env) {
  const pre = prefix + dateStamp(env)
  const last = await db.first(
    `SELECT order_no FROM ${table} WHERE order_no LIKE ? ORDER BY id DESC LIMIT 1`,
    pre + '%'
  )
  const n = last ? Number.parseInt(String(last.order_no).slice(-4), 10) : 0
  const seq = Number.isFinite(n) ? n + 1 : 1
  return pre + String(seq).padStart(4, '0')
}

// ---------------- 请求体归一 ----------------

/** 空字符串 / 空日期 → null（对应 Pydantic 的 before validator） */
function blankToNull(v) {
  if (v === undefined || v === null) return null
  if (typeof v === 'string') {
    const s = v.trim()
    return s === '' ? null : s
  }
  return v
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ---------------- 响应构造 ----------------

/** 一次性把商品信息取成 Map（分块，规避 D1 的 100 参数上限） */
async function loadProducts(db, items) {
  const pids = [...new Set(items.map((i) => i.product_id).filter(Boolean))]
  const prodMap = new Map()
  if (!pids.length) return prodMap
  // 必须分块：D1 单条语句最多 100 个绑定参数。
  // 一张明细超过 100 行的销售单（或采购单）走这里，不分块会直接
  // 报 too many SQL variables，导致**详情页打不开**（150 行实测 500）。
  for (const p of await allInChunks(
    db,
    pids,
    (ph) => `SELECT id, name, spec, unit, sku FROM products WHERE id IN (${ph})`
  )) {
    prodMap.set(p.id, p)
  }
  return prodMap
}

/** 明细行 → 响应形状（纯函数，prodMap 由调用方备好） */
function shapeItems(cfg, items, prodMap) {
  return items.map((i) => {
    const p = prodMap.get(i.product_id)
    const done = Number(i[cfg.qtyField] || 0)
    const qty = Number(i.quantity || 0)
    return {
      id: i.id,
      product_id: i.product_id,
      quantity: qty,
      price: i.price ?? 0,
      tax_rate: i.tax_rate ?? 0,
      amount: i.amount ?? 0,
      [cfg.qtyField]: done,
      remark: i.remark ?? null,
      created_at: isoOf(i.created_at),
      product_name: p ? p.name : `⚠ 商品#${i.product_id} 已删除`,
      product_spec: p ? p.spec ?? null : null,
      product_unit: p ? p.unit ?? null : null,
      product_sku: p ? p.sku ?? null : null,
      pending_quantity: Math.max(qty - done, 0),
    }
  })
}

/** 列表里的「商品名称摘要」：1 项直接显示，多项显示「首个 等N项」 */
function summarize(labels) {
  if (!labels || !labels.length) return ''
  if (labels.length === 1) return labels[0]
  return `${labels[0]} 等${labels.length}项`
}

/** 单据 → 响应形状（纯函数，关联数据由调用方备好） */
function shapeOrder(cfg, order, { items, party, warehouse, creator }) {
  let creatorName = ''
  if (order[cfg.personField]) {
    creatorName = order[cfg.personField]
  } else if (creator) {
    creatorName = creator.full_name || creator.username || ''
  }

  return {
    id: order.id,
    order_no: order.order_no,
    [cfg.party.fk]: order[cfg.party.fk] ?? null,
    [cfg.dateField]: dateOf(order[cfg.dateField]),
    warehouse_id: order.warehouse_id ?? null,
    [cfg.personField]: order[cfg.personField] ?? null,
    [cfg.extraDateField]: dateOf(order[cfg.extraDateField]),
    payment_method: order.payment_method ?? null,
    payment_terms: order.payment_terms ?? null,
    currency: order.currency ?? null,
    exchange_rate: order.exchange_rate ?? null,
    tax_amount: order.tax_amount ?? 0,
    freight: order.freight ?? 0,
    total_amount: order.total_amount ?? 0,
    status: order.status ?? 0,
    status_text: cfg.statusText[order.status] ?? '',
    approve_by: order.approve_by ?? null,
    approve_at: isoOf(order.approve_at),
    remark: order.remark ?? null,
    delivery_address: order.delivery_address ?? null,
    invoice_no: order.invoice_no ?? null,
    created_by: order.created_by ?? null,
    created_at: isoOf(order.created_at),
    updated_at: isoOf(order.updated_at),
    items,
    [`${cfg.party.respPrefix}_name`]: party
      ? party.name
      : order[cfg.party.fk]
        ? `⚠ ${cfg.party.label}#${order[cfg.party.fk]} 已不存在`
        : cfg.party.none,
    [`${cfg.party.respPrefix}_contact`]: party ? party.contact ?? null : null,
    [`${cfg.party.respPrefix}_phone`]: party ? party.phone ?? null : null,
    warehouse_name: order.warehouse_id
      ? warehouse
        ? warehouse.name
        : `⚠ 仓库#${order.warehouse_id} 已删除`
      : '',
    creator_name: creatorName,
  }
}

/** 单张单据（详情用）：关联数据逐个查，一张单最多 5 条查询，可以接受 */
async function decorate(ctx, cfg, order) {
  const { db } = ctx

  const rawItems = await db.all(
    `SELECT * FROM ${cfg.table.item} WHERE order_id = ? ORDER BY id`,
    order.id
  )

  const party = order[cfg.party.fk]
    ? await db.first(
        `SELECT id, name, contact, phone FROM ${cfg.party.table} WHERE id = ?`,
        order[cfg.party.fk]
      )
    : null

  const warehouse = order.warehouse_id
    ? await db.first('SELECT id, name FROM warehouses WHERE id = ?', order.warehouse_id)
    : null

  const creator = order.created_by
    ? await db.first('SELECT full_name, username FROM users WHERE id = ?', order.created_by)
    : null

  const prodMap = await loadProducts(db, rawItems)

  return shapeOrder(cfg, order, {
    items: shapeItems(cfg, rawItems, prodMap),
    party,
    warehouse,
    creator,
  })
}

/**
 * 整页单据（列表用）—— **每种关联只查一次**，查询数与页大小无关（约 5~9 条）。
 *
 * 原来的写法是 `for (const o of orders) await decorate(...)`，每张单 4~6 条查询：
 * 一页 20 单就是 100+ 次，直接撞上 D1「每次 Worker 调用查询次数」上限
 * （免费 50 / 付费 1000）—— 免费计划下一页十几单就打不开了。
 * 这里顺带把列表摘要（商品名称/规格/项数）也算出来，省掉原来重复查一次明细。
 */
async function decorateMany(ctx, cfg, orders) {
  if (!orders.length) return []
  const { db } = ctx
  const oids = orders.map((o) => o.id)

  const allItems = await allInChunks(
    db,
    oids,
    (ph) => `SELECT * FROM ${cfg.table.item} WHERE order_id IN (${ph}) ORDER BY id`
  )
  const itemsByOrder = new Map()
  for (const it of allItems) {
    if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, [])
    itemsByOrder.get(it.order_id).push(it)
  }

  const prodMap = await loadProducts(db, allItems)

  const partyMap = new Map()
  for (const p of await allInChunks(
    db,
    [...new Set(orders.map((o) => o[cfg.party.fk]).filter(Boolean))],
    (ph) => `SELECT id, name, contact, phone FROM ${cfg.party.table} WHERE id IN (${ph})`
  )) {
    partyMap.set(p.id, p)
  }

  const whMap = new Map()
  for (const w of await allInChunks(
    db,
    [...new Set(orders.map((o) => o.warehouse_id).filter(Boolean))],
    (ph) => `SELECT id, name FROM warehouses WHERE id IN (${ph})`
  )) {
    whMap.set(w.id, w)
  }

  const userMap = new Map()
  for (const u of await allInChunks(
    db,
    [...new Set(orders.map((o) => o.created_by).filter(Boolean))],
    (ph) => `SELECT id, full_name, username FROM users WHERE id IN (${ph})`
  )) {
    userMap.set(u.id, u)
  }

  return orders.map((o) => {
    const raw = itemsByOrder.get(o.id) || []
    const out = shapeOrder(cfg, o, {
      items: shapeItems(cfg, raw, prodMap),
      party: partyMap.get(o[cfg.party.fk]) || null,
      warehouse: whMap.get(o.warehouse_id) || null,
      creator: userMap.get(o.created_by) || null,
    })

    // 列表摘要：直接用已经取到的明细算，不再单独查一遍
    const names = []
    const specs = []
    for (const it of raw) {
      const p = prodMap.get(it.product_id)
      if (p && p.name) names.push(p.name)
      if (p && p.spec) specs.push(p.spec)
    }
    out.item_count = names.length
    out.product_summary = summarize(names)
    out.spec_summary = summarize(specs)
    return out
  })
}


// ---------------- 工厂 ----------------

export function makeOrderRoutes(cfg) {
  const O = cfg.table.order
  const I = cfg.table.item

  // ---- 列表 ----
  async function list(ctx) {
    const { db, url } = ctx
    const { page, pageSize, offset } = paginationOf(url, { maxSize: 100 })

    const P = cfg.party
    const where = []
    const params = []

    const keyword = url.searchParams.get('keyword')
    if (keyword) {
      const k = likeArg(keyword)
      where.push(
        `(o.order_no LIKE ? ESCAPE '\\' OR o.remark LIKE ? ESCAPE '\\'
          OR o.delivery_address LIKE ? ESCAPE '\\' OR o.invoice_no LIKE ? ESCAPE '\\'
          OR p.name LIKE ? ESCAPE '\\' OR p.contact LIKE ? ESCAPE '\\'
          OR p.phone LIKE ? ESCAPE '\\' OR p.address LIKE ? ESCAPE '\\')`
      )
      params.push(k, k, k, k, k, k, k, k)
    }

    const partyName = url.searchParams.get(cfg.filters.partyName)
    if (partyName) {
      where.push(`p.name LIKE ? ESCAPE '\\'`)
      params.push(likeArg(partyName))
    }
    const contact = url.searchParams.get('contact')
    if (contact) {
      where.push(`p.contact LIKE ? ESCAPE '\\'`)
      params.push(likeArg(contact))
    }
    const phone = url.searchParams.get('phone')
    if (phone) {
      where.push(`p.phone LIKE ? ESCAPE '\\'`)
      params.push(likeArg(phone))
    }
    const address = url.searchParams.get('address')
    if (address) {
      where.push(`(o.delivery_address LIKE ? ESCAPE '\\' OR p.address LIKE ? ESCAPE '\\')`)
      params.push(likeArg(address), likeArg(address))
    }
    const remark = url.searchParams.get('remark')
    if (remark) {
      where.push(`o.remark LIKE ? ESCAPE '\\'`)
      params.push(likeArg(remark))
    }

    const statusRaw = url.searchParams.get('status')
    const status = intParam(statusRaw)
    if (statusRaw !== null && statusRaw !== '' && status !== null) {
      where.push('o.status = ?')
      params.push(status)
    }

    const startDate = url.searchParams.get('start_date')
    if (startDate) {
      where.push('o.created_at >= ?')
      params.push(startDate)
    }
    const endDate = url.searchParams.get('end_date')
    if (endDate) {
      // 补成当天末尾，否则会漏掉结束日期当天的数据（Python 版的 bug，这里已修）
      where.push('o.created_at <= ?')
      params.push(endOfDayBound(endDate))
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const fromSql = `FROM ${O} o LEFT JOIN ${P.table} p ON p.id = o.${P.fk} ${whereSql}`

    const total = await db.count(`SELECT COUNT(*) AS n ${fromSql}`, ...params)
    const orders = await db.all(
      `SELECT o.* ${fromSql} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset
    )

    // 整页一次性装饰（原来逐单 decorate 是 N+1：一页 20 单要 100+ 次查询）
    const decorated = await decorateMany(ctx, cfg, orders)

    return paginated(total, page, pageSize, decorated)
  }

  // ---- 详情 ----
  async function get(ctx) {
    const order = await ctx.db.first(`SELECT * FROM ${O} WHERE id = ?`, Number(ctx.params.id))
    if (!order) notFound(`${cfg.doc}不存在`)
    return json(await decorate(ctx, cfg, order))
  }

  // ---- 新增 ----
  async function create(ctx) {
    const { db, body, env } = ctx
    const items = Array.isArray(body?.items) ? body.items : []
    if (!items.length) bad(`${cfg.detail}不能为空`)

    for (const it of items) {
      if (!(Number(it.quantity) > 0)) bad('数量必须大于 0')
    }

    // 商品存在性（Python 版未校验，这里补上，避免外键错误）
    // 分块查询：一张单可能有上百个明细，不分块会撞 D1 的 100 参数上限
    const pids = [...new Set(items.map((i) => Number(i.product_id)).filter(Boolean))]
    const found = new Set(
      (await allInChunks(db, pids, (ph) => `SELECT id FROM products WHERE id IN (${ph})`)).map(
        (r) => r.id
      )
    )
    const missing = pids.filter((p) => !found.has(p))
    if (missing.length) bad(`商品不存在：${missing.join(', ')}`)

    const { tax, total } = calcAmounts(items, body?.freight)

    const wid = (body?.warehouse_id ? Number(body.warehouse_id) : null) || (await requireWarehouse(ctx))
    const now = nowLocal(env)

    const orderNo = await generateOrderNo(db, O, cfg.prefix, env)

    const cols = [
      'order_no',
      cfg.party.fk,
      cfg.dateField,
      'warehouse_id',
      cfg.personField,
      cfg.extraDateField,
      'payment_method',
      'payment_terms',
      'currency',
      'exchange_rate',
      'tax_amount',
      'freight',
      'total_amount',
      'status',
      'created_by',
      'remark',
      'delivery_address',
      'invoice_no',
      'created_at',
      'updated_at',
    ]
    const values = [
      orderNo,
      body?.[cfg.party.fk] ?? null,
      blankToNull(body?.[cfg.dateField]) || now.slice(0, 10),
      wid,
      blankToNull(body?.[cfg.personField]),
      blankToNull(body?.[cfg.extraDateField]),
      blankToNull(body?.payment_method),
      blankToNull(body?.payment_terms),
      blankToNull(body?.currency) || 'CNY',
      numOrNull(body?.exchange_rate) ?? 1,
      tax,
      numOrNull(body?.freight) ?? 0,
      total,
      cfg.status.draft,
      ctx.user.id,
      blankToNull(body?.remark),
      blankToNull(body?.delivery_address),
      blankToNull(body?.invoice_no),
      now,
      now,
    ]

    const orderId = await db.insert(
      `INSERT INTO ${O} (${cols.map((c) => `"${c}"`).join(', ')})
       VALUES (${cols.map(() => '?').join(', ')})`,
      ...values
    )

    // 明细：校验已在前面做完，这里整批原子写入；
    // 万一失败，补偿删除刚建的主单，避免留下无明细的孤儿单
    //
    // 用多行 INSERT：一张单可能有上百条明细，逐行一条语句会撞上
    // D1「每次调用查询次数」上限（免费 50）。8 列 → 每语句 12 行，
    // 150 条明细从 150 条语句降到 13 条。
    const itemCols = [
      'order_id', 'product_id', 'quantity', 'price',
      'tax_rate', 'amount', 'remark', 'created_at',
    ]
    const itemRows = items.map((it) => [
      orderId,
      Number(it.product_id),
      Number(it.quantity),
      Number(it.price ?? 0),
      Number(it.tax_rate ?? 0),
      Number(it.quantity) * Number(it.price ?? 0),
      blankToNull(it.remark),
      now,
    ])

    try {
      await db.batch(multiRowInsert(db, I, itemCols, itemRows))
    } catch (e) {
      await db.batch([
        db.raw.prepare(`DELETE FROM ${I} WHERE order_id = ?`).bind(orderId),
        db.raw.prepare(`DELETE FROM ${O} WHERE id = ?`).bind(orderId),
      ])
      throw e
    }

    await logOp(db, ctx.user, cfg.module, `新增${cfg.doc}`, orderNo, `金额:${total} 仓库#${wid}`)

    const order = await db.first(`SELECT * FROM ${O} WHERE id = ?`, orderId)
    return json(await decorate(ctx, cfg, order))
  }

  // ---- 编辑（仅草稿，明细整体替换）----
  async function update(ctx) {
    const { db, body, env } = ctx
    const id = Number(ctx.params.id)

    const order = await db.first(`SELECT * FROM ${O} WHERE id = ?`, id)
    if (!order) notFound(`${cfg.doc}不存在`)
    if (order.status !== cfg.status.draft) bad(`仅「草稿」状态的${cfg.doc}可以编辑`)

    const items = Array.isArray(body?.items) ? body.items : []
    if (!items.length) bad(`${cfg.detail}不能为空`)
    for (const it of items) {
      if (!(Number(it.quantity) > 0)) bad('数量必须大于 0')
    }

    const pids = [...new Set(items.map((i) => Number(i.product_id)).filter(Boolean))]
    const found = new Set(
      (await allInChunks(db, pids, (ph) => `SELECT id FROM products WHERE id IN (${ph})`)).map(
        (r) => r.id
      )
    )
    const missing = pids.filter((p) => !found.has(p))
    if (missing.length) bad(`商品不存在：${missing.join(', ')}`)

    let wid = order.warehouse_id
    if (body?.warehouse_id) {
      wid = Number(body.warehouse_id)
      const wh = await db.first('SELECT id FROM warehouses WHERE id = ?', wid)
      if (!wh) bad(`仓库不存在：${wid}`)
    }

    const { tax, total } = calcAmounts(items, body?.freight)
    const now = nowLocal(env)

    const sets = [
      `${cfg.party.fk} = ?`,
      `${cfg.dateField} = ?`,
      'warehouse_id = ?',
      `${cfg.personField} = ?`,
      `${cfg.extraDateField} = ?`,
      'payment_method = ?',
      'payment_terms = ?',
      'currency = ?',
      'exchange_rate = ?',
      'tax_amount = ?',
      'freight = ?',
      'total_amount = ?',
      'remark = ?',
      'delivery_address = ?',
      'invoice_no = ?',
      'updated_at = ?',
    ]
    const values = [
      body?.[cfg.party.fk] ?? null,
      blankToNull(body?.[cfg.dateField]) || order[cfg.dateField] || now.slice(0, 10),
      wid,
      blankToNull(body?.[cfg.personField]),
      blankToNull(body?.[cfg.extraDateField]),
      blankToNull(body?.payment_method),
      blankToNull(body?.payment_terms),
      blankToNull(body?.currency) || 'CNY',
      numOrNull(body?.exchange_rate) ?? 1,
      tax,
      numOrNull(body?.freight) ?? 0,
      total,
      blankToNull(body?.remark),
      blankToNull(body?.delivery_address),
      blankToNull(body?.invoice_no),
      now,
    ]

    // 整批原子：删旧明细 + 插新明细 + 更新主单
    await db.batch([
      db.raw.prepare(`DELETE FROM ${I} WHERE order_id = ?`).bind(id),
      ...items.map((it) =>
        db.raw
          .prepare(
            `INSERT INTO ${I} (order_id, product_id, quantity, price, tax_rate, amount, remark, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            Number(it.product_id),
            Number(it.quantity),
            Number(it.price ?? 0),
            Number(it.tax_rate ?? 0),
            Number(it.quantity) * Number(it.price ?? 0),
            blankToNull(it.remark),
            now
          )
      ),
      db.raw.prepare(`UPDATE ${O} SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id),
    ])

    await logOp(db, ctx.user, cfg.module, `编辑${cfg.doc}`, order.order_no)

    const fresh = await db.first(`SELECT * FROM ${O} WHERE id = ?`, id)
    return json(await decorate(ctx, cfg, fresh))
  }

  // ---- 审核 ----
  async function approve(ctx) {
    const { db, env } = ctx
    const id = Number(ctx.params.id)

    const order = await db.first(`SELECT * FROM ${O} WHERE id = ?`, id)
    if (!order) notFound(`${cfg.doc}不存在`)
    if (order.status !== cfg.status.draft) bad('订单状态不正确')

    await db.run(
      `UPDATE ${O} SET status = ?, approve_by = ?, approve_at = ?, updated_at = ? WHERE id = ?`,
      cfg.status.approved,
      ctx.user.id,
      nowLocal(env),
      nowLocal(env),
      id
    )
    await logOp(db, ctx.user, cfg.module, `审核${cfg.doc}`, order.order_no)
    return ok('审核成功')
  }

  // ---- 收货 / 发货（分批，可多次）----
  async function act(ctx) {
    const { db, body, env } = ctx
    const id = Number(ctx.params.id)

    const order = await db.first(`SELECT * FROM ${O} WHERE id = ?`, id)
    if (!order) notFound(`${cfg.doc}不存在`)
    if (order.status !== cfg.status.approved && order.status !== cfg.status.partial) {
      bad(`仅「已审核」或「部分${cfg.act.donePart}」的单据可以${cfg.act.verb}`)
    }

    const reqItems = Array.isArray(body?.items) ? body.items : []
    if (!reqItems.length) bad(`请填写本次${cfg.act.verb}数量`)

    const wid = (body?.warehouse_id ? Number(body.warehouse_id) : null) || order.warehouse_id
    if (!wid) bad('未指定仓库')
    const wh = await db.first('SELECT id FROM warehouses WHERE id = ?', wid)
    if (!wh) bad(`仓库不存在：${wid}`)

    const items = await db.all(`SELECT * FROM ${I} WHERE order_id = ? ORDER BY id`, id)
    const byId = new Map(items.map((i) => [i.id, i]))

    const statements = []
    const itemUpdates = []
    let totalNow = 0

    for (const req of reqItems) {
      const qty = Number(req.quantity) || 0
      if (qty <= 0) continue

      const item = byId.get(Number(req.item_id))
      if (!item) bad(`明细行不存在：#${req.item_id}`)

      const done = Number(item[cfg.qtyField] || 0)
      const full = Number(item.quantity || 0)
      const pending = full - done

      if (pending <= 0) bad(`该明细已${cfg.act.verb}完毕（商品#${item.product_id}）`)
      if (qty > pending) {
        bad(`本次${cfg.act.verb} ${qty} 超过待${cfg.act.verbOne}数量 ${pending}（商品#${item.product_id}）`)
      }

      // 库存规划（只读，出库时校验库存是否够）
      const plan = await planStock(ctx, {
        productId: item.product_id,
        warehouseId: wid,
        delta: cfg.act.delta * qty,
        type: cfg.act.delta > 0 ? cfg.act.typeIn : cfg.act.typeOut,
        relatedType: cfg.act.relatedType,
        relatedId: order.id,
        relatedNo: order.order_no,
        remark: `分批${cfg.act.verb} ${done + qty}/${full}`,
      })
      statements.push(...plan.statements)
      itemUpdates.push({ id: item.id, delta: qty })
      totalNow += qty
    }

    if (totalNow === 0) bad(`本次${cfg.act.verb}数量为 0，无需${cfg.act.stockWord}`)

    // 是否全部完成
    const doneMap = new Map()
    for (const u of itemUpdates) {
      const cur = Number((byId.get(u.id) || {})[cfg.qtyField] || 0)
      doneMap.set(u.id, cur + u.delta)
    }
    let allDone = true
    for (const it of items) {
      const d = doneMap.has(it.id) ? doneMap.get(it.id) : Number(it[cfg.qtyField] || 0)
      if (d < Number(it.quantity || 0)) {
        allDone = false
        break
      }
    }

    const newStatus = allDone ? cfg.status.done : cfg.status.partial
    const now = nowLocal(env)

    // 一次原子提交：库存 + 流水 + 明细累计 + 主单状态
    await db.batch([
      ...statements,
      ...itemUpdates.map((u) =>
        db.raw
          .prepare(`UPDATE ${I} SET ${cfg.qtyField} = ${cfg.qtyField} + ? WHERE id = ?`)
          .bind(u.delta, u.id)
      ),
      db.raw
        .prepare(`UPDATE ${O} SET status = ?, updated_at = ? WHERE id = ?`)
        .bind(newStatus, now, id),
    ])

    await logOp(
      db,
      ctx.user,
      cfg.module,
      allDone ? `${cfg.act.logDone}` : cfg.act.log,
      order.order_no,
      `本次${cfg.act.stockWord} ${totalNow}，状态 ${cfg.statusText[newStatus]}`
    )

    return ok(`本次${cfg.act.stockWord} ${totalNow}，当前状态：${cfg.statusText[newStatus]}`)
  }

  // ---- 作废 ----
  async function cancel(ctx) {
    const { db } = ctx
    const id = Number(ctx.params.id)

    const order = await db.first(`SELECT * FROM ${O} WHERE id = ?`, id)
    if (!order) notFound(`${cfg.doc}不存在`)
    if (order.status !== cfg.status.draft && order.status !== cfg.status.approved) {
      bad(`已${cfg.act.donePart}或已关闭的${cfg.doc}不能作废`)
    }

    await db.run(
      `UPDATE ${O} SET status = ?, updated_at = ? WHERE id = ?`,
      cfg.status.closed,
      nowLocal(ctx.env),
      id
    )
    await logOp(db, ctx.user, cfg.module, `作废${cfg.doc}`, order.order_no)
    return ok('作废成功')
  }

  // ---- 删除（仅草稿或已关闭）----
  async function remove(ctx) {
    const { db } = ctx
    const id = Number(ctx.params.id)

    const order = await db.first(`SELECT * FROM ${O} WHERE id = ?`, id)
    if (!order) notFound(`${cfg.doc}不存在`)
    if (order.status !== cfg.status.draft && order.status !== cfg.status.closed) {
      bad(`已审核或已${cfg.act.donePart}的${cfg.doc}不能删除，请先作废`)
    }

    await db.batch([
      db.raw.prepare(`DELETE FROM ${I} WHERE order_id = ?`).bind(id),
      db.raw.prepare(`DELETE FROM ${O} WHERE id = ?`).bind(id),
    ])
    await logOp(db, ctx.user, cfg.module, `删除${cfg.doc}`, order.order_no)
    return ok('删除成功')
  }

  async function requireWarehouse(ctx) {
    const wh = await ctx.db.first('SELECT id FROM warehouses WHERE status = 1 ORDER BY id LIMIT 1')
    if (wh) return wh.id
    const any = await ctx.db.first('SELECT id FROM warehouses ORDER BY id LIMIT 1')
    if (any) return any.id
    bad('系统没有可用仓库，请先创建仓库')
  }

  const base = `/api/${cfg.base}`
  const perm = cfg.perm

  return [
    { method: 'GET', path: new RegExp(`^${base}$`), perm: perm.view, handler: list },
    { method: 'POST', path: new RegExp(`^${base}$`), perm: perm.add, handler: create },
    { method: 'GET', path: new RegExp(`^${base}/(?<id>\\d+)$`), perm: perm.view, handler: get },
    { method: 'PUT', path: new RegExp(`^${base}/(?<id>\\d+)$`), perm: perm.edit, handler: update },
    { method: 'PUT', path: new RegExp(`^${base}/(?<id>\\d+)/approve$`), perm: perm.approve, handler: approve },
    { method: 'PUT', path: new RegExp(`^${base}/(?<id>\\d+)/${cfg.act.route}$`), perm: perm.act, handler: act },
    { method: 'PUT', path: new RegExp(`^${base}/(?<id>\\d+)/cancel$`), perm: perm.cancel, handler: cancel },
    { method: 'DELETE', path: new RegExp(`^${base}/(?<id>\\d+)$`), perm: perm.delete, handler: remove },
  ]
}
