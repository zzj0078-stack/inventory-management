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

function paymentOut(p, partnerName) {
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
    // 凭证（层次 2）
    voucher_date: p.voucher_date ?? null,
    period: p.period ?? null,
    summary: p.summary ?? null,
    attachment_count: p.attachment_count ?? 0,
    debit_account: p.debit_account ?? null,
    credit_account: p.credit_account ?? null,
  }
}

/** 批量取往来单位名，避免 N+1 */
async function partnerNameMap(db, payments) {
  const custIds = [...new Set(payments.filter((p) => p.partner_type === 'customer').map((p) => p.partner_id).filter(Boolean))]
  const supIds = [...new Set(payments.filter((p) => p.partner_type !== 'customer').map((p) => p.partner_id).filter(Boolean))]

  const map = new Map()
  if (custIds.length) {
    const ph = custIds.map(() => '?').join(',')
    for (const r of await db.all(`SELECT id, name FROM customers WHERE id IN (${ph})`, ...custIds)) {
      map.set(`customer:${r.id}`, r.name)
    }
  }
  if (supIds.length) {
    const ph = supIds.map(() => '?').join(',')
    for (const r of await db.all(`SELECT id, name FROM suppliers WHERE id IN (${ph})`, ...supIds)) {
      map.set(`supplier:${r.id}`, r.name)
    }
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
  const items = rows.map((p) => paymentOut(p, names.get(`${p.partner_type}:${p.partner_id}`)))

  return paginated(total, page, pageSize, items)
}

// ---------------- 新增 ----------------

async function create(ctx) {
  const { db, body, env } = ctx
  if (!body?.type) bad('请选择收付款类型')
  if (!body?.partner_type) bad('请选择对象类型')
  if (!body?.partner_id) bad('请选择往来单位')
  if (!(Number(body?.amount) > 0)) bad('金额必须大于 0')

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
    body?.related_type ?? null,
    body?.related_id ?? null,
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
    merged.related_type,
    merged.related_id,
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

export const routes = [
  { method: 'GET', path: /^\/api\/ext\/payments$/, perm: 'finance:view', handler: list },
  { method: 'POST', path: /^\/api\/ext\/payments$/, perm: 'finance:add', handler: create },
  { method: 'PUT', path: /^\/api\/ext\/payments\/(?<payment_id>\d+)$/, perm: 'finance:edit', handler: update },
  { method: 'DELETE', path: /^\/api\/ext\/payments\/(?<payment_id>\d+)$/, perm: 'finance:delete', handler: remove },

  { method: 'GET', path: /^\/api\/ext\/receivables$/, perm: 'finance:view', handler: receivables },
]
