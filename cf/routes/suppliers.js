/**
 * 供应商
 * 对应 backend/app/api/suppliers.py
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
  'bank_name',
  'bank_account',
  'tax_number',
  'remark',
]
const UPDATE_FIELDS = [...CREATE_FIELDS, 'status']

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
 * 供应商应付 = 已审核/已收货采购 − 付供应商货款 + 供应商退款 − 已审核退货
 * 符号：我们付款减少应付；供应商退款给我们则让应付回升
 */
export async function calcOutstanding(db, supplierId) {
  const total = Number(
    (await db.scalar(
      `SELECT COALESCE(SUM(total_amount), 0) AS v FROM purchase_orders
        WHERE supplier_id = ? AND status IN (1,2,3,5,6)`,
      supplierId
    )) || 0
  )

  // 我们付给供应商
  const paid = Number(
    (await db.scalar(
      `SELECT COALESCE(SUM(amount), 0) AS v FROM payments
        WHERE type = 2 AND partner_type = 'supplier' AND partner_id = ?`,
      supplierId
    )) || 0
  )

  // 供应商退款给我们
  const refunded = Number(
    (await db.scalar(
      `SELECT COALESCE(SUM(amount), 0) AS v FROM payments
        WHERE type = 1 AND partner_type = 'supplier' AND partner_id = ?`,
      supplierId
    )) || 0
  )

  const returned = Number(
    (await db.scalar(
      `SELECT COALESCE(SUM(total_amount), 0) AS v FROM purchase_returns
        WHERE supplier_id = ? AND status IN (1,2)`,
      supplierId
    )) || 0
  )

  const orderCount = await db.count(
    'SELECT COUNT(*) AS n FROM purchase_orders WHERE supplier_id = ? AND status IN (1,2,3,5,6)',
    supplierId
  )

  return { amount: total - paid + refunded - returned, orderCount }
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
  const total = await db.count(`SELECT COUNT(*) AS n FROM suppliers ${whereSql}`, ...params)
  const rows = await db.all(
    `SELECT * FROM suppliers ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset
  )

  return paginated(total, page, pageSize, rows.map(toResponse))
}

async function outstanding(ctx) {
  const { db, params } = ctx
  const id = Number(params.id)

  const supplier = await db.first('SELECT * FROM suppliers WHERE id = ?', id)
  if (!supplier) notFound('供应商不存在')

  const { amount, orderCount } = await calcOutstanding(db, id)
  const a = round2(amount)

  return json({
    supplier_id: id,
    supplier_name: supplier.name,
    amount: a,
    payable: a,
    order_count: orderCount,
    has_debt: amount > 0,
    is_prepaid: amount < 0,
  })
}

async function create(ctx) {
  const { db, body, user } = ctx
  const data = clean(body || {})
  const name = String(data.name ?? '').trim()
  if (!name) bad('请输入供应商名称')

  if (await db.first('SELECT id FROM suppliers WHERE name = ?', name)) bad('供应商名称已存在')

  const now = nowLocal(ctx.env)
  const cols = [...CREATE_FIELDS, 'status', 'created_at', 'updated_at']
  const values = [
    ...CREATE_FIELDS.map((f) => (f === 'name' ? name : data[f] === undefined ? null : data[f])),
    1,
    now,
    now,
  ]

  const id = await db.insert(
    `INSERT INTO suppliers (${cols.map((c) => `"${c}"`).join(', ')})
     VALUES (${cols.map(() => '?').join(', ')})`,
    ...values
  )
  await logOp(db, user, '供应商管理', '新增供应商', name)

  const row = await db.first('SELECT * FROM suppliers WHERE id = ?', id)
  return json(toResponse(row))
}

async function get(ctx) {
  const { db, params } = ctx
  const row = await db.first('SELECT * FROM suppliers WHERE id = ?', Number(params.id))
  if (!row) notFound('供应商不存在')
  return json(toResponse(row))
}

async function update(ctx) {
  const { db, body, user, params } = ctx
  const id = Number(params.id)

  const existing = await db.first('SELECT * FROM suppliers WHERE id = ?', id)
  if (!existing) notFound('供应商不存在')

  const incoming = {}
  for (const [k, v] of Object.entries(body || {})) {
    if (UPDATE_FIELDS.includes(k)) incoming[k] = v
  }
  const data = clean(incoming)

  if (data.name !== undefined) {
    const name = String(data.name ?? '').trim()
    if (!name) bad('请输入供应商名称')
    if (await db.first('SELECT id FROM suppliers WHERE name = ? AND id != ?', name, id)) {
      bad('供应商名称已存在')
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
    await db.run(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = ?`, ...values, id)
  }

  await logOp(db, user, '供应商管理', '编辑供应商', existing.name)

  const row = await db.first('SELECT * FROM suppliers WHERE id = ?', id)
  return json(toResponse(row))
}

async function remove(ctx) {
  const { db, user, params, url } = ctx
  const id = Number(params.id)
  const force = boolParam(url.searchParams.get('force'))

  const supplier = await db.first('SELECT * FROM suppliers WHERE id = ?', id)
  if (!supplier) notFound('供应商不存在')

  const { amount, orderCount } = await calcOutstanding(db, id)
  if (amount > 0 && !force) {
    bad(
      `该供应商存在未结清应付款 ¥${amount.toFixed(2)}（关联 ${orderCount} 张采购单），` +
        `请先完成付款或作废相关单据后再删除`
    )
  }

  const totalOrders = await db.count('SELECT COUNT(*) AS n FROM purchase_orders WHERE supplier_id = ?', id)
  if (totalOrders > 0) {
    bad(
      `该供应商已被 ${totalOrders} 张采购单引用，删除会导致历史单据失去往来单位。请改用「禁用」状态。`
    )
  }

  const totalReturns = await db.count('SELECT COUNT(*) AS n FROM purchase_returns WHERE supplier_id = ?', id)
  if (totalReturns > 0) {
    bad(`该供应商已被 ${totalReturns} 张采购退货单引用，无法删除。请改用「禁用」状态。`)
  }

  await db.run('DELETE FROM suppliers WHERE id = ?', id)
  await logOp(
    db,
    user,
    '供应商管理',
    '删除供应商',
    supplier.name,
    `应付款:¥${amount.toFixed(2)}${force ? '(强制删除)' : ''}`
  )
  return ok('删除成功')
}

export const routes = [
  { method: 'GET', path: /^\/api\/suppliers$/, perm: 'supplier:view', handler: list },
  { method: 'POST', path: /^\/api\/suppliers$/, perm: 'supplier:add', handler: create },
  { method: 'GET', path: /^\/api\/suppliers\/(?<id>\d+)\/outstanding$/, perm: 'supplier:view', handler: outstanding },
  { method: 'GET', path: /^\/api\/suppliers\/(?<id>\d+)$/, perm: 'supplier:view', handler: get },
  { method: 'PUT', path: /^\/api\/suppliers\/(?<id>\d+)$/, perm: 'supplier:edit', handler: update },
  { method: 'DELETE', path: /^\/api\/suppliers\/(?<id>\d+)$/, perm: 'supplier:delete', handler: remove },
]
