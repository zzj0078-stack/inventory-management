/**
 * 收付款 + 应收应付 + 凭证（层次 2）
 * 对应 backend/app/api/extended.py 的「收付款」段
 *
 * 四象限凭证规则（按「类型 × 对象类型」确定借贷科目）：
 *   收款 · 客户      借 银行存款 / 贷 应收账款
 *   收款 · 供应商    借 银行存款 / 贷 应付账款   （供应商退款给我们）
 *   付款 · 供应商    借 应付账款 / 贷 银行存款
 *   付款 · 客户      借 应收账款 / 贷 银行存款   （退款给客户）
 */

import { bad, notFound, ok, json, paginated, paginationOf, intParam } from '../lib/http.js'
import { nowLocal, isoOf, todayLocal, currentPeriod, dateStamp } from '../lib/time.js'
import { logOp } from '../lib/oplog.js'
import { allInChunks } from '../lib/db.js'

/** 生成单号：前缀 + yyyymmdd + 4 位序号 */
async function genNo(db, prefix, env) {
  const p = prefix + dateStamp(env)
  const last = await db.first(
    'SELECT payment_no AS no FROM payments WHERE payment_no LIKE ? ORDER BY id DESC LIMIT 1',
    p + '%'
  )
  const n = last ? Number.parseInt(String(last.no).slice(-4), 10) : 0
  const seq = Number.isFinite(n) ? n + 1 : 1
  return p + String(seq).padStart(4, '0')
}

/** 凭证号：记-YYYY-MM-0001（按会计期间流水） */
async function genVoucherNo(db, period) {
  const prefix = `记-${period}-`
  const last = await db.first(
    'SELECT voucher_no AS no FROM payments WHERE voucher_no LIKE ? ORDER BY id DESC LIMIT 1',
    prefix + '%'
  )
  let seq = 1
  if (last && last.no) {
    const n = Number.parseInt(String(last.no).split('-').pop(), 10)
    if (Number.isFinite(n)) seq = n + 1
  }
  return `${prefix}${String(seq).padStart(4, '0')}`
}

/** 借方科目：按收付款方式判断 */
const DEBIT_BY_METHOD = {
  现金: '库存现金',
  银行转账: '银行存款',
  微信: '银行存款',
  支付宝: '银行存款',
  银行承兑: '应收票据',
}

/**
 * 生成摘要与借贷科目
 * @returns {{summary: string, debit: string, credit: string}}
 */
export function buildVoucher(type, partnerName, amount, paymentMethod, relatedNo = '', relatedType = '', partnerType = 'customer') {
  const isReceive = Number(type) === 1
  const isCustomer = partnerType === 'customer'
  const cash = DEBIT_BY_METHOD[paymentMethod || ''] || '银行存款'

  let verb
  let kind
  if (isReceive && isCustomer) {
    verb = '收'
    kind = '货款'
  } else if (isReceive && !isCustomer) {
    verb = '收'
    kind = '退款' // 供应商退款
  } else if (!isReceive && !isCustomer) {
    verb = '付'
    kind = '货款'
  } else {
    verb = '付'
    kind = '退款' // 退款给客户
  }

  if (relatedType === 'sale_return' || relatedType === 'purchase_return') kind = '退货款'

  let summary = `${verb}${partnerName || ''}${kind}`
  if (relatedNo) summary += `（${relatedNo}）`

  let debit
  let credit
  if (isReceive && isCustomer) {
    debit = cash
    credit = '应收账款'
  } else if (isReceive && !isCustomer) {
    debit = cash
    credit = '应付账款'
  } else if (!isReceive && !isCustomer) {
    debit = '应付账款'
    credit = cash
  } else {
    debit = '应收账款'
    credit = cash
  }

  return { summary, debit, credit }
}

