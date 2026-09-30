/**
 * 客户
 * 对应 backend/app/api/customers.py
 */

import { bad, notFound, ok, json, paginated, paginationOf, intParam, boolParam, likeArg, round2 } from '../lib/http.js'
import { nowLocal, isoOf } from '../lib/time.js'
import { logOp } from '../lib/oplog.js'

const CREATE_FIELDS = [
  'name',
  'contact',
  'phone',
  'email',
  'address',
  'credit_limit',
  'bank_name',
  'bank_account',
  'tax_number',
  'remark',
]
const UPDATE_FIELDS = [...CREATE_FIELDS, 'status']

/** 允许为空的字段：空串归一为 NULL */
const BLANK_TO_NULL = new Set([
  'contact',
  'phone',
  'email',
  'bank_name',
  'bank_account',
  'tax_number',
  'remark',
])

function clean(data) {
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    out[k] = BLANK_TO_NULL.has(k) && typeof v === 'string' ? v.trim() || null : v
  }
  return out
}

function toResponse(r) {
  return {
    id: r.id,
    name: r.name,
    contact: r.contact ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    address: r.address ?? null,
    credit_limit: r.credit_limit ?? 0,
    bank_name: r.bank_name ?? null,
    bank_account: r.bank_account ?? null,
    tax_number: r.tax_number ?? null,
    status: r.status ?? 1,
    remark: r.remark ?? null,
    created_at: isoOf(r.created_at),
    updated_at: isoOf(r.updated_at),
  }
}

/**
 * 客户应收 = 已审核/已发货销售 − 收客户货款 + 退款给客户 − 已审核退货
 * 符号：客户付款减少应收；我们退款给客户则让应收回升
 */
export async function calcOutstanding(db, customerId) {
  const total = Number(
    (await db.scalar(
      `SELECT COALESCE(SUM(total_amount), 0) AS v FROM sales_orders
        WHERE customer_id = ? AND status IN (1,2,3,5,6)`,
      customerId
    )) || 0
  )

  const received = Number(
    (await db.scalar(
      `SELECT COALESCE(SUM(amount), 0) AS v FROM payments
        WHERE type = 1 AND partner_type = 'customer' AND partner_id = ?`,
      customerId
    )) || 0
  )

  const refunded = Number(
    (await db.scalar(
      `SELECT COALESCE(SUM(amount), 0) AS v FROM payments
        WHERE type = 2 AND partner_type = 'customer' AND partner_id = ?`,
      customerId
    )) || 0
  )

  const returned = Number(
    (await db.scalar(
      `SELECT COALESCE(SUM(total_amount), 0) AS v FROM sale_returns
        WHERE customer_id = ? AND status IN (1,2)`,
      customerId
    )) || 0
  )

  const orderCount = await db.count(
    'SELECT COUNT(*) AS n FROM sales_orders WHERE customer_id = ? AND status IN (1,2,3,5,6)',
    customerId
  )

  return { amount: total - received + refunded - returned, orderCount }
}