/** 解析往来单位名称、关联单据号，并生成摘要与借贷科目 */
async function resolvePaymentContext(db, data) {
  let partnerName = ''
  if (data.partner_type === 'customer') {
    const c = await db.first('SELECT name FROM customers WHERE id = ?', data.partner_id)
    partnerName = c ? c.name : ''
  } else {
    const s = await db.first('SELECT name FROM suppliers WHERE id = ?', data.partner_id)
    partnerName = s ? s.name : ''
  }

  let relatedNo = ''
  const rid = data.related_id
  if (rid) {
    if (data.related_type === 'sales_order') {
      const o = await db.first('SELECT order_no FROM sales_orders WHERE id = ?', rid)
      relatedNo = o ? o.order_no : ''
    } else if (data.related_type === 'purchase_order') {
      const o = await db.first('SELECT order_no FROM purchase_orders WHERE id = ?', rid)
      relatedNo = o ? o.order_no : ''
    }
  }

  const v = buildVoucher(
    data.type,
    partnerName,
    data.amount,
    data.payment_method,
    relatedNo,
    data.related_type,
    data.partner_type || 'customer'
  )
  return v
}

function paymentOut(p, partnerName, allocations) {
  return {
    id: p.id,
    payment_no: p.payment_no,
    type: p.type,
    partner_type: p.partner_type,
    partner_id: p.partner_id,
    partner_name: partnerName || '',
    amount: p.amount ?? 0,
    payment_method: p.payment_method ?? null,
    voucher_no: p.voucher_no ?? null,
    remark: p.remark ?? null,
    created_at: isoOf(p.created_at),
    related_type: p.related_type ?? null,
    related_id: p.related_id ?? null,
    // 核销明细：这笔款分给了哪些单、各多少
    allocations: allocations || [],
    allocated_total: (allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0),
    // 凭证（层次 2）
    voucher_date: p.voucher_date ?? null,
    period: p.period ?? null,
    summary: p.summary ?? null,
    attachment_count: p.attachment_count ?? 0,
    debit_account: p.debit_account ?? null,
    credit_account: p.credit_account ?? null,
  }
}

/** 该往来单位下，收付款应核销的单据类型 */
function orderTypeOf(partnerType) {
  return partnerType === 'customer' ? 'sales_order' : 'purchase_order'
}

/**
 * 校验并规范化核销分配。
 *
 * 规则（与服务端一致性要求最高的几条）：
 *   - 金额 <= 0 的行直接忽略，前端空行不必特殊处理
 *   - 合计不得超过本次收付款金额（小于则视为部分指定用途）
 *   - related_type 必须与往来单位匹配：客户→销售单，供应商→采购单
 *     否则会出现"给客户收的款核销到采购单"这种对不上的账
 */
function normalizeAllocations(body) {
  const raw = Array.isArray(body?.allocations) ? body.allocations : []
  const expected = orderTypeOf(body?.partner_type)
  const out = []
  for (const a of raw) {
    const amt = Number(a?.amount)
    if (!(amt > 0)) continue
    const rt = String(a?.related_type || expected)
    if (rt !== 'sales_order' && rt !== 'purchase_order') bad('核销单据类型不正确')
    if (rt !== expected) {
      bad(expected === 'sales_order' ? '客户收款只能核销销售单' : '供应商付款只能核销采购单')
    }
    const rid = Number(a?.related_id)
    if (!rid) bad('核销的单据不存在')
    out.push({ related_type: rt, related_id: rid, amount: Math.round(amt * 100) / 100 })
  }
  const total = out.reduce((s, a) => s + a.amount, 0)
  if (total > Number(body?.amount) + 0.005) bad('核销合计不能大于本次金额')
  return out
}

/** 批量写入核销分配 */
async function insertAllocations(db, paymentId, allocs, now) {
  if (!allocs.length) return
  await db.batch(
    allocs.map((a) =>
      db.raw
        .prepare(
          `INSERT INTO payment_allocations (payment_id, related_type, related_id, amount, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(paymentId, a.related_type, a.related_id, a.amount, now)
    )
  )
}

/** 批量取若干笔收付款的核销明细，按 payment_id 分组 */
async function allocationsByPayment(db, paymentIds) {
  const map = new Map()
  const rows = await allInChunks(
    db,
    paymentIds,
    (ph) => `SELECT * FROM payment_allocations WHERE payment_id IN (${ph}) ORDER BY id`
  )
  for (const r of rows) {
    const key = Number(r.payment_id)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({
      related_type: r.related_type,
      related_id: r.related_id,
      amount: r.amount ?? 0,
    })
  }
  return map
}

/** 批量取往来单位名，避免 N+1 */
async function partnerNameMap(db, payments) {
  const custIds = [...new Set(payments.filter((p) => p.partner_type === 'customer').map((p) => p.partner_id).filter(Boolean))]
  const supIds = [...new Set(payments.filter((p) => p.partner_type !== 'customer').map((p) => p.partner_id).filter(Boolean))]

  const map = new Map()
  // 分块：一页最多 100 条收付款，涉及的不同客户/供应商可能超过 100 个，
  // 不分块会撞 D1 的「每查询最多 100 个绑定参数」
  for (const r of await allInChunks(
    db,
    custIds,
    (ph) => `SELECT id, name FROM customers WHERE id IN (${ph})`
  )) {
    map.set(`customer:${r.id}`, r.name)
  }
  for (const r of await allInChunks(
    db,
    supIds,
    (ph) => `SELECT id, name FROM suppliers WHERE id IN (${ph})`
  )) {
    map.set(`supplier:${r.id}`, r.name)
  }
  return map
}

// ---------------- 列表 ----------------

async function list(ctx) {
  const { db, url } = ctx
  const { page, pageSize, offset } = paginationOf(url)

  const typeRaw = url.searchParams.get('type')
  const type = intParam(typeRaw)

  const where = []
  const params = []
  if (typeRaw !== null && typeRaw !== '' && type !== null) {
    where.push('type = ?')
    params.push(type)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await db.count(`SELECT COUNT(*) AS n FROM payments ${whereSql}`, ...params)
  const rows = await db.all(
    `SELECT * FROM payments ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset
  )

  const names = await partnerNameMap(db, rows)
  const allocMap = await allocationsByPayment(db, rows.map((p) => p.id))
  const items = rows.map((p) =>
    paymentOut(p, names.get(`${p.partner_type}:${p.partner_id}`), allocMap.get(Number(p.id)))
  )

  return paginated(total, page, pageSize, items)
}

// ---------------- 新增 ----------------

async function create(ctx) {
  const { db, body, env } = ctx
  if (!body?.type) bad('请选择收付款类型')
  if (!body?.partner_type) bad('请选择对象类型')
  if (!body?.partner_id) bad('请选择往来单位')
  if (!(Number(body?.amount) > 0)) bad('金额必须大于 0')

  // 先校验核销分配，避免主单已经写入才发现分配不合法
  const allocs = normalizeAllocations(body)

  const today = todayLocal(env)
  let vdate = body?.voucher_date ? String(body.voucher_date).slice(0, 10) : null
  if (vdate && !/^\d{4}-\d{2}-\d{2}$/.test(vdate)) vdate = null
  vdate = vdate || today
  const period = vdate.slice(0, 7)

  const auto = await resolvePaymentContext(db, body)
  const pno = await genNo(db, 'PAY', env)
  const voucherNo = body?.voucher_no || (await genVoucherNo(db, period))

  const id = await db.insert(
    `INSERT INTO payments
       (payment_no, type, related_type, related_id, partner_type, partner_id, amount,
        payment_method, voucher_no, voucher_date, period, summary, attachment_count,
        debit_account, credit_account, remark, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    pno,
    Number(body.type),
    // related_* 保留给凭证摘要用：带核销时取第一张单，兼容原有逻辑
    allocs.length ? allocs[0].related_type : (body?.related_type ?? null),
    allocs.length ? allocs[0].related_id : (body?.related_id ?? null),
    body.partner_type,
    Number(body.partner_id),
    Number(body.amount),
    body?.payment_method ?? '现金',
    voucherNo,
    vdate,
    period,
    body?.summary || auto.summary,
    body?.attachment_count || 1,
    body?.debit_account || auto.debit,
    body?.credit_account || auto.credit,
    body?.remark ?? null,
    ctx.user.id,
    nowLocal(env)
  )

  await insertAllocations(db, id, allocs, nowLocal(env))

  await logOp(db, ctx.user, '收付款', '新增', pno, `${voucherNo} ${body?.summary || auto.summary} 金额:${body.amount}`)

  const p = await db.first('SELECT * FROM payments WHERE id = ?', id)
  return json({
    id: p.id,
    payment_no: p.payment_no,
    voucher_no: p.voucher_no,
    summary: p.summary,
    debit_account: p.debit_account,
    credit_account: p.credit_account,
  })
}

// ---------------- 编辑 ----------------

async function update(ctx) {
  const { db, body } = ctx
  const id = Number(ctx.params.payment_id)

  const p = await db.first('SELECT * FROM payments WHERE id = ?', id)
  if (!p) notFound('收付款记录不存在')

  // 凭证日期：传了才改，非法则保留原值
  let vdate = p.voucher_date
  if (body?.voucher_date) {
    const candidate = String(body.voucher_date).slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) vdate = candidate
  }

  // 合并出「新内容」再重算摘要/借贷
  const merged = {
    type: body?.type ?? p.type,
    partner_type: body?.partner_type ?? p.partner_type,
    partner_id: body?.partner_id ?? p.partner_id,
    amount: body?.amount ?? p.amount,
    payment_method: body?.payment_method ?? p.payment_method,
    related_type: body?.related_type ?? p.related_type,
    related_id: body?.related_id ?? p.related_id,
  }
  const auto = await resolvePaymentContext(db, merged)

  const before = p.amount
  const period = vdate ? String(vdate).slice(0, 7) : p.period

  // 只有传了非空 voucher_no 才覆盖，否则保留原凭证号
  const voucherNo = body?.voucher_no ? body.voucher_no : p.voucher_no
  const attachment = body?.attachment_count ? Number(body.attachment_count) : p.attachment_count
  const summary = body?.summary || auto.summary
  const debit = body?.debit_account || auto.debit
  const credit = body?.credit_account || auto.credit
  const remark = body && 'remark' in body ? body.remark : p.remark

  // 核销分配随收付款一起替换：没传 allocations 就保留原样
  const hasAllocField = body && Object.prototype.hasOwnProperty.call(body, 'allocations')
  const allocs = hasAllocField ? normalizeAllocations({ ...merged, allocations: body.allocations }) : null

  await db.run(
    `UPDATE payments SET
       type = ?, partner_type = ?, partner_id = ?, amount = ?, payment_method = ?,
       related_type = ?, related_id = ?, voucher_date = ?, period = ?,
       summary = ?, debit_account = ?, credit_account = ?, voucher_no = ?,
       attachment_count = ?, remark = ?
     WHERE id = ?`,
    Number(merged.type),
    merged.partner_type,
    Number(merged.partner_id),
    Number(merged.amount),
    merged.payment_method,
    allocs && allocs.length ? allocs[0].related_type : merged.related_type,
    allocs && allocs.length ? allocs[0].related_id : merged.related_id,
    vdate,
    period,
    summary,
    debit,
    credit,
    voucherNo,
    attachment,
    remark,
    id
  )

  if (allocs) {
    await db.run('DELETE FROM payment_allocations WHERE payment_id = ?', id)
    await insertAllocations(db, id, allocs, nowLocal(ctx.env))
  }

  await logOp(db, ctx.user, '收付款', '编辑', p.payment_no, `${voucherNo} 金额 ${before} -> ${merged.amount}`)

  const fresh = await db.first('SELECT * FROM payments WHERE id = ?', id)
  return json({
    id: fresh.id,
    payment_no: fresh.payment_no,
    voucher_no: fresh.voucher_no,
    summary: fresh.summary,
  })
}

// ---------------- 删除 ----------------

async function remove(ctx) {
  const { db } = ctx
  const id = Number(ctx.params.payment_id)

  const p = await db.first('SELECT * FROM payments WHERE id = ?', id)
  if (!p) notFound('收付款记录不存在')

  await db.run('DELETE FROM payment_allocations WHERE payment_id = ?', id)
  await db.run('DELETE FROM payments WHERE id = ?', id)
  await logOp(db, ctx.user, '收付款', '删除', p.payment_no, `${p.payment_no} ${p.voucher_no || ''} 金额:${p.amount}`)
  return ok('删除成功')
}

// ---------------- 应收应付 ----------------

async function receivables(ctx) {
  const { db } = ctx

  const sumOrders = async (table) =>
    Number(
      (await db.scalar(
        `SELECT COALESCE(SUM(total_amount), 0) AS v FROM ${table} WHERE status IN (1,2,3,5,6)`
      )) || 0
    )

  const sumPay = async (type, partnerType) =>
    Number(
      (await db.scalar(
        'SELECT COALESCE(SUM(amount), 0) AS v FROM payments WHERE type = ? AND partner_type = ?',
        type,
        partnerType
      )) || 0
    )

  const sumReturn = async (table) =>
    Number(
      (await db.scalar(
        `SELECT COALESCE(SUM(total_amount), 0) AS v FROM ${table} WHERE status IN (1,2)`
      )) || 0
    )

  const salesTotal = await sumOrders('sales_orders')
  const purchaseTotal = await sumOrders('purchase_orders')

  const recvFromCustomer = await sumPay(1, 'customer') // 收客户货款
  const refundToCustomer = await sumPay(2, 'customer') // 退款给客户
  const paidToSupplier = await sumPay(2, 'supplier') // 付供应商货款
  const refundFromSupplier = await sumPay(1, 'supplier') // 收供应商退款

  const saleReturned = await sumReturn('sale_returns')
  const purchaseReturned = await sumReturn('purchase_returns')

  // 符号：客户付款减少应收；退款给客户让应收回升（把多收的钱还回去）
  const receivable = salesTotal - recvFromCustomer + refundToCustomer - saleReturned
  const payable = purchaseTotal - paidToSupplier + refundFromSupplier - purchaseReturned

  return json({
    receivable,
    payable,
    sales_total: salesTotal,
    purchase_total: purchaseTotal,
    // 兼容旧前端字段
    received: recvFromCustomer,
    paid: paidToSupplier,
    // 明细口径，便于前端展示
    recv_from_customer: recvFromCustomer,
    refund_to_customer: refundToCustomer,
    paid_to_supplier: paidToSupplier,
    refund_from_supplier: refundFromSupplier,
    sale_returned: saleReturned,
    purchase_returned: purchaseReturned,
  })
}

// ---------------- 待核销单据 ----------------

/**
 * 某往来单位下、尚未结清的单据，供收付款时选择核销对象。
 *
 * 已结金额 = 该单在 payment_allocations 里的分配合计。
 * 约定与欠款口径一致：只统计已生效的单据（status IN 1,2,3,5,6），
 * 否则草稿单会混进核销列表，和欠款页对不上。
 *
 * 返回按日期从早到晚（先核销最早的欠款，符合常规对账习惯）。
 */
async function openOrders(ctx) {
  const { db, url } = ctx
  const partnerType = url.searchParams.get('partner_type') || 'customer'
  const partnerId = Number(url.searchParams.get('partner_id') || 0)
  if (!partnerId) bad('请选择往来单位')

  const isCustomer = partnerType === 'customer'
  const table = isCustomer ? 'sales_orders' : 'purchase_orders'
  const fk = isCustomer ? 'customer_id' : 'supplier_id'
  const dateField = isCustomer ? 'sale_date' : 'purchase_date'
  const relatedType = orderTypeOf(partnerType)
  const ACTIVE = '(1,2,3,5,6)'

  const orders = await db.all(
    `SELECT o.id, o.order_no, o.total_amount, o.status,
            COALESCE(NULLIF(o.${dateField}, ''), substr(o.created_at, 1, 10)) AS d
       FROM ${table} o
      WHERE o.${fk} = ? AND o.status IN ${ACTIVE}
      ORDER BY d ASC, o.id ASC`,
    partnerId
  )

  const settled = new Map()
  for (const r of await allInChunks(
    db,
    orders.map((o) => o.id),
    (ph) =>
      `SELECT related_id, COALESCE(SUM(amount), 0) AS v
         FROM payment_allocations
        WHERE related_type = '${relatedType}' AND related_id IN (${ph})
        GROUP BY related_id`
  )) {
    settled.set(Number(r.related_id), Number(r.v || 0))
  }

  /*
   * 已退货金额：退货的部分不用再收/付，必须从应结金额里减掉。
   * 与单据列表、对账单口径保持一致，否则会出现
   * 「单据列表说已结清、核销列表说还欠 300」这种自相矛盾。
   */
  const returnTable = isCustomer ? 'sale_returns' : 'purchase_returns'
  const returnFk = isCustomer ? 'sales_order_id' : 'purchase_order_id'
  const returned = new Map()
  for (const r of await allInChunks(
    db,
    orders.map((o) => o.id),
    (ph) =>
      `SELECT ${returnFk} AS oid, COALESCE(SUM(total_amount), 0) AS v
         FROM ${returnTable}
        WHERE ${returnFk} IN (${ph}) AND status IN (1,2)
        GROUP BY ${returnFk}`
  )) {
    returned.set(Number(r.oid), Number(r.v || 0))
  }

  const items = orders.map((o) => {
    const total = Number(o.total_amount || 0)
    const paid = settled.get(Number(o.id)) || 0
    const ret = Math.round((returned.get(Number(o.id)) || 0) * 100) / 100
    // 应结 = 单据金额 − 已退货；未结 = 应结 − 已结
    const payable = Math.round((total - ret) * 100) / 100
    const outstanding = Math.round((payable - paid) * 100) / 100
    return {
      id: o.id,
      order_no: o.order_no,
      date: o.d,
      status: o.status,
      total_amount: total,
      returned_amount: ret,
      payable_amount: payable,
      settled_amount: paid,
      outstanding,
      settled: outstanding <= 0.005,
      related_type: relatedType,
    }
  })

  const totalOutstanding = items.reduce((s, i) => s + Math.max(i.outstanding, 0), 0)
  return json({
    partner_type: partnerType,
    partner_id: partnerId,
    related_type: relatedType,
    items,
    // 只回未结清的条数，便于前端显示"还有几张未结"
    open_count: items.filter((i) => !i.settled).length,
    total_outstanding: Math.round(totalOutstanding * 100) / 100,
  })
}

export const routes = [
  { method: 'GET', path: /^\/api\/ext\/payments$/, perm: 'finance:view', handler: list },
  { method: 'POST', path: /^\/api\/ext\/payments$/, perm: 'finance:add', handler: create },
  { method: 'PUT', path: /^\/api\/ext\/payments\/(?<payment_id>\d+)$/, perm: 'finance:edit', handler: update },
  { method: 'DELETE', path: /^\/api\/ext\/payments\/(?<payment_id>\d+)$/, perm: 'finance:delete', handler: remove },

  { method: 'GET', path: /^\/api\/ext\/receivables$/, perm: 'finance:view', handler: receivables },

  // 收付款核销：选单时拉取该往来单位未结清的单据
  { method: 'GET', path: /^\/api\/ext\/open-orders$/, perm: 'finance:view', handler: openOrders },
]