async function list(ctx) {
  const { db, url } = ctx
  const { page, pageSize, offset } = paginationOf(url)

  const keyword = url.searchParams.get('keyword')
  const statusRaw = url.searchParams.get('status')
  const status = intParam(statusRaw)

  const where = []
  const params = []

  if (keyword) {
    const k = likeArg(keyword)
    where.push(`(name LIKE ? ESCAPE '\\' OR contact LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')`)
    params.push(k, k, k)
  }
  if (statusRaw !== null && statusRaw !== '' && status !== null) {
    where.push('status = ?')
    params.push(status)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await db.count(`SELECT COUNT(*) AS n FROM customers ${whereSql}`, ...params)
  const rows = await db.all(
    `SELECT * FROM customers ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset
  )

  return paginated(total, page, pageSize, rows.map(toResponse))
}

async function outstanding(ctx) {
  const { db, params } = ctx
  const id = Number(params.id)

  const customer = await db.first('SELECT * FROM customers WHERE id = ?', id)
  if (!customer) notFound('客户不存在')

  const { amount, orderCount } = await calcOutstanding(db, id)
  const a = round2(amount)

  return json({
    customer_id: id,
    customer_name: customer.name,
    amount: a,
    receivable: a,
    order_count: orderCount,
    has_debt: amount > 0,
    is_prepaid: amount < 0,
  })
}

async function create(ctx) {
  const { db, body, user } = ctx
  const data = clean(body || {})
  const name = String(data.name ?? '').trim()
  if (!name) bad('请输入客户名称')

  if (await db.first('SELECT id FROM customers WHERE name = ?', name)) bad('客户名称已存在')

  const now = nowLocal(ctx.env)
  const cols = [...CREATE_FIELDS]
  const values = CREATE_FIELDS.map((f) => {
    if (f === 'name') return name
    if (f === 'credit_limit') return Number(data[f] ?? 0)
    return data[f] === undefined ? null : data[f]
  })
  cols.push('status', 'created_at', 'updated_at')
  values.push(1, now, now)

  const id = await db.insert(
    `INSERT INTO customers (${cols.map((c) => `"${c}"`).join(', ')})
     VALUES (${cols.map(() => '?').join(', ')})`,
    ...values
  )
  await logOp(db, user, '客户管理', '新增客户', name)

  const row = await db.first('SELECT * FROM customers WHERE id = ?', id)
  return json(toResponse(row))
}

async function get(ctx) {
  const { db, params } = ctx
  const row = await db.first('SELECT * FROM customers WHERE id = ?', Number(params.id))
  if (!row) notFound('客户不存在')
  return json(toResponse(row))
}

async function update(ctx) {
  const { db, body, user, params } = ctx
  const id = Number(params.id)

  const existing = await db.first('SELECT * FROM customers WHERE id = ?', id)
  if (!existing) notFound('客户不存在')

  const incoming = {}
  for (const [k, v] of Object.entries(body || {})) {
    if (UPDATE_FIELDS.includes(k)) incoming[k] = v
  }
  const data = clean(incoming)

  if (data.name !== undefined) {
    const name = String(data.name ?? '').trim()
    if (!name) bad('请输入客户名称')
    if (await db.first('SELECT id FROM customers WHERE name = ? AND id != ?', name, id)) {
      bad('客户名称已存在')
    }
    data.name = name
  }

  const sets = []
  const values = []
  for (const [k, v] of Object.entries(data)) {
    sets.push(`"${k}" = ?`)
    values.push(v === undefined ? null : v)
  }
  if (sets.length) {
    sets.push('updated_at = ?')
    values.push(nowLocal(ctx.env))
    await db.run(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`, ...values, id)
  }

  await logOp(db, user, '客户管理', '编辑客户', existing.name)

  const row = await db.first('SELECT * FROM customers WHERE id = ?', id)
  return json(toResponse(row))
}

async function remove(ctx) {
  const { db, user, params, url } = ctx
  const id = Number(params.id)
  const force = boolParam(url.searchParams.get('force'))

  const customer = await db.first('SELECT * FROM customers WHERE id = ?', id)
  if (!customer) notFound('客户不存在')

  const { amount, orderCount } = await calcOutstanding(db, id)
  if (amount > 0 && !force) {
    bad(
      `该客户存在未结清应收款 ¥${amount.toFixed(2)}（关联 ${orderCount} 张销售单），` +
        `请先完成收款或作废相关单据后再删除`
    )
  }

  const totalOrders = await db.count('SELECT COUNT(*) AS n FROM sales_orders WHERE customer_id = ?', id)
  if (totalOrders > 0) {
    bad(
      `该客户已被 ${totalOrders} 张销售单引用，删除会导致历史单据失去往来单位。请改用「禁用」状态。`
    )
  }

  const totalReturns = await db.count('SELECT COUNT(*) AS n FROM sale_returns WHERE customer_id = ?', id)
  if (totalReturns > 0) {
    bad(`该客户已被 ${totalReturns} 张销售退货单引用，无法删除。请改用「禁用」状态。`)
  }

  await db.run('DELETE FROM customers WHERE id = ?', id)
  await logOp(
    db,
    user,
    '客户管理',
    '删除客户',
    customer.name,
    `应收款:¥${amount.toFixed(2)}${force ? '(强制删除)' : ''}`
  )
  return ok('删除成功')
}

export const routes = [
  { method: 'GET', path: /^\/api\/customers$/, perm: 'customer:view', handler: list },
  { method: 'POST', path: /^\/api\/customers$/, perm: 'customer:add', handler: create },
  { method: 'GET', path: /^\/api\/customers\/(?<id>\d+)\/outstanding$/, perm: 'customer:view', handler: outstanding },
  { method: 'GET', path: /^\/api\/customers\/(?<id>\d+)$/, perm: 'customer:view', handler: get },
  { method: 'PUT', path: /^\/api\/customers\/(?<id>\d+)$/, perm: 'customer:edit', handler: update },
  { method: 'DELETE', path: /^\/api\/customers\/(?<id>\d+)$/, perm: 'customer:delete', handler: remove },
]
